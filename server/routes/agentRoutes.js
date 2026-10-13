// server/routes/agentRoutes.js
// 所有 Agent / 知识库 / 检索 / 问答 接口统一在此注册。
// 统一：requestId 贯穿、错误格式、参数长度校验、请求频率限制、SSE 标准事件。

const { AppError, ERROR_CODES, genRequestId, sanitizeForLog, isAbortError } = require('../ai/error')
const { formatSseEvent } = require('../ai/sse')
const agentRepo = require('../repositories/agentRepository')
const knowledgeRepo = require('../repositories/knowledgeRepository')
const knowledgeService = require('../knowledge/knowledgeService')
const knowledgeAgent = require('../agent/knowledgeAgent')
const { AgentOrchestrator } = require('../agent/agentOrchestrator')
const { AgentExecutor } = require('../agent/agentExecutor')
const { WorkflowExecutor } = require('../agent/workflow/workflowExecutor')
const tools = require('../agent/tools')

const LIMITS = {
  message: 8000,
  title: 200,
  content: 50000,
  selection: 20000
}

// ---------- 认证 / 校验 / 错误辅助 ----------
function getToken(req) {
  const header = req.headers.authorization || ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

function getUser(req, db) {
  const token = getToken(req)
  if (!token) return null
  return db.get('users').find({ token }).value() || null
}

function requireUser(req, db) {
  const user = getUser(req, db)
  if (!user) {
    throw new AppError(ERROR_CODES.FORBIDDEN, '未登录', { status: 401 })
  }
  return user
}

// 校验「登录 + sessionId 存在 + 会话归属当前用户」。
//   未登录 → 401；缺少 sessionId → 400；会话不存在或不属于当前用户 → 404（统一）。
function requireAuthenticatedSession(req, sessionId, db) {
  const user = requireUser(req, db)
  if (!sessionId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, '缺少 sessionId', { status: 400 })
  }
  const session = agentRepo.getSession(sessionId)
  if (!session || String(session.userId || '') !== String(user.id)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, '会话不存在', { status: 404 })
  }
  return { user, session }
}

function requireSessionOwner(req, sessionId, db) {
  return requireAuthenticatedSession(req, sessionId, db).session
}

function requireRunOwner(req, runId, db) {
  const user = requireUser(req, db)
  const run = agentRepo.getRun(runId)
  if (!run || String(run.userId || '') !== String(user.id)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
  }
  return run
}

function requireKnowledgeOwner(req, documentId, db) {
  const user = requireUser(req, db)
  const doc = knowledgeService.getDocument(documentId)
  if (!doc) {
    throw new AppError(ERROR_CODES.NOT_FOUND, '文档不存在', { status: 404 })
  }
  if (String(doc.authorId || '') !== String(user.columnId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, '无权操作他人知识库文档', { status: 403 })
  }
  return doc
}

