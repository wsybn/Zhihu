// Agent service 层：集中封装所有 AI 相关请求。
// 组件不得直接调用 axios 访问 AI 接口，只能通过本 service。
// 已接入真实 Agent 后端：结构化输出校验、SSE 标准事件、Tool Calling、RAG。

import http, { API_BASE_URL, ApiResponse } from './http'
import type {
  AgentMessage,
  AgentRun,
  AgentRunStep,
  AgentSession,
  ArticleAskResult,
  ArticleOutline,
  ArticlePatch,
  AgentSseEvent,
  KnowledgeSearchItem,
  ReviewReport,
  SeriesClassificationResult,
  TopicSuggestionsResult,
  ToolCallStatus
} from '../types/agent'

export interface AgentContext {
  title?: string
  content?: string
  selection?: string
}

export interface AgentRequestOptions {
  signal?: AbortSignal
}

export interface CreateSessionRequest {
  title?: string
}

export interface ChatRequest {
  sessionId?: string
  message: string
  context?: AgentContext
  useTools?: boolean
}

export interface OutlineRequest {
  sessionId?: string
  context?: AgentContext
}

export interface ArticlePatchRequest {
  sessionId?: string
  action: string
  target: ArticlePatch['target']
  context?: AgentContext
}

export interface ReviewRequest {
  sessionId?: string
  context?: AgentContext
}

// 统一的后端返回：一次 Agent 操作同时产出 run 记录与 assistant 消息
export interface AgentRunResult {
  run: AgentRun
  message: AgentMessage
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  order?: 'asc' | 'desc'
  nextCursor?: { createdAt: string; id: string }
}

export interface AgentMessagePageOptions extends AgentRequestOptions {
  includeUsers?: boolean
  before?: string
  cursor?: string
  order?: 'asc' | 'desc'
}

// ---------- SSE 流式回调 ----------
// 一次工具调用会触发两次 tool.called：先 running，再终态（success/failed/cancelled）。
// 通过 toolCallId 关联同一工具调用，用于前端展示「运行中 → 成功/失败/取消」状态。
export interface ToolCallEvent {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: unknown
  error?: string | null
}

export interface StreamCallbacks {
  onEvent?: (event: AgentSseEvent) => void
  onRunStarted?: (runId: string, run: AgentRun) => void
  onStepStarted?: (runId: string, stepId: string, stepKey: string) => void
  onDelta?: (chunk: string) => void
  onToolCalled?: (event: ToolCallEvent) => void
  onStepCompleted?: (runId: string, stepId: string, stepKey: string) => void
  onRunCompleted?: (runId: string, content: string, message?: AgentMessage, run?: AgentRun) => void
  onRunFailed?: (runId: string, error: unknown) => void
  onRunCancelled?: (runId: string) => void
}

// ---------- 会话 / 消息 ----------
export async function createAgentSession(
  payload: CreateSessionRequest = {},
  options: AgentRequestOptions = {}
): Promise<AgentSession> {
  const { data } = await http.post<ApiResponse<AgentSession>>(
    '/api/agent/sessions',
    payload,
    { signal: options.signal }
  )
  return data.data
}

export async function fetchAgentSession(
  sessionId: string,
  options: AgentRequestOptions = {}
): Promise<AgentSession> {
  const { data } = await http.get<ApiResponse<AgentSession>>(
    `/api/agent/sessions/${sessionId}`,
    { signal: options.signal }
  )
  return data.data
}

export async function fetchAgentSessionMessages(
  sessionId: string,
  page = 1,
  pageSize = 50,
  options: AgentMessagePageOptions = {}
): Promise<PaginatedResult<AgentMessage>> {
  const { data } = await http.get<ApiResponse<PaginatedResult<AgentMessage>>>(
    `/api/agent/sessions/${sessionId}/messages`,
    {
      params: {
        page,
        pageSize,
        includeUsers: options.includeUsers === true ? 'true' : undefined,
        before: options.before,
        cursor: options.cursor,
        order: options.order
      },
      signal: options.signal
    }
  )
  return data.data
}

export async function fetchAgentSessionRuns(
  sessionId: string,
  options: AgentRequestOptions = {}
): Promise<AgentRun[]> {
  const { data } = await http.get<ApiResponse<AgentRun[]>>(
    `/api/agent/sessions/${sessionId}/runs`,
    { signal: options.signal }
  )
  return data.data
}

