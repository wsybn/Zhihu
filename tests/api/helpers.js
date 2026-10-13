// tests/api/helpers.js
// HTTP 集成测试共享工具：临时数据库 / 临时 Agent 数据目录 / 假 DeepSeek 客户端 / 合法结构化输出夹具。

const fs = require('fs')
const os = require('os')
const path = require('path')

// 假客户端已注入，但 deepseekClient 仍会校验 key 是否存在，这里给个哑值
process.env.DEEPSEEK_API_KEY = 'test-key'

const agentRepo = require('../../server/repositories/agentRepository')
const knowledgeRepo = require('../../server/repositories/knowledgeRepository')
const toolCallRepo = require('../../server/repositories/toolCallRepository')

// 重置所有 JsonFileStore 的内存缓存与文件路径，使新的 AGENT_DATA_DIR 立即生效。
// createApp 会在设置 AGENT_DATA_DIR 之后调用本函数，保证每个测试实例数据完全隔离。
function resetAllStores() {
  agentRepo.resetStores()
  knowledgeRepo.resetStores()
  toolCallRepo.resetStores()
}

// 生成临时数据库文件（json-server lowdb 格式）
function makeTempDb({ users = [], columns = [], posts = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihuu-db-'))
  const dbPath = path.join(dir, 'db.json')
  fs.writeFileSync(dbPath, JSON.stringify({ users, columns, posts }, null, 2))
  return { dir, dbPath }
}

// 生成临时 Agent 持久化目录
function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zhihuu-data-'))
}

// 标准测试用户 / 专栏 / 文章
function testUsers() {
  return [
    { id: '1', name: 'Alice', email: 'a@test.com', password: 'pass', columnId: '1', token: 'token-a' },
    { id: '2', name: 'Bob', email: 'b@test.com', password: 'pass', columnId: '2', token: 'token-b' }
  ]
}

function testColumns() {
  return [
    { id: '1', title: 'Alice 专栏', author: 'Alice' },
    { id: '2', title: 'Bob 专栏', author: 'Bob' }
  ]
}

function testPosts() {
  return [
    { id: 'p1', title: 'Vue3 文章', content: '组合式 API 让逻辑复用更简单', columnId: '1', column: '1' },
    { id: 'p2', title: 'React 文章', content: 'Fiber 是可中断的渲染架构', columnId: '2', column: '2' }
  ]
}

// 合法结构化输出夹具（与 server/ai/schemas 对齐）
function validOutline() {
  return {
    goal: '介绍组合式 API',
    audience: '前端开发者',
    estimatedLength: 2000,
    titleCandidates: ['Vue3 组合式 API 入门'],
    sections: [{ id: 's1', title: '什么是组合式 API', keyPoints: ['setup'], status: 'pending' }]
  }
}

function validPatchList() {
  return [{
    target: 'content',
    operation: 'replace',
    originalText: '旧文本',
    proposedText: '新文本',
    reason: '更清晰',
    status: 'pending'
  }]
}

function validReview() {
  return {
    score: 85,
    summary: '整体良好',
    issues: [{ severity: 'warning', category: 'grammar', message: '存在一处语病' }]
  }
}

// 把一段文本转成 SSE 事件 async 迭代器（响应 stream: true 时返回）
async function * makeTextStream(text) {
  for (const ch of text) {
    yield { type: 'response.output_text.delta', delta: ch }
  }
}

// 可配置的假 DeepSeek 客户端（不消耗真实额度）
//   - text: 纯文本回答（chat / chatWithTools 最终文本）
//   - json: 结构化输出（chatJson 直接序列化返回）
//   - streamText: 流式回答（chatStream 逐字输出）
//   - onCall: 记录每次 create 调用的回调，供断言
function makeFakeClient({ text = '测试回答', json = null, streamText = null, onCall = null } = {}) {
  return {
    responses: {
      create: async (params) => {
        if (onCall) onCall(params)
        if (params.stream) {
          const content = streamText || text
          return makeTextStream(content)
        }
        if (json !== null && json !== undefined) {
          const serialized = JSON.stringify(json)
          return {
            output: [{ type: 'message', content: [{ type: 'output_text', text: serialized }] }],
            output_text: serialized
          }
        }
        return {
          output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
          output_text: text
        }
      }
    }
  }
}

module.exports = {
  makeTempDb,
  makeTempDataDir,
  testUsers,
  testColumns,
  testPosts,
  validOutline,
  validPatchList,
  validReview,
  makeFakeClient,
  resetAllStores
}
