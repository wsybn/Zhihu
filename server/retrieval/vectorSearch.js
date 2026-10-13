// server/retrieval/vectorSearch.js
// 向量检索：对知识库 Chunk 的 embedding 做余弦相似度。
// 当前使用本地向量索引（内存扫描）；接口设计成后续可替换为
// pgvector / Qdrant / Milvus / Elasticsearch / Redis Vector。

const { embed, cosineSimilarity, provider } = require('../knowledge/embeddingService')

// chunks: 由 knowledgeRepository.listAllChunks() 提供，
// 每个 chunk 形如 { id, articleId, content, embedding, metadata }。
// docById: articleId -> 文档（补标题等字段）。
async function searchVector(query, chunks, docById, { topK = 5 } = {}) {
  if (!chunks || chunks.length === 0) return []
  const qVec = await embed(query)

  const scored = []
  for (const chunk of chunks) {
    if (!chunk.embedding || chunk.embedding.length === 0) continue
    const sim = cosineSimilarity(qVec, chunk.embedding)
    if (sim <= 0) continue
    scored.push({
      articleId: chunk.articleId,
      title: (docById[chunk.articleId] && docById[chunk.articleId].title) || chunk.metadata.title || '',
      chunk: chunk.content,
      score: +(sim).toFixed(4),
      source: 'vector',
      metadata: {
        chunkIndex: chunk.chunkIndex,
        documentId: chunk.documentId,
        embeddingProvider: provider.name
      }
    })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

module.exports = { searchVector }
