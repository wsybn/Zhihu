// server/agent/agentExecutor.js
// Agent 统一执行层：把「创建 run / 执行模型调用 / 写步骤 / 写消息 / 重试」集中在一处，
// 非流式路由（chat / outline / article-patch / review）复用同一套状态机。
//
// 关键点：
//   - run 上持久化 requestSnapshot（操作类型 + 原始请求快照），重试只依赖服务端快照，
//     不信任前端重新提交的请求体，避免前端篡改；
//   - 取消（cancelled）是终态，重试 / 执行前强制校验，绝不回跳；
//   - 每次执行真实调用 DeepSeek，绝不只改状态不执行；
//   - 执行异常统一在 execute 内 failStep，非流式路由不再各自维护 failStep，避免遗漏。

const deepseek = require('../ai/deepseekClient')
const agentRepo = require('../repositories/agentRepository')
const toolCallRepo = require('../repositories/toolCallRepository')
const { AppError, ERROR_CODES, isAbortError } = require('../ai/error')
const { AgentOrchestrator } = require('./agentOrchestrator')
const tools = require('./tools')
const knowledgeService = require('../knowledge/knowledgeService')
const { ContextBuilder } = require('./context/contextBuilder')
const { HistorySummarizer } = require('./context/historySummarizer')
const { compressToolResult } = require('./context/toolResultCompressor')
const tokenCounter = require('./context/tokenCounter')

const outlineSchema = require('../ai/schemas/outlineSchema')
const patchSchema = require('../ai/schemas/patchSchema')
const reviewSchema = require('../ai/schemas/reviewSchema')

const OPERATION_TYPES = {
  chat: 'chat',
  outline: 'outline',
  'article-patch': 'article-patch',
  review: 'review'
}

const CHAT_INSTRUCTIONS = '你是中文知乎文章创作助手。请直接、具体地回答用户问题，结合标题和正文上下文，不要虚构已执行的操作。'

class AgentExecutor {
  constructor(orchestrator, deps = {}) {
    this.orchestrator = orchestrator || new AgentOrchestrator()
    this.deepseek = deps.deepseekClient || deepseek
    this.toolRegistry = deps.toolRegistry || tools.createRegistry()
    this.getDb = deps.getDb || (() => null)
    this.knowledgeService = deps.knowledgeService || knowledgeService
    this.historySummarizer = deps.historySummarizer || new HistorySummarizer({
      agentRepo,
      deepseekClient: this.deepseek,
      policy: deps.contextPolicy
    })
    this.contextBuilder = deps.contextBuilder || new ContextBuilder({
      agentRepo,
      historySummarizer: this.historySummarizer,
      policy: deps.contextPolicy
    })
    this.resumeLocks = new Set()
  }

  _safeContinuation(input = []) {
    return (Array.isArray(input) ? input : []).slice(-40).map(message => ({
      role: String(message && message.role || 'user').slice(0, 20),
      content: String(message && message.content || '').slice(-2500)
    }))
  }

