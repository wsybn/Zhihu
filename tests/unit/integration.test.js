// tests/integration.test.js
// 集成测试：Tool Calling 多轮 / 工具计数与取消超时 / 文章问答检索范围 /
// 用户数据与权限隔离 / 重启恢复 / 索引幂等。
// 通过 _setClientForTest 注入假 DeepSeek 客户端，不消耗真实 API 额度。

const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')

// 独立数据目录，避免与 agent.test.js 并发时互相干扰
const tmpData = path.join(__dirname, '..', '.tmp-agent-data-it')
process.env.AGENT_DATA_DIR = tmpData
fs.rmSync(tmpData, { recursive: true, force: true })

process.env.DEEPSEEK_API_KEY = 'test-key'

const deepseek = require('../../server/ai/deepseekClient')
const { ERROR_CODES, classifyAiError } = require('../../server/ai/error')
const agentRepo = require('../../server/repositories/agentRepository')
const knowledgeRepo = require('../../server/repositories/knowledgeRepository')
const knowledgeService = require('../../server/knowledge/knowledgeService')
const knowledgeAgent = require('../../server/agent/knowledgeAgent')
const tools = require('../../server/agent/tools')
const { AgentOrchestrator } = require('../../server/agent/agentOrchestrator')

test('Tool Calling 多轮：客户端维护 history，不依赖 previous_response_id，支持一次返回多个 function_call', async () => {
  const calls = []
  const fakeClient = {
    responses: {
      create: async (params) => {
        calls.push(params)
        if (calls.length === 1) {
          return {
            output: [
              { type: 'message', content: [{ type: 'output_text', text: '需要检索' }] },
              { type: 'function_call', id: 'call-1', name: 'search_articles', arguments: '{"query":"Vue"}' },
              { type: 'function_call', id: 'call-2', name: 'search_knowledge_base', arguments: '{"query":"Vue"}' }
            ],
            output_text: ''
          }
        }
        return {
          output: [{ type: 'message', content: [{ type: 'output_text', text: '最终答案' }] }],
          output_text: '最终答案'
        }
      }
    }
  }
  deepseek._setClientForTest(fakeClient)

  const called = []
  const result = await deepseek.chatWithTools({
    instructions: 'test',
    input: '帮我查资料',
    tools: [
      { type: 'function', name: 'search_articles' },
      { type: 'function', name: 'search_knowledge_base' }
    ],
    onToolCall: async (name, args, meta) => {
      called.push({ name, args, callId: meta.callId })
      return { result: { ok: true } }
    }
  })

  assert.equal(result.text, '最终答案')
  assert.equal(called.length, 2)
  assert.equal(result.toolLogs.length, 2)

  // 无状态：第一轮请求绝不能带 previous_response_id
  assert.equal(calls[0].previous_response_id, undefined)
  assert.equal(calls[1].previous_response_id, undefined)

  // 第二轮 input 里包含 function_call 与 function_call_output（历史在客户端维护）
  const secondInput = calls[1].input
  assert.ok(secondInput.some(item => item.type === 'function_call' && item.call_id === 'call-1'))
  assert.ok(secondInput.some(item => item.type === 'function_call_output' && item.call_id === 'call-1'))
  assert.ok(secondInput.some(item => item.type === 'function_call' && item.call_id === 'call-2'))
  assert.ok(secondInput.some(item => item.type === 'function_call_output' && item.call_id === 'call-2'))
})

test('Tool Calling 达到最大轮数：抛 TOOL_ITERATION_LIMIT，且 AppError 原样透传', async () => {
  const fakeClient = {
    responses: {
      create: async () => ({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '继续' }] },
          { type: 'function_call', id: 'c', name: 'search_articles', arguments: '{"query":"x"}' }
        ],
        output_text: ''
      })
    }
  }
  deepseek._setClientForTest(fakeClient)

  await assert.rejects(
    () => deepseek.chatWithTools({
      instructions: 'test',
      input: 'x',
      tools: [{ type: 'function', name: 'search_articles' }],
      maxToolIterations: 2,
      onToolCall: async () => ({ result: { ok: true } })
    }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.TOOL_ITERATION_LIMIT)
      // 已经是 AppError，再经 classifyAiError 也不会被降级重归类
      assert.equal(classifyAiError(err).code, ERROR_CODES.TOOL_ITERATION_LIMIT)
      return true
    }
  )
})

test('工具执行：总次数上限 / 取消 / 超时 / 失败 状态区分', async () => {
  const registry = tools.createRegistry()

  // 总次数上限（用小上限覆盖）
  const callCounts = new Map()
  const ctx = { callCounts, currentArticle: { title: 'T' }, maxTotalCalls: 3 }
  for (let i = 0; i < 3; i++) {
    await tools.executeTool(registry, 'get_current_article_context', {}, ctx)
  }
  const limited = await tools.executeTool(registry, 'get_current_article_context', {}, ctx)
  assert.equal(limited.limit, true)
  assert.ok(limited.error.includes('总次数'))

  // 取消：父信号已中止
  const ac = new AbortController()
  ac.abort()
  const cancelled = await tools.executeTool(registry, 'get_current_article_context', {}, {
    signal: ac.signal, callCounts: new Map(), currentArticle: { title: 'T' }
  })
  assert.equal(cancelled.cancelled, true)

  // 失败：工具抛错时只返回安全文案，不泄露内部信息
  registry.byName.set('boom', {
    name: 'boom',
    description: '',
    parameters: { type: 'object', properties: {}, required: [] },
    maxCalls: 5,
    timeoutMs: 1000,
    execute: async () => { throw new Error('内部 secret 堆栈') }
  })
  const failed = await tools.executeTool(registry, 'boom', {}, { callCounts: new Map() })
  assert.equal(failed.error, '工具执行失败')
  assert.ok(!failed.error.includes('secret'))

  // 超时：慢工具超过 timeoutMs（工具须监听 ctx.signal，超时后中止并抛出）
  registry.byName.set('slow', {
    name: 'slow',
    description: '',
    parameters: { type: 'object', properties: {}, required: [] },
    maxCalls: 5,
    timeoutMs: 20,
    execute: (args, toolCtx) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: 1 }), 300)
      toolCtx.signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
  })
  const timedOut = await tools.executeTool(registry, 'slow', {}, { callCounts: new Map() })
  assert.equal(timedOut.timeout, true)
})