function assertLength(value, max, fieldName) {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (s.length > max) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${fieldName} 长度超过限制（${max}）`, { status: 400 })
  }
  return s
}

function sendOk(res, data, msg = 'ok') {
  return res.jsonp({ code: 0, data, msg })
}

function sendError(res, error, requestId) {
  const appError = error instanceof AppError
    ? error
    : new AppError(ERROR_CODES.AI_REQUEST_FAILED, undefined, { status: 500, requestId })
  // 服务端日志（脱敏），不含 API Key / 原始堆栈
  console.error(`[agent] ${appError.code} requestId=${appError.requestId}`, sanitizeForLog(error && error.message ? error.message : error))
  return res.status(appError.status).jsonp(appError.toResponse())
}

// ---------- 简易内存限流（生产应替换为 Redis） ----------
function createRateLimiter({ clock } = {}) {
  const rateBuckets = new Map()
  const now = clock && clock.now ? () => clock.now() : () => Date.now()
  return {
    check(req, { limit = 30, windowMs = 60 * 1000 } = {}) {
      const key = getToken(req) || req.ip || 'anon'
      const bucket = rateBuckets.get(key) || { count: 0, resetAt: now() + windowMs }
      if (now() > bucket.resetAt) {
        bucket.count = 0
        bucket.resetAt = now() + windowMs
      }
      bucket.count++
      rateBuckets.set(key, bucket)
      if (bucket.count > limit) {
        throw new AppError(ERROR_CODES.AI_RATE_LIMITED, undefined, { status: 429, retryable: true })
      }
    }
  }
}

// 非流式请求的取消上下文：客户端在模型调用中途断开时，中止后续 DeepSeek 调用。
// 通过 markCompleted 区分「正常完成」与「客户端中途断开」，避免误中止已完成请求。
function createRequestAbortContext(req, res) {
  const controller = new AbortController()
  let finished = false
  const onDisconnect = () => {
    if (!finished && !res.writableEnded) {
      controller.abort()
    }
  }
  req.on('aborted', onDisconnect)
  req.on('close', onDisconnect)
  return {
    signal: controller.signal,
    markCompleted: () => { finished = true },
    cleanup: () => {
      req.removeListener('aborted', onDisconnect)
      req.removeListener('close', onDisconnect)
    }
  }
}

// ---------- SSE 事件输出辅助 ----------
function writeEvent(res, eventName, payload) {
  res.write(formatSseEvent(eventName, payload))
}

function registerAgentRoutes(server, options = {}) {
  const { router } = options
  const db = () => router.db

  // 每个 app 实例拥有独立的编排器 / 执行器 / 工具注册表 / 限流器，测试间互不串扰
  const toolRegistry = options.toolRegistry || tools.createRegistry()
  const orchestrator = options.orchestrator || new AgentOrchestrator()
  const executor = options.executor || new AgentExecutor(orchestrator, {
    toolRegistry,
    getDb: db,
    knowledgeService
  })
  const workflowExecutor = options.workflowExecutor || new WorkflowExecutor({
    orchestrator,
    deepseekClient: executor.deepseek
  })
  const rateLimiter = options.rateLimiter || createRateLimiter({ clock: options.clock })
  const checkRateLimit = (req, opts) => rateLimiter.check(req, opts)

  // 服务启动时，把上次重启前仍为 running 的 Run 标记为 failed，避免永远「运行中」
  try {
    const recovered = orchestrator.recoverInterruptedRuns()
    if (recovered > 0) console.log(`[agent] 重启恢复：${recovered} 个 running Run 已标记为 failed`)
  } catch (e) {
    console.error('[agent] 重启恢复失败:', e.message)
  }

  // ================= 会话 =================
  server.post('/api/agent/sessions', (req, res) => {
    try {
      checkRateLimit(req)
      const user = requireUser(req, db())
      const title = assertLength(req.body && req.body.title, LIMITS.title, '标题') || 'AI 创作会话'
      const session = agentRepo.createSession({ title, userId: String(user.id) })
      return sendOk(res, session)
    } catch (e) {
      return sendError(res, e)
    }
  })

  // 会话详情（校验登录与归属）
  server.get('/api/agent/sessions/:id', (req, res) => {
    try {
      const { session } = requireAuthenticatedSession(req, req.params.id, db())
      return sendOk(res, session)
    } catch (e) {
      return sendError(res, e)
    }
  })

  // 消息分页（校验登录与归属）
  server.get('/api/agent/sessions/:id/messages', (req, res) => {
    try {
      const user = requireSessionOwner(req, req.params.id, db())
      const page = Math.max(1, parseInt(req.query.page, 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
      const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
      let before = req.query.before || req.query.cursor || undefined
      if (typeof before === 'string' && before.trim().startsWith('{')) {
        try { before = JSON.parse(before) } catch (e) { before = undefined }
      }
      const ownerId = user.userId || user.id
      let result
      if (order === 'desc' && page === 1) {
        const recent = agentRepo.listRecentMessages(req.params.id, ownerId, { limit: pageSize, before, order })
        const total = agentRepo.listMessagesBySessionAndUser(req.params.id, ownerId, { page: 1, pageSize: 100 }).total
        result = {
          items: recent,
          total,
          page,
          pageSize,
          order,
          ...(recent.length === pageSize && total > pageSize
            ? { nextCursor: { createdAt: recent[recent.length - 1].createdAt, id: recent[recent.length - 1].id } }
            : {})
        }
      } else {
        result = agentRepo.listMessagesBySessionAndUser(req.params.id, ownerId, { page, pageSize, before, order })
      }
      // 保持旧前端默认只展示 assistant 消息；需要完整会话记录的客户端显式传入
      // includeUsers=true。ContextBuilder 不依赖该投影，始终从 Repository 读取完整历史。
      if (String(req.query.includeUsers || '').toLowerCase() !== 'true') {
        result.items = result.items.filter(message => message.role !== 'user')
        result.total = result.items.length
      }
      return sendOk(res, result)
    } catch (e) {
      return sendError(res, e)
    }
  })

  // 会话下的运行列表（校验登录与归属）
  server.get('/api/agent/sessions/:id/runs', (req, res) => {
    try {
      const { user, session } = requireAuthenticatedSession(req, req.params.id, db())
      const runs = agentRepo.listRunsBySessionAndUser(session.id, String(user.id))
      return sendOk(res, runs.map(r => orchestrator.getRun(r.id)))
    } catch (e) {
      return sendError(res, e)
    }
  })

  // ================= 非流式对话 =================
  server.post('/api/agent/chat', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    let run = null
    try {
      checkRateLimit(req)
      const { user, session } = requireAuthenticatedSession(req, req.body.sessionId, db())
      const message = assertLength(req.body && req.body.message, LIMITS.message, '消息')
      if (!message) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, '消息不能为空', { status: 400, requestId })
      }
      const context = req.body.context || {}
      const title = assertLength(context.title, LIMITS.title, '标题')
      const content = assertLength(context.content, LIMITS.content, '正文')
      const selection = assertLength(context.selection, LIMITS.selection, '选区')
      const clientMessageId = assertLength(req.body.clientMessageId, 160, 'clientMessageId')
      run = executor.createRun({
        sessionId: session.id,
        userId: String(user.id),
        operation: 'chat',
        request: {
          message,
          clientMessageId,
          articleId: assertLength(context.articleId, 64, 'articleId'),
          title,
          content,
          selection,
          ragChunks: Array.isArray(context.ragChunks) ? context.ragChunks.slice(0, 50) : []
        }
      })
      const result = await executor.execute({ runId: run.id, signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e) && run) orchestrator.cancel(run.id)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  // ================= 大纲 =================
  server.post('/api/agent/outline', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    let run = null
    try {
      checkRateLimit(req)
      const { user, session } = requireAuthenticatedSession(req, req.body.sessionId, db())
      const context = req.body.context || {}
      run = executor.createRun({
        sessionId: session.id,
        userId: String(user.id),
        operation: 'outline',
        request: { title: context.title, content: context.content }
      })
      const result = await executor.execute({ runId: run.id, signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e) && run) orchestrator.cancel(run.id)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  // ================= 文章修改建议 =================
  server.post('/api/agent/article-patch', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    let run = null
    try {
      checkRateLimit(req)
      const { user, session } = requireAuthenticatedSession(req, req.body.sessionId, db())
      const action = assertLength(req.body.action, 50, 'action')
      const target = assertLength(req.body.target, 20, 'target') || 'content'
      const context = req.body.context || {}
      run = executor.createRun({
        sessionId: session.id,
        userId: String(user.id),
        operation: 'article-patch',
        request: {
          action,
          target,
          title: context.title,
          content: context.content,
          selection: context.selection,
          articleId: context.articleId || ''
        }
      })
      const result = await executor.execute({ runId: run.id, signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e) && run) orchestrator.cancel(run.id)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  // ================= 审查 =================
  server.post('/api/agent/review', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    let run = null
    try {
      checkRateLimit(req)
      const { user, session } = requireAuthenticatedSession(req, req.body.sessionId, db())
      const context = req.body.context || {}
      run = executor.createRun({
        sessionId: session.id,
        userId: String(user.id),
        operation: 'review',
        request: { title: context.title, content: context.content }
      })
      const result = await executor.execute({ runId: run.id, signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e) && run) orchestrator.cancel(run.id)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  // ================= SSE 流式对话（标准事件 + 可选 Tool Calling） =================
  server.post('/api/agent/chat/stream', async (req, res) => {
    const requestId = genRequestId()

    // 认证与参数校验必须在发送 SSE 头之前完成，否则无法向客户端返回 401/400/404
    let user, session, message, context, title, content, selection, sessionId, userId, useTools, clientMessageId
    try {
      checkRateLimit(req)
      ;({ user, session } = requireAuthenticatedSession(req, req.body.sessionId, db()))
      message = assertLength(req.body.message, LIMITS.message, '消息')
      if (!message) throw new AppError(ERROR_CODES.VALIDATION_FAILED, '消息不能为空', { status: 400, requestId })
      context = req.body.context || {}
      title = assertLength(context.title, LIMITS.title, '标题')
      content = assertLength(context.content, LIMITS.content, '正文')
      selection = assertLength(context.selection, LIMITS.selection, '选区')
      clientMessageId = assertLength(req.body.clientMessageId, 160, 'clientMessageId')
      sessionId = session.id
      userId = String(user.id)
      useTools = Boolean(req.body.useTools)
    } catch (e) {
      return sendError(res, e, requestId)
    }

    res.status(200)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()

    const tryWrite = (name, payload) => {
      try {
        if (!res.writableEnded) writeEvent(res, name, payload)
      } catch {
        // 客户端已断开，忽略写入失败
      }
    }

    const sendFail = (e) => {
      const appError = e instanceof AppError ? e : new AppError(ERROR_CODES.AI_REQUEST_FAILED, undefined, { requestId })
      console.error(`[agent/stream] ${appError.code} requestId=${appError.requestId}`, sanitizeForLog(e && e.message))
      tryWrite('run.failed', { runId: currentRunId, data: { error: appError.toResponse().error } })
      if (!res.writableEnded) res.end()
    }

    let currentRunId = ''
    let cancelled = false
    let finished = false
    let cleanupMerged = null
    const connectionAbortController = new AbortController()

    // 统一断开处理：客户端中止时，立即中止模型与工具，并标记 Run/Step/Tool cancelled。
    // 注意：不要监听 req.on('close') —— 该事件在请求体读完后即触发（并非断开信号），
    // 会误把正常完成的请求判为取消。这里用 req 'aborted' + res 'close'，并通过 finished 区分正常结束。
    const handleDisconnect = () => {
      if (finished || cancelled) return
      cancelled = true
      connectionAbortController.abort()
      if (currentRunId) orchestrator.cancel(currentRunId)
    }
    req.on('aborted', handleDisconnect)
    res.on('close', handleDisconnect)

    try {
      // 普通流式与工具流式统一保存为 operation: 'chat'，用 request.useTools 区分是否启用工具。
      // 这样重试可复用 AgentExecutor 的 chat 执行路径，避免「不支持 research」导致重试卡死。
      const run = executor.createRun({
        sessionId,
        userId,
        operation: 'chat',
        request: { message, clientMessageId, title, content, selection, useTools, articleId: context.articleId || '', ragChunks: Array.isArray(context.ragChunks) ? context.ragChunks.slice(0, 50) : [] }
      })
      currentRunId = run.id

      const existingAssistant = agentRepo.findMessageByRunId(run.id, { role: 'assistant' })
      if (run.status === 'completed' && existingAssistant) {
        finished = true
        tryWrite('run.completed', { runId: run.id, data: { content: existingAssistant.content, run: orchestrator.getRun(run.id), contextUsage: run.checkpoint?.contextUsage || {} } })
        if (!res.writableEnded) res.end()
        return
      }

      // 统一取消链：连接断开信号 与 编排器取消信号 合并，模型与工具共享同一信号
      const orchestratorSignal = orchestrator.registerSignal(run.id)
      const merged = tools.mergeAbortSignals([connectionAbortController.signal, orchestratorSignal])
      const signal = merged.signal
      cleanupMerged = merged.cleanup

      const goalStep = run.steps.find(s => s.stepKey === 'goal_analysis')
      orchestrator.startStep(run.id, 'goal_analysis', { message })
      tryWrite('run.started', { runId: run.id, data: { run: orchestrator.getRun(run.id) } })
      tryWrite('step.started', { runId: run.id, stepId: goalStep.id, data: { stepKey: 'goal_analysis', label: '创作目标' } })

      let fullText = ''

      // 复用 AgentExecutor 的共享执行函数：首次请求与重试走同一套模型 + 工具逻辑，
      // 工具模式继续复用白名单 / 调用次数限制 / 用户数据权限 / AbortSignal / 工具日志。
      const toolContext = {
        db: db(),
        userId,
        authorId: String(user.columnId || ''),
        sessionId,
        runId: run.id,
        currentArticle: { title, content, selection },
        knowledgeService
      }
      const chatResult = await executor.performChat({
        request: { message, clientMessageId, userMessageId: run.checkpoint && run.checkpoint.userMessageId, runId: run.id, sessionId, userId, title, content, selection, useTools, articleId: context.articleId || '', ragChunks: Array.isArray(context.ragChunks) ? context.ragChunks.slice(0, 50) : [] },
        signal,
        useTools,
        toolRegistry,
        toolContext,
        runId: run.id,
        onContextBuilt: (built) => {
          tryWrite('context.built', {
            runId: run.id,
            stepId: goalStep.id,
            data: {
              estimatedInputTokens: built.usage.estimatedInputTokens,
              inputBudgetTokens: built.usage.inputBudgetTokens,
              overflowTokens: built.usage.overflowTokens || 0,
              tokensByKind: built.usage.tokensByKind,
              droppedTokensByKind: built.usage.droppedTokensByKind,
              truncatedKinds: built.usage.truncatedKinds,
              phase: 'context_built',
              sessionId,
              summaryUpdated: built.summaryUpdated
            }
          })
        },
        onText: (chunk) => {
          tryWrite('message.delta', { runId: run.id, stepId: goalStep.id, data: { content: chunk } })
        },
        onToolCall: (ev) => {
          const status = ev.phase === 'called' ? 'running' : ev.status
          tryWrite('tool.called', {
            runId: run.id,
            stepId: goalStep.id,
            data: {
              toolCallId: ev.callId,
              toolName: ev.toolName,
              arguments: ev.arguments,
              status,
              result: ev.result || null,
              error: ev.error || null
            }
          })
        }
      })
      fullText = chatResult.text

      if (cancelled) {
        orchestrator.cancel(run.id)
        finished = true
        tryWrite('run.cancelled', { runId: run.id, data: {} })
        if (!res.writableEnded) res.end()
        return
      }

      agentRepo.updateRunCheckpoint(run.id, { phase: 'model_responded', contextUsage: chatResult.contextUsage || {} })
      orchestrator.completeStep(run.id, 'goal_analysis', { contextUsage: chatResult.contextUsage || {}, answerTokenEstimate: String(fullText || '').length })
      const finalResult = await executor.finalizeChatRun(run, fullText, { contextUsage: chatResult.contextUsage || {} })
      tryWrite('step.completed', { runId: run.id, stepId: goalStep.id, data: { stepKey: 'goal_analysis', output: { contextUsage: chatResult.contextUsage || {} } } })
      finished = true
      tryWrite('run.completed', { runId: run.id, data: { content: fullText, message: finalResult.message, run: finalResult.run, contextUsage: chatResult.contextUsage || {} } })
      if (!res.writableEnded) res.end()
    } catch (e) {
      // 取消 / 中止：只发 run.cancelled，绝不把已取消的 Run 覆盖为 failed
      const runNow = currentRunId ? orchestrator.getRun(currentRunId) : null
      const isCancel = cancelled || isAbortError(e) || (runNow && runNow.status === 'cancelled')
      if (isCancel) {
        if (currentRunId && runNow && runNow.status !== 'cancelled') {
          orchestrator.cancel(currentRunId)
        }
        finished = true
        tryWrite('run.cancelled', { runId: currentRunId, data: {} })
        if (!res.writableEnded) res.end()
      } else {
        if (currentRunId) orchestrator.failStep(currentRunId, 'goal_analysis', e)
        sendFail(e)
      }
    } finally {
      if (cleanupMerged) cleanupMerged()
      if (currentRunId) orchestrator.clearSignal(currentRunId)
    }
  })

  // ================= Run 查询 / 取消 / 重试 / 确认 =================
  server.get('/api/agent/runs/:runId', (req, res) => {
    try {
      requireRunOwner(req, req.params.runId, db())
      const run = orchestrator.getRun(req.params.runId)
      return sendOk(res, run)
    } catch (e) {
      return sendError(res, e)
    }
  })

  server.get('/api/agent/runs/:runId/steps', (req, res) => {
    try {
      requireRunOwner(req, req.params.runId, db())
      const run = orchestrator.getRun(req.params.runId)
      return sendOk(res, run.steps)
    } catch (e) {
      return sendError(res, e)
    }
  })

  server.post('/api/agent/runs/:runId/cancel', (req, res) => {
    try {
      requireRunOwner(req, req.params.runId, db())
      const run = orchestrator.cancel(req.params.runId)
      if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
      return sendOk(res, run)
    } catch (e) {
      return sendError(res, e)
    }
  })

  // 重试：按服务端保存的 requestSnapshot 真实重新执行（不信任前端提交的请求体）
  server.post('/api/agent/runs/:runId/retry', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    try {
      requireRunOwner(req, req.params.runId, db())
      const result = await executor.retry(req.params.runId, { signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e)) orchestrator.cancel(req.params.runId)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  // 从最近安全 Checkpoint 继续；与 retry（目标步骤重新执行）区分。
  server.post('/api/agent/runs/:runId/resume', async (req, res) => {
    const requestId = genRequestId()
    const abortCtx = createRequestAbortContext(req, res)
    try {
      requireRunOwner(req, req.params.runId, db())
      const result = await executor.resume(req.params.runId, { signal: abortCtx.signal })
      abortCtx.markCompleted()
      return sendOk(res, result)
    } catch (e) {
      if (isAbortError(e)) orchestrator.cancel(req.params.runId)
      return sendError(res, e, requestId)
    } finally {
      abortCtx.cleanup()
    }
  })

  server.post('/api/agent/runs/:runId/confirm-outline', (req, res) => {
    try {
      requireRunOwner(req, req.params.runId, db())
      const run = orchestrator.confirmOutline(req.params.runId)
      // Return the confirmed running state promptly; the actual writing step
      // continues as a durable background task and cannot be faked by only
      // changing currentStep.
      setImmediate(() => {
        workflowExecutor.continueAfterOutlineConfirmation(req.params.runId)
          .catch(error => console.error('[agent/workflow] section_writing failed', sanitizeForLog(error && error.message)))
      })
      return sendOk(res, run)
    } catch (e) {
      return sendError(res, e)
    }
  })

  // ================= 站内混合检索 =================
  server.get('/api/articles/hybrid-search', async (req, res) => {
    const requestId = genRequestId()
    try {
      const q = assertLength(req.query.q, 200, '查询词')
      const topK = Math.min(50, Math.max(1, parseInt(req.query.topK, 10) || 10))
      if (!q) return sendOk(res, { items: [], total: 0 })
      const results = await knowledgeService.searchArticles(q, { topK })
      return sendOk(res, { items: results, total: results.length })
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  // ================= 知识库 =================
  server.get('/api/knowledge/index/:articleId/status', (req, res) => {
    try {
      const user = requireUser(req, db())
      const post = db().get('posts').find({ id: req.params.articleId }).value()
      if (!post) throw new AppError(ERROR_CODES.NOT_FOUND, '文章不存在', { status: 404 })
      if (String(post.columnId || post.column || '') !== String(user.columnId)) {
        throw new AppError(ERROR_CODES.FORBIDDEN, '无权查看他人文章索引状态', { status: 403 })
      }
      return sendOk(res, knowledgeService.getIndexStatus(req.params.articleId))
    } catch (e) {
      return sendError(res, e)
    }
  })

  server.post('/api/knowledge/index/:articleId', async (req, res) => {
    const requestId = genRequestId()
    try {
      checkRateLimit(req, { limit: 30 })
      const user = requireUser(req, db())
      const articleId = req.params.articleId
      const post = db().get('posts').find({ id: articleId }).value()
      if (!post) throw new AppError(ERROR_CODES.NOT_FOUND, '文章不存在', { status: 404, requestId })
      // 权限：只能索引自己专栏下的文章
      if (String(post.columnId || post.column || '') !== String(user.columnId)) {
        throw new AppError(ERROR_CODES.FORBIDDEN, '无权索引他人文章', { status: 403, requestId })
      }
      const result = await knowledgeService.indexArticle(post, { authorId: String(user.columnId) })
      return sendOk(res, result)
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  server.post('/api/knowledge/search', async (req, res) => {
    const requestId = genRequestId()
    try {
      const user = requireUser(req, db())
      const q = assertLength(req.body.query, 200, '查询词')
      const topK = Math.min(50, Math.max(1, parseInt(req.body.topK, 10) || 10))
      if (!q) throw new AppError(ERROR_CODES.VALIDATION_FAILED, '查询词不能为空', { status: 400, requestId })
      // 知识库搜索必须限定当前用户 authorId，避免串到他人数据
      const results = await knowledgeService.search(q, { topK, authorId: String(user.columnId) })
      return sendOk(res, { items: results, total: results.length, embeddingProvider: knowledgeService.provider.name })
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  server.get('/api/knowledge/documents', (req, res) => {
    try {
      const user = requireUser(req, db())
      return sendOk(res, knowledgeRepo.listDocumentsByAuthor(String(user.columnId)))
    } catch (e) {
      return sendError(res, e)
    }
  })

  server.delete('/api/knowledge/documents/:id', (req, res) => {
    try {
      requireKnowledgeOwner(req, req.params.id, db())
      knowledgeService.deleteDocument(req.params.id)
      return sendOk(res, { deleted: true })
    } catch (e) {
      return sendError(res, e)
    }
  })

  // ================= 文章问答 =================
  server.post('/api/articles/:id/ask', async (req, res) => {
    const requestId = genRequestId()
    try {
      checkRateLimit(req)
      const question = assertLength(req.body.question, LIMITS.message, '问题')
      if (!question) throw new AppError(ERROR_CODES.VALIDATION_FAILED, '问题不能为空', { status: 400, requestId })
      const articleId = req.params.id
      const post = db().get('posts').find({ id: articleId }).value()
      if (!post) throw new AppError(ERROR_CODES.NOT_FOUND, '文章不存在', { status: 404, requestId })

      // 文章问答只检索当前文章，已索引则检索 Chunk，未索引则临时清洗切块
      const answer = await knowledgeAgent.askArticle(question, {
        articleId,
        post: {
          id: post.id,
          title: post.title,
          content: String(post.content || '')
        },
        knowledgeService
      })
      return sendOk(res, answer)
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  // ================= 个人知识库 Agent =================
  server.post('/api/agent/knowledge-chat', async (req, res) => {
    const requestId = genRequestId()
    try {
      checkRateLimit(req)
      const user = requireUser(req, db())
      const question = assertLength(req.body.question, LIMITS.message, '问题')
      if (!question) throw new AppError(ERROR_CODES.VALIDATION_FAILED, '问题不能为空', { status: 400, requestId })
      const result = await knowledgeAgent.knowledgeChat(question, {
        authorId: String(user.columnId),
        db: db(),
        knowledgeService
      })
      return sendOk(res, result)
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  server.post('/api/agent/topic-suggestions', async (req, res) => {
    const requestId = genRequestId()
    try {
      checkRateLimit(req)
      const user = requireUser(req, db())
      const count = Math.min(10, Math.max(1, parseInt(req.body.count, 10) || 5))
      const result = await knowledgeAgent.topicSuggestions({ authorId: String(user.columnId), db: db(), count })
      return sendOk(res, result)
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })

  server.post('/api/agent/series-classification', async (req, res) => {
    const requestId = genRequestId()
    try {
      checkRateLimit(req)
      const user = requireUser(req, db())
      const result = await knowledgeAgent.seriesClassification({ authorId: String(user.columnId), db: db() })
      return sendOk(res, result)
    } catch (e) {
      return sendError(res, e, requestId)
    }
  })
}

module.exports = {
  registerAgentRoutes,
  createRateLimiter
}
