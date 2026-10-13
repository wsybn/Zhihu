// tests/e2e/auth.spec.ts
// E2E 场景 1：注册新账号 + 登录预置账号。
import { test, expect } from '@playwright/test'
import { SEED, login } from './helpers'

test('注册新账号后进入主页并展示其专栏', async ({ page }) => {
  const name = `用户${Date.now()}`
  const email = `user${Date.now()}@test.com`

  await page.goto('/register')
  await page.getByPlaceholder('请输入邮箱地址').fill(email)
  await page.getByPlaceholder('请输入昵称').fill(name)
  await page.getByPlaceholder('请输入密码').fill('pass123')
  await page.getByPlaceholder('请再次输入密码').fill('pass123')
  await page.getByRole('button', { name: '注册新用户' }).click()

  await page.waitForURL('**/')
  await expect(page.getByText(`${name}的专栏`).first()).toBeVisible()
})

test('登录预置账号进入主页', async ({ page }) => {
  await login(page)
  await expect(page.getByText('AI 内容助手').first()).toBeVisible()
  await expect(page.getByText(SEED.columnTitle).first()).toBeVisible()
})
