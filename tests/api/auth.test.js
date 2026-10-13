// tests/api/auth.test.js
// 认证与权限：所有需要登录的 Agent 接口在无 token / 无效 token 下必须 401，
// 且服务器绝不创建 userId 为空的会话。

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

test('无 token 访问所有 AI 接口返回 401', async () => {
  const { request } = buildApp()
  const cases = [
    ['POST', '/api/agent/sessions', {}],
    ['POST', '/api/agent/chat', { sessionId: 's', message: 'hi' }],
    ['POST', '/api/agent/outline', { sessionId: 's' }],
    ['POST', '/api/agent/article-patch', { sessionId: 's', action: 'polish' }],
    ['POST', '/api/agent/review', { sessionId: 's' }],
    ['GET', '/api/agent/sessions/s1', null],
    ['GET', '/api/agent/sessions/s1/messages', null],
    ['GET', '/api/agent/sessions/s1/runs', null],
    ['GET', '/api/agent/runs/r1', null],
    ['GET', '/api/agent/runs/r1/steps', null],
    ['POST', '/api/knowledge/search', { query: 'x' }],
    ['GET', '/api/knowledge/documents', null],
    ['POST', '/api/agent/knowledge-chat', { question: 'x' }]
  ]
  for (const [method, url, body] of cases) {
    const req = request[method.toLowerCase()](url)
    if (body) req.send(body)
    const res = await req
    assert.equal(res.status, 401, `${method} ${url} 应返回 401，实际 ${res.status}`)
  }
})

test('无效 token 返回 401（不创建任何会话）', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/sessions')
    .set('Authorization', 'Bearer not-a-real-token')
    .send({ title: 'x' })
  assert.equal(res.status, 401)
})

test('创建会话强制写入 userId，绝不产生空 userId 会话', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/sessions')
    .set('Authorization', 'Bearer token-a')
    .send({ title: '我的会话' })
  assert.equal(res.status, 200)
  assert.equal(res.body.code, 0)
  assert.equal(String(res.body.data.userId), '1')

  // 通过 GET 会话详情再次确认归属
  const detail = await request
    .get(`/api/agent/sessions/${res.body.data.id}`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(detail.status, 200)
  assert.equal(String(detail.body.data.userId), '1')
})

test('登录接口：正确凭据返回 token，错误凭据返回 404', async () => {
  const { request } = buildApp()
  const ok = await request.post('/user/login').send({ email: 'a@test.com', password: 'pass' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.data.token, 'token-a')

  const bad = await request.post('/user/login').send({ email: 'a@test.com', password: 'wrong' })
  assert.equal(bad.status, 404)
})
