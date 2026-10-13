// tests/api/runStateMachine.test.js
// Run 生命周期状态机：执行失败统一 failStep / 工具模式重试 / 重试与取消的终态规则 / 并发互斥。

const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const agentRepo = require('../../server/repositories/agentRepository')
const { makeTempDb, makeTempDataDir, testUsers, testColumns, testPosts, makeFakeClient, validOutline, resetAllStores } = require('./helpers')

const STEPS = ['goal_analysis', 'internal_research', 'outline_generation', 'outline_confirmation', 'section_writing', 'article_review', 'publish_preparation']

function buildApp(client) {
  const dataDir = makeTempDataDir()
  const { dbPath } = makeTempDb({ users: testUsers(), columns: testColumns(), posts: testPosts() })
  const app = createApp({ dataDir, databasePath: dbPath, aiClient: client || makeFakeClient() })
  resetAllStores()
  return { app, request: supertest(app) }
}

async function createSession(request, token) {
  const res = await request.post('/api/agent/sessions').set('Authorization', `Bearer ${token}`).send({ title: 's' })
  return res.body.data
}

// 直接构造一个带 7 个步骤与请求快照的 run（绕过 HTTP 首次请求）
function createRunWithSteps({ sessionId = 'sess-x', type = 'chat', status = 'failed', userId = '1', requestSnapshot }) {
  const run = agentRepo.createRun({ sessionId, type, status, userId, requestSnapshot })
  STEPS.forEach(key => agentRepo.createRunStep({ runId: run.id, stepKey: key, status: 'pending' }))
  return run
}

function throwingClient(error) {
  return {
    responses: {
      create: async () => { throw error }
    }
  }
}

// ---------- 问题一：非流式请求失败后统一 failStep ----------

test('chat 模型调用失败后 Run 与 goal_analysis 步骤均为 failed', async () => {
  const { request } = buildApp(throwingClient(new Error('网络错误')))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })
  assert.equal(res.status, 502)

  // 通过会话运行列表拿到 runId
  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const target = runs.body.data[0]
  assert.equal(target.status, 'failed')
  const goal = target.steps.find(s => s.stepKey === 'goal_analysis')
  assert.equal(goal.status, 'failed')
})

test('outline 结构化输出失败后 outline_generation 与 Run 均为 failed', async () => {
  const { request } = buildApp(makeFakeClient({ text: '这不是合法 JSON' }))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/outline')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, context: { title: 't' } })
  assert.equal(res.status, 502)
  assert.equal(res.body.error.code, 'AI_STRUCTURED_OUTPUT_INVALID')

  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const run = runs.body.data[0]
  assert.equal(run.status, 'failed')
  const step = run.steps.find(s => s.stepKey === 'outline_generation')
  assert.equal(step.status, 'failed')
})

test('article-patch 失败后 section_writing 与 Run 均为 failed', async () => {
  const { request } = buildApp(makeFakeClient({ text: '不是 JSON' }))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/article-patch')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, action: 'polish' })
  assert.equal(res.status, 502)

  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const run = runs.body.data[0]
  assert.equal(run.status, 'failed')
  assert.equal(run.steps.find(s => s.stepKey === 'section_writing').status, 'failed')
})

test('review 失败后 article_review 与 Run 均为 failed', async () => {
  const { request } = buildApp(makeFakeClient({ text: '不是 JSON' }))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/review')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, context: { content: 'c' } })
  assert.equal(res.status, 502)

  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const run = runs.body.data[0]
  assert.equal(run.status, 'failed')
  assert.equal(run.steps.find(s => s.stepKey === 'article_review').status, 'failed')
})

test('Abort 后 Run 为 cancelled，不被 failStep 覆盖为 failed', async () => {
  const abortErr = new Error('aborted')
  abortErr.name = 'AbortError'
  const { request } = buildApp(throwingClient(abortErr))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })
  assert.equal(res.status, 499)

  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const run = runs.body.data[0]
  assert.equal(run.status, 'cancelled')
  assert.notEqual(run.status, 'failed')
})

