// tests/api/articleAsk.test.js
// 文章问答：只针对当前文章检索，不编造答案。

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

test('文章问答：已索引文章返回答案与引用', async () => {
  const { request } = buildApp()
  await request.post('/api/knowledge/index/p1').set('Authorization', 'Bearer token-a')

  const res = await request
    .post('/api/articles/p1/ask')
    .set('Authorization', 'Bearer token-a')
    .send({ question: '这篇文章讲了什么？' })
  assert.equal(res.status, 200)
  assert.ok(typeof res.body.data.answer === 'string')
  assert.ok(Array.isArray(res.body.data.citations))
})

test('文章问答：文章不存在返回 404', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/articles/nonexistent/ask')
    .set('Authorization', 'Bearer token-a')
    .send({ question: '讲了什么？' })
  assert.equal(res.status, 404)
})

test('文章问答：空问题返回 400', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/articles/p1/ask')
    .set('Authorization', 'Bearer token-a')
    .send({ question: '' })
  assert.equal(res.status, 400)
})

test('文章问答：无检索结果时不编造答案', async () => {
  const { request } = buildApp()
  // p1 未索引且内容为空时，应明确告知没有足够资料
  const res = await request
    .post('/api/articles/p1/ask')
    .set('Authorization', 'Bearer token-a')
    .send({ question: '有什么独特内容？' })
  assert.equal(res.status, 200)
  assert.ok(res.body.data.answer.includes('没有足够资料'))
  assert.equal(res.body.data.citations.length, 0)
})
