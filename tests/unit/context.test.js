const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const dataDir = path.join(__dirname, '..', '.tmp-context-data')
process.env.AGENT_DATA_DIR = dataDir
fs.rmSync(dataDir, { recursive: true, force: true })

const agentRepo = require('../../server/repositories/agentRepository')
const tokenCounter = require('../../server/agent/context/tokenCounter')
const { resolveContextPolicy } = require('../../server/agent/context/contextPolicy')
const { ContextBuilder } = require('../../server/agent/context/contextBuilder')
const { HistorySummarizer } = require('../../server/agent/context/historySummarizer')
const { compressToolResult } = require('../../server/agent/context/toolResultCompressor')
const tools = require('../../server/agent/tools')

test('中文保守 Token 估算不会退化为 length / 4', () => {
  const text = '中'.repeat(100)
  assert.ok(tokenCounter.estimateTextTokens(text) >= 100)
  assert.ok(tokenCounter.truncateTextToTokens(text, 20).length <= 21)
})

test('非法上下文配置回退默认值，并保留正预算', () => {
  const policy = resolveContextPolicy({ contextWindowTokens: 1, reservedOutputTokens: 999999 })
  assert.equal(policy.contextWindowTokens, 64000)
  assert.ok(policy.contextWindowTokens - policy.reservedOutputTokens - policy.safetyMarginTokens > 0)
})

test('ContextBuilder 保留当前消息、完整对话轮，并按优先级裁剪低优先级内容', async () => {
  const session = agentRepo.createSession({ userId: 'u1' })
  const user = agentRepo.createMessage({ sessionId: session.id, userId: 'u1', role: 'user', type: 'text', content: '第一轮问题' })
  agentRepo.createMessage({ sessionId: session.id, userId: 'u1', role: 'assistant', type: 'text', content: '第一轮回答' })
  const current = agentRepo.createMessage({ sessionId: session.id, userId: 'u1', role: 'user', type: 'text', content: '当前问题', clientMessageId: 'current' })
  const builder = new ContextBuilder({
    agentRepo,
    policy: {
      contextWindowTokens: 1024,
      reservedOutputTokens: 256,
      safetyMarginTokens: 32,
      maxHistoryTokens: 128,
      maxArticleTokens: 128,
      maxSelectionTokens: 128,
      maxRagTokens: 128,
      maxToolResultTokens: 128,
      maxSummaryTokens: 64,
      recentTurnsToKeep: 8,
      summaryTriggerRatio: 2
    }
  })
  const built = await builder.build({
    sessionId: session.id,
    userId: 'u1',
    request: { message: current.content, userMessageId: current.id, title: '标题', content: '文章正文 '.repeat(100), selection: '当前选区' },
    ragChunks: [{ chunkId: 'r1', score: 0.9, content: '检索资料' }, { chunkId: 'r1', score: 0.8, content: '重复资料' }]
  })
  assert.ok(built.input.some(message => message.content.includes('当前问题')))
  assert.ok(built.input.some(message => message.content.includes('当前选区')))
  assert.ok(built.usage.estimatedInputTokens <= built.usage.inputBudgetTokens)
  const historyMessages = built.input.filter(message => message.content.includes('第一轮'))
  assert.equal(historyMessages.length, 2)
  assert.equal(built.selectedBlocks.filter(block => block.kind === 'recent_history').length <= 1, true)
  assert.equal(user.role, 'user')
})

test('摘要触发后更新 Session，但不删除原始消息；摘要失败可降级', async () => {
  const session = agentRepo.createSession({ userId: 'u2' })
  const messages = []
  for (let i = 0; i < 5; i++) {
    messages.push(agentRepo.createMessage({ sessionId: session.id, userId: 'u2', role: 'user', type: 'text', content: `目标 ${i} ${'很长'.repeat(100)}` }))
    messages.push(agentRepo.createMessage({ sessionId: session.id, userId: 'u2', role: 'assistant', type: 'text', content: `结论 ${i} ${'很长'.repeat(100)}` }))
  }
  const summarizer = new HistorySummarizer({
    agentRepo,
    policy: { maxHistoryTokens: 256, summaryTriggerRatio: 1, recentTurnsToKeep: 2, maxSummaryTokens: 200 },
    deepseekClient: { chat: async () => JSON.stringify({ userGoals: ['持续写作'], preferences: [], confirmedFacts: [], decisions: [], unresolvedTasks: ['继续'], referencedEntities: [], narrative: '滚动摘要' }) }
  })
  const result = await summarizer.maybeSummarize({ sessionId: session.id, userId: 'u2', messages })
  assert.equal(result.updated, true)
  const updated = agentRepo.getSession(session.id)
  assert.equal(updated.summaryVersion, 1)
  assert.ok(updated.summaryUntilMessageId)
  assert.equal(agentRepo.listMessagesBySessionAndUser(session.id, 'u2').total, 10)

  const failing = new HistorySummarizer({
    agentRepo,
    policy: { maxHistoryTokens: 256, summaryTriggerRatio: 1, recentTurnsToKeep: 1 },
    deepseekClient: { chat: async () => { throw new Error('summary unavailable') } }
  })
  const fallback = await failing.maybeSummarize({ sessionId: session.id, userId: 'u2', messages })
  assert.equal(fallback.updated, false)
  assert.equal(fallback.failed, true)
})

test('工具结果压缩会脱敏、按工具类型摘要并受 Token 上限约束', () => {
  const compressed = compressToolResult({
    toolName: 'search_articles',
    result: { items: [{ id: 'a1', title: '文章', excerpt: '摘要', password: 'secret' }], token: 'secret' },
    maxTokens: 30
  })
  const serialized = JSON.stringify(compressed.compactResult)
  assert.ok(!serialized.includes('secret'))
  assert.ok(compressed.compactTokenEstimate <= 30)
})

test('Checkpoint 可跨 Repository 重载，成功工具调用按幂等键只执行一次', async () => {
  const session = agentRepo.createSession({ userId: 'u3' })
  const run = agentRepo.createRun({ sessionId: session.id, type: 'chat', userId: 'u3' })
  agentRepo.updateRunCheckpoint(run.id, {
    phase: 'tool_results_ready',
    userMessageId: 'm1',
    completedToolCallIds: ['call-1'],
    compactToolResults: [{ callId: 'call-1', toolName: 'safe', result: { ok: true } }]
  })
  agentRepo.resetStores()
  const reloaded = agentRepo.getRun(run.id)
  assert.equal(reloaded.checkpoint.phase, 'tool_results_ready')
  assert.deepEqual(reloaded.checkpoint.completedToolCallIds, ['call-1'])

  let executions = 0
  const registry = {
    tools: [],
    byName: new Map([['safe', {
      name: 'safe',
      parameters: { type: 'object', properties: {}, required: [] },
      maxCalls: 5,
      timeoutMs: 1000,
      execute: async () => { executions++; return { ok: true } }
    }]])
  }
  const first = await tools.executeTool(registry, 'safe', {}, { runId: run.id, userId: 'u3', idempotencyKey: `${run.id}:call-1`, callCounts: new Map() })
  const second = await tools.executeTool(registry, 'safe', {}, { runId: run.id, userId: 'u3', idempotencyKey: `${run.id}:call-1`, callCounts: new Map() })
  assert.equal(executions, 1)
  assert.equal(first.result.ok, true)
  assert.equal(second.reused, true)
})