// ---------- 问题二：工具模式 run 可基于服务端快照真实重试 ----------

test('工具模式 Run 可基于服务端快照真实重试（真实执行带工具调用的对话）', async () => {
  const calls = []
  const client = {
    responses: {
      create: async (params) => {
        calls.push(params)
        if (calls.length === 1) {
          return {
            output: [
              { type: 'message', content: [{ type: 'output_text', text: '需要上下文' }] },
              { type: 'function_call', id: 'c1', name: 'get_current_article_context', arguments: '{}' }
            ],
            output_text: ''
          }
        }
        return { output: [{ type: 'message', content: [{ type: 'output_text', text: '结合上下文回答' }] }], output_text: '结合上下文回答' }
      }
    }
  }
  const { request } = buildApp(client)
  const session = await createSession(request, 'token-a')

  const run = createRunWithSteps({
    sessionId: session.id,
    status: 'failed',
    requestSnapshot: { operation: 'chat', request: { message: '查一下', title: 'T', content: 'C', selection: '', useTools: true } }
  })

  const retry = await request
    .post(`/api/agent/runs/${run.id}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({ message: '前端篡改的消息不应被采用' })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.data.run.id, run.id)
  assert.equal(retry.body.data.message.content, '结合上下文回答')

  // 真实执行了工具多轮（chatWithTools），而非退化为普通 chat
  assert.ok(calls.length >= 2, `应有多轮模型调用，实际 ${calls.length}`)
  assert.ok(Array.isArray(calls[0].tools) && calls[0].tools.length > 0, '首轮应携带 tools 白名单')
})

test('工具模式重试失败后不会停在 pending/running（进入 failed）', async () => {
  const { request } = buildApp(throwingClient(new Error('模型挂了')))
  const session = await createSession(request, 'token-a')

  const run = createRunWithSteps({
    sessionId: session.id,
    status: 'failed',
    requestSnapshot: { operation: 'chat', request: { message: '查一下', title: 'T', content: 'C', useTools: true } }
  })

  const retry = await request
    .post(`/api/agent/runs/${run.id}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(retry.status, 502)

  const after = await request.get(`/api/agent/runs/${run.id}`).set('Authorization', 'Bearer token-a')
  assert.equal(after.body.data.status, 'failed')
  assert.notEqual(after.body.data.status, 'pending')
  assert.notEqual(after.body.data.status, 'running')
  assert.equal(after.body.data.steps.find(s => s.stepKey === 'goal_analysis').status, 'failed')
})

// ---------- 问题三：Run 生命周期保护 ----------

test('completed Run 重试返回 409，且不会新增消息', async () => {
  const { request } = buildApp(makeFakeClient({ text: '回答' }))
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: 'hi' })
  const runId = chat.body.data.run.id

  const retry = await request
    .post(`/api/agent/runs/${runId}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(retry.status, 409)

  const messages = await request
    .get(`/api/agent/sessions/${session.id}/messages`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(messages.body.data.total, 1, '重试不应产生新消息')
})

test('pending / running / waiting_for_user Run 重试返回 409', async () => {
  const { request } = buildApp(makeFakeClient({ json: validOutline() }))
  const session = await createSession(request, 'token-a')

  const pending = createRunWithSteps({ sessionId: session.id, status: 'pending', requestSnapshot: { operation: 'chat', request: { message: 'x' } } })
  const running = createRunWithSteps({ sessionId: session.id, status: 'running', requestSnapshot: { operation: 'chat', request: { message: 'x' } } })

  for (const r of [pending, running]) {
    const res = await request.post(`/api/agent/runs/${r.id}/retry`).set('Authorization', 'Bearer token-a').send({})
    assert.equal(res.status, 409, `status=${r.status} 重试应 409`)
  }

  // waiting_for_user：由 outline 接口产生
  const outline = await request
    .post('/api/agent/outline')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, context: { title: 't' } })
  assert.equal(outline.body.data.run.status, 'waiting_for_user')
  const wfu = await request
    .post(`/api/agent/runs/${outline.body.data.run.id}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(wfu.status, 409)
})

