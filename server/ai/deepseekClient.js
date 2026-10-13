// server/ai/deepseekClient.js
// 统一 DeepSeek 客户端：文本 / JSON 结构化 / SSE 流式 / Tool Calling 四类调用，
// 集中处理超时、AbortController、401/402/429/500、网络错误、空响应与 JSON 解析失败。
// 路由层不再重复编写 DeepSeek 调用逻辑。

require('dotenv').config()
const OpenAI = require('openai')
const { AppError, ERROR_CODES, classifyAiError, genRequestId } = require('./error')
const { validateAgainstSchema } = require('./validateStructuredOutput')
const { compressToolResult } = require('../agent/context/toolResultCompressor')

const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_TIMEOUT_MS = 60 * 1000
const MAX_OUTPUT_TOKENS = 4000

let _client = null

function getConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL
  }
}

function hasApiKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY)
}

function getClient() {
  if (!hasApiKey()) {
    throw new AppError(ERROR_CODES.AI_AUTH_FAILED, '未配置 DEEPSEEK_API_KEY，无法调用模型', {
      status: 500
    })
  }
  if (!_client) {
    const { apiKey, baseURL } = getConfig()
    _client = new OpenAI({
      apiKey,
      baseURL,
      timeout: DEFAULT_TIMEOUT_MS
    })
  }
  return _client
}

// 把外部 signal 与内部超时合并为一个 signal，确保取消与超时都能中断请求
function withSignal(externalSignal) {
  const controller = new AbortController()
  const timer = null
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  const wrapped = controller.signal
  const abort = () => controller.abort()
  const clear = () => {
    if (timer) clearTimeout(timer)
  }
  return { signal: wrapped, abort, clear }
}

// 从 Responses API 返回结构中尽力提取最终文本。
// 优先读取 output_text；部分 SDK / 服务端不聚合 output_text 时，
// 回退到遍历 output[].content[] 中 output_text / text 类型的文本片段拼接。
function extractResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const texts = []
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue
    for (const part of item.content || []) {
      if (
        (part?.type === 'output_text' || part?.type === 'text') &&
        typeof part.text === 'string'
      ) {
        texts.push(part.text)
      }
    }
  }

  return texts.join('').trim()
}

// 空响应安全告警：只记录结构信息，绝不记录 API Key、完整 Prompt 或用户文章正文。
function warnEmptyResponse(response, context) {
  console.warn('DeepSeek returned empty text', {
    context,
    responseId: response?.id,
    status: response?.status,
    outputTypes: Array.isArray(response?.output) ? response.output.map(item => item?.type) : [],
    hasOutputText: typeof response?.output_text === 'string'
  })
}

// Responses API 同时接受字符串和消息数组。数组必须复制，避免工具循环向调用方
// 传入的数组追加 function_call / output 时产生隐式副作用。
function normalizeInput(input) {
  if (!Array.isArray(input)) return input === undefined || input === null ? '' : String(input)
  const copy = input.map(item => (item && typeof item === 'object' ? { ...item } : item))
  // 兼容旧调用方把 input 转成字符串做断言/日志的行为；不会进入 JSON 序列化。
  Object.defineProperty(copy, 'toString', {
    enumerable: false,
    value: () => copy.map(item => typeof item === 'string' ? item : item?.content || '').join('\n')
  })
  return copy
}

// 普通文本调用，返回纯文本（已 trim，空响应会抛 AI_BAD_RESPONSE）
async function chat({ instructions, input, maxOutputTokens = MAX_OUTPUT_TOKENS, signal }) {
  const requestId = genRequestId()
  if (!hasApiKey()) {
    throw new AppError(ERROR_CODES.AI_AUTH_FAILED, '未配置 DEEPSEEK_API_KEY，无法调用模型', { status: 500, requestId })
  }
  const { signal: merged, clear } = withSignal(signal)
  try {
    const client = getClient()
    const response = await client.responses.create(
      {
        model: getConfig().model,
        instructions,
        input: normalizeInput(input),
        max_output_tokens: maxOutputTokens,
        stream: false
      },
      { signal: merged }
    )
    const text = extractResponseText(response)
    const trimmed = text.trim()
    if (!trimmed) {
      warnEmptyResponse(response, 'chat')
      throw new AppError(ERROR_CODES.AI_BAD_RESPONSE, undefined, { status: 502, retryable: true, requestId })
    }
    return trimmed
  } catch (error) {
    throw classifyAiError(error, requestId)
  } finally {
    clear()
  }
}

