// mock-server/server.js
// 仅负责启动：构建 app（见 createApp.js）并监听端口。
// 所有路由 / 中间件 / 依赖注入都在 createApp 中完成，测试可 require createApp 而不会自动监听端口。

const { createApp } = require('./createApp')

const port = 3000
const server = createApp()

server.listen(port, () => {
  console.log(`Mock server is running at http://localhost:${port}`)
})
