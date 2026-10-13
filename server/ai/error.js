// server/ai/error.js
// 统一错误模型：所有 Agent 接口对外只返回安全、脱敏的错误结构，
// 绝不把 DeepSeek 原始错误、API Key、内部堆栈返回给前端。

const crypto = require('crypto')

function genRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex')
}

const ERROR_CODES = {
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_AUTH_FAILED: 'AI_AUTH_FAILED',
  AI_BALANCE: 'AI_BALANCE',
  AI_BAD_RESPONSE: 'AI_BAD_RESPONSE',
  AI_STRUCTURED_OUTPUT_INVALID: 'AI_STRUCTURED_OUTPUT_INVALID',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_CALL_LIMIT: 'TOOL_CALL_LIMIT',
  TOOL_ITERATION_LIMIT: 'TOOL_ITERATION_LIMIT',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  CONTEXT_BUDGET_EXCEEDED: 'CONTEXT_BUDGET_EXCEEDED',
  CANCELLED: 'CANCELLED'
}

// 面向用户的安全文案，不泄露任何内部信息
const SAFE_MESSAGES = {
  [ERROR_CODES.AI_REQUEST_FAILED]: 'AI 请求失败，请稍后重试',
  [ERROR_CODES.AI_TIMEOUT]: 'AI 请求超时，请稍后重试',
  [ERROR_CODES.AI_RATE_LIMITED]: '请求过于频繁，请稍后重试',
  [ERROR_CODES.AI_AUTH_FAILED]: 'AI 服务鉴权失败，请联系管理员检查配置',
  [ERROR_CODES.AI_BALANCE]: 'AI 服务余额不足',
  [ERROR_CODES.AI_BAD_RESPONSE]: 'AI 返回了无效内容，请重试',
  [ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID]: 'AI 返回内容格式校验失败，请重试',
  [ERROR_CODES.VALIDATION_FAILED]: '请求参数不合法',
  [ERROR_CODES.NOT_FOUND]: '资源不存在',
  [ERROR_CODES.FORBIDDEN]: '无权访问该资源',
  [ERROR_CODES.TOOL_NOT_FOUND]: '工具不存在',
  [ERROR_CODES.TOOL_CALL_LIMIT]: '工具调用次数已达上限',
  [ERROR_CODES.TOOL_ITERATION_LIMIT]: '工具调用轮数超过上限，未能得到最终答案',
  [ERROR_CODES.TOOL_EXECUTION_FAILED]: '工具执行失败',
  [ERROR_CODES.CONTEXT_BUDGET_EXCEEDED]: '上下文超过预算，无法安全构建模型输入',
  [ERROR_CODES.CANCELLED]: '请求已取消'
}

class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message || SAFE_MESSAGES[code] || '请求失败')
    this.name = 'AppError'
    this.code = code
    this.status = extra.status !== undefined ? extra.status : 500
    this.retryable = extra.retryable !== undefined ? extra.retryable : false
    this.requestId = extra.requestId || genRequestId()
    this.cause = extra.cause
    this.detail = extra.detail
  }

  toResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        requestId: this.requestId
      }
    }
  }
}

// 把 DeepSeek / 网络错误归类为安全的 AppError。
// 原始 error 只会写入服务端日志（由调用方负责脱敏），不会进入返回体。
function classifyAiError(error, requestId) {
  // 已经是安全的应用错误（如工具轮数超限、取消）时原样透传，避免被降级重归类
  if (error instanceof AppError) return error

  const status = error && error.status
  const name = error && error.name
  const code = error && error.code

  // 主动取消（AbortController）
  if (
    name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ECONNABORTED' ||
    (error && error.type === 'aborted')
  ) {
    return new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499, requestId })
  }

  if (status === 401) {
    return new AppError(ERROR_CODES.AI_AUTH_FAILED, undefined, { status: 500, requestId })
  }
  if (status === 402) {
    return new AppError(ERROR_CODES.AI_BALANCE, undefined, { status: 402, requestId })
  }
  if (status === 429) {
    return new AppError(ERROR_CODES.AI_RATE_LIMITED, undefined, { status: 429, retryable: true, requestId })
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new AppError(ERROR_CODES.AI_REQUEST_FAILED, undefined, { status: 502, retryable: true, requestId })
  }
  if (status) {
    return new AppError(ERROR_CODES.AI_REQUEST_FAILED, undefined, { status, requestId })
  }

  // 超时
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(String(error && error.message || ''))) {
    return new AppError(ERROR_CODES.AI_TIMEOUT, undefined, { status: 504, retryable: true, requestId })
  }

  // 其余网络 / 未知错误
  return new AppError(ERROR_CODES.AI_REQUEST_FAILED, undefined, { status: 502, retryable: true, requestId })
}

// 统一判断「取消 / 中止」类错误：覆盖主动 AbortController、超时中止、
// 以及 classifyAiError 已归类的 CANCELLED AppError。
// 用于编排器 / 路由层避免把「已取消」误判为「失败」。
function isAbortError(error) {
  if (!error) return false
  if (error instanceof AppError && error.code === ERROR_CODES.CANCELLED) return true
  const name = error.name
  const code = error.code
  if (name === 'AbortError' || code === 'ABORT_ERR' || code === 'ECONNABORTED') return true
  return error.type === 'aborted'
}

// 日志脱敏：移除 apiKey / authorization / token 等敏感字段
function sanitizeForLog(value) {
  try {
    const seen = new WeakSet()
    const walk = (v) => {
      if (v === null || v === undefined) return v
      if (typeof v !== 'object') return v
      if (seen.has(v)) return '[Circular]'
      seen.add(v)
      const out = Array.isArray(v) ? [] : {}
      for (const key of Object.keys(v)) {
        const k = key.toLowerCase()
        if (/api[-_]?key|authorization|token|secret|password|bearer/.test(k)) {
          out[key] = '[REDACTED]'
          continue
        }
        out[key] = walk(v[key])
      }
      return out
    }
    return walk(value)
  } catch (e) {
    return '[unserializable]'
  }
}

module.exports = {
  genRequestId,
  ERROR_CODES,
  SAFE_MESSAGES,
  AppError,
  classifyAiError,
  isAbortError,
  sanitizeForLog
}
