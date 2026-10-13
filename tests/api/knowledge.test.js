// tests/api/knowledge.test.js
// 知识库：索引权限 / 检索作者隔离 / 文档列表与删除归属。

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

test('索引文章：只能索引自己专栏下的文章', async () => {
  const { request } = buildApp()

  // 自己（p1 属于 columnId 1）
  const own = await request
    .post('/api/knowledge/index/p1')
    .set('Authorization', 'Bearer token-a')
  assert.equal(own.status, 200)

  // 他人文章（p2 属于 columnId 2）
  const cross = await request
    .post('/api/knowledge/index/p2')
    .set('Authorization', 'Bearer token-a')
  assert.equal(cross.status, 403)

  // 不存在的文章
  const missing = await request
    .post('/api/knowledge/index/nope')
    .set('Authorization', 'Bearer token-a')
  assert.equal(missing.status, 404)
})

test('知识库检索：只返回当前用户作者的数据', async () => {
  const { request } = buildApp()
  await request.post('/api/knowledge/index/p1').set('Authorization', 'Bearer token-a')
  await request.post('/api/knowledge/index/p2').set('Authorization', 'Bearer token-b')

  const aRes = await request
    .post('/api/knowledge/search')
    .set('Authorization', 'Bearer token-a')
    .send({ query: '组合式 API', topK: 10 })
  assert.equal(aRes.status, 200)
  // Alice 只能搜到自己的 p1（组合式 API），搜不到 Bob 的 Fiber
  assert.ok(aRes.body.data.items.every(it => String(it.articleId) === 'p1'))

  const bRes = await request
    .post('/api/knowledge/search')
    .set('Authorization', 'Bearer token-b')
    .send({ query: 'Fiber', topK: 10 })
  assert.ok(bRes.body.data.items.every(it => String(it.articleId) === 'p2'))
})

test('文档列表只返回本人文档，删除他人文档返回 403', async () => {
  const { request } = buildApp()
  await request.post('/api/knowledge/index/p1').set('Authorization', 'Bearer token-a')

  const aDocs = await request.get('/api/knowledge/documents').set('Authorization', 'Bearer token-a')
  assert.equal(aDocs.status, 200)
  assert.ok(aDocs.body.data.length >= 1)
  assert.ok(aDocs.body.data.every(d => String(d.authorId) === '1'))

  const bDocs = await request.get('/api/knowledge/documents').set('Authorization', 'Bearer token-b')
  assert.equal(bDocs.body.data.length, 0)

  // 删除他人文档
  const docId = aDocs.body.data[0].id
  const crossDelete = await request
    .delete(`/api/knowledge/documents/${docId}`)
    .set('Authorization', 'Bearer token-b')
  assert.equal(crossDelete.status, 403)

  // 删除自己的文档
  const ownDelete = await request
    .delete(`/api/knowledge/documents/${docId}`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(ownDelete.status, 200)
})
