// tests/api/session.test.js
// 会话所有权：跨用户访问会话 / 消息 / 运行必须 404，不能串到他人数据。

const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const { makeTempDb, makeTempDataDir, testUsers, testColumns, testPosts, makeFakeClient, resetAllStores } = require('./helpers')

function buildApp() {
  const dataDir = makeTempDataDir()
  const { dbPath } = makeTempDb({ users: testUsers(), columns: testColumns(), posts: testPosts() })
  const app = createApp({ dataDir, databasePath: dbPath, aiClient: makeFakeClient() })
  resetAllStores()
  return { app, request: supertest(app) }
}

async function createSessionFor(request, token, title) {
  const res = await request
    .post('/api/agent/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ title })
  assert.equal(res.status, 200)
  return res.body.data
}

test('跨用户访问会话详情返回 404（统一为不存在）', async () => {
  const { request } = buildApp()
  const session = await createSessionFor(request, 'token-a', 'A 的会话')

  const ok = await request.get(`/api/agent/sessions/${session.id}`).set('Authorization', 'Bearer token-a')
  assert.equal(ok.status, 200)

  const cross = await request.get(`/api/agent/sessions/${session.id}`).set('Authorization', 'Bearer token-b')
  assert.equal(cross.status, 404)
})

test('跨用户访问消息列表返回 404', async () => {
  const { request } = buildApp()
  const session = await createSessionFor(request, 'token-a', 'A 的会话')

  // A 产生一条消息
  await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })

  const aMessages = await request
    .get(`/api/agent/sessions/${session.id}/messages`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(aMessages.status, 200)
  assert.ok(aMessages.body.data.total >= 1)

  const bMessages = await request
    .get(`/api/agent/sessions/${session.id}/messages`)
    .set('Authorization', 'Bearer token-b')
  assert.equal(bMessages.status, 404)
})

test('跨用户访问运行列表返回 404', async () => {
  const { request } = buildApp()
  const session = await createSessionFor(request, 'token-a', 'A 的会话')
  await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: session.id, message: '你好' })

  const bRuns = await request
    .get(`/api/agent/sessions/${session.id}/runs`)
    .set('Authorization', 'Bearer token-b')
  assert.equal(bRuns.status, 404)
})

test('缺少 sessionId 返回 400，不存在的会话返回 404', async () => {
  const { request } = buildApp()
  const missing = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ message: 'hi' })
  assert.equal(missing.status, 400)

  const notFound = await request
    .post('/api/agent/chat')
    .set('Authorization', 'Bearer token-a')
    .send({ sessionId: 'sess-nonexistent', message: 'hi' })
  assert.equal(notFound.status, 404)
})
