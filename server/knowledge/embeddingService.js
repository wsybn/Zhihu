// server/knowledge/embeddingService.js
// Embedding 服务：当前使用「本地哈希词袋」作为可运行的 fallback，
// 明确标记 embeddingProvider，不伪装成真实向量。
// 预留真实 Embedding 接口（OpenAI 兼容 / 自建），后续替换本文件即可。

const DIM = 256

// 简易分词：中文按连续 CJK 字符 + 二元组，英文按单词
function tokenize(text) {
  const tokens = []
  const s = String(text || '').toLowerCase()
  // 英文 / 数字单词
  const words = s.match(/[a-z0-9]+/g) || []
  words.forEach(w => tokens.push(w))
  // 中文连续串，取单字与二元组
  const cjkRuns = s.match(/[一-鿿]+/g) || []
  cjkRuns.forEach(run => {
    for (const ch of run) tokens.push(ch)
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  })
  return tokens
}

function hashToken(token) {
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % DIM)
}

function l2Normalize(vec) {
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}

// 本地哈希词袋向量（TF 加权 + L2 归一化）
function embedLocal(text) {
  const vec = new Array(DIM).fill(0)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vec
  for (const token of tokens) {
    vec[hashToken(token)] += 1
  }
  return l2Normalize(vec)
}

// 余弦相似度
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // 输入已归一化，点积即余弦
}

// 当前 provider 信息，暴露给上层与日志，避免误判为真实语义向量
const provider = {
  name: 'local-hashing',
  isFallback: true,
  dim: DIM
}

// 统一入口：embed(text) -> number[]（已归一化）
// 后续接入真实模型时，在此处替换实现并更新 provider。
async function embed(text) {
  return embedLocal(text)
}

module.exports = {
  embed,
  embedLocal,
  tokenize,
  cosineSimilarity,
  provider,
  DIM
}
