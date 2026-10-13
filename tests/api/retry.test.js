// tests/api/retry.test.js
// 重试执行器：基于服务端 requestSnapshot 真实重新执行，取消 run 不可重试，缺失快照报错。

const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const agentRepo = require('../../server/repositories/agentRepository')
const { makeTempDb, makeTempDataDir, testUsers, testColumns, testPosts, makeFakeClient, resetAllStores } = require('./helpers')

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

test('重试基于服务端快照真实重新执行，而非前端重新提交的请求体', async () => {
  const calls = []
  const client = makeFakeClient({ text: '回答', onCall: params => calls.push(params) })
  const { request } = buildApp(client)
  const session = await createSession(request, 'token-a')

  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '原始消息A' })
  assert.equal(chat.status, 200)
  const runId = chat.body.data.run.id
  assert.equal(calls.length, 1)
  assert.ok(String(calls[0].input).includes('原始消息A'))

  // 生命周期规则：只有 failed 的 run 可以重试，先把 run 置为 failed
  agentRepo.updateRun(runId, { status: 'failed' })

  // 重试请求体故意为空，服务端应仍按快照中的「原始消息A」执行
  const retry = await request
    .post(`/api/agent/runs/${runId}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(retry.status, 200)
  assert.equal(retry.body.data.run.id, runId)
  assert.ok(retry.body.data.message) // 产生新的 assistant 消息

  assert.equal(calls.length, 2, '重试应真实调用模型一次')
  assert.ok(String(calls[1].input).includes('原始消息A'), '重试输入应来自服务端快照')

  // 步骤 retryCount 增加
  const run = await request.get(`/api/agent/runs/${runId}`).set('Authorization', 'Bearer token-a')
  const goal = run.body.data.steps.find(s => s.stepKey === 'goal_analysis')
  assert.equal(goal.retryCount, 1)
})

test('已取消的 run 不可重试（返回 499）', async () => {
  const { request } = buildApp()
  // 直接构造一个 cancelled run（userId 归属 user 1）
  const run = agentRepo.createRun({ sessionId: 'x', type: 'chat', status: 'cancelled', userId: '1' })
  const res = await request
    .post(`/api/agent/runs/${run.id}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(res.status, 499)
})

test('缺失请求快照的 run 重试返回 409', async () => {
  const { request } = buildApp()
  const run = agentRepo.createRun({ sessionId: 'x', type: 'chat', status: 'failed', userId: '1' })
  const res = await request
    .post(`/api/agent/runs/${run.id}/retry`)
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(res.status, 409)
})

test('跨用户重试返回 404', async () => {
  const { request } = buildApp()
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: 'hi' })
  const runId = chat.body.data.run.id

  const cross = await request
    .post(`/api/agent/runs/${runId}/retry`)
    .set('Authorization', 'Bearer token-b')
    .send({})
  assert.equal(cross.status, 404)
})
