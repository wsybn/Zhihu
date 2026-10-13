// server/knowledge/knowledgeService.js
// 知识库门面：对外提供 检索 / 文档管理 / 文章问答 能力，
// 组合关键词、向量、混合检索与本地重排。

const knowledgeRepo = require('../repositories/knowledgeRepository')
const { indexArticle } = require('./documentIndexer')
const { searchKeyword } = require('../retrieval/keywordSearch')
const { searchVector } = require('../retrieval/vectorSearch')
const { searchHybrid } = require('../retrieval/hybridSearch')
const { rerankLocal } = require('../retrieval/reranker')
const { provider, embed, cosineSimilarity, tokenize } = require('./embeddingService')
const { cleanText, splitIntoChunks } = require('./chunkSplitter')

// 把知识库文档映射为检索文档结构
function buildDocView(docs = knowledgeRepo.listDocuments()) {
  return {
    list: docs.map(d => ({
      articleId: d.articleId,
      title: d.title,
      content: d.content,
      authorId: d.authorId,
      tags: d.tags
    })),
    byId: docs.reduce((acc, d) => { acc[d.articleId] = d; return acc }, {})
  }
}

async function searchArticles(query, { topK = 10, authorId = '' } = {}) {
  const docs = authorId
    ? knowledgeRepo.listDocumentsByAuthor(authorId)
    : knowledgeRepo.listDocuments()
  const { list, byId } = buildDocView(docs)
  const keywordResults = searchKeyword(query, list, { topK: Math.max(topK, 20) })
  const chunks = knowledgeRepo.listChunksByAuthor(authorId)
  const vectorResults = await searchVector(query, chunks, byId, { topK: Math.max(topK, 20) })
  const merged = await searchHybrid(query, keywordResults, vectorResults, { topK, dedupe: 'article' })
  return rerankLocal(query, merged).slice(0, topK)
}

async function searchKnowledgeChunks(query, { topK = 10, authorId = '', maxChunksPerArticle = 3 } = {}) {
  // Author filtering happens before either retrieval strategy. This prevents
  // another author's documents from occupying the global candidate window.
  const docs = authorId
    ? knowledgeRepo.listDocumentsByAuthor(authorId)
    : knowledgeRepo.listDocuments()
  const { list, byId } = buildDocView(docs)
  const ownedArticleIds = new Set(list.map(doc => String(doc.articleId)))
  const keywordResults = searchKeyword(query, list, { topK: Math.max(topK * 4, 20) })
    .map(result => ({ ...result, metadata: { ...(result.metadata || {}), chunkIndex: 0 } }))
  const chunks = knowledgeRepo.listChunksByAuthor(authorId)
    .filter(chunk => ownedArticleIds.has(String(chunk.articleId)))
  const vectorResults = await searchVector(query, chunks, byId, { topK: Math.max(topK * 4, 20) })
  const merged = await searchHybrid(query, keywordResults, vectorResults, {
    topK: Math.max(topK * 4, 20),
    dedupe: 'chunk',
    maxChunksPerArticle
  })
  return rerankLocal(query, merged).slice(0, topK)
}

// Backward-compatible knowledge search entry point. RAG callers receive
// chunk-level results; public article search uses searchArticles explicitly.
async function search(query, options = {}) {
  return searchKnowledgeChunks(query, options)
}

function listDocuments() {
  return knowledgeRepo.listDocuments()
}

function getDocument(id) {
  return knowledgeRepo.getDocument(id)
}

function deleteDocument(id) {
  return knowledgeRepo.removeDocument(id)
}

function getChunksByArticle(articleId) {
  return knowledgeRepo.listChunksByArticle(articleId)
}

function getIndexStatus(articleId) {
  return knowledgeRepo.getLatestIndexJob(articleId)
}

// 对单个文章的 Chunk 做关键词 + 向量相关度打分，选出 topK。
// 只返回指定 articleId 的结果，避免串到其他文章。
function chunkKeywordScore(query, text) {
  const qTokens = tokenize(query)
  if (!qTokens.length) return 0
  const textTokens = new Set(tokenize(text))
  let hits = 0
  for (const t of qTokens) {
    if (textTokens.has(t)) hits++
  }
  return hits / qTokens.length
}

async function rankChunks(query, chunks, { articleId, title, topK }) {
  const qVec = await embed(query)
  const scored = []
  for (const chunk of chunks) {
    const text = String(chunk.content || '')
    if (!text) continue
    let vec = chunk.embedding
    if (!vec || vec.length === 0) vec = await embed(text)
    const kw = chunkKeywordScore(query, text)
    const sim = cosineSimilarity(qVec, vec)
    const score = kw + sim
    if (score <= 0) continue
    scored.push({
      articleId: String(articleId),
      title: title || '',
      chunk: text,
      score: +(score).toFixed(4),
      source: 'article'
    })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// 检索当前文章已索引的 Chunk（限定 articleId）
async function searchArticle(articleId, query, { topK = 5 } = {}) {
  const doc = knowledgeRepo.getDocumentByArticle(String(articleId))
  const chunks = knowledgeRepo.listChunksByArticle(String(articleId))
  if (!chunks || chunks.length === 0) return []
  const title = doc ? doc.title : ''
  return rankChunks(query, chunks, { articleId: String(articleId), title, topK })
}

// 文章未索引时，现场清洗 + 切块 + 打分（临时 Chunk，不持久化）
async function searchTemporaryArticle(post, query, { topK = 5, maxContentLength = 50000 } = {}) {
  if (!post) return []
  const articleId = String(post.id || '')
  const title = String(post.title || '')
  const content = cleanText(String(post.content || '').slice(0, maxContentLength))
  const pieces = splitIntoChunks(content)
  if (pieces.length === 0) return []
  const chunks = pieces.map((text, i) => ({ content: text, chunkIndex: i }))
  return rankChunks(query, chunks, { articleId, title, topK })
}

module.exports = {
  indexArticle,
  search,
  searchArticles,
  searchKnowledgeChunks,
  searchArticle,
  searchTemporaryArticle,
  listDocuments,
  getDocument,
  deleteDocument,
  getChunksByArticle,
  getIndexStatus,
  provider
}
