const test = require('node:test')
const assert = require('node:assert')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
const agentRepo = require('../../server/repositories/agentRepository')
const { makeTempDb, makeTempDataDir, testUsers, testColumns, testPosts, makeFakeClient, validOutline, resetAllStores } = require('./helpers')

function buildApp(client) {
  const dataDir = makeTempDataDir()
  const { dbPath } = makeTempDb({ users: testUsers(), columns: testColumns(), posts: testPosts() })
  const app = createApp({ dataDir, databasePath: dbPath, aiClient: client || makeFakeClient() })
  resetAllStores()
  return { request: supertest(app), dbPath }
}

async function createSession(request, token = 'token-a') {
  const response = await request.post('/api/agent/sessions').set('Authorization', `Bearer ${token}`).send({ title: 's' })
  return response.body.data
}

test('消息接口 includeUsers=true 返回完整且可用 desc + before 游标分页', async () => {
  const { request } = buildApp()
  const session = await createSession(request)
  await request.post('/api/agent/chat').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, message: '一' })
  const first = await request.get(`/api/agent/sessions/${session.id}/messages?includeUsers=true&order=desc&pageSize=1`).set('Authorization', 'Bearer token-a')
  assert.equal(first.status, 200)
  assert.equal(first.body.data.items.length, 1)
  assert.equal(first.body.data.items[0].role, 'assistant')
  assert.ok(first.body.data.nextCursor)
  const older = await request
    .get(`/api/agent/sessions/${session.id}/messages?includeUsers=true&order=desc&pageSize=1&before=${encodeURIComponent(JSON.stringify(first.body.data.nextCursor))}`)
    .set('Authorization', 'Bearer token-a')
  assert.equal(older.status, 200)
  assert.equal(older.body.data.items[0].role, 'user')
})

test('resume 从 tool_results_ready 继续模型，不重新执行工具', async () => {
  let calls = 0
  const { request } = buildApp({ responses: { create: async () => { calls++; return { output: [{ type: 'message', content: [{ type: 'output_text', text: '续跑完成' }] }], output_text: '续跑完成' } } } })
  const session = await createSession(request)
  const run = agentRepo.createRun({
    sessionId: session.id,
    type: 'chat',
    status: 'failed',
    userId: '1',
    requestSnapshot: { operation: 'chat', request: { message: '继续', useTools: true } }
  })
  const steps = ['goal_analysis', 'internal_research', 'outline_generation', 'outline_confirmation', 'section_writing', 'article_review', 'publish_preparation']
  steps.forEach(stepKey => agentRepo.createRunStep({ runId: run.id, stepKey, status: 'pending' }))
  agentRepo.updateRunCheckpoint(run.id, {
    phase: 'tool_results_ready',
    compactToolResults: [{ callId: 'c1', toolName: 'read_article', result: { found: true } }],
    modelContinuation: { input: [{ role: 'user', content: '继续' }], functionCalls: [{ id: 'c1', name: 'read_article' }] }
  })
  const response = await request.post(`/api/agent/runs/${run.id}/resume`).set('Authorization', 'Bearer token-a').send({})
  assert.equal(response.status, 200)
  assert.equal(response.body.data.message.content, '续跑完成')
  assert.equal(calls, 1)
  assert.equal(agentRepo.listMessagesBySessionAndUser(session.id, '1').total, 1)
})

test('确认大纲后真实执行 section_writing 并持久化 ArticlePatch', async () => {
  const { request } = buildApp(makeFakeClient({ json: validOutline(), text: '章节草稿' }))
  const session = await createSession(request)
  const outline = await request.post('/api/agent/outline').set('Authorization', 'Bearer token-a').send({ sessionId: session.id, context: { title: 't', content: 'c' } })
  assert.equal(outline.status, 200)
  const runId = outline.body.data.run.id
  const confirmed = await request.post(`/api/agent/runs/${runId}/confirm-outline`).set('Authorization', 'Bearer token-a').send({})
  assert.equal(confirmed.body.data.currentStep, 'section_writing')
  await new Promise(resolve => setTimeout(resolve, 30))
  const after = await request.get(`/api/agent/runs/${runId}`).set('Authorization', 'Bearer token-a')
  assert.equal(after.body.data.status, 'completed')
  assert.equal(after.body.data.steps.find(step => step.stepKey === 'section_writing').status, 'completed')
  const messages = await request.get(`/api/agent/sessions/${session.id}/messages?includeUsers=true`).set('Authorization', 'Bearer token-a')
  assert.ok(messages.body.data.items.some(message => message.type === 'article_patch'))
})

test('普通写入路由需要登录并校验文章/专栏归属', async () => {
  const { request } = buildApp()
  const unauthenticated = await request.post('/columns/1/posts').send({ title: 'x', content: 'y' })
  assert.equal(unauthenticated.status, 401)
  const crossCreate = await request.post('/columns/2/posts').set('Authorization', 'Bearer token-a').send({ title: 'x', content: 'y' })
  assert.equal(crossCreate.status, 403)
  const crossPatch = await request.patch('/posts/p2').set('Authorization', 'Bearer token-a').send({ title: 'x' })
  assert.equal(crossPatch.status, 403)
  const publicRead = await request.get('/posts/p2')
  assert.equal(publicRead.status, 200)
})