// 从模型输出中尽力解析 JSON：剥离 Markdown 代码块后 JSON.parse
function parseJson(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: new Error('输出不是字符串') }
  }
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 截取首个 { 到最后一个 } 之间的内容，容忍模型前后多余的说明文字
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last > first) s = s.slice(first, last + 1)
  try {
    return { ok: true, value: JSON.parse(s) }
  } catch (error) {
    return { ok: false, error }
  }
}

// JSON 结构化调用：先解析，解析失败 / schema 校验失败会自动重试一次，
// 重试仍失败则抛出结构化错误，绝不把残缺结果直接交给前端。
async function chatJson({ instructions, input, schema, maxOutputTokens = MAX_OUTPUT_TOKENS, signal, maxRetries = 1 }) {
  const requestId = genRequestId()
  const baseInstructions = instructions || ''
  let lastIssue = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let prompt = `${baseInstructions}\n只返回合法 JSON，不要 Markdown 代码块，不要额外解释。`
    if (lastIssue && attempt > 0) {
      prompt += `\n上一次输出不符合要求：${lastIssue}。请严格按要求重新输出。`
    }
    const text = await chat({ instructions: prompt, input, maxOutputTokens, signal })
    const parsed = parseJson(text)
    if (!parsed.ok) {
      lastIssue = '输出不是合法 JSON'
      continue
    }
    const result = validateAgainstSchema(schema, parsed.value)
    if (result.ok) {
      return result.value
    }
    lastIssue = result.errors.join('；')
  }

  throw new AppError(
    ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID,
    undefined,
    { status: 502, retryable: true, requestId, detail: lastIssue }
  )
}

// SSE 流式调用：返回一个 async 迭代器，逐块 yield { type: 'delta', content }。
// 调用方负责在消费时捕获异常并 emit run.failed。
async function * chatStream({ instructions, input, maxOutputTokens = MAX_OUTPUT_TOKENS, signal }) {
  const requestId = genRequestId()
  if (!hasApiKey()) {
    throw new AppError(ERROR_CODES.AI_AUTH_FAILED, '未配置 DEEPSEEK_API_KEY，无法调用模型', { status: 500, requestId })
  }
  const { signal: merged, clear } = withSignal(signal)
  try {
    const client = getClient()
    const stream = await client.responses.create(
      {
        model: getConfig().model,
        instructions,
        input: normalizeInput(input),
        max_output_tokens: maxOutputTokens,
        stream: true
      },
      { signal: merged }
    )
    for await (const event of stream) {
      if (event && event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        yield { type: 'delta', content: event.delta }
      }
    }
  } catch (error) {
    throw classifyAiError(error, requestId)
  } finally {
    clear()
  }
}

// 把模型返回的 function_call item 规范化为可再次作为 input 提交的形式。
// 兼容 id / call_id 两种字段命名，保证 call_id 配对一致。
function toFunctionCallItem(item) {
  return {
    type: 'function_call',
    call_id: item.call_id || item.id,
    name: item.name,
    arguments: item.arguments || '{}'
  }
}

// 序列化工具执行结果，作为 function_call_output 的 output 字段。
function serializeToolResult(toolResult) {
  if (toolResult && toolResult.error !== undefined) {
    return JSON.stringify({ error: toolResult.error })
  }
  if (toolResult && toolResult.result !== undefined) {
    return JSON.stringify(toolResult.result)
  }
  return JSON.stringify(toolResult === undefined ? {} : toolResult)
}

