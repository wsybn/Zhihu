// server/repositories/knowledgeRepository.js
// 知识库文档与 Chunk 的持久化仓储。

const { JsonFileStore } = require('./jsonFileStore')
const { genRequestId } = require('../ai/error')

const documents = new JsonFileStore('knowledge_documents')
const chunks = new JsonFileStore('knowledge_chunks')
const indexJobs = new JsonFileStore('knowledge_index_jobs')

function now() {
  return new Date().toISOString()
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${genRequestId().split('-').pop()}`
}

// ---------- Documents ----------
function createDocument({ articleId, authorId = '', title, content, tags = [] }) {
  const existing = documents.find(d => d.articleId === articleId)
  if (existing) {
    return updateDocument(existing.id, { authorId, title, content, tags, updatedAt: now() })
  }
  const doc = {
    id: newId('doc'),
    articleId,
    authorId,
    title,
    content,
    tags,
    createdAt: now(),
    updatedAt: now()
  }
  documents.insert(doc)
  return doc
}

function getDocument(id) {
  return documents.getById(id)
}

function getDocumentByArticle(articleId) {
  return documents.find(d => d.articleId === articleId)
}

function listDocuments() {
  return documents.all()
}

function listDocumentsByAuthor(authorId) {
  if (!authorId) return documents.all()
  return documents.filter(d => String(d.authorId || '') === String(authorId))
}

function updateDocument(id, patch) {
  return documents.update(id, patch)
}

function removeDocument(id) {
  const doc = documents.getById(id)
  if (doc) {
    chunks.removeWhere(c => c.documentId === id)
  }
  return documents.remove(id)
}

// ---------- Chunks ----------
function createChunk({ documentId, articleId, content, chunkIndex, embedding = [], metadata = {} }) {
  const chunk = {
    id: newId('chunk'),
    documentId,
    articleId,
    content,
    chunkIndex,
    embedding,
    metadata,
    createdAt: now()
  }
  chunks.insert(chunk)
  return chunk
}

function listChunksByDocument(documentId) {
  return chunks.filter(c => c.documentId === documentId)
}

function listChunksByArticle(articleId) {
  return chunks.filter(c => c.articleId === articleId)
}

function listAllChunks() {
  return chunks.all()
}

function listChunksByAuthor(authorId) {
  if (!authorId) return chunks.all()
  // chunk 本身不冗余存 authorId，通过其所属文档的 authorId 解析归属
  const owned = new Set(
    documents
      .filter(d => String(d.authorId || '') === String(authorId))
      .map(d => String(d.articleId))
  )
  return chunks.filter(c => owned.has(String(c.articleId)))
}

function removeChunksByDocument(documentId) {
  return chunks.removeWhere(c => c.documentId === documentId)
}

// Replaces an entire document index in one repository operation. Callers must
// calculate every embedding before invoking this function so a failed index
// leaves the previous chunks untouched.
function replaceChunksForDocument(documentId, nextChunks = []) {
  chunks.removeWhere(c => c.documentId === documentId)
  const records = nextChunks.map(chunk => ({
    id: chunk.id || newId('chunk'),
    documentId,
    articleId: chunk.articleId,
    content: chunk.content,
    chunkIndex: chunk.chunkIndex,
    embedding: chunk.embedding || [],
    metadata: chunk.metadata || {},
    createdAt: chunk.createdAt || now()
  }))
  chunks.insertMany(records)
  return records
}

function createIndexJob({ articleId, documentId = null } = {}) {
  const job = {
    id: newId('index'),
    articleId: String(articleId || ''),
    documentId,
    status: 'pending',
    error: null,
    createdAt: now(),
    updatedAt: now()
  }
  indexJobs.insert(job)
  return job
}

function updateIndexJob(id, patch = {}) {
  return indexJobs.update(id, { ...patch, updatedAt: now() })
}

function getIndexJob(id) {
  return indexJobs.getById(id)
}

function getLatestIndexJob(articleId) {
  return indexJobs
    .filter(job => String(job.articleId) === String(articleId))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null
}

function listIndexJobs({ articleId } = {}) {
  return articleId === undefined
    ? indexJobs.all()
    : indexJobs.filter(job => String(job.articleId) === String(articleId))
}

// 重置全部存储（测试隔离用）
function resetStores() {
  documents.reset()
  chunks.reset()
  indexJobs.reset()
}

module.exports = {
  createDocument,
  getDocument,
  getDocumentByArticle,
  listDocuments,
  listDocumentsByAuthor,
  updateDocument,
  removeDocument,
  createChunk,
  listChunksByDocument,
  listChunksByArticle,
  listAllChunks,
  listChunksByAuthor,
  removeChunksByDocument,
  replaceChunksForDocument,
  createIndexJob,
  updateIndexJob,
  getIndexJob,
  getLatestIndexJob,
  listIndexJobs,
  resetStores,
  newId
}