  // 只保留请求快照中的白名单字段，避免把无关 / 敏感字段持久化到磁盘
  _snapshot(operation, request = {}) {
    const pick = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v)
    const base = {
      operation,
      request: {
        message: pick(request.message, 8000),
        title: pick(request.title, 200),
        content: pick(request.content, 50000),
        selection: pick(request.selection, 20000),
        action: pick(request.action, 50),
        target: pick(request.target, 20),
        articleId: pick(request.articleId, 64),
        clientMessageId: pick(request.clientMessageId, 160),
        userMessageId: pick(request.userMessageId, 100),
        useTools: Boolean(request.useTools)
      }
    }
    return base
  }

  // 创建 run 并保存请求快照
  createRun({ sessionId, userId, operation, request }) {
    const clientMessageId = request && request.clientMessageId
    if (operation === 'chat' && clientMessageId) {
      const existingMessage = agentRepo.findMessageByClientId(sessionId, userId, clientMessageId)
      if (existingMessage && existingMessage.runId) {
        const existingRun = this.orchestrator.getRun(existingMessage.runId)
        if (existingRun && existingRun.sessionId === sessionId && String(existingRun.userId) === String(userId)) return existingRun
      }
    }
    const type = OPERATION_TYPES[operation] || operation
    const run = this.orchestrator.createRun({ sessionId, type, userId })
    const snapshot = this._snapshot(operation, request)
    if (operation === 'chat' && request && request.message) {
      const id = clientMessageId || agentRepo.newId('client')
      const userMessage = agentRepo.createMessage({
        sessionId,
        userId,
        role: 'user',
        type: 'text',
        content: request.message,
        clientMessageId: id,
        runId: run.id,
        tokenEstimate: tokenCounter.estimateTextTokens(request.message)
      })
      snapshot.request.clientMessageId = userMessage.clientMessageId || id
      snapshot.request.userMessageId = userMessage.id
      agentRepo.updateRunCheckpoint(run.id, { phase: 'user_message_saved', userMessageId: userMessage.id })
      agentRepo.touchSession(sessionId)
    }
    agentRepo.updateRun(run.id, { requestSnapshot: snapshot })
    return this.orchestrator.getRun(run.id)
  }

  _ensureUserMessage(run, request) {
    if (!run || run.type !== 'chat' || !request || !request.message) return null
    const checkpointId = run.checkpoint && run.checkpoint.userMessageId
    const snapshotId = run.requestSnapshot && run.requestSnapshot.request && run.requestSnapshot.request.userMessageId
    const known = agentRepo.getMessage(checkpointId || snapshotId)
    if (known && known.sessionId === run.sessionId && String(known.userId) === String(run.userId)) return known

    const clientMessageId = request.clientMessageId || (run.requestSnapshot && run.requestSnapshot.request && run.requestSnapshot.request.clientMessageId) || agentRepo.newId('client')
    const message = agentRepo.createMessage({
      sessionId: run.sessionId,
      userId: run.userId,
      role: 'user',
      type: 'text',
      content: request.message,
      clientMessageId,
      runId: run.id,
      tokenEstimate: tokenCounter.estimateTextTokens(request.message)
    })
    const snapshot = run.requestSnapshot || { operation: 'chat', request: {} }
    snapshot.request = { ...(snapshot.request || {}), clientMessageId: message.clientMessageId || clientMessageId, userMessageId: message.id }
    agentRepo.updateRun(run.id, { requestSnapshot: snapshot })
    agentRepo.updateRunCheckpoint(run.id, { phase: 'user_message_saved', userMessageId: message.id })
    agentRepo.touchSession(run.sessionId)
    return message
  }

  // 读取并校验 run 的请求快照，供重试使用
  getSnapshot(run) {
    if (!run.requestSnapshot || !run.requestSnapshot.operation) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '该运行缺少请求快照，无法重试', { status: 409 })
    }
    return run.requestSnapshot
  }

  // 执行一次操作：真实调用模型 + 写步骤 + 写消息。
  // runId 存在时为重试（复用原 run 与 snapshot），否则新建 run。
  // 所有执行期异常在此统一 failStep（取消类异常除外），路由层无需各自维护。
  async execute({ sessionId, userId, operation, request, signal, runId }) {
    let run
    if (runId) {
      run = this.orchestrator.getRun(runId)
      if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
      if (sessionId && String(run.sessionId) !== String(sessionId)) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
      if (userId && String(run.userId) !== String(userId)) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
      if (run.status === 'completed') {
        const message = agentRepo.findMessageByRunId(run.id, { role: 'assistant' })
        if (message) return { run: this.orchestrator.getRun(run.id), message, contextUsage: run.checkpoint?.contextUsage || {} }
      }
      if (run.checkpoint && run.checkpoint.phase === 'final_response_pending') {
        const message = agentRepo.findMessageByRunId(run.id, { role: 'assistant' })
        if (message) {
          this.orchestrator.completeRun(run.id)
          agentRepo.updateRunCheckpoint(run.id, { phase: 'completed', assistantMessageId: message.id })
          return { run: this.orchestrator.getRun(run.id), message, contextUsage: run.checkpoint.contextUsage || {} }
        }
      }
      const snap = this.getSnapshot(run)
      operation = snap.operation
      request = operation === 'chat'
        ? { ...(snap.request || {}), toolResults: run.checkpoint?.compactToolResults || [] }
        : snap.request
    } else {
      run = this.createRun({ sessionId, userId, operation, request })
    }

    if (operation === 'chat') this._ensureUserMessage(run, request)

    const stepKey = this._stepKeyFor(operation)
    let handler
    switch (operation) {
      case 'chat':
        handler = () => this._runChat(run, request, signal)
        break
      case 'outline':
        handler = () => this._runOutline(run, request, signal)
        break
      case 'article-patch':
        handler = () => this._runArticlePatch(run, request, signal)
        break
      case 'review':
        handler = () => this._runReview(run, request, signal)
        break
      default:
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `未知操作类型：${operation}`, { status: 400 })
    }

    try {
      return await handler()
    } catch (error) {
      this._handleExecutionError(run.id, stepKey, error)
      throw error
    }
  }

  // 执行期异常处理：取消类异常绝不覆盖为 failed；其余异常将 Step 与 Run 标记为 failed。
  // failStep 自身失败时忽略，保留最初业务异常（由 execute 原样 rethrow）。
  _handleExecutionError(runId, stepKey, error) {
    if (isAbortError(error)) return
    const run = this.orchestrator.getRun(runId)
    if (run && run.status === 'cancelled') return
    try {
      this.orchestrator.failStep(runId, stepKey, error)
    } catch (e) {
      // 忽略 failStep 自身异常，不覆盖原始业务异常
    }
  }

  // 重试：按服务端快照真实重新执行，重试计数 +1。
  // 只有 failed 的 run 可以重试；通过 beginRetry 做原子状态占用，防止并发重复执行。
  async retry(runId, { signal } = {}) {
    const run = this.orchestrator.beginRetry(runId)
    try {
      const snap = this.getSnapshot(run)
      const stepKey = this._stepKeyFor(snap.operation)
      // 复位目标步骤（pending + retryCount++），再真实执行
      this.orchestrator.retryStep(runId, stepKey)
      if (['context_built', 'tools_pending', 'tool_results_ready', 'final_response_pending'].includes(run.checkpoint && run.checkpoint.phase)) {
        return await this._resumeFromCheckpoint(this.orchestrator.getRun(runId), { signal })
      }
      return await this.execute({
        sessionId: run.sessionId,
        userId: run.userId,
        runId,
        operation: snap.operation,
        request: snap.request,
        signal
      })
    } finally {
      this.orchestrator.endRetry(runId)
    }
  }

  // Resume is deliberately distinct from retry: it consumes the latest safe
  // checkpoint and only falls back to the persisted request snapshot when the
  // checkpoint cannot safely continue.
  async resume(runId, { signal } = {}) {
    const run = this.orchestrator.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    if (run.status === 'completed') return this.execute({ runId, sessionId: run.sessionId, userId: run.userId, signal })
    if (run.status === 'waiting_for_user') throw new AppError(ERROR_CODES.VALIDATION_FAILED, '该运行正在等待用户确认', { status: 409 })
    if (run.status !== 'failed') throw new AppError(ERROR_CODES.VALIDATION_FAILED, '只有失败的运行可以恢复', { status: 409 })
    if (this.resumeLocks.has(runId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, '该运行正在恢复中，请勿重复提交', { status: 409 })
    this.resumeLocks.add(runId)
    try {
      const snapshot = this.getSnapshot(run)
      this.orchestrator.retryStep(runId, this._stepKeyFor(snapshot.operation))
      return await this._resumeFromCheckpoint(this.orchestrator.getRun(runId), { signal })
    } finally {
      this.resumeLocks.delete(runId)
    }
  }

  async _resumeFromCheckpoint(run, { signal } = {}) {
    const snapshot = this.getSnapshot(run)
    const request = { ...(snapshot.request || {}) }
    const checkpoint = run.checkpoint || {}
    const phase = checkpoint.phase || 'user_message_saved'

    if (phase === 'final_response_pending') {
      const existing = agentRepo.findMessageByRunId(run.id, { role: 'assistant' })
      if (existing) return this.finalizeChatRun(run, existing.content, { contextUsage: checkpoint.contextUsage || {} })
      if (checkpoint.partialAssistantOutput) return this.finalizeChatRun(run, checkpoint.partialAssistantOutput, { contextUsage: checkpoint.contextUsage || {} })
    }

    if (snapshot.operation !== 'chat') {
      // Structured operations currently have no serializable provider-level
      // continuation. Rebuild only from the server snapshot, never a client
      // retry body, and keep the original user message/run.
      return this.execute({ runId: run.id, sessionId: run.sessionId, userId: run.userId, operation: snapshot.operation, request, signal })
    }

    if (phase === 'tools_pending') {
      const pending = Array.isArray(checkpoint.pendingToolCalls) ? checkpoint.pendingToolCalls : []
      const toolContext = this._buildToolContext(run, request)
      const results = []
      for (const pendingCall of pending) {
        const callId = String(pendingCall.id || '')
        const idempotencyKey = `${run.id}:${callId}`
        const existing = toolCallRepo.findSuccessfulByIdempotencyKey(idempotencyKey, { runId: run.id, userId: run.userId })
        if (existing) {
          results.push({ callId, toolName: pendingCall.toolName, result: existing.result })
          continue
        }
        const tool = this.toolRegistry.byName.get(pendingCall.toolName)
        if (!tool || tool.replaySafe === false || !pendingCall.arguments) {
          results.push({ callId, toolName: pendingCall.toolName, error: '工具缺少安全恢复数据，等待用户决定是否重放' })
          continue
        }
        let args
        try {
          args = JSON.parse(String(pendingCall.arguments))
        } catch (e) {
          results.push({ callId, toolName: pendingCall.toolName, error: '工具参数无法安全恢复' })
          continue
        }
        const executed = await tools.executeTool(this.toolRegistry, pendingCall.toolName, args, {
          ...toolContext,
          signal,
          callCounts: new Map(),
          idempotencyKey
        })
        const compact = compressToolResult({
          toolName: pendingCall.toolName,
          result: executed.result,
          error: executed.error,
          maxTokens: this.contextBuilder.policy.maxToolResultTokens
        })
        results.push({ callId, toolName: pendingCall.toolName, result: compact.compactResult, error: executed.error })
      }
      agentRepo.updateRunCheckpoint(run.id, { phase: 'tool_results_ready', pendingToolCalls: [], compactToolResults: results.slice(-20) })
      return this._resumeFromCheckpoint(this.orchestrator.getRun(run.id), { signal })
    }

    const continuation = checkpoint.modelContinuation && Array.isArray(checkpoint.modelContinuation.input)
      ? checkpoint.modelContinuation.input
      : null
    // tool_results_ready already contains the durable tool conclusions. Do
    // not offer tools again in this branch, otherwise a provider could replay
    // a successful call while continuing the answer.
    const useTools = Boolean(request.useTools) && phase !== 'tool_results_ready'
    const result = await this.performChat({
      request: {
        ...request,
        runId: run.id,
        sessionId: run.sessionId,
        userId: run.userId,
        userMessageId: checkpoint.userMessageId,
        toolResults: checkpoint.compactToolResults || []
      },
      prebuiltContext: continuation && phase === 'context_built'
        ? { instructions: CHAT_INSTRUCTIONS, input: continuation, usage: checkpoint.contextUsage || {}, selectedBlocks: [], droppedBlocks: [], summaryUpdated: false }
        : null,
      signal,
      useTools,
      toolRegistry: this.toolRegistry,
      toolContext: useTools ? this._buildToolContext(run, request) : null,
      runId: run.id
    })
    return this.finalizeChatRun(run, result.text, { contextUsage: result.contextUsage || checkpoint.contextUsage || {} })
  }

  _stepKeyFor(operation) {
    switch (operation) {
      case 'chat': return 'goal_analysis'
      case 'outline': return 'outline_generation'
      case 'article-patch': return 'section_writing'
      case 'review': return 'article_review'
      default: return 'goal_analysis'
    }
  }

  // 从服务端保存的 run 快照重建工具执行上下文（用户数据权限 / 当前文章 / 知识库）。
  // 只使用服务端 run.userId 与 requestSnapshot，不信任重试请求体。
  _buildToolContext(run, request) {
    const db = this.getDb()
    let authorId = String(run.userId || '')
    if (db) {
      try {
        const user = db.get('users').find({ id: String(run.userId) }).value()
        if (user && user.columnId) authorId = String(user.columnId)
      } catch (e) {
        // 无法解析用户时回退到 userId
      }
    }
    return {
      db,
      userId: String(run.userId || ''),
      authorId,
      sessionId: run.sessionId,
      runId: run.id,
      currentArticle: {
        title: request.title || '',
        content: request.content || '',
        selection: request.selection || ''
      },
      knowledgeService: this.knowledgeService
    }
  }

  // 共享的「目标分析」模型交互：普通流式 / 普通非流式 / 工具模式。
  // 首次请求（SSE 路由）与重试（_runChat）复用同一函数，工具模式复用白名单 /
  // 调用次数限制 / 用户数据权限 / AbortSignal / 工具日志。
  //   - onText(chunk)：流式增量回调（工具模式在结束后回调一次完整文本）
  //   - onToolCall(ev)：工具调用回调，ev.phase ∈ { called, done }
  async performChat({ request, signal, useTools, onText, onToolCall, onContextBuilt, toolRegistry, toolContext, prebuiltContext }) {
    const runId = (toolContext && toolContext.runId) || request.runId
    const sessionId = (toolContext && toolContext.sessionId) || request.sessionId
    const userId = (toolContext && toolContext.userId) || request.userId
    const built = prebuiltContext || await this.contextBuilder.build({
      sessionId,
      userId,
      request: { ...request, instructions: CHAT_INSTRUCTIONS },
      ragChunks: request.ragChunks || [],
      toolResults: request.toolResults || [],
      signal
    })
    if (runId) {
      agentRepo.updateRunCheckpoint(runId, {
        phase: 'context_built',
        contextUsage: built.usage,
        selectedBlockIds: built.selectedBlocks.map(block => block.id),
        modelContinuation: {
          input: this._safeContinuation(built.input),
          functionCalls: []
        }
      })
    }
    if (onContextBuilt) onContextBuilt(built)
    const instructions = built.instructions
    const input = built.input
    const registry = toolRegistry || this.toolRegistry
    const callCounts = new Map()
    let fullText = ''
    let lastPartialCheckpointLength = 0
    const reportText = chunk => {
      if (!chunk) return
      if (runId && fullText.length - lastPartialCheckpointLength >= 256) {
        lastPartialCheckpointLength = fullText.length
        agentRepo.updateRunCheckpoint(runId, {
          phase: 'model_responded',
          partialAssistantOutput: fullText.slice(-4000)
        })
      }
      if (onText) onText(chunk)
    }

    if (useTools) {
      const result = await this.deepseek.chatWithTools({
        instructions,
        input,
        tools: tools.toOpenAITools(registry),
        signal,
        onToolCall: async (toolName, args, meta) => {
          const callId = (meta && meta.callId) || `${toolName}-${Date.now().toString(36)}`
          if (onToolCall) onToolCall({ phase: 'called', callId, toolName, arguments: args })
          if (runId) agentRepo.updateRunCheckpoint(runId, {
            phase: 'tools_pending',
            pendingToolCalls: [{
              id: callId,
              toolName,
              arguments: JSON.stringify(args || {}).slice(0, 4000)
            }],
            modelContinuation: { input: this._safeContinuation(input), functionCalls: [{ id: callId, name: toolName }] }
          })
          const exec = await tools.executeTool(registry, toolName, args, {
            ...toolContext,
            signal,
            callCounts,
            idempotencyKey: runId ? `${runId}:${callId}` : undefined
          })
          const compact = compressToolResult({
            toolName,
            result: exec.result,
            error: exec.error,
            maxTokens: this.contextBuilder.policy.maxToolResultTokens
          })
          const safeExec = { ...exec, compactResult: compact.compactResult, rawTokenEstimate: compact.rawTokenEstimate, compactTokenEstimate: compact.compactTokenEstimate }
          if (runId) {
            const currentRun = agentRepo.getRun(runId)
            const checkpoint = currentRun && currentRun.checkpoint ? currentRun.checkpoint : {}
            agentRepo.updateRunCheckpoint(runId, {
              phase: 'tool_results_ready',
              pendingToolCalls: [],
              completedToolCallIds: Array.from(new Set([...(checkpoint.completedToolCallIds || []), callId])),
              compactToolResults: [...(checkpoint.compactToolResults || []), { callId, toolName, result: compact.compactResult }].slice(-20)
            })
          }
          const status = exec.cancelled ? 'cancelled' : (exec.error ? 'failed' : 'success')
          if (onToolCall) {
            onToolCall({
              phase: 'done',
              callId,
              toolName,
              arguments: args,
              status,
              result: compact.compactResult || null,
              error: exec.error || null
            })
          }
          return safeExec
        }
      })
      fullText = result.text
      if (result.toolLogs && result.toolLogs.length && !fullText) {
        fullText = '已根据检索到的资料完成分析。'
      }
      reportText(fullText)
    } else if (onText) {
      for await (const chunk of this.deepseek.chatStream({ instructions, input, signal })) {
        if (chunk.type === 'delta') {
          fullText += chunk.content
          reportText(chunk.content)
        }
      }
    } else {
      fullText = await this.deepseek.chat({ instructions, input, signal })
    }

    return { text: fullText, contextUsage: built.usage, selectedBlocks: built.selectedBlocks, droppedBlocks: built.droppedBlocks, summaryUpdated: built.summaryUpdated }
  }

  async finalizeChatRun(run, text, { contextUsage = {} } = {}) {
    const current = this.orchestrator.getRun(run.id)
    if (current && current.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const existing = agentRepo.findMessageByRunId(run.id, { role: 'assistant' })
    const message = existing || agentRepo.createMessage({
      sessionId: run.sessionId,
      role: 'assistant',
      type: 'text',
      content: text,
      userId: run.userId,
      runId: run.id,
      tokenEstimate: tokenCounter.estimateTextTokens(text)
    })
    agentRepo.updateRunCheckpoint(run.id, {
      phase: 'final_response_pending',
      assistantMessageId: message.id,
      contextUsage
    })
    agentRepo.touchSession(run.sessionId)
    this.orchestrator.completeRun(run.id)
    agentRepo.updateRunCheckpoint(run.id, { phase: 'completed', assistantMessageId: message.id, contextUsage })
    return { run: this.orchestrator.getRun(run.id), message, contextUsage }
  }

  async _runChat(run, request, signal) {
    const useTools = Boolean(request.useTools)
    const userMessage = this._ensureUserMessage(run, request)
    this.orchestrator.startStep(run.id, 'goal_analysis', { userMessageId: userMessage && userMessage.id })
    const toolContext = useTools ? this._buildToolContext(run, request) : null
    const result = await this.performChat({
      request: { ...request, userMessageId: userMessage && userMessage.id, runId: run.id, sessionId: run.sessionId, userId: run.userId },
      signal,
      useTools,
      toolRegistry: this.toolRegistry,
      toolContext,
      runId: run.id
    })
    agentRepo.updateRunCheckpoint(run.id, { phase: 'model_responded', contextUsage: result.contextUsage || {} })
    this.orchestrator.completeStep(run.id, 'goal_analysis', {
      contextUsage: result.contextUsage || {},
      answerTokenEstimate: tokenCounter.estimateTextTokens(result.text)
    })
    return this.finalizeChatRun(run, result.text, { contextUsage: result.contextUsage || {} })
  }

  async _runOutline(run, request, signal) {
    this.orchestrator.startStep(run.id, 'outline_generation', { title: request.title })
    const outline = await this.deepseek.chatJson({
      instructions: '你是中文文章策划助手。输出 ArticleOutline：titleCandidates(string[])、audience、goal、estimatedLength(number)、sections(array)，每个 section 含 id/title/keyPoints(string[])/status(pending)。',
      input: `标题：${request.title || '暂无'}\n正文：${request.content || '暂无'}`,
      schema: outlineSchema,
      signal
    })
    this.orchestrator.completeStep(run.id, 'outline_generation', outline)
    this.orchestrator.waitingForUser(run.id, 'outline_confirmation')
    const message = agentRepo.createMessage({
      sessionId: run.sessionId,
      role: 'assistant',
      type: 'outline',
      content: '已生成文章大纲，请查看并确认。',
      payload: outline,
      userId: run.userId,
      runId: run.id
    })
    return { run: this.orchestrator.getRun(run.id), message }
  }

  async _runArticlePatch(run, request, signal) {
    this.orchestrator.startStep(run.id, 'section_writing', { action: request.action })
    const patches = await this.deepseek.chatJson({
      instructions: '你是中文文章编辑。根据 action 与 target 生成 ArticlePatch 数组（可返回对象或数组）。每项含 target、operation(replace|append|insert)、originalText、proposedText、reason、status(pending)。只提出可执行修改，不要覆盖全文。',
      input: `action：${request.action}\ntarget：${request.target || 'content'}\n标题：${request.title}\n正文：${request.content}\n选中内容：${request.selection}`,
      schema: patchSchema.patchList,
      signal
    })
    const patchList = Array.isArray(patches) ? patches : [patches]
    patchList.forEach(p => {
      agentRepo.createPatch({ ...p, articleId: request.articleId || '', sessionId: run.sessionId, userId: run.userId })
    })
    this.orchestrator.completeStep(run.id, 'section_writing', { patches: patchList })
    this.orchestrator.completeRun(run.id)
    const message = agentRepo.createMessage({
      sessionId: run.sessionId,
      role: 'assistant',
      type: 'article_patch',
      content: '已生成文章修改建议，请在卡片中查看并决定是否接受。',
      payload: patchList,
      userId: run.userId,
      runId: run.id
    })
    return { run: this.orchestrator.getRun(run.id), message }
  }

  async _runReview(run, request, signal) {
    this.orchestrator.startStep(run.id, 'article_review', { title: request.title })
    const review = await this.deepseek.chatJson({
      instructions: '你是中文文章审查助手。输出 ReviewReport：score(0-100)、summary、issues(array)。每个 issue 含 severity(error|warning|info)、category、message、suggestion，可选 originalText、replacement、startIndex、endIndex。覆盖错别字、语病、Markdown 格式、标题层级、结构完整性、逻辑冲突、技术结论、引用来源、重复、代码块、API 示例、概念一致性。',
      input: `请审查以下文章：\n标题：${request.title || ''}\n正文：${request.content || ''}`,
      schema: reviewSchema.review,
      signal
    })
    const report = { ...review, id: 'review-' + Date.now().toString(36), createdAt: new Date().toISOString() }
    this.orchestrator.completeStep(run.id, 'article_review', report)
    this.orchestrator.completeRun(run.id)
    const message = agentRepo.createMessage({
      sessionId: run.sessionId,
      role: 'assistant',
      type: 'review',
      content: '审查完成，请查看报告。',
      payload: report,
      userId: run.userId,
      runId: run.id
    })
    return { run: this.orchestrator.getRun(run.id), message }
  }
}

module.exports = { AgentExecutor }
