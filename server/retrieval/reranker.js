// server/retrieval/reranker.js
// 本地重排序：在候选集上做查询词覆盖、短语命中、标题命中等轻量打分。
// 明确标记为本地 fallback，后续可替换为 cross-encoder / 学习型重排。

const { tokenize } = require('../knowledge/embeddingService')

function rerankLocal(query, candidates) {
  const qTokens = tokenize(query)
  const qLower = String(query || '').toLowerCase()

  return candidates.map(c => {
    const title = String(c.title || '').toLowerCase()
    const chunk = String(c.chunk || '').toLowerCase()
    const titleTokens = new Set(tokenize(title))

    let titleHits = 0
    let chunkHits = 0
    for (const t of qTokens) {
      if (titleTokens.has(t)) titleHits++
      if (chunk.includes(t)) chunkHits++
    }
    const phraseHit = qLower && title.includes(qLower) ? 2 : 0

    const rerankScore = c.score * 0.5 + titleHits * 0.25 + chunkHits * 0.15 + phraseHit * 0.2
    return {
      ...c,
      score: +(rerankScore).toFixed(4),
      metadata: {
        ...(c.metadata || {}),
        reranker: 'local-fallback'
      }
    }
  }).sort((a, b) => b.score - a.score)
}

module.exports = { rerankLocal }
