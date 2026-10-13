// tests/api/knowledgeAgent.test.js
// 个人知识库 Agent 接口：知识库问答 / 选题建议 / 系列分类（空数据时不调用模型、不编造）。
const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const { makeTempDb, makeTempDataDir, testUsers, testColumns, makeFakeClient, resetAllStores } = require('./helpers')

function buildApp() {
  const dataDir = makeTempDataDir()
  // 空文章列表：让知识库检索 / 作者历史文章都为空，验证不调用模型的安全兜底路径
  const { dbPath } = makeTempDb({ users: testUsers(), columns: testColumns(), posts: [] })
  const app = createApp({ dataDir, databasePath: dbPath, aiClient: makeFakeClient() })
  resetAllStores()
  return { app, request: supertest(app) }
}

test('知识库问答：无检索结果时不调用模型并明确告知', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/knowledge-chat')
    .set('Authorization', 'Bearer token-a')
    .send({ question: '有什么内容？' })
  assert.equal(res.status, 200)
  assert.ok(res.body.data.answer.includes('没有足够资料'))
  assert.deepEqual(res.body.data.citations, [])
})

test('选题建议：无历史文章时返回空列表', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/topic-suggestions')
    .set('Authorization', 'Bearer token-a')
    .send({ count: 5 })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.topics, [])
})

test('系列分类：无历史文章时返回空列表', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/series-classification')
    .set('Authorization', 'Bearer token-a')
    .send({})
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.series, [])
})
