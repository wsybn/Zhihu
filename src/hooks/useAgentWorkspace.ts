// Agent 工作台状态管理（composable）。
// 选择 composable 而非 Vuex module 的原因：
//  1. 现有 store.ts 是承载登录/专栏/文章的单文件全局状态，不宜继续膨胀；
//  2. Agent 工作台状态（消息、大纲、审查、补丁）是「页面级、与当前创作会话绑定」的临时状态；
//  3. composable 天然支持 onUnmounted 清理定时器与请求，未来确需跨页共享时再平迁 Vuex module。

import { computed, ref, onMounted, onUnmounted, reactive, getCurrentInstance } from 'vue'
import { useAgentStream, simulateDeltaFallback } from './useAgentStream'
import store from '../store'
import {
  createAgentSession,
  sendAgentChat,
  generateOutline,
  generateArticlePatch,
  reviewArticle,
  searchKnowledge,
  fetchAgentSession,
  fetchAgentSessionMessages,
  fetchAgentSessionRuns,
  fetchAgentRunSteps,
  retryAgentRun,
  confirmAgentOutline
} from '../services/agentService'
import type { AgentContext, ToolCallEvent } from '../services/agentService'
import { searchArticles as searchArticleRecords } from '../services/articleService'
import type {
  AgentMessage,
  AgentRun,
  AgentSession,
  ArticleOutline,
  ArticlePatch,
  QuickAction,
  QuickActionKey,
  ReviewIssue,
  ReviewReport,
  ToolCallRecord,
  WorkflowStep,
  WorkflowStepKey,
  WorkflowStepStatus
} from '../types/agent'

export interface AgentWorkspaceOptions {
  getContext?: () => AgentContext
  onPatchAccepted?: (patch: ArticlePatch) => boolean | void
  onOutlineInsert?: (markdown: string) => void
  onReviewApply?: (issue: ReviewIssue) => boolean | void
  onTitleApply?: (title: string) => void
  onReviewLocate?: (issue: ReviewIssue) => void
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  { key: 'goal_analysis', label: '创作目标', status: 'pending' },
  { key: 'internal_research', label: '资料检索', status: 'pending' },
  { key: 'outline_generation', label: '生成大纲', status: 'pending' },
  { key: 'outline_confirmation', label: '确认大纲', status: 'pending' },
  { key: 'section_writing', label: '章节写作', status: 'pending' },
  { key: 'article_review', label: '全文审查', status: 'pending' },
  { key: 'publish_preparation', label: '发布准备', status: 'pending' }
]

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'outline', label: '生成大纲', prompt: '请为当前文章生成结构化大纲' },
  { key: 'research', label: '查询资料', prompt: '查询与当前文章相关的站内文章' },
  { key: 'knowledge_search', label: '知识库检索', prompt: '检索个人知识库中的相关内容' },
  { key: 'continue', label: '续写文章', prompt: '请根据当前内容续写文章' },
  { key: 'polish', label: '润色全文', prompt: '请润色全文，使表达更流畅' },
  { key: 'polish_selection', label: '润色选中', prompt: '请润色选中的内容', needsSelection: true },
  { key: 'title', label: '优化标题', prompt: '请优化文章标题' },
  { key: 'summary', label: '生成摘要', prompt: '请为文章生成一段摘要' },
  { key: 'review', label: '审查全文', prompt: '请审查全文' },
  { key: 'professional', label: '更专业', prompt: '请将表达改得更专业' },
  { key: 'casual', label: '更口语', prompt: '请将表达改得更口语' },
  { key: 'zhihu', label: '知乎风格', prompt: '请改成适合知乎的表达风格' }
]

type ReviewIssueState = 'pending' | 'accepted' | 'ignored'

type LastTask =
  | { kind: 'chat'; prompt: string }
  | { kind: 'outline'; prompt: string }
  | { kind: 'review'; prompt: string }
  | { kind: 'search'; prompt: string; query: string }
  | { kind: 'knowledge_search'; prompt: string; query: string }
  | { kind: 'patch'; prompt: string; action: string; target: ArticlePatch['target'] }

