// tests/api/sse.test.js
// SSE 流式对话：标准事件顺序 / 认证 / Tool Calling / 客户端断开取消（run cancelled 而非 failed）。

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const supertest = require('supertest')

const { createApp } = require('../../mock-server/createApp')
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

// 把 SSE 原始文本解析为事件名列表
function parseEventNames(raw) {
  return raw
    .split('\n\n')
    .map(frame => frame.split('\n').find(l => l.startsWith('event: ')))
    .filter(Boolean)
    .map(l => l.slice(7).trim())
}

test('SSE 流式对话：完整事件序列 run.started → delta → completed', async () => {
  const { request } = buildApp(makeFakeClient({ streamText: '你好世界' }))
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/chat/stream')
    .set('Authorization', 'Bearer token-a')
    .set('Accept', 'text/event-stream')
    .send({ sessionId: session.id, message: 'hi' })

  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/event-stream/)
  const names = parseEventNames(res.text)
  assert.ok(names.includes('run.started'), names.join(','))
  assert.ok(names.includes('step.started'), names.join(','))
  assert.ok(names.includes('message.delta'), names.join(','))
  assert.ok(names.includes('step.completed'), names.join(','))
  assert.ok(names.includes('run.completed'), names.join(','))
})

test('SSE 流式对话无 token 返回 401', async () => {
  const { request } = buildApp()
  const res = await request
    .post('/api/agent/chat/stream')
    .set('Accept', 'text/event-stream')
    .send({ sessionId: 's', message: 'hi' })
  assert.equal(res.status, 401)
})

test('SSE Tool Calling：发出 tool.called 事件', async () => {
  const calls = []
  const client = {
    responses: {
      create: async (params) => {
        calls.push(params)
        if (calls.length === 1) {
          return {
            output: [
              { type: 'message', content: [{ type: 'output_text', text: '需要检索' }] },
              { type: 'function_call', id: 'call-1', name: 'get_current_article_context', arguments: '{}' }
            ],
            output_text: ''
          }
        }
        return {
          output: [{ type: 'message', content: [{ type: 'output_text', text: '结合上下文回答' }] }],
          output_text: '结合上下文回答'
        }
      }
    }
  }
  const { request } = buildApp(client)
  const session = await createSession(request, 'token-a')

  const res = await request
    .post('/api/agent/chat/stream')
    .set('Authorization', 'Bearer token-a')
    .set('Accept', 'text/event-stream')
    .send({ sessionId: session.id, message: '查一下', useTools: true, context: { title: 'T', content: 'C' } })

  assert.equal(res.status, 200)
  const names = parseEventNames(res.text)
  assert.ok(names.includes('tool.called'), names.join(','))
  assert.ok(names.includes('run.completed'), names.join(','))
})

test('客户端中途断开：run 被标记为 cancelled 而非 failed', async () => {
  // 慢速流式客户端，确保在客户端断开前流未结束
  async function * slowStream() {
    for (let i = 0; i < 50; i++) {
      yield { type: 'response.output_text.delta', delta: '字' }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const client = {
    responses: {
      create: async (params) => {
        if (params.stream) return slowStream()
        return { output: [], output_text: '' }
      }
    }
  }
  const dataDir = makeTempDataDir()
  const { dbPath } = makeTempDb({ users: testUsers(), columns: testColumns(), posts: testPosts() })
  const app = createApp({ dataDir, databasePath: dbPath, aiClient: client })
  resetAllStores()

  // 监听端口，用原生 http 手动断开
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port

  // 先建会话
  const request = supertest(app)
  const session = await createSession(request, 'token-a')

  // 手动发起流式请求，读到 run.started 后立刻断开
  const runId = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/agent/chat/stream',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-a'
      }
    }, res => {
      let buf = ''
      res.on('data', chunk => {
        buf += chunk.toString()
        const m = buf.match(/event: run\.started\ndata: (\{[\s\S]*?\})\n\n/)
        if (m) {
          try {
            const id = JSON.parse(m[1]).runId
            if (id) {
              req.destroy() // 模拟客户端中途断开
              resolve(id)
            }
          } catch (e) {
            reject(e)
          }
        }
      })
      res.on('error', () => {})
    })
    req.on('error', () => {})
    req.write(JSON.stringify({ sessionId: session.id, message: 'hi' }))
    req.end()
    setTimeout(() => reject(new Error('未收到 run.started')), 3000)
  })

  // 等待服务端处理断开
  await new Promise(resolve => setTimeout(resolve, 300))

  const after = await request.get(`/api/agent/runs/${runId}`).set('Authorization', 'Bearer token-a')
  assert.equal(after.status, 200)
  assert.equal(after.body.data.status, 'cancelled')
  assert.notEqual(after.body.data.status, 'failed')

  await new Promise(resolve => server.close(resolve))
})
