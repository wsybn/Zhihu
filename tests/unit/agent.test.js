// tests/agent.test.js
// 后端 Agent 平台测试：错误分类 / schema 校验 / SSE 事件 / 编排器 / 工具 / 检索 / 知识库。

const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')

// 隔离测试数据目录
const tmpData = path.join(__dirname, '..', '.tmp-agent-data')
process.env.AGENT_DATA_DIR = tmpData
fs.rmSync(tmpData, { recursive: true, force: true })

const { classifyAiError, ERROR_CODES } = require('../../server/ai/error')
const { validateAgainstSchema } = require('../../server/ai/validateStructuredOutput')
const outlineSchema = require('../../server/ai/schemas/outlineSchema')
const reviewSchema = require('../../server/ai/schemas/reviewSchema')
const { formatSseEvent } = require('../../server/ai/sse')
const { AgentOrchestrator } = require('../../server/agent/agentOrchestrator')
const agentRepo = require('../../server/repositories/agentRepository')
const tools = require('../../server/agent/tools')
const { splitIntoChunks, cleanText } = require('../../server/knowledge/chunkSplitter')
const { embed, cosineSimilarity, provider } = require('../../server/knowledge/embeddingService')
const knowledgeAgent = require('../../server/agent/knowledgeAgent')
const { searchKeyword } = require('../../server/retrieval/keywordSearch')
const { rrf } = require('../../server/retrieval/hybridSearch')

test('错误分类：401/402/429/500/网络/取消 均可识别且不泄露原始信息', () => {
  const auth = classifyAiError({ status: 401, message: 'secret api key xyz' })
  assert.equal(auth.code, ERROR_CODES.AI_AUTH_FAILED)
  assert.equal(auth.retryable, false)

  const balance = classifyAiError({ status: 402 })
  assert.equal(balance.code, ERROR_CODES.AI_BALANCE)

  const limited = classifyAiError({ status: 429 })
  assert.equal(limited.code, ERROR_CODES.AI_RATE_LIMITED)
  assert.equal(limited.retryable, true)

  const server = classifyAiError({ status: 500, message: 'internal stack trace' })
  assert.equal(server.code, ERROR_CODES.AI_REQUEST_FAILED)
  assert.equal(server.retryable, true)

  const net = classifyAiError({ code: 'ETIMEDOUT' })
  assert.equal(net.code, ERROR_CODES.AI_TIMEOUT)

  const cancelled = classifyAiError({ name: 'AbortError' })
  assert.equal(cancelled.code, ERROR_CODES.CANCELLED)

  // 不泄露原始信息：错误对象里没有 api key / 堆栈
  const resp = server.toResponse()
  assert.ok(!JSON.stringify(resp).includes('internal stack trace'))
  assert.ok(!JSON.stringify(resp).includes('secret api key'))
})

test('结构化输出校验：缺失字段 / 越界 clamp / 枚举归一化', () => {
  assert.equal(validateAgainstSchema(outlineSchema, { goal: 'g' }).ok, false)

  const ok = validateAgainstSchema(outlineSchema, {
    goal: 'g',
    audience: 'a',
    estimatedLength: 2000,
    titleCandidates: ['t1'],
    sections: [{ id: 's', title: '章节', keyPoints: ['k'], status: 'pending' }]
  })
  assert.equal(ok.ok, true)

  const clamped = validateAgainstSchema(outlineSchema, {
    goal: 'g',
    audience: 'a',
    estimatedLength: 999999,
    titleCandidates: ['1', '2', '3', '4', '5', '6'],
    sections: [{ id: 's', title: 't', keyPoints: ['k'], status: 'bad' }]
  })
  assert.equal(clamped.ok, true)
  assert.equal(clamped.value.titleCandidates.length, 5)
  assert.equal(clamped.value.estimatedLength, 20000)
  assert.equal(clamped.value.sections[0].status, 'pending')

  const review = validateAgainstSchema(reviewSchema.review, {
    score: 150,
    summary: 's',
    issues: [{ severity: 'ERR', category: 'typo', message: 'm' }]
  })
  assert.equal(review.ok, true)
  assert.equal(review.value.score, 100)
  assert.equal(review.value.issues[0].severity, 'info')
  assert.equal(review.value.issues[0].category, 'spelling')
})

test('SSE 事件格式化：包含 runId/stepId/timestamp/data 与正确帧格式', () => {
  const frame = formatSseEvent('message.delta', { runId: 'r1', stepId: 's1', data: { content: 'hi' } })
  assert.ok(frame.startsWith('event: message.delta\n'))
  const dataLine = frame.split('\n').find(l => l.startsWith('data: '))
  const parsed = JSON.parse(dataLine.slice(6))
  assert.equal(parsed.runId, 'r1')
  assert.equal(parsed.stepId, 's1')
  assert.ok(parsed.timestamp)
  assert.equal(parsed.data.content, 'hi')
})