function uid(prefix = 'm'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

type PersistedMessage = AgentMessage & {
  runId?: string
  clientMessageId?: string
}

// 会话缓存按用户隔离：每个账号一份 `agent_session_id:<userId>`，
// 切换账号 / 登出后不会误恢复上一账号的会话。
const agentSessionStorageKey = (userId: string): string => `agent_session_id:${userId}`

const currentUserId = (): string => String(store.state.user.id || '')

export function useAgentWorkspace(options: AgentWorkspaceOptions = {}) {
  const stream = useAgentStream()

  const session = ref<AgentSession | null>(null)
  const messages = ref<AgentMessage[]>([])
  const workflowSteps = ref<WorkflowStep[]>(
    WORKFLOW_STEPS.map(s => ({ ...s }))
  )
  const isAwaiting = ref(false)
  const streamingMessage = ref<AgentMessage | null>(null)
  const lastUserMessage = ref<AgentMessage | null>(null)
  const outlineAccepted = ref(false)
  const selectedOutlineTitle = ref('')
  const reviewIssueStates = ref<Record<string, ReviewIssueState>>({})
  const lastPatchAction = ref<{ action: string; target: ArticlePatch['target'] } | null>(null)
  const lastTask = ref<LastTask | null>(null)
  // run/step 映射与工具调用日志（供时间线 / 工具状态组件消费）
  const activeRunId = ref('')
  const activeRun = ref<AgentRun | null>(null)
  const runSteps = ref<AgentRun['steps']>([])
  const currentStepKey = ref<WorkflowStepKey | null>(null)
  const toolCalls = ref<ToolCallRecord[]>([])
  // Agent 模式：开启后 sendMessage 走 Tool Calling，允许模型自主检索站内文章 / 知识库
  const agentMode = ref(false)

  let abortController: AbortController | null = null
  let fallbackCancel: (() => void) | null = null
  let stopped = false

  const sessionId = computed(() => session.value?.id || '')
  const isStreaming = computed(() => stream.isStreaming.value)
  const isGenerating = computed(() => isAwaiting.value || stream.isStreaming.value)

  const currentOutline = computed<ArticleOutline | null>(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.type === 'outline' && m.payload) return m.payload as ArticleOutline
    }
    return null
  })

  const currentReview = computed<ReviewReport | null>(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.type === 'review' && m.payload) return m.payload as ReviewReport
    }
    return null
  })

  const currentPatches = computed<ArticlePatch[]>(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.type === 'article_patch' && Array.isArray(m.payload)) {
        return m.payload as ArticlePatch[]
      }
    }
    return []
  })

  const setStep = (key: WorkflowStepKey, status: WorkflowStepStatus) => {
    const step = workflowSteps.value.find(s => s.key === key)
    if (step) step.status = status
  }

  const pushMessage = (msg: AgentMessage) => {
    messages.value.push(msg)
    return msg
  }

  const mergeMessage = (incoming: AgentMessage, placeholder?: AgentMessage | null): AgentMessage => {
    const candidate = incoming as PersistedMessage
    const placeholderMeta = placeholder as PersistedMessage | null | undefined
    const index = messages.value.findIndex(message => {
      const existing = message as PersistedMessage
      return existing.id === candidate.id ||
        (candidate.runId && existing.runId === candidate.runId) ||
        (candidate.clientMessageId && existing.clientMessageId === candidate.clientMessageId) ||
        (placeholder && existing.id === placeholder.id) ||
        (placeholderMeta?.runId && existing.runId === placeholderMeta.runId)
    })
    if (index < 0) {
      messages.value.push(incoming)
      return incoming
    }
    messages.value[index] = { ...messages.value[index], ...incoming }
    return messages.value[index]
  }

  const mergeRestoredMessages = (items: AgentMessage[]): AgentMessage[] => {
    const byKey = new Map<string, AgentMessage>()
    items.forEach(item => {
      const meta = item as PersistedMessage
      const key = meta.id || `${meta.runId || ''}:${meta.clientMessageId || ''}:${item.createdAt}`
      const previous = byKey.get(key)
      byKey.set(key, previous ? { ...previous, ...item } : item)
    })
    return Array.from(byKey.values()).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))
  }

  const ensureSession = async (): Promise<string> => {
    if (session.value) return session.value.id
    const s = await createAgentSession({
      title: 'AI 创作会话'
    })
    session.value = s
    const uid = currentUserId()
    if (uid) {
      try {
        localStorage.setItem(agentSessionStorageKey(uid), s.id)
      } catch {
        // 隐私模式 / 存储被禁用时静默忽略
      }
    }
    return s.id
  }

  // 是否属于「会话不存在 / 无权访问」类错误（用于清除本地会话缓存）
  const isSessionAccessError = (e: unknown): boolean => {
    const err = e as { apiError?: { code?: number } }
    const code = err?.apiError?.code
    return code === 401 || code === 404
  }

  const clearAgentSessionCache = (): void => {
    const uid = currentUserId()
    if (!uid) return
    try {
      localStorage.removeItem(agentSessionStorageKey(uid))
    } catch {
      // 静默忽略
    }
  }

  // 用 run 的步骤状态映射工作台步骤（恢复时把 completed / failed / waiting_for_user / cancelled 还原）
  const mapWorkflowStepsFromRun = (run: AgentRun): void => {
    const steps = run.steps || []
    workflowSteps.value = WORKFLOW_STEPS.map(base => {
      const s = steps.find(x => x.stepKey === base.key)
      return { ...base, status: s ? (s.status as WorkflowStepStatus) : 'pending' }
    })
  }

  // 恢复上次会话：刷新页面或组件重挂后，重新拉取会话 / 消息 / 运行与步骤，还原工作台状态。
  // 会话不存在或无权访问（401/404）时清除本地缓存，避免反复请求他人会话。
  const restoreSession = async (sessionId: string): Promise<void> => {
    if (!sessionId || isGenerating.value) return
    if (!currentUserId()) return // 未登录不恢复任何会话
    try {
      // 1. 拉取会话并校验归属
      const fetched = await fetchAgentSession(sessionId)
      session.value = fetched

      // 2. 拉取历史消息（outline / review / patch 卡片由此自动还原）
      // Descending + includeUsers explicitly asks the server for the newest
      // page while preserving the old endpoint's compatibility projection.
      // The UI always renders chronological order after the fetch.
      const result = await fetchAgentSessionMessages(sessionId, 1, 100, { includeUsers: true, order: 'desc' })
      messages.value = mergeRestoredMessages(result.items)

      // 3. 拉取 run 列表，恢复最近一个 run 的步骤与状态
      const runs = await fetchAgentSessionRuns(sessionId)
      if (runs.length > 0) {
        const latest = runs[runs.length - 1]
        activeRunId.value = latest.id
        activeRun.value = latest
        currentStepKey.value = latest.currentStep || null
        // 显式拉取最新 run 的步骤（完整还原 waiting_for_user / failed / cancelled 等状态）
        const steps = await fetchAgentRunSteps(latest.id)
        runSteps.value = steps.map(s => ({ ...s }))
        mapWorkflowStepsFromRun({ ...latest, steps })
      }
    } catch (e) {
      if (isSessionAccessError(e)) {
        clearAgentSessionCache()
      }
      // 网络异常等其他错误：静默忽略，不阻塞用户新建会话
    }
  }

  const beginRequest = () => {
    stopped = false
    isAwaiting.value = true
    abortController = new AbortController()
  }

  const endRequest = () => {
    isAwaiting.value = false
    abortController = null
  }

  const isAbortedError = (e: unknown): boolean => {
    if (stopped) return true
    const err = e as { code?: string; name?: string; apiError?: { code: number } }
    return err?.code === 'ERR_CANCELED' || err?.name === 'AbortError'
  }

  // 把底层错误转成用户可读提示（兼容新错误对象与网络中断）
  const friendlyError = (e: unknown): string => {
    const err = e as { apiError?: { error?: string; retryable?: boolean }; name?: string; message?: string }
    if (err?.apiError?.error) return err.apiError.error
    if (err?.name === 'TypeError' || /fetch|network|Failed to fetch|连接|中断/i.test(err?.message || '')) {
      return '连接中断，请检查网络后重试。'
    }
    return 'AI 请求失败'
  }

  const pushError = (text: string) => {
    pushMessage({
      id: uid('m'),
      sessionId: sessionId.value,
      role: 'assistant',
      type: 'error',
      content: text,
      createdAt: new Date().toISOString()
    })
  }

  const runTask = async (opts: {
    prompt: string
    task: () => Promise<{ run: AgentRun | null | unknown; message: AgentMessage }>
    stepKey: WorkflowStepKey
    onSuccess?: (result: AgentMessage) => void
    streamChat?: (placeholder: AgentMessage) => Promise<void>
  }): Promise<void> => {
    if (isGenerating.value) return
    let placeholder: AgentMessage | null = null
    beginRequest()
    try {
      // 先创建会话，再创建本地消息，保证所有消息都带有有效 sessionId。
      await ensureSession()

      const userMsg = pushMessage({
        id: uid('m'),
        sessionId: sessionId.value,
        role: 'user',
        type: 'text',
        content: opts.prompt,
        createdAt: new Date().toISOString()
      })
      lastUserMessage.value = userMsg

      placeholder = pushMessage({
        id: uid('m'),
        sessionId: sessionId.value,
        role: 'assistant',
        type: 'text',
        content: '',
        createdAt: new Date().toISOString()
      })

      setStep(opts.stepKey, 'running')
      if (opts.streamChat) {
        await opts.streamChat(placeholder)
        setStep(opts.stepKey, 'completed')
        opts.onSuccess?.(placeholder)
        return
      }
      const result = await opts.task()
      if (result.run && typeof result.run === 'object' && 'id' in result.run) {
        activeRunId.value = String((result.run as AgentRun).id)
        activeRun.value = result.run as AgentRun
        runSteps.value = ((result.run as AgentRun).steps || []).map(s => ({ ...s }))
        currentStepKey.value = (result.run as AgentRun).currentStep || null
        mapWorkflowStepsFromRun(result.run as AgentRun)
      }
      // Replace the local placeholder with the persisted assistant message so
      // a response followed by restore cannot render the same answer twice.
      const persistedMessage = result.message.type === 'text'
        ? { ...result.message, content: '' }
        : { ...result.message }
      mergeMessage(persistedMessage, placeholder)
      placeholder = messages.value.find(message => message.id === result.message.id) || result.message

      if (result.message.type === 'text' && result.message.content) {
        // 【fallback】非流式接口返回完整文本时，用渲染兜底分段展示；
        // 不生成新内容，仅改善观感。
        const streamingPlaceholder = placeholder
        streamingMessage.value = streamingPlaceholder
        fallbackCancel = simulateDeltaFallback(
          result.message.content,
          chunk => {
            streamingPlaceholder.content += chunk
          },
          () => {
            streamingMessage.value = null
            fallbackCancel = null
          }
        )
      } else {
        placeholder.content = result.message.content
      }
      opts.onSuccess?.(result.message)
    } catch (e) {
      if (isAbortedError(e)) {
        // 用户主动停止：保留已显示内容
        if (placeholder) {
          messages.value = messages.value.filter(m => m.id !== placeholder?.id || placeholder.content)
        }
      } else {
        setStep(opts.stepKey, 'failed')
        if (placeholder) {
          messages.value = messages.value.filter(m => m.id !== placeholder?.id)
        }
        streamingMessage.value = null
        pushError(friendlyError(e))
      }
    } finally {
      endRequest()
    }
  }

  const sendMessage = (text: string, opts: { useTools?: boolean } = {}): void => {
    // 工具调用策略：显式指定 > Agent 模式；research/knowledge 类查询在 Agent 模式下强制开工具
    const useTools = opts.useTools ?? agentMode.value
    lastTask.value = { kind: 'chat', prompt: text }
    runTask({
      prompt: text,
      stepKey: 'goal_analysis',
      task: () =>
        sendAgentChat(
          {
            sessionId: sessionId.value,
            message: text,
            context: options.getContext?.(),
            useTools
          },
          { signal: abortController?.signal }
        ).then(res => ({ run: res.run, message: res.message })),
      streamChat: placeholder => {
        streamingMessage.value = placeholder
        return stream.start(
          {
            sessionId: sessionId.value,
            message: text,
            context: options.getContext?.(),
            useTools
          },
          {
            onDelta: chunk => { placeholder.content += chunk },
            onRunStarted: (id, run) => {
              (placeholder as PersistedMessage).runId = id
              activeRunId.value = id
              activeRun.value = run
              runSteps.value = (run.steps || []).map(s => ({ ...s }))
              toolCalls.value = []
            },
            onStepStarted: (stepKey, stepId) => {
              currentStepKey.value = stepKey as WorkflowStepKey
              const step = runSteps.value.find(s => s.stepKey === stepKey)
              if (step) {
                step.status = 'running'
                step.id = stepId || step.id
                step.startedAt = new Date().toISOString()
              }
            },
            onStepCompleted: stepKey => {
              const step = runSteps.value.find(s => s.stepKey === stepKey)
              if (step) {
                step.status = 'completed'
                step.completedAt = new Date().toISOString()
              }
            },
            onToolCalled: (event: ToolCallEvent) => {
              trackToolCall(event)
            },
            onRunCompleted: (content, persisted, completedRun) => {
              if (persisted) mergeMessage(persisted, placeholder)
              else if (placeholder && content) placeholder.content = content
              if (completedRun) {
                activeRun.value = completedRun
                runSteps.value = (completedRun.steps || []).map(s => ({ ...s }))
                currentStepKey.value = completedRun.currentStep || null
                mapWorkflowStepsFromRun(completedRun)
              }
              streamingMessage.value = null
            }
          }
        )
      },
      onSuccess: () => setStep('goal_analysis', 'completed')
    })
  }

  // 工具调用状态跟踪：running 时新建记录，终态（success/failed/cancelled）按 toolCallId 回填
  const trackToolCall = (event: ToolCallEvent): void => {
    const id = event.toolCallId || uid('tc')
    const existing = toolCalls.value.find(t => t.id === id)
    if (existing) {
      existing.status = event.status
      existing.result = event.result
      existing.error = event.error ?? null
      return
    }
    toolCalls.value.push({
      id,
      toolName: event.toolName,
      arguments: event.arguments,
      result: event.result,
      error: event.error ?? null,
      status: event.status,
      createdAt: new Date().toISOString()
    })
  }

  const runOutline = (prompt: string): void => {
    outlineAccepted.value = false
    lastTask.value = { kind: 'outline', prompt }
    runTask({
      prompt,
      stepKey: 'outline_generation',
      task: () =>
        generateOutline(
          { sessionId: sessionId.value, context: options.getContext?.() },
          { signal: abortController?.signal }
        ).then(res => ({ run: res.run, message: res.message })),
      onSuccess: () => {
        setStep('outline_generation', 'completed')
        setStep('outline_confirmation', 'waiting_for_user')
      }
    })
  }

  const runReview = (prompt: string): void => {
    reviewIssueStates.value = {}
    lastTask.value = { kind: 'review', prompt }
    runTask({
      prompt,
      stepKey: 'article_review',
      task: () =>
        reviewArticle(
          { sessionId: sessionId.value, context: options.getContext?.() },
          { signal: abortController?.signal }
        ).then(res => ({ run: res.run, message: res.message })),
      onSuccess: () => setStep('article_review', 'completed')
    })
  }

  const runArticleSearch = (query: string, prompt = `查找文章：${query}`): void => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      pushError('请输入要查询的文章关键词')
      return
    }
    lastTask.value = { kind: 'search', prompt, query: normalizedQuery }
    runTask({
      prompt,
      stepKey: 'internal_research',
      task: async () => {
        const result = await searchArticleRecords(
          { q: normalizedQuery, page: 1, pageSize: 5 },
          { signal: abortController?.signal }
        )
        return {
          run: null,
          message: {
            id: uid('m'),
            sessionId: sessionId.value,
            role: 'tool' as const,
            type: 'article_search' as const,
            content: result.total > 0
              ? `找到 ${result.total} 篇与「${normalizedQuery}」相关的文章。`
              : `没有找到与「${normalizedQuery}」相关的文章。`,
            payload: result,
            createdAt: new Date().toISOString()
          }
        }
      },
      onSuccess: () => setStep('internal_research', 'completed')
    })
  }

  const runKnowledgeSearch = (query: string, prompt = `检索知识库：${query}`): void => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      pushError('请输入要检索的关键词')
      return
    }
    lastTask.value = { kind: 'knowledge_search', prompt, query: normalizedQuery }
    runTask({
      prompt,
      stepKey: 'internal_research',
      task: async () => {
        const result = await searchKnowledge(normalizedQuery, 10, {
          signal: abortController?.signal
        })
        return {
          run: null,
          message: {
            id: uid('m'),
            sessionId: sessionId.value,
            role: 'tool' as const,
            type: 'knowledge_search' as const,
            content: result.total > 0
              ? `知识库中找到 ${result.total} 条与「${normalizedQuery}」相关的内容。`
              : `知识库中没有与「${normalizedQuery}」相关的内容。`,
            payload: result,
            createdAt: new Date().toISOString()
          }
        }
      },
      onSuccess: () => setStep('internal_research', 'completed')
    })
  }

  const runPatch = (action: string, target: ArticlePatch['target']): void => {
    const context = options.getContext?.()
    if (target === 'selection' && !context?.selection) {
      pushError('请先在编辑区选中需要润色的内容，再使用「润色选中」')
      return
    }
    lastPatchAction.value = { action, target }
    lastTask.value = {
      kind: 'patch',
      prompt: QUICK_ACTIONS.find(a => a.key === action)?.prompt || action,
      action,
      target
    }
    runTask({
      prompt: QUICK_ACTIONS.find(a => a.key === action)?.prompt || action,
      stepKey: 'section_writing',
      task: () =>
        generateArticlePatch(
          { sessionId: sessionId.value, action, target, context },
          { signal: abortController?.signal }
        ).then(res => ({ run: res.run, message: res.message })),
      onSuccess: () => setStep('section_writing', 'completed')
    })
  }

  const runQuickAction = (key: QuickActionKey): void => {
    const action = QUICK_ACTIONS.find(a => a.key === key)
    if (!action) return
    switch (key) {
      case 'outline':
        runOutline(action.prompt)
        break
      case 'research': {
        // Agent 模式下检索/问答类查询走 Tool Calling，让模型自主决定调用检索工具
        if (agentMode.value) {
          sendMessage(action.prompt, { useTools: true })
          break
        }
        const context = options.getContext?.()
        const query = context?.title || context?.selection || context?.content?.slice(0, 40) || ''
        runArticleSearch(query, action.prompt)
        break
      }
      case 'knowledge_search': {
        if (agentMode.value) {
          sendMessage(action.prompt, { useTools: true })
          break
        }
        const context = options.getContext?.()
        const query = context?.title || context?.selection || context?.content?.slice(0, 40) || ''
        runKnowledgeSearch(query, action.prompt)
        break
      }
      case 'review':
        runReview(action.prompt)
        break
      case 'summary':
        sendMessage(action.prompt)
        break
      case 'title':
        runPatch(key, 'title')
        break
      case 'polish_selection':
        runPatch(key, 'selection')
        break
      default:
        runPatch(key, 'content')
    }
  }

  const setAgentMode = (value: boolean): void => {
    agentMode.value = value
  }

  const stopGeneration = (): void => {
    stopped = true
    if (fallbackCancel) {
      fallbackCancel()
      fallbackCancel = null
      streamingMessage.value = null
    }
    if (stream.isStreaming.value) {
      stream.stop()
      if (streamingMessage.value) {
        streamingMessage.value.content += '\n\n_（已停止生成）_'
        streamingMessage.value = null
      }
    }
    if (abortController) {
      abortController.abort()
    }
  }

  const retry = (): void => {
    const task = lastTask.value
    if (!task) return
    switch (task.kind) {
      case 'chat':
        sendMessage(task.prompt)
        break
      case 'outline':
        runOutline(task.prompt)
        break
      case 'review':
        runReview(task.prompt)
        break
      case 'search':
        runArticleSearch(task.query, task.prompt)
        break
      case 'knowledge_search':
        runKnowledgeSearch(task.query, task.prompt)
        break
      case 'patch':
        runPatch(task.action, task.target)
        break
    }
  }

  // 重试当前活动 run：走服务端 requestSnapshot（不重新提交前端请求体）。
  // 已取消的 run 不可重试。
  const retryActiveRun = async (): Promise<void> => {
    const runId = activeRunId.value
    const run = activeRun.value
    if (!runId || !run || run.status === 'cancelled') return
    if (isGenerating.value) return
    beginRequest()
    try {
      const result = await retryAgentRun(runId, { signal: abortController?.signal })
      activeRun.value = result.run
      runSteps.value = (result.run.steps || []).map(s => ({ ...s }))
      currentStepKey.value = result.run.currentStep || null
      mapWorkflowStepsFromRun(result.run)
      if (result.message) pushMessage(result.message)
    } catch (e) {
      if (!isAbortedError(e)) {
        pushError(friendlyError(e))
      }
    } finally {
      endRequest()
    }
  }

  const selectOutlineTitle = (title: string): void => {
    selectedOutlineTitle.value = title
    options.onTitleApply?.(title)
  }

  const locateReviewIssue = (issue: ReviewIssue): void => {
    options.onReviewLocate?.(issue)
  }

  const acceptOutline = (): void => {
    outlineAccepted.value = true
    setStep('outline_confirmation', 'completed')
    setStep('section_writing', 'pending')
    if (activeRunId.value) {
      confirmAgentOutline(activeRunId.value).then(run => {
        activeRun.value = run
        runSteps.value = (run.steps || []).map(s => ({ ...s }))
        currentStepKey.value = run.currentStep || null
        mapWorkflowStepsFromRun(run)
      }).catch(error => {
        outlineAccepted.value = false
        setStep('outline_confirmation', 'failed')
        pushError(friendlyError(error))
      })
    }
  }

  const rejectOutline = (): void => {
    outlineAccepted.value = false
    setStep('outline_confirmation', 'pending')
  }

  const regenerateOutline = (): void => {
    runOutline('请重新生成文章大纲')
  }

  const insertOutline = (): void => {
    const outline = currentOutline.value
    if (!outline) return
    const lines: string[] = []
    if (outline.goal) lines.push(`> 创作目标：${outline.goal}`)
    if (outline.audience) lines.push(`> 目标读者：${outline.audience}`)
    lines.push('')
    outline.sections.forEach((section, idx) => {
      lines.push(`## ${idx + 1}. ${section.title}`)
      section.keyPoints.forEach(point => {
        lines.push(`- ${point}`)
      })
      lines.push('')
    })
    options.onOutlineInsert?.(lines.join('\n'))
  }

  const patchMessageByPatch = (patchId: string) => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.type !== 'article_patch' || !Array.isArray(m.payload)) continue
      const patch = (m.payload as ArticlePatch[]).find(p => p.id === patchId)
      if (patch) return { message: m, patch }
    }
    return null
  }

  const acceptPatch = (patchId: string): void => {
    const found = patchMessageByPatch(patchId)
    if (!found) return
    const applied = options.onPatchAccepted?.(found.patch)
    if (applied !== false) {
      found.patch.status = 'accepted'
    }
  }

  const rejectPatch = (patchId: string): void => {
    const found = patchMessageByPatch(patchId)
    if (!found) return
    found.patch.status = 'rejected'
  }

  const regeneratePatch = (patchId: string): void => {
    const found = patchMessageByPatch(patchId)
    if (!found) return
    found.patch.status = 'rejected'
    if (lastPatchAction.value) {
      runPatch(lastPatchAction.value.action, lastPatchAction.value.target)
    }
  }

  const findIssue = (issueId: string): ReviewIssue | null => {
    const review = currentReview.value
    if (!review) return null
    return review.issues.find(i => i.id === issueId) || null
  }

  const acceptReviewIssue = (issueId: string): void => {
    const issue = findIssue(issueId)
    if (!issue) return
    if (issue.replacement) {
      const applied = options.onReviewApply?.(issue)
      if (applied === false) return
    }
    reviewIssueStates.value[issueId] = 'accepted'
  }

  const ignoreReviewIssue = (issueId: string): void => {
    if (!findIssue(issueId)) return
    reviewIssueStates.value[issueId] = 'ignored'
  }

  const acceptAllSafeIssues = (): void => {
    const review = currentReview.value
    if (!review) return
    review.issues
      .filter(i => i.replacement && i.severity !== 'error')
      .forEach(issue => {
        if (reviewIssueStates.value[issue.id] === 'accepted') return
        const applied = options.onReviewApply?.(issue)
        if (applied !== false) {
          reviewIssueStates.value[issue.id] = 'accepted'
        }
      })
  }

  const markPublishPreparation = (status: WorkflowStepStatus): void => {
    setStep('publish_preparation', status)
  }

  // A composable is normally created inside setup(). The guard also makes
  // direct service-level usage safe (and avoids lifecycle warnings in tests)
  // without masking Vue warnings globally.
  if (getCurrentInstance()) {
    onUnmounted(() => {
      stopped = true
      if (fallbackCancel) fallbackCancel()
      stream.stop()
      if (abortController) abortController.abort()
    })

    onMounted(() => {
      const uid = currentUserId()
      if (!uid) return // 未登录不恢复会话
      let saved = ''
      try {
        saved = localStorage.getItem(agentSessionStorageKey(uid)) || ''
      } catch {
        // 隐私模式 / 存储被禁用时静默忽略
      }
      if (saved) restoreSession(saved)
    })
  }

  return reactive({
    session,
    sessionId,
    messages,
    workflowSteps,
    quickActions: QUICK_ACTIONS,
    isAwaiting,
    isStreaming,
    isGenerating,
    currentOutline,
    currentReview,
    currentPatches,
    outlineAccepted,
    selectedOutlineTitle,
    reviewIssueStates,
    activeRunId,
    activeRun,
    runSteps,
    currentStepKey,
    toolCalls,
    agentMode,
    setAgentMode,
    streamError: stream.error,
    currentStepId: stream.currentStepId,
    sendMessage,
    restoreSession,
    searchArticles: runArticleSearch,
    searchKnowledge: runKnowledgeSearch,
    runQuickAction,
    stopGeneration,
    retry,
    retryActiveRun,
    clearAgentSessionCache,
    selectOutlineTitle,
    acceptOutline,
    rejectOutline,
    regenerateOutline,
    insertOutline,
    locateReviewIssue,
    acceptPatch,
    rejectPatch,
    regeneratePatch,
    acceptReviewIssue,
    ignoreReviewIssue,
    acceptAllSafeIssues,
    markPublishPreparation
  })
}

export type AgentWorkspace = ReturnType<typeof useAgentWorkspace>
