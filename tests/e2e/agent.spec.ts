// tests/e2e/agent.spec.ts
// E2E 场景 2：登录后在主页与 AI 助手流式对话（AI_PROVIDER=fake，不消耗真实额度）。
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test('主页 AI 助手：发送消息后展示 Fake AI 回答', async ({ page }) => {
  await login(page)

  const input = page.getByPlaceholder('向 AI 助手提问…')
  await input.fill('帮我梳理写作思路')
  await page.getByRole('button', { name: '发送' }).click()

  // fake provider 返回确定性文案，等待其以流式方式渲染出来
  await expect(page.getByText('这是 Fake AI Provider 生成的测试回答。').first()).toBeVisible()
})
