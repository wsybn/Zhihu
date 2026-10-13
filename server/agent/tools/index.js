// server/agent/tools/index.js
// 工具注册表与统一执行调度：
//   - 参数校验
//   - 调用次数限制
//   - 超时
//   - 异常捕获
//   - 调用日志
//   - 权限（只读当前用户有权限的数据）

const defs = require('./definitions')
const toolCallRepo = require('../../repositories/toolCallRepository')
const { AppError, ERROR_CODES } = require('../../ai/error')

// 单次 Run 的工具调用总上限，避免模型在工具间无限循环。
const MAX_TOTAL_TOOL_CALLS = 20

function createRegistry() {
  const tools = [
    defs.buildSearchArticles(),
    defs.buildReadArticle(),
    defs.buildGetCurrentArticleContext(),
    defs.buildSearchKnowledgeBase(),
    defs.buildCreateOutline(),
    defs.buildCreateArticlePatch(),
    defs.buildReviewArticle(),
    defs.buildSuggestTopics()
  ]
  const byName = new Map(tools.map(t => [t.name, t]))
  return { tools, byName }
}

// 合并多个 AbortSignal：任一信号中止即触发合并信号，全部清理监听器。
// 用于让工具同时监听「Agent Run 取消信号」与「工具超时信号」，
// 避免用新的 signal 完全覆盖父 signal。
function mergeAbortSignals(signals) {
  const controller = new AbortController()
  const listeners = []
  const onAbort = () => controller.abort()

  for (const sig of signals || []) {
    if (!sig) continue
    if (sig.aborted) {
      controller.abort()
      break
    }
    sig.addEventListener('abort', onAbort, { once: true })
    listeners.push(sig)
  }

  const cleanup = () => {
    for (const sig of listeners) {
      sig.removeEventListener('abort', onAbort)
    }
  }

  return { signal: controller.signal, cleanup }
}

// 基础参数校验：检查 required 字段是否存在（类型宽松，供模型调用容错）
function validateArgs(tool, args) {
  const params = tool.parameters || {}
  const required = params.required || []
  const missing = required.filter(key => args[key] === undefined || args[key] === null || args[key] === '')
  if (missing.length) {
    return { ok: false, error: `缺少参数：${missing.join(', ')}` }
  }
  return { ok: true }
}

// 工具白名单：模型请求的工具名必须在注册表中，否则拒绝
function isAllowedTool(byName, toolName) {
  return byName.has(toolName)
}

// 执行单个工具，统一做次数限制 / 超时 / 取消 / 异常 / 日志。
// ctx.callCounts 必须由一次 Run 复用同一个 Map，保证 per-tool 与 total 限制跨调用生效。
async function executeTool(registry, toolName, args, ctx = {}) {
  const tool = registry.byName.get(toolName)
  if (!tool) {
    throw new AppError(ERROR_CODES.TOOL_NOT_FOUND, undefined, { status: 404 })
  }

  const validation = validateArgs(tool, args || {})
  if (!validation.ok) {
    return { error: validation.error }
  }

  // 恢复 Run 时优先复用已经成功的工具结果，避免重复执行有副作用的工具。
  if (ctx.idempotencyKey) {
    const existing = toolCallRepo.findSuccessfulByIdempotencyKey(ctx.idempotencyKey, {
      runId: ctx.runId,
      userId: ctx.userId
    })
    if (existing) {
      return { result: existing.result, reused: true, rawResultRef: existing.id }
    }
  }

  // 调用次数限制：callCounts 在整个 Run 内复用，不能每次重新创建
  const callCounts = ctx.callCounts || new Map()
  const maxTotalCalls = ctx.maxTotalCalls !== undefined ? ctx.maxTotalCalls : MAX_TOTAL_TOOL_CALLS
  const totalCalls = Array.from(callCounts.values()).reduce((a, b) => a + b, 0)

  if (totalCalls >= maxTotalCalls) {
    toolCallRepo.logToolCall({
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      toolName,
      args: args || {},
      error: '工具调用总次数已达上限',
      status: 'failed',
      idempotencyKey: ctx.idempotencyKey,
      durationMs: 0
    })
    return { error: '工具调用总次数已达上限', limit: true }
  }

  const count = (callCounts.get(toolName) || 0) + 1
  if (count > tool.maxCalls) {
    toolCallRepo.logToolCall({
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      toolName,
      args: args || {},
      error: `工具 ${toolName} 调用次数已达上限（${tool.maxCalls}）`,
      status: 'failed',
      idempotencyKey: ctx.idempotencyKey,
      durationMs: 0
    })
    return { error: `工具 ${toolName} 调用次数已达上限（${tool.maxCalls}）`, limit: true }
  }
  callCounts.set(toolName, count)

  const start = Date.now()
  const parentSignal = ctx.signal
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), tool.timeoutMs || 10000)
  const { signal, cleanup } = mergeAbortSignals([parentSignal, timeoutController.signal])

  const log = (result, error, status) => toolCallRepo.logToolCall({
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    toolName,
    args: args || {},
    result,
    error,
    status,
    idempotencyKey: ctx.idempotencyKey,
    durationMs: Date.now() - start
  })

  try {
    const result = await tool.execute(args, { ...ctx, signal })

    if (parentSignal && parentSignal.aborted) {
      const record = log(null, '工具执行已取消', 'cancelled')
      return { error: '工具执行已取消', cancelled: true, rawResultRef: record && record.id }
    }

    const record = log(result, null, 'success')
    return { result, rawResultRef: record && record.id }
  } catch (e) {
    const cancelled = Boolean(parentSignal && parentSignal.aborted)
    const timedOut = !cancelled && timeoutController.signal.aborted
    const status = cancelled ? 'cancelled' : (timedOut ? 'timeout' : 'failed')
    // 只返回安全脱敏文案，不泄露内部错误 / 堆栈
    const safeError = cancelled
      ? '工具执行已取消'
      : (timedOut ? '工具执行超时' : (e instanceof AppError ? e.message : '工具执行失败'))

    const record = log(null, safeError, status)

    if (cancelled) return { error: safeError, cancelled: true, rawResultRef: record && record.id }
    if (timedOut) return { error: safeError, timeout: true, rawResultRef: record && record.id }
    if (e instanceof AppError) return { error: safeError, rawResultRef: record && record.id }
    return { error: safeError, rawResultRef: record && record.id }
  } finally {
    clearTimeout(timer)
    cleanup()
  }
}

// 转成 DeepSeek / OpenAI Responses API 的 tools 格式
function toOpenAITools(registry) {
  return registry.tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))
}

module.exports = {
  createRegistry,
  executeTool,
  isAllowedTool,
  toOpenAITools,
  mergeAbortSignals,
  MAX_TOTAL_TOOL_CALLS
}