test('mergeAbortSignals：任一信号中止即触发合并信号，并可清理监听器', () => {
  const a = new AbortController()
  const b = new AbortController()
  const { signal, cleanup } = tools.mergeAbortSignals([a.signal, b.signal])
  assert.equal(signal.aborted, false)
  b.abort()
  assert.equal(signal.aborted, true)
  cleanup()
})

test('文章问答只检索当前文章：searchArticle / searchTemporaryArticle 不串到其他文章', async () => {
  await knowledgeService.indexArticle({ id: 'a1', title: 'Vue3', content: 'Vue3 组合式 API 让逻辑复用更简单' }, { authorId: '2' })
  await knowledgeService.indexArticle({ id: 'a2', title: 'React', content: 'React Fiber 是可中断的渲染架构' }, { authorId: '2' })

  const byArticle = await knowledgeService.searchArticle('a1', '组合式 API')
  assert.ok(byArticle.length > 0)
  assert.ok(byArticle.every(c => c.articleId === 'a1'))

  // 未索引文章：临时切块检索，同样只返回该文章
  const temp = await knowledgeService.searchTemporaryArticle(
    { id: 'a9', title: '临时', content: '这是一篇临时文章的独特内容' },
    '独特内容'
  )
  assert.ok(temp.every(c => c.articleId === 'a9'))

  // 无任何资料时 askArticle 明确告知，不编造
  const empty = await knowledgeAgent.askArticle('x', {
    articleId: 'none',
    post: { id: 'none', title: 't', content: '' },
    knowledgeService
  })
  assert.equal(empty.citations.length, 0)
  assert.ok(empty.answer.includes('没有足够资料'))
})

test('用户数据与权限隔离：文档/Chunk 按 authorId 归属', async () => {
  await knowledgeService.indexArticle({ id: 'u1-a', title: 'A', content: '用户1的内容' }, { authorId: 'userA' })
  await knowledgeService.indexArticle({ id: 'u2-a', title: 'B', content: '用户2的内容' }, { authorId: 'userB' })

  assert.equal(knowledgeRepo.listDocumentsByAuthor('userA').length, 1)
  assert.equal(knowledgeRepo.listDocumentsByAuthor('userB').length, 1)
  assert.equal(knowledgeRepo.listDocumentsByAuthor('userC').length, 0)

  const chunksUserA = knowledgeRepo.listChunksByAuthor('userA')
  assert.ok(chunksUserA.length > 0)
  assert.ok(chunksUserA.every(c => String(c.articleId) === 'u1-a'))
})

test('会话/消息/Run 归属校验：listMessagesBySessionAndUser 与 listRunsBySessionAndUser', () => {
  const s1 = agentRepo.createSession({ title: 't', userId: 'u1' })
  const s2 = agentRepo.createSession({ title: 't', userId: 'u2' })
  agentRepo.createMessage({ sessionId: s1.id, role: 'user', type: 'text', content: 'hi', userId: 'u1' })
  agentRepo.createMessage({ sessionId: s2.id, role: 'user', type: 'text', content: 'hi', userId: 'u2' })
  agentRepo.createRun({ sessionId: s1.id, type: 'chat', status: 'completed', userId: 'u1' })

  assert.equal(agentRepo.listMessagesBySessionAndUser(s1.id, 'u1').total, 1)
  assert.equal(agentRepo.listMessagesBySessionAndUser(s1.id, 'u2').total, 0)
  assert.equal(agentRepo.listRunsBySessionAndUser(s1.id, 'u1').length, 1)
  assert.equal(agentRepo.listRunsBySessionAndUser(s1.id, 'u2').length, 0)
})

test('重启恢复：running 状态的 Run 与 Step 被标记为 failed', () => {
  const orch = new AgentOrchestrator()
  const s = agentRepo.createSession({ title: 't', userId: 'u1' })
  const run = orch.createRun({ sessionId: s.id, type: 'writing', userId: 'u1' })
  orch.startStep(run.id, 'goal_analysis', {})

  const recovered = orch.recoverInterruptedRuns()
  assert.equal(recovered, 1)

  const after = orch.getRun(run.id)
  assert.equal(after.status, 'failed')
  const step = after.steps.find(x => x.stepKey === 'goal_analysis')
  assert.equal(step.status, 'failed')
  assert.ok(step.error.includes('服务重启'))
})

test('知识库索引幂等：同一文章重复索引不产生重复 Chunk', async () => {
  const first = await knowledgeService.indexArticle({ id: 'idem', title: 'T', content: '第一段。\n\n第二段。' }, { authorId: '2' })
  const second = await knowledgeService.indexArticle({ id: 'idem', title: 'T', content: '第一段。\n\n第二段。' }, { authorId: '2' })
  assert.equal(first.chunkCount, second.chunkCount)
  assert.equal(knowledgeRepo.listChunksByArticle('idem').length, second.chunkCount)
})
