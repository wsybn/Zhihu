import { defineConfig, devices } from '@playwright/test'

// E2E 配置：前端 dev server（8080，代理到后端）+ mock 后端（3000，AI_PROVIDER=fake）。
// 两个服务由 Playwright 自动拉起 / 回收，测试不消耗真实 DeepSeek 额度。
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: 'node mock-server/e2eServer.js',
      url: 'http://localhost:3000/columns',
      reuseExistingServer: !process.env.CI,
      timeout: 30 * 1000
    },
    {
      command: 'npm run serve',
      url: 'http://localhost:8080',
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000
    }
  ]
})
