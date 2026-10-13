// server/scripts/indexExistingArticles.js
// 把 mock-server/db.json 中已存在的文章批量建立知识库索引。
//   - 幂等：重复执行会重建同一文章的 Chunk（先清旧再写新），不会产生重复索引
//   - 增量：标题与正文都未变化的文章会被跳过，避免无谓重建
//   - 清理：已从 posts 删除的文章，其文档与 Chunk 一并移除
//   - 归属：authorId = 文章所属专栏 columnId（与线上检索隔离口径一致）
//
// 用法：node server/scripts/indexExistingArticles.js [dbPath]
// 默认读取 mock-server/db.json。

const fs = require('fs')
const path = require('path')

const knowledgeRepo = require('../repositories/knowledgeRepository')
const { indexArticle } = require('../knowledge/documentIndexer')

const DEFAULT_DB = path.join(__dirname, '..', '..', 'mock-server', 'db.json')

async function main() {
  const dbPath = process.argv[2] || DEFAULT_DB
  if (!fs.existsSync(dbPath)) {
    console.error(`[knowledge:index] 找不到数据库文件：${dbPath}`)
    process.exit(1)
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  const posts = Array.isArray(db.posts) ? db.posts : []

  // 1. 批量建立 / 增量更新索引（按标题+正文判定是否跳过）
  let added = 0
  let updated = 0
  let skipped = 0
  let totalChunks = 0
  const failed = []
  for (const post of posts) {
    try {
      const articleId = String(post.id)
      const existing = knowledgeRepo.getDocumentByArticle(articleId)
      const unchanged = existing
        && String(existing.title || '') === String(post.title || '')
        && String(existing.content || '') === String(post.content || '')

      if (unchanged) {
        skipped++
        totalChunks += knowledgeRepo.listChunksByArticle(articleId).length
        continue
      }

      const { chunkCount } = await indexArticle(post, {
        authorId: String(post.columnId || post.column || ''),
        tags: []
      })
      if (existing) updated++
      else added++
      totalChunks += chunkCount
    } catch (e) {
      failed.push({ articleId: post.id, message: e.message })
    }
  }

  // 2. 清理已删除文章的索引
  const validIds = new Set(posts.map(p => String(p.id)))
  const deleted = []
  for (const doc of knowledgeRepo.listDocuments()) {
    if (!validIds.has(String(doc.articleId))) {
      knowledgeRepo.removeDocument(doc.id)
      deleted.push(doc.articleId)
    }
  }

  const stats = {
    source: dbPath,
    totalArticles: posts.length,
    added,
    updated,
    skipped,
    deleted: deleted.length,
    failed: failed.length,
    totalChunks,
    failedDetails: failed
  }

  console.log('[knowledge:index] 完成')
  console.log(
    `[knowledge:index] 新增 ${added}，更新 ${updated}，跳过 ${skipped}，删除 ${deleted.length}，失败 ${failed.length}（共 ${posts.length} 篇文章，${totalChunks} 个 Chunk）`
  )
  console.log(JSON.stringify(stats, null, 2))

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error('[knowledge:index] 失败：', e)
  process.exit(1)
})
