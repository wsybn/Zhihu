// tests/e2e/article.spec.ts
// E2E 场景 3：登录后创建文章，并在专栏列表看到新文章。
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test('创建文章后出现在专栏列表', async ({ page }) => {
  await login(page)

  const title = `E2E 文章 ${Date.now()}`
  await page.goto('/created')
  await page.getByPlaceholder('请输入文章标题').fill(title)
  await page.getByPlaceholder('请输入文章详情，支持 Markdown 语法').fill('这是一篇 E2E 创建的文章正文。')
  await page.getByRole('button', { name: '发表文章' }).click()

  // 发表成功后跳转到所在专栏
  await page.waitForURL('**/column/**')
  await expect(page.getByText(title).first()).toBeVisible()
})
