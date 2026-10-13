// server/retrieval/keywordSearch.js
// 关键词检索：对文章标题 / 正文做分词命中打分。
// 统一返回 { articleId, title, chunk, score, source, metadata }。

const { tokenize } = require('../knowledge/embeddingService')

function searchKeyword(query, documents, { topK = 10 } = {}) {
  const qTokens = tokenize(query)
  if (!qTokens.length) return []

  const results = []
  for (const doc of documents) {
    const title = String(doc.title || '')
    const content = String(doc.content || '')
    const titleTokens = new Set(tokenize(title))
    const contentTokens = tokenize(content)

    let titleHits = 0
    let contentHits = 0
    for (const t of qTokens) {
      if (titleTokens.has(t)) titleHits++
      if (contentTokens.includes(t)) contentHits++
    }

    // 标题命中权重远高于正文命中
    const score = titleHits * 3 + contentHits * 1
    if (score <= 0) continue

    results.push({
      articleId: doc.articleId,
      title,
      chunk: content.slice(0, 400),
      score,
      source: 'keyword',
      metadata: { titleHits, contentHits }
    })
  }

  // 归一化分数到 0~1 区间（相对最高分）
  const maxScore = results.length ? Math.max(...results.map(r => r.score)) : 1
  results.forEach(r => { r.score = maxScore ? +(r.score / maxScore).toFixed(4) : 0 })

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

module.exports = { searchKeyword }
