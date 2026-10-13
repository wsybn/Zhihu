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
  return { request: supertest(app) }
}

async function createSession(request, token) {
  const result = await request.post('/api/agent/sessions').set('Authorization', `Bearer ${token}`).send({ title: '会话' })
  return result.body.data
}

test('跨请求会话保存 user/assistant，第二轮上下文包含第一轮', async () => {
  const calls = []
  const { request } = buildApp(makeFakeClient({ text: '回答', onCall: params => calls.push(params) }))
  const session = await createSession(request, 'token-a')
  await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, message: '第一轮秘密问题', clientMessageId: 'm-1' })
  const second = await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, message: '我刚才说了什么', clientMessageId: 'm-2' })
  assert.equal(second.status, 200)
  assert.ok(Array.isArray(calls[1].input))
  assert.ok(String(calls[1].input).includes('第一轮秘密问题'))
  assert.ok(String(calls[1].input).includes('回答'))
  const messages = await request.get(`/api/agent/sessions/${session.id}/messages?includeUsers=true`).set('Authorization', 'Bearer token-a')
  assert.equal(messages.body.data.total, 4)
  assert.deepEqual(messages.body.data.items.map(item => item.role), ['user', 'assistant', 'user', 'assistant'])
  assert.ok(second.body.data.contextUsage)
})

test('clientMessageId 重试幂等，模型失败时 user 消息仍保留', async () => {
  const { request } = buildApp({ responses: { create: async () => { throw new Error('model down') } } })
  const session = await createSession(request, 'token-a')
  const failed = await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, message: '保留我', clientMessageId: 'same-id' })
  assert.equal(failed.status, 502)
  const messages = await request.get(`/api/agent/sessions/${session.id}/messages?includeUsers=true`).set('Authorization', 'Bearer token-a')
  assert.equal(messages.body.data.total, 1)
  assert.equal(messages.body.data.items[0].role, 'user')

  const success = buildApp(makeFakeClient({ text: '完成' }))
  const session2 = await createSession(success.request, 'token-a')
  const first = await success.request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session2.id, message: '只保存一次', clientMessageId: 'once' })
  const repeat = await success.request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session2.id, message: '篡改消息', clientMessageId: 'once' })
  assert.equal(first.body.data.run.id, repeat.body.data.run.id)
  const persisted = agentRepo.listMessagesBySessionAndUser(session2.id, '1')
  assert.equal(persisted.total, 2)
})

test('历史读取按 sessionId 和 userId 隔离', async () => {
  const calls = []
  const { request } = buildApp(makeFakeClient({ text: '回答', onCall: params => calls.push(params) }))
  const a = await createSession(request, 'token-a')
  const b = await createSession(request, 'token-b')
  await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: a.id, message: '用户 A 私密内容' })
  await request.post('/api/agent/chat').set('Authorization', 'Bearer token-b').send({ sessionId: b.id, message: '用户 B 新问题' })
  assert.ok(!String(calls[1].input).includes('用户 A 私密内容'))
})
