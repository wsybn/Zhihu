// 工具结果只以压缩、安全版本进入模型和跨轮上下文；原始结果仍由 ToolCall
// Repository 保存，便于审计和后续排查。

const {
  safeStableStringify,
  estimateValueTokens,
  truncateTextToTokens
} = require('./tokenCounter')

const SECRET_KEYS = new Set([
  'token', 'access_token', 'authorization', 'cookie', 'password', 'apikey', 'api_key', 'secret'
])

function isSecretKey(key) {
  return SECRET_KEYS.has(String(key).toLowerCase()) || /authorization|cookie|password|api[-_]?key|secret/i.test(String(key))
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  if (depth > 5) return '[省略嵌套内容]'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return '[循环引用]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1, seen))
  return Object.keys(value).reduce((out, key) => {
    if (!isSecretKey(key)) out[key] = sanitize(value[key], depth + 1, seen)
    return out
  }, {})
}

function safeError(error) {
  const source = error && typeof error === 'object' ? error : {}
  return {
    code: typeof source.code === 'string' ? source.code.slice(0, 80) : 'TOOL_ERROR',
    message: '工具执行未成功',
    retryable: Boolean(source.retryable)
  }
}

function compactSearch(data) {
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.results) ? data.results : [])
  return {
    items: items.slice(0, 8).map(item => ({
      id: item.articleId || item.id || item.chunkId || '',
      title: item.title || '',
      score: item.score,
      excerpt: String(item.excerpt || item.content || item.text || '').slice(0, 280),
      citation: item.citation || item.source || item.articleId || undefined
    })),
    total: data?.total === undefined ? items.length : data.total
  }
}

function compactReview(data) {
  return {
    score: data?.score,
    summary: String(data?.summary || '').slice(0, 800),
    issues: Array.isArray(data?.issues)
      ? data.issues.slice(0, 12).map(issue => ({
        severity: issue.severity,
        category: issue.category,
        message: String(issue.message || '').slice(0, 240),
        suggestion: String(issue.suggestion || '').slice(0, 240)
      }))
      : []
  }
}

function compactArticleList(data) {
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    items: items.slice(0, 10).map(item => ({
      id: item.id || item.articleId || '',
      title: item.title || '',
      summary: String(item.summary || item.excerpt || '').slice(0, 240)
    })),
    total: data?.total === undefined ? items.length : data.total
  }
}

function fitToBudget(value, maxTokens) {
  const budget = Math.max(1, Number(maxTokens) || 1)
  let result = sanitize(value)
  if (estimateValueTokens(result) <= budget) return result

  if (result && typeof result === 'object') {
    if (Array.isArray(result)) result = result.slice(0, 1)
    else {
      const keys = Object.keys(result)
      for (const key of keys) {
        if (estimateValueTokens(result) <= budget) break
        if (Array.isArray(result[key])) result[key] = result[key].slice(0, 2)
        else if (typeof result[key] === 'string') result[key] = truncateTextToTokens(result[key], Math.max(1, Math.floor(budget / 2)))
      }
    }
  }
  if (estimateValueTokens(result) <= budget) return result
  // 最后的降级可以是字符串，但必须严格满足预算；结构化字段已无法在
  // 极小窗口中同时保留，字符串片段仍比把原始结果直接送入模型安全。
  return truncateTextToTokens(safeStableStringify(result), budget)
}

function compressToolResult({ toolName = 'unknown', result, error, maxTokens = 6000 } = {}) {
  const raw = error ? { error: safeError(error) } : sanitize(result)
  const rawTokenEstimate = estimateValueTokens(raw)
  let compact
  if (error) compact = { error: safeError(error) }
  else if (/search/i.test(toolName) && (result?.items || result?.results)) compact = compactSearch(result)
  else if (/review/i.test(toolName)) compact = compactReview(result)
  else if (/article/i.test(toolName) && result?.items) compact = compactArticleList(result)
  else if (/context/i.test(toolName)) {
    compact = {
      title: String(result?.title || '').slice(0, 300),
      selection: String(result?.selection || '').slice(0, 1200),
      content: String(result?.content || '').slice(0, 2000)
    }
  } else compact = raw

  compact = fitToBudget(compact, maxTokens)
  return {
    toolName,
    status: error ? 'failed' : 'success',
    compactResult: compact,
    rawTokenEstimate,
    compactTokenEstimate: estimateValueTokens(compact)
  }
}

module.exports = {
  compressToolResult,
  sanitizeToolResult: sanitize,
  fitToBudget
}
