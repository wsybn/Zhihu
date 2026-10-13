// server/retrieval/hybridSearch.js
// 混合检索：融合关键词与向量结果。
// 使用 Reciprocal Rank Fusion（RRF）合并两路排序，避免分数尺度不一致。

function rrf(resultsPerSource, k = 60) {
  const fused = new Map()
  resultsPerSource.forEach(results => {
    results.forEach((item, rank) => {
      const key = `${item.articleId}|${item.metadata && item.metadata.chunkIndex !== undefined ? item.metadata.chunkIndex : item.chunk.slice(0, 40)}`
      const score = 1 / (k + rank + 1)
      if (!fused.has(key)) {
        fused.set(key, { item, score })
      } else {
        fused.get(key).score += score
      }
    })
  })
  return Array.from(fused.values())
    .map(entry => ({ ...entry.item, rrfScore: entry.score }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
}

async function searchHybrid(query, keywordResults, vectorResults, { topK = 10, dedupe = 'article', maxChunksPerArticle = 3 } = {}) {
  const merged = rrf([keywordResults, vectorResults])
  let selected
  if (dedupe === 'chunk') {
    const byChunk = new Map()
    merged.forEach(r => {
      const chunkKey = `${r.articleId}|${r.metadata && r.metadata.chunkIndex !== undefined ? r.metadata.chunkIndex : r.chunk.slice(0, 80)}`
      const prev = byChunk.get(chunkKey)
      if (!prev || r.rrfScore > prev.rrfScore) byChunk.set(chunkKey, r)
    })
    const articleCounts = new Map()
    selected = Array.from(byChunk.values()).filter(item => {
      const count = articleCounts.get(item.articleId) || 0
      if (count >= maxChunksPerArticle) return false
      articleCounts.set(item.articleId, count + 1)
      return true
    })
  } else {
    // Article search returns at most one result per article.
    const byArticle = new Map()
    merged.forEach(r => {
      const prev = byArticle.get(r.articleId)
      if (!prev || r.rrfScore > prev.rrfScore) byArticle.set(r.articleId, r)
    })
    selected = Array.from(byArticle.values())
  }
  return selected
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK)
    .map(r => ({
      articleId: r.articleId,
      title: r.title,
      chunk: r.chunk,
      score: +(r.rrfScore).toFixed(4),
      source: 'hybrid',
      metadata: { ...(r.metadata || {}), rrf: true }
    }))
}

module.exports = { searchHybrid, rrf }
