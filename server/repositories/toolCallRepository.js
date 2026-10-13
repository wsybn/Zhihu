// server/repositories/toolCallRepository.js
// Tool 调用日志持久化：记录每次工具调用的入参、结果、耗时、归属会话与用户。

const { JsonFileStore } = require('./jsonFileStore')
const { genRequestId } = require('../ai/error')
const { estimateTextTokens } = require('../agent/context/tokenCounter')

const toolCalls = new JsonFileStore('tool_call_logs')

function now() {
  return new Date().toISOString()
}

const DEFAULT_SAFE_VALUE_OPTIONS = Object.freeze({
  maxDepth: 6,
  maxArrayItems: 50,
  maxStringLength: 4000,
  maxObjectKeys: 100,
  maxTotalTokens: 12000
})

function safeValue(value, options = {}, state, depth = 0) {
  const opts = { ...DEFAULT_SAFE_VALUE_OPTIONS, ...(options || {}) }
  const context = state || { seen: new WeakSet(), tokens: 0 }
  const charge = (candidate, fallback = '[已达到日志大小上限]') => {
    const cost = estimateTextTokens(typeof candidate === 'string' ? candidate : JSON.stringify(candidate))
    if (context.tokens + cost > opts.maxTotalTokens) return fallback
    context.tokens += cost
    return candidate
  }
  if (value === null || value === undefined) return value
  if (depth > opts.maxDepth) return '[省略嵌套内容]'
  if (typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') return undefined
    if (typeof value === 'string') {
      const clipped = value.length > opts.maxStringLength
        ? `${value.slice(0, Math.max(0, opts.maxStringLength - 12))}…[已截断]`
        : value
      return charge(clipped)
    }
    return charge(value)
  }
  if (context.seen.has(value)) return '[循环引用]'
  context.seen.add(value)
  if (Array.isArray(value)) {
    const items = value.slice(0, opts.maxArrayItems).map(item => safeValue(item, opts, context, depth + 1))
    const omittedCount = Math.max(0, value.length - opts.maxArrayItems)
    if (omittedCount > 0) return charge({ items, omittedCount, truncated: true })
    return charge(items)
  }
  const out = {}
  const keys = Object.keys(value)
  const allowedKeys = keys.slice(0, opts.maxObjectKeys)
  for (const key of allowedKeys) {
    if (/token|authorization|cookie|password|api[-_]?key|secret/i.test(key)) continue
    const safe = safeValue(value[key], opts, context, depth + 1)
    if (safe !== undefined) out[key] = safe
  }
  if (keys.length > allowedKeys.length) {
    out.omittedKeys = keys.length - allowedKeys.length
    out.truncated = true
  }
  return charge(out)
}

function logToolCall({ runId, sessionId, userId, toolName, args, result, error, durationMs, status, idempotencyKey }) {
  const safeArgs = safeValue(args || {})
  const safeResult = result !== undefined ? safeValue(result) : null
  const safeError = error === undefined || error === null ? null : safeValue(String(error), { ...DEFAULT_SAFE_VALUE_OPTIONS, maxStringLength: 2000 })
  const resultSummary = result === undefined || result === null
    ? safeError
    : (Array.isArray(result) ? `数组结果（${result.length} 项）` : typeof result === 'object' ? `对象结果（${Object.keys(result).length} 个字段）` : String(result).slice(0, 200))
  if (idempotencyKey) {
    const existing = toolCalls.find(row => row.idempotencyKey === idempotencyKey)
    if (existing && existing.status === 'success') return existing
    if (existing) {
      return toolCalls.update(existing.id, {
        runId: runId || existing.runId || '',
        sessionId: sessionId || existing.sessionId || '',
        userId: userId || existing.userId || '',
        toolName,
        args: safeArgs,
        result: safeResult,
        compactResult: safeResult,
        resultSummary: safeValue(resultSummary, { ...DEFAULT_SAFE_VALUE_OPTIONS, maxStringLength: 500 }),
        rawResultRef: existing.id,
        error: safeError,
        status: status || (error ? 'failed' : 'success'),
        durationMs: durationMs || 0
      })
    }
  }
  const record = {
    id: 'tc-' + genRequestId().split('-').pop() + '-' + Date.now().toString(36),
    runId: runId || '',
    sessionId: sessionId || '',
    userId: userId || '',
    toolName,
    args: safeArgs,
    result: safeResult,
    compactResult: safeResult,
    resultSummary: safeValue(resultSummary, { ...DEFAULT_SAFE_VALUE_OPTIONS, maxStringLength: 500 }),
    rawResultRef: null,
    error: safeError,
    status: status || (error ? 'failed' : 'success'),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    durationMs: durationMs || 0,
    createdAt: now()
  }
  record.rawResultRef = record.id
  const maxRecords = Math.max(100, Number(process.env.AGENT_MAX_TOOL_LOG_RECORDS) || 5000)
  const existingRows = toolCalls.all()
  if (existingRows.length >= maxRecords) {
    const referenced = new Set()
    try {
      const agentRepo = require('./agentRepository')
      agentRepo.listAllRuns().forEach(run => {
        ;(run.checkpoint && run.checkpoint.completedToolCallIds || []).forEach(id => referenced.add(`${run.id}:${id}`))
        ;(run.checkpoint && run.checkpoint.pendingToolCalls || []).forEach(call => referenced.add(`${run.id}:${call.id}`))
      })
    } catch (e) {
      // Retention is best effort; never prevent the actual tool call from being logged.
    }
    const removable = existingRows
      .slice()
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .find(row => !row.idempotencyKey || !referenced.has(row.idempotencyKey))
    if (removable) toolCalls.remove(removable.id)
  }
  toolCalls.insert(record)
  return record
}

function getToolCall(id) {
  return toolCalls.getById(id)
}

function findSuccessfulByIdempotencyKey(idempotencyKey, { runId, userId } = {}) {
  if (!idempotencyKey) return null
  return toolCalls.find(row => (
    row.idempotencyKey === idempotencyKey &&
    row.status === 'success' &&
    (runId === undefined || row.runId === runId) &&
    (userId === undefined || String(row.userId || '') === String(userId || ''))
  )) || null
}

function listToolCalls(filter = {}) {
  let rows = toolCalls.all()
  if (filter.runId) rows = rows.filter(r => r.runId === filter.runId)
  if (filter.sessionId) rows = rows.filter(r => r.sessionId === filter.sessionId)
  if (filter.toolName) rows = rows.filter(r => r.toolName === filter.toolName)
  return rows
}

function resetStores() {
  toolCalls.reset()
}

module.exports = {
  safeValue,
  DEFAULT_SAFE_VALUE_OPTIONS,
  logToolCall,
  getToolCall,
  findSuccessfulByIdempotencyKey,
  listToolCalls,
  resetStores
}
