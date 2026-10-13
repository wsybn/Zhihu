// server/knowledge/documentIndexer.js
// 文章入库：正文清理 → 切 Chunk → 生成 Embedding → 保存文档与 Chunk、建立检索索引。

const knowledgeRepo = require('../repositories/knowledgeRepository')
const { splitIntoChunks } = require('./chunkSplitter')
const { embed, provider } = require('./embeddingService')

async function indexArticle(article, { authorId = '', tags = [] } = {}) {
  if (!article || !article.id) {
    throw new Error('indexArticle 需要 article.id')
  }
  const title = String(article.title || '')
  const content = String(article.content || '')
  const existing = knowledgeRepo.getDocumentByArticle(String(article.id))
  const job = knowledgeRepo.createIndexJob({ articleId: String(article.id), documentId: existing ? existing.id : null })
  knowledgeRepo.updateIndexJob(job.id, { status: 'running' })
  const chunks = splitIntoChunks(content)
  const calculatedChunks = []
  try {
    // Compute the complete replacement before touching the existing document
    // or chunks. An embedding failure therefore preserves the old index.
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embed(chunks[i])
      calculatedChunks.push({
        articleId: String(article.id),
        content: chunks[i],
        chunkIndex: i,
        embedding,
        metadata: { title, embeddingProvider: provider.name }
      })
    }

    const document = knowledgeRepo.createDocument({
      articleId: String(article.id),
      authorId: String(authorId || ''),
      title,
      content,
      tags: Array.isArray(tags) ? tags : []
    })
    const replaced = knowledgeRepo.replaceChunksForDocument(document.id, calculatedChunks)
    const completedJob = knowledgeRepo.updateIndexJob(job.id, {
      status: 'completed',
      documentId: document.id,
      chunkCount: replaced.length,
      error: null
    })
    return { document, chunkCount: replaced.length, embeddingProvider: provider.name, indexJob: completedJob }
  } catch (error) {
    const failedJob = knowledgeRepo.updateIndexJob(job.id, {
      status: 'failed',
      error: String(error && error.message ? error.message : '索引失败').slice(0, 500)
    })
    error.indexJob = failedJob
    throw error
  }
}

module.exports = { indexArticle }