// Tool Calling：让模型自主决定是否调用工具，最多 maxToolIterations 轮。
// tools 形如 [{ type: 'function', name, description, parameters }]。
// onToolCall(name, args, meta) 必须返回 { result }（JSON 可序列化）或 { error }。
// meta 提供 { callId }，便于调用方按 call_id 关联同一工具调用的事件 / 日志。
//
// DeepSeek Responses API 是无状态接口，不使用 previous_response_id 保存上下文。
// 本函数在客户端维护完整 input history：
//   初始为原始用户消息 → 调用 → 把 assistant message 与 function_call 加入 history
//   → 执行全部 function_call → 把全部 function_call_output 加入 history → 再调用。
async function chatWithTools({
  instructions,
  input,
  tools,
  signal,
  maxToolIterations = 6,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
  onToolCall
}) {
  const requestId = genRequestId()
  if (!hasApiKey()) {
    throw new AppError(ERROR_CODES.AI_AUTH_FAILED, '未配置 DEEPSEEK_API_KEY，无法调用模型', { status: 500, requestId })
  }
  const { signal: merged, clear } = withSignal(signal)
  const client = getClient()
  const toolLogs = []

  // 客户端维护的完整输入历史：初始至少包含原始用户消息
  const normalized = normalizeInput(input)
  const history = typeof normalized === 'string'
    ? [{ role: 'user', content: normalized }]
    : (Array.isArray(normalized) ? normalized : [])

  try {
    for (let i = 0; i < maxToolIterations; i++) {
      const response = await client.responses.create(
        {
          model: getConfig().model,
          instructions,
          input: history,
          tools,
          max_output_tokens: maxOutputTokens,
          stream: false
        },
        { signal: merged }
      )

      const output = Array.isArray(response.output) ? response.output : []
      const functionCalls = output.filter(item => item.type === 'function_call')

      // 没有工具调用 → 视为最终文本
      if (functionCalls.length === 0) {
        const text = extractResponseText(response)
        if (!text) {
          warnEmptyResponse(response, 'chatWithTools-final')
        }
        return { text, toolLogs }
      }

      // 把需要保留的 assistant message 与 function_call 一并加入 history
      for (const item of output) {
        if (item.type === 'message') {
          history.push(item)
        } else if (item.type === 'function_call') {
          history.push(toFunctionCallItem(item))
        }
      }

      // 执行全部 function_call（支持一次响应返回多个）
      const outputs = []
      for (const functionCall of functionCalls) {
        const callId = functionCall.call_id || functionCall.id || genRequestId()
        let args = {}
        try {
          args = functionCall.arguments ? JSON.parse(functionCall.arguments) : {}
        } catch (e) {
          args = {}
        }

        const start = Date.now()
        let toolResult
        try {
          toolResult = await onToolCall(functionCall.name, args, { callId })
        } catch (e) {
          toolResult = { error: e && e.message ? e.message : '工具执行失败' }
        }
        const compact = toolResult && toolResult.compactResult !== undefined
          ? {
              compactResult: toolResult.compactResult,
              rawTokenEstimate: toolResult.rawTokenEstimate,
              compactTokenEstimate: toolResult.compactTokenEstimate
            }
          : compressToolResult({
            toolName: functionCall.name,
            result: toolResult && toolResult.result,
            error: toolResult && toolResult.error,
            maxTokens: 6000
          })
        const compactOutput = toolResult && toolResult.error
          ? { error: toolResult.error }
          : { result: compact.compactResult }
        toolLogs.push({
          id: callId,
          toolName: functionCall.name,
          arguments: args,
          rawResultRef: toolResult && toolResult.rawResultRef,
          compactResult: compact.compactResult,
          rawTokenEstimate: compact.rawTokenEstimate,
          compactTokenEstimate: compact.compactTokenEstimate,
          durationMs: Date.now() - start
        })

        outputs.push({
          type: 'function_call_output',
          call_id: callId,
          output: serializeToolResult(compactOutput)
        })
      }

      // 全部工具执行完成后，把全部 function_call_output 一次性加入 history
      history.push(...outputs)
    }

    // 达到最大轮数仍未得到最终文本：返回明确错误，绝不以空字符串冒充成功
    throw new AppError(
      ERROR_CODES.TOOL_ITERATION_LIMIT,
      undefined,
      { status: 502, retryable: true, requestId }
    )
  } catch (error) {
    throw classifyAiError(error, requestId)
  } finally {
    clear()
  }
}

// 测试注入：替换底层 OpenAI client，便于在不消耗真实额度的前提下模拟模型行为。
function _setClientForTest(client) {
  _client = client
}

module.exports = {
  getConfig,
  hasApiKey,
  chat,
  chatJson,
  chatStream,
  chatWithTools,
  parseJson,
  extractResponseText,
  _setClientForTest
}
