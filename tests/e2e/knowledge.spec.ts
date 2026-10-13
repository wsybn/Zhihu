// tests/e2e/knowledge.spec.ts
// E2E 场景 4：创建文章（自动索引）→ 详情页对文章提问（知识库问答，AI_PROVIDER=fake）。
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test('文章自动索引后可在详情页提问并得到回答', async ({ page }) => {
  await login(page)

  const title = `知识库文章 ${Date.now()}`
  await page.goto('/created')
  await page.getByPlaceholder('请输入文章标题').fill(title)
  await page.getByPlaceholder('请输入文章详情，支持 Markdown 语法').fill('Vue3 组合式 API 让逻辑复用更简单。')
  await page.getByRole('button', { name: '发表文章' }).click()

  // 回到专栏列表后，点击进入文章详情页
  await page.waitForURL('**/column/**')
  await page.getByText(title).first().click()
  await page.waitForURL('**/posts/**')

  // 对文章提问（问题需与正文关键词相关，RAG 才会检索到内容并调用模型）
  await page.getByPlaceholder('例如：这篇文章的核心观点是什么？').fill('组合式 API 有什么作用？')
  await page.getByRole('button', { name: '提问' }).click()

  // fake provider 返回确定性回答
  await expect(page.getByText('这是 Fake AI Provider 生成的测试回答。').first()).toBeVisible()
})
