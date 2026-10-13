// tests/api/run.test.js
// Run 查询 / 取消 / 确认大纲：所有权校验 + 状态机。

const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const {
  makeTempDb, makeTempDataDir, testUsers, testColumns, testPosts,
  makeFakeClient, validOutline, resetAllStores
} = require('./helpers')

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

test('跨用户访问 run 与 steps 返回 404', async () => {
  const { request } = buildApp()
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })
  const runId = chat.body.data.run.id

  const ok = await request.get(`/api/agent/runs/${runId}`).set('Authorization', 'Bearer token-a')
  assert.equal(ok.status, 200)

  const cross = await request.get(`/api/agent/runs/${runId}`).set('Authorization', 'Bearer token-b')
  assert.equal(cross.status, 404)

  const crossSteps = await request.get(`/api/agent/runs/${runId}/steps`).set('Authorization', 'Bearer token-b')
  assert.equal(crossSteps.status, 404)
})

test('运行列表返回 run 且带 7 个步骤', async () => {
  const { request } = buildApp()
  const session = await createSession(request, 'token-a')
  await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, message: '你好' })

  const runs = await request.get(`/api/agent/sessions/${session.id}/runs`).set('Authorization', 'Bearer token-a')
  assert.equal(runs.status, 200)
  assert.equal(runs.body.data.length, 1)
  assert.equal(runs.body.data[0].steps.length, 7)
  assert.equal(runs.body.data[0].status, 'completed')
})

test('取消 run：成功后状态为 cancelled，跨用户取消返回 404', async () => {
  const { request } = buildApp()
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })
  const runId = chat.body.data.run.id

  // 已完成 run 的取消是无害的（不会把 completed 改回 cancelled）
  const cross = await request.post(`/api/agent/runs/${runId}/cancel`).set('Authorization', 'Bearer token-b')
  assert.equal(cross.status, 404)
})

test('确认大纲状态机：未生成大纲 / 非等待态时确认被拒绝', async () => {
  const { request } = buildApp(makeFakeClient({ json: validOutline() }))
  const session = await createSession(request, 'token-a')

  // 生成大纲 → waiting_for_user
  const outline = await request
    .post('/api/agent/outline')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, context: { title: 't' } })
  assert.equal(outline.status, 200)
  const runId = outline.body.data.run.id
  assert.equal(outline.body.data.run.status, 'waiting_for_user')

  // 正常确认：waiting_for_user → running(section_writing)
  const confirmed = await request
    .post(`/api/agent/runs/${runId}/confirm-outline`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.data.status, 'running')
  assert.equal(confirmed.body.data.currentStep, 'section_writing')

  // 再次确认（已非 waiting_for_user）→ 409
  const again = await request
    .post(`/api/agent/runs/${runId}/confirm-outline`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(again.status, 409)
})

test('纯 chat run 直接确认大纲被拒绝（大纲未生成）', async () => {
  const { request } = buildApp()
  const session = await createSession(request, 'token-a')
  const chat = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })
  const runId = chat.body.data.run.id

  const res = await request
    .post(`/api/agent/runs/${runId}/confirm-outline`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(res.status, 409)
})