test('cancelled Run 重试返回 499', async () => {
  const { request } = buildApp()
  const run = createRunWithSteps({ status: 'cancelled', requestSnapshot: { operation: 'chat', request: { message: 'x' } } })
  const res = await request.post(`/api/agent/runs/${run.id}/retry`).set('Authorization', 'Bearer token-a').send({})
  assert.equal(res.status, 499)
})

test('pending 与 waiting_for_user Run 均可取消', async () => {
  const { request } = buildApp(makeFakeClient({ json: validOutline() }))
  const session = await createSession(request, 'token-a')

  // pending run 取消
  const pending = createRunWithSteps({ sessionId: session.id, status: 'pending', requestSnapshot: { operation: 'chat', request: { message: 'x' } } })
  const c1 = await request.post(`/api/agent/runs/${pending.id}/cancel`).set('Authorization', 'Bearer token-a')
  assert.equal(c1.status, 200)
  assert.equal(c1.body.data.status, 'cancelled')
  assert.equal(c1.body.data.currentStep, null)

  // waiting_for_user run 取消（outline 生成的 run）
  const outline = await request
    .post('/api/agent/outline')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, context: { title: 't' } })
  const outlineRunId = outline.body.data.run.id
  const c2 = await request.post(`/api/agent/runs/${outlineRunId}/cancel`).set('Authorization', 'Bearer token-a')
  assert.equal(c2.status, 200)
  assert.equal(c2.body.data.status, 'cancelled')
  assert.equal(c2.body.data.currentStep, null)
  // 已完成的 outline_generation 保持 completed，waiting_for_user 的 outline_confirmation 置为 cancelled
  const steps = c2.body.data.steps
  assert.equal(steps.find(s => s.stepKey === 'outline_generation').status, 'completed')
  assert.equal(steps.find(s => s.stepKey === 'outline_confirmation').status, 'cancelled')
})

test('completed Run 调用取消后仍保持 completed', async () => {
  const { request } = buildApp(makeFakeClient({ text: '回答' }))
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: 'hi' })
  const runId = chat.body.data.run.id

  const cancel = await request.post(`/api/agent/runs/${runId}/cancel`).set('Authorization', 'Bearer token-a')
  assert.equal(cancel.status, 200)
  assert.equal(cancel.body.data.status, 'completed')
})

test('两个并发重试请求最多只有一个真正执行模型', async () => {
  let callCount = 0
  const client = {
    responses: {
      create: async () => {
        callCount++
        if (callCount === 1) throw new Error('首次失败')
        await new Promise(resolve => setTimeout(resolve, 20))
        return { output: [{ type: 'message', content: [{ type: 'output_text', text: '回答' }] }], output_text: '回答' }
      }
    }
  }
  const { request } = buildApp(client)
  const session = await createSession(request, 'token-a')

  // 首次请求失败，制造 failed run
  const first = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: 'hi' })
  assert.equal(first.status, 502)
  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  const runId = runs.body.data[0].id
  assert.equal(runs.body.data[0].status, 'failed')
  const before = callCount // 1

  const results = await Promise.all([
    request.post(`/api/agent/runs/${runId}/retry`).set('Authorization', 'Bearer token-a').send({}),
    request.post(`/api/agent/runs/${runId}/retry`).set('Authorization', 'Bearer token-a').send({})
  ])
  const statuses = results.map(r => r.status).sort()
  assert.deepEqual(statuses, [200, 409])
  // 仅多执行一次模型（并发中只有一个重试真正跑模型）
  assert.equal(callCount - before, 1, `并发重试应只有一次模型调用，实际 ${callCount - before} 次`)
})