test('编排器：7 步骤 / waiting_for_user / cancel / retry', () => {
  const orch = new AgentOrchestrator()
  const session = agentRepo.createSession({ title: 't' })
  const run = orch.createRun({ sessionId: session.id, type: 'writing' })
  assert.equal(run.steps.length, 7)

  orch.startStep(run.id, 'outline_generation', { title: 'x' })
  orch.completeStep(run.id, 'outline_generation', { goal: 'g' })
  const waiting = orch.waitingForUser(run.id, 'outline_confirmation')
  assert.equal(waiting.status, 'waiting_for_user')
  assert.equal(waiting.currentStep, 'outline_confirmation')

  // 确认大纲后才进入 section_writing
  const confirmed = orch.confirmOutline(run.id)
  assert.equal(confirmed.currentStep, 'section_writing')

  // 取消后不能继续调用（retry 抛 CANCELLED）
  const run2 = orch.createRun({ sessionId: session.id, type: 'writing' })
  orch.startStep(run2.id, 'article_review')
  orch.cancel(run2.id)
  const cancelled = orch.getRun(run2.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.throws(() => orch.retryStep(run2.id, 'article_review'), err => err.code === ERROR_CODES.CANCELLED)
})

test('工具注册表：白名单 / 参数校验 / 调用次数限制', async () => {
  const registry = tools.createRegistry()
  assert.equal(registry.tools.length, 8)
  assert.equal(tools.isAllowedTool(registry.byName, 'search_articles'), true)
  assert.equal(tools.isAllowedTool(registry.byName, 'delete_article'), false)

  // 缺参返回错误
  const missing = await tools.executeTool(registry, 'search_articles', {}, {})
  assert.ok(missing.error)

  // 只读工具可用
  const result = await tools.executeTool(registry, 'get_current_article_context', {}, {
    currentArticle: { title: 'T', content: 'C', selection: '' }
  })
  assert.equal(result.result.title, 'T')

  // 调用次数限制
  const callCounts = new Map()
  const ctx = { callCounts, currentArticle: { title: 'T' } }
  for (let i = 0; i < 6; i++) {
    await tools.executeTool(registry, 'get_current_article_context', {}, ctx)
  }
  const limited = await tools.executeTool(registry, 'get_current_article_context', {}, ctx)
  assert.ok(limited.error && limited.error.includes('上限'))
})

test('Chunk 切分：清理 Markdown/HTML 并按段落切块', () => {
  const cleaned = cleanText('## 标题\n这是**加粗** <b>html</b> 文本')
  assert.ok(!cleaned.includes('#') && !cleaned.includes('**') && !cleaned.includes('<b>'))

  const chunks = splitIntoChunks('第一段内容。\n\n第二段内容。\n\n第三段内容。', { maxChars: 100 })
  assert.ok(chunks.length >= 1)
  assert.ok(chunks.every(c => c.length > 0))
})

test('Embedding fallback：归一化向量 + 相似文本余弦更接近', async () => {
  assert.equal(provider.isFallback, true)
  const a = await embed('Vue3 组合式 API')
  const b = await embed('Vue3 组合式 API 详解')
  const c = await embed('红烧肉的做法')
  const ab = cosineSimilarity(a, b)
  const ac = cosineSimilarity(a, c)
  assert.ok(ab > ac, `相似文本相似度应更高：ab=${ab} ac=${ac}`)
})

test('关键词检索与 RRF 融合', () => {
  const docs = [
    { articleId: '1', title: 'Vue3 组合式 API', content: '组合式 API 让逻辑复用更简单' },
    { articleId: '2', title: 'React Fiber 架构', content: 'Fiber 是可中断的渲染架构' }
  ]
  const res = searchKeyword('组合式 API', docs)
  assert.equal(res[0].articleId, '1')

  const fused = rrf([[{ articleId: '1', title: 'a', chunk: 'x' }], [{ articleId: '1', title: 'a', chunk: 'y' }]])
  assert.ok(fused.length >= 1)
})

test('知识库问答：无检索结果时不编造答案', async () => {
  const fakeKnowledge = { search: async () => [] }
  const result = await knowledgeAgent.knowledgeChat('这个问题有答案吗', {
    authorId: '2',
    db: { get: () => ({ value: () => [] }) },
    knowledgeService: fakeKnowledge
  })
  assert.equal(result.citations.length, 0)
  assert.ok(result.answer.includes('没有足够资料'))
})
