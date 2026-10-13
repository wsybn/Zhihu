// server/repositories/agentRepository.js
// Agent 会话 / 消息 / 运行 / 步骤 / 补丁 的持久化仓储。
// 服务重启后可通过这些数据恢复会话与运行。

const { JsonFileStore } = require('./jsonFileStore')
const { genRequestId } = require('../ai/error')

const sessions = new JsonFileStore('agent_sessions')
const messages = new JsonFileStore('agent_messages')
const runs = new JsonFileStore('agent_runs')
const runSteps = new JsonFileStore('agent_run_steps')
const patches = new JsonFileStore('article_patches')

function now() {
  return new Date().toISOString()
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${genRequestId().split('-').pop()}`
}

// ---------- Sessions ----------
function createSession({ title = 'AI 创作会话', userId = '' }) {
  const session = {
    id: newId('sess'),
    title,
    userId,
    status: 'active',
    summary: null,
    summaryUntilMessageId: null,
    summaryVersion: 0,
    summaryUpdatedAt: null,
    createdAt: now(),
    updatedAt: now()
  }
  sessions.insert(session)
  return session
}

function getSession(id) {
  const session = sessions.getById(id)
  return session
    ? {
        summary: null,
        summaryUntilMessageId: null,
        summaryVersion: 0,
        summaryUpdatedAt: null,
        ...session
      }
    : session
}

function touchSession(id) {
  return sessions.update(id, { updatedAt: now() })
}

function updateSession(id, patch = {}) {
  const safePatch = { ...patch }
  delete safePatch.id
  return sessions.update(id, safePatch)
}

// JsonFileStore 没有数据库级 CAS；同步版本检查可以防止同一进程内的
// 并发摘要用旧版本覆盖新版本，未来迁移数据库时可替换为条件更新。
function updateSessionSummary(id, { summary, summaryUntilMessageId, expectedVersion } = {}) {
  const current = sessions.getById(id)
  if (!current) return null
  const currentVersion = Number(current.summaryVersion || 0)
  if (expectedVersion !== undefined && currentVersion !== Number(expectedVersion)) return null
  return sessions.update(id, {
    summary: summary === undefined ? current.summary || null : summary,
    summaryUntilMessageId: summaryUntilMessageId === undefined ? current.summaryUntilMessageId || null : summaryUntilMessageId,
    summaryVersion: currentVersion + 1,
    summaryUpdatedAt: now()
  })
}

function listSessionsByUser(userId) {
  const rows = !userId ? sessions.all() : sessions.filter(s => s.userId === userId)
  return rows.map(session => getSession(session.id))
}

// ---------- Messages ----------
function createMessage({ sessionId, role, type, content = '', payload, userId = '', clientMessageId, runId, tokenEstimate, status }) {
  if (clientMessageId) {
    const existing = findMessageByClientId(sessionId, userId, clientMessageId)
    if (existing) return existing
  }
  const msg = {
    id: newId('m'),
    sessionId,
    userId,
    role,
    type,
    content,
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(runId ? { runId } : {}),
    ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
    ...(status ? { status } : {}),
    createdAt: now()
  }
  if (payload !== undefined) msg.payload = payload
  messages.insert(msg)
  return msg
}

function compareMessageToCursor(message, cursor) {
  if (!cursor) return 0
  if (typeof cursor === 'object') {
    return String(message.createdAt || '').localeCompare(String(cursor.createdAt || '')) ||
      String(message.id || '').localeCompare(String(cursor.id || ''))
  }
  const target = messages.getById(String(cursor))
  return target ? compareMessages(message, target) : 0
}

function paginateMessages(source, { page = 1, pageSize = 50, before, cursor, order = 'asc' } = {}) {
  const normalizedPage = Math.max(1, Number(page) || 1)
  const normalizedPageSize = Math.max(1, Math.min(100, Number(pageSize) || 50))
  const direction = String(order).toLowerCase() === 'desc' ? -1 : 1
  let all = source.slice().sort((a, b) => direction * compareMessages(a, b))
  const boundary = before || cursor
  if (boundary) {
    // `before` is intentionally chronological: in descending mode it selects
    // older records, while ascending mode selects records after the cursor.
    all = all.filter(message => {
      const comparison = compareMessageToCursor(message, boundary)
      return direction < 0 ? comparison < 0 : comparison > 0
    })
  }
  const start = (normalizedPage - 1) * normalizedPageSize
  return {
    items: all.slice(start, start + normalizedPageSize),
    total: all.length,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    order: direction < 0 ? 'desc' : 'asc',
    ...(all.length > start + normalizedPageSize
      ? { nextCursor: all[start + normalizedPageSize - 1] && { createdAt: all[start + normalizedPageSize - 1].createdAt, id: all[start + normalizedPageSize - 1].id } }
      : {})
  }
}

function listMessages(sessionId, options = {}) {
  const all = messages.filter(m => m.sessionId === sessionId)
  return paginateMessages(all, options)
}

// 同时校验消息归属的会话与用户，供权限校验使用
function listMessagesBySessionAndUser(sessionId, userId, options = {}) {
  const all = messages.filter(m => m.sessionId === sessionId && String(m.userId || '') === String(userId || ''))
  return paginateMessages(all, options)
}

function compareMessages(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''))
}

function getMessage(id) {
  return messages.getById(id)
}

function findMessageByClientId(sessionId, userId, clientMessageId) {
  if (!clientMessageId) return null
  return messages.find(message => (
    message.sessionId === sessionId &&
    String(message.userId || '') === String(userId || '') &&
    message.clientMessageId === clientMessageId
  )) || null
}

function findMessageByRunId(runId, { role } = {}) {
  return messages.find(message => message.runId === runId && (!role || message.role === role)) || null
}

function listRecentMessages(sessionId, userId, { limit = 50, before, order = 'desc' } = {}) {
  const all = messages.filter(m => m.sessionId === sessionId && String(m.userId || '') === String(userId || ''))
  const normalizedLimit = Math.max(0, Math.min(100, Number(limit) || 50))
  const direction = String(order).toLowerCase() === 'desc' ? -1 : 1
  let sorted = all.slice().sort((a, b) => direction * compareMessages(a, b))
  if (before) {
    sorted = sorted.filter(message => {
      const comparison = compareMessageToCursor(message, before)
      return direction < 0 ? comparison < 0 : comparison > 0
    })
  }
  return sorted.slice(0, normalizedLimit)
}

function listMessagesAfter(sessionId, userId, messageId, { limit = 100000 } = {}) {
  const all = listMessagesBySessionAndUser(sessionId, userId, { page: 1, pageSize: 100000 }).items
  const index = all.findIndex(message => message.id === messageId)
  if (index < 0) return []
  return all.slice(index + 1, index + 1 + limit)
}

// ---------- Runs ----------
function createRun({ sessionId, type, status = 'running', currentStep = null, userId = '', requestSnapshot = null }) {
  const run = {
    id: newId('run'),
    sessionId,
    type,
    status,
    currentStep,
    steps: [],
    userId,
    requestSnapshot,
    checkpoint: {
      version: 1,
      phase: 'user_message_saved',
      iteration: 0,
      userMessageId: null,
      assistantMessageId: null,
      contextUsage: {},
      selectedBlockIds: [],
      completedToolCallIds: [],
      pendingToolCalls: [],
      compactToolResults: [],
      modelContinuation: { input: [], functionCalls: [] },
      partialAssistantOutput: '',
      updatedAt: now()
    },
    createdAt: now(),
    updatedAt: now()
  }
  runs.insert(run)
  return run
}

function getRun(id) {
  const run = runs.getById(id)
  if (!run) return run
  return {
    checkpoint: {
      version: 1,
      phase: 'user_message_saved',
      iteration: 0,
      userMessageId: null,
      assistantMessageId: null,
      contextUsage: {},
      selectedBlockIds: [],
      completedToolCallIds: [],
      pendingToolCalls: [],
      compactToolResults: [],
      modelContinuation: { input: [], functionCalls: [] },
      partialAssistantOutput: '',
      ...(run.checkpoint || {})
    },
    ...run
  }
}

function updateRun(id, patch) {
  const updated = runs.update(id, { ...patch, updatedAt: now() })
  return updated
}

function updateRunCheckpoint(id, patch = {}) {
  const run = runs.getById(id)
  if (!run) return null
  const checkpoint = { ...(run.checkpoint || {}), ...patch, version: 1, updatedAt: now() }
  return runs.update(id, { checkpoint })
}

function listRunsBySession(sessionId) {
  return runs.filter(r => r.sessionId === sessionId)
}

function listRunsBySessionAndUser(sessionId, userId) {
  return runs.filter(r => r.sessionId === sessionId && String(r.userId || '') === String(userId || ''))
}

function listAllRuns() {
  return runs.all()
}

// ---------- Run steps ----------
function createRunStep({ runId, stepKey, status = 'pending', input = {}, output = {} }) {
  const step = {
    id: newId('step'),
    runId,
    stepKey,
    status,
    input,
    output,
    error: null,
    retryCount: 0,
    startedAt: now(),
    completedAt: null
  }
  runSteps.insert(step)
  return step
}

function getRunStep(id) {
  return runSteps.getById(id)
}

function updateRunStep(id, patch) {
  return runSteps.update(id, patch)
}

function listRunSteps(runId) {
  return runSteps.filter(s => s.runId === runId)
}

// ---------- Patches ----------
function createPatch(patch) {
  const record = {
    ...patch,
    id: patch.id || newId('patch'),
    createdAt: now()
  }
  patches.insert(record)
  return record
}

function listPatchesByArticle(articleId) {
  return patches.filter(p => p.articleId === articleId)
}

function getPatch(id) {
  return patches.getById(id)
}

function updatePatch(id, patch) {
  return patches.update(id, patch)
}

// 重置全部存储（测试隔离用：重新解析 AGENT_DATA_DIR，清空内存缓存）
function resetStores() {
  sessions.reset()
  messages.reset()
  runs.reset()
  runSteps.reset()
  patches.reset()
}

module.exports = {
  createSession,
  getSession,
  touchSession,
  listSessionsByUser,
  createMessage,
  listMessages,
  listMessagesBySessionAndUser,
  listRecentMessages,
  listMessagesAfter,
  getMessage,
  findMessageByClientId,
  findMessageByRunId,
  updateSession,
  updateSessionSummary,
  createRun,
  getRun,
  updateRun,
  updateRunCheckpoint,
  listRunsBySession,
  listRunsBySessionAndUser,
  listAllRuns,
  createRunStep,
  getRunStep,
  updateRunStep,
  listRunSteps,
  createPatch,
  getPatch,
  updatePatch,
  listPatchesByArticle,
  resetStores,
  newId
}