// ---------- 非流式对话 ----------
export async function sendAgentChat(
  payload: ChatRequest,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    '/api/agent/chat',
    payload,
    { signal: options.signal }
  )
  return data.data
}

// ---------- SSE 流式对话（标准事件） ----------
// 服务端按 SSE 规范输出 `event: <name>` + `data: <json>` 帧。
// 这里负责读取流、按帧切分、解析，并分发到对应回调。
export async function streamAgentChat(
  payload: ChatRequest,
  callbacks: StreamCallbacks = {},
  options: AgentRequestOptions = {}
): Promise<void> {
  const token = localStorage.getItem('token')
  const response = await fetch(`${API_BASE_URL}/api/agent/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload),
    signal: options.signal
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `AI 流式请求失败（HTTP ${response.status}）`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        const parsed = parseSseFrame(frame)
        if (!parsed) continue
        dispatchEvent(parsed.event, parsed.name, callbacks)
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}

interface SseFrame {
  event: AgentSseEvent
  name: string
}

// 单个 SSE 帧 -> { event, name }；无法解析时返回 null。
// 帧格式：event: <name>\ndata: <json>（可能还含 id: / retry: 等注释行）
export function parseSseFrame(frame: string): SseFrame | null {
  let eventName = 'message'
  let dataLine: string | null = null
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLine = line.slice(5).trim()
    }
  }
  if (dataLine === null) return null
  try {
    const payload = JSON.parse(dataLine) as {
      runId: string
      stepId?: string | null
      timestamp?: string
      data?: Record<string, unknown>
    }
    return {
      name: eventName,
      event: {
        runId: payload.runId || '',
        stepId: payload.stepId ?? null,
        timestamp: payload.timestamp || '',
        data: payload.data || {}
      }
    }
  } catch {
    return null
  }
}

function dispatchEvent(event: AgentSseEvent, name: string, callbacks: StreamCallbacks) {
  callbacks.onEvent?.(event)
  const d = event.data || {}
  const runId = event.runId
  switch (name) {
    case 'run.started':
      callbacks.onRunStarted?.(runId, d.run as AgentRun)
      break
    case 'step.started':
      callbacks.onStepStarted?.(runId, event.stepId || '', (d.stepKey as string) || '')
      break
    case 'message.delta':
      callbacks.onDelta?.((d.content as string) || '')
      break
    case 'tool.called':
      callbacks.onToolCalled?.({
        toolCallId: (d.toolCallId as string) || '',
        toolName: (d.toolName as string) || '',
        arguments: (d.arguments as Record<string, unknown>) || {},
        status: (d.status as ToolCallStatus) || 'running',
        result: d.result,
        error: (d.error as string | null) ?? null
      })
      break
    case 'step.completed':
      callbacks.onStepCompleted?.(runId, event.stepId || '', (d.stepKey as string) || '')
      break
    case 'run.completed':
      callbacks.onRunCompleted?.(runId, (d.content as string) || '', d.message as AgentMessage | undefined, d.run as AgentRun | undefined)
      break
    case 'run.failed':
      callbacks.onRunFailed?.(runId, d.error)
      break
    case 'run.cancelled':
      callbacks.onRunCancelled?.(runId)
      break
  }
}

// ---------- 结构化产出 ----------
export async function generateOutline(
  payload: OutlineRequest,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    '/api/agent/outline',
    payload,
    { signal: options.signal }
  )
  return data.data
}

export async function generateArticlePatch(
  payload: ArticlePatchRequest,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    '/api/agent/article-patch',
    payload,
    { signal: options.signal }
  )
  return data.data
}

export async function reviewArticle(
  payload: ReviewRequest,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    '/api/agent/review',
    payload,
    { signal: options.signal }
  )
  return data.data
}

// ---------- Run / Step ----------
export async function fetchAgentRun(runId: string): Promise<AgentRun> {
  const { data } = await http.get<ApiResponse<AgentRun>>(
    `/api/agent/runs/${runId}`
  )
  return data.data
}

export async function fetchAgentRunSteps(runId: string): Promise<AgentRunStep[]> {
  const { data } = await http.get<ApiResponse<AgentRunStep[]>>(
    `/api/agent/runs/${runId}/steps`
  )
  return data.data
}

export async function cancelAgentRun(runId: string): Promise<AgentRun> {
  const { data } = await http.post<ApiResponse<AgentRun>>(
    `/api/agent/runs/${runId}/cancel`
  )
  return data.data
}

// 重试一个 run：服务端按保存的 requestSnapshot 真实重新执行，不信任前端重新提交的请求体。
// 返回与普通执行一致的 { run, message }（新产生的 assistant 消息）。
export async function retryAgentRun(
  runId: string,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    `/api/agent/runs/${runId}/retry`,
    {},
    { signal: options.signal }
  )
  return data.data
}

export async function resumeAgentRun(
  runId: string,
  options: AgentRequestOptions = {}
): Promise<AgentRunResult> {
  const { data } = await http.post<ApiResponse<AgentRunResult>>(
    `/api/agent/runs/${runId}/resume`,
    {},
    { signal: options.signal }
  )
  return data.data
}

export async function confirmAgentOutline(runId: string): Promise<AgentRun> {
  const { data } = await http.post<ApiResponse<AgentRun>>(
    `/api/agent/runs/${runId}/confirm-outline`
  )
  return data.data
}

// ---------- 知识库 / 检索 / 问答 ----------
export interface KnowledgeSearchResponse {
  items: KnowledgeSearchItem[]
  total: number
  embeddingProvider?: string
}

export async function searchKnowledge(
  query: string,
  topK = 10,
  options: AgentRequestOptions = {}
): Promise<KnowledgeSearchResponse> {
  const { data } = await http.post<ApiResponse<KnowledgeSearchResponse>>(
    '/api/knowledge/search',
    { query, topK },
    { signal: options.signal }
  )
  return data.data
}

export async function hybridSearchArticles(
  query: string,
  topK = 10,
  options: AgentRequestOptions = {}
): Promise<{ items: KnowledgeSearchItem[]; total: number }> {
  const { data } = await http.get<ApiResponse<{ items: KnowledgeSearchItem[]; total: number }>>(
    '/api/articles/hybrid-search',
    { params: { q: query, topK }, signal: options.signal }
  )
  return data.data
}

export async function askArticle(
  articleId: string,
  question: string,
  options: AgentRequestOptions = {}
): Promise<ArticleAskResult> {
  const { data } = await http.post<ApiResponse<ArticleAskResult>>(
    `/api/articles/${articleId}/ask`,
    { question },
    { signal: options.signal }
  )
  return data.data
}

export async function askKnowledgeChat(
  question: string,
  options: AgentRequestOptions = {}
): Promise<ArticleAskResult> {
  const { data } = await http.post<ApiResponse<ArticleAskResult>>(
    '/api/agent/knowledge-chat',
    { question },
    { signal: options.signal }
  )
  return data.data
}

export async function getTopicSuggestions(
  count = 5,
  options: AgentRequestOptions = {}
): Promise<TopicSuggestionsResult> {
  const { data } = await http.post<ApiResponse<TopicSuggestionsResult>>(
    '/api/agent/topic-suggestions',
    { count },
    { signal: options.signal }
  )
  return data.data
}

export async function getSeriesClassification(
  options: AgentRequestOptions = {}
): Promise<SeriesClassificationResult> {
  const { data } = await http.post<ApiResponse<SeriesClassificationResult>>(
    '/api/agent/series-classification',
    {},
    { signal: options.signal }
  )
  return data.data
}

// ---------- 类型守卫 ----------
// 从 message.payload 中安全提取结构化数据（payload 类型未知，需运行时判断）
export function extractPayload<T>(message: AgentMessage): T | undefined {
  return message.payload as T | undefined
}

export function isOutlinePayload(payload: unknown): payload is ArticleOutline {
  if (!payload || typeof payload !== 'object') return false
  return Array.isArray((payload as ArticleOutline).sections)
}

export function isReviewPayload(payload: unknown): payload is ReviewReport {
  if (!payload || typeof payload !== 'object') return false
  return Array.isArray((payload as ReviewReport).issues)
}

export function isPatchPayload(payload: unknown): payload is ArticlePatch[] {
  return Array.isArray(payload)
}
