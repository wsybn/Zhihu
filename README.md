# zhuhuhu

## Project setup
```
yarn install
```

### Compiles and hot-reloads for development
```
yarn serve
```

### Compiles and minifies for production
```
yarn build
```

### Lints and fixes files
```
yarn lint
```

## 环境变量

- 服务端（`mock-server/server.js` 通过 `dotenv` 读取，**不会**打包进前端）：
  复制 `.env.example` 为 `.env`，填写 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`。
- 前端（vue-cli 构建期注入，**仅 `VUE_APP_` 前缀**会进 bundle）：
  `VUE_APP_API_BASE_URL` 指定后端地址，留空则使用同源相对路径。
  参考 `.env.development.example` / `.env.production.example`。
  **严禁把 `DEEPSEEK_API_KEY` 等密钥放入任何 `VUE_APP_` 变量。**

## 常用脚本

```
npm run mock:server       # 启动后端（json-server + Agent/知识库/检索/问答接口）
npm run knowledge:index   # 把 mock-server/db.json 中的文章批量建立知识库索引（幂等）
npm run serve             # 启动前端开发服务器（端口 8080）
npm run build             # 生产构建
npm run lint              # ESLint 检查
```

## 测试

所有自动化测试默认使用 **Fake AI Client**，不会真实消耗 DeepSeek 额度（`AI_PROVIDER=fake`）。

```
npm run test:unit         # 后端单元测试（node --test tests/unit/）
npm run test:api          # 后端 HTTP 集成测试（supertest，tests/api/）
npm run test:components   # 前端组件 / composable 测试（vitest）
npm test                  # 依次运行 unit + api + components
npm run test:all          # test + E2E
npm run test:e2e          # Playwright 端到端（自动拉起前后端，AI_PROVIDER=fake）
npm run test:canary       # DeepSeek 真实连通性探针（需配置 DEEPSEEK_API_KEY，未配置则跳过）
npm run test:coverage     # 后端 c8 + 前端 vitest 覆盖率（带门槛，低于门槛则失败）
```

## AI 创作助手

- 后端：`mock-server/server.js` 挂载 `server/routes/agentRoutes.js`，提供会话 / 消息 / run / step、
  SSE 流式（`run.started`、`message.delta`、`tool.called`…）、大纲、补丁、审查、知识库检索与问答等接口。
- 前端：`src/hooks/useAgentWorkspace.ts` 管理工作台状态，`src/hooks/useAgentStream.ts` 消费 SSE。
- **安全约束**：AI 绝不自动覆盖文章正文；所有修改建议（补丁 / 审查）都必须由用户点击「接受」后，
  经 `src/utils/patchApply.ts` 精确匹配（原文唯一出现才替换）才落盘。

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).

# 认证边界说明

`mock-server` 使用 Mock Token 和本地 JSON 数据保存账号信息，密码字段仅为本地演示夹具；它不是生产认证实现。生产环境应替换为服务端会话/JWT、密码哈希和持久化权限校验。
