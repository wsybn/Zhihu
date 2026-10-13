// tests/e2e/helpers.ts
// E2E 共享登录工具：走真实登录 UI，返回已登录的 page。
import { expect, type Page } from '@playwright/test'

export const SEED = {
  email: 'e2e@test.com',
  password: 'pass123',
  columnTitle: 'E2E 用户专栏'
}

// 通过登录页 UI 登录预置账号，成功后回到主页。
export async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByPlaceholder('请输入邮箱').fill(SEED.email)
  await page.getByPlaceholder('请输入密码').fill(SEED.password)
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForURL('**/')
  await expect(page.getByText(SEED.columnTitle).first()).toBeVisible()
}
