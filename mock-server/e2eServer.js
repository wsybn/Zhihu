// mock-server/e2eServer.js
// 专供 Playwright E2E 的 mock 后端：
//   - 每次启动使用全新的临时数据库 + 临时 Agent 数据目录，测试之间不互相污染；
//   - 预置一个已知账号（e2e@test.com / pass123），供登录场景直接使用；
//   - 强制 AI_PROVIDER=fake，任何 AI 调用都不消耗真实 DeepSeek 额度。

const fs = require('fs')
const os = require('os')
const path = require('path')
const { createApp } = require('./createApp')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihuu-e2e-data-'))
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihuu-e2e-db-'))
const dbPath = path.join(dbDir, 'db.json')

const seed = {
  users: [
    { id: '1', name: 'E2E 用户', email: 'e2e@test.com', password: 'pass123', columnId: '1', token: 'e2e-token' }
  ],
  columns: [
    { id: '1', title: 'E2E 用户专栏', author: 'E2E 用户', description: 'E2E 测试专栏' }
  ],
  posts: []
}
fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2))

process.env.AI_PROVIDER = 'fake'

const server = createApp({ databasePath: dbPath, dataDir })
const port = Number(process.env.PORT || 3000)

server.listen(port, () => {
  console.log(`E2E mock server running at http://localhost:${port} (AI_PROVIDER=fake)`)
})
