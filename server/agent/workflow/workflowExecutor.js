// 真实 Workflow 执行器：确认大纲只负责改变门禁状态，章节写作由此处实际调用模型并持久化产物。

const agentRepo = require('../../repositories/agentRepository')
const { AppError, ERROR_CODES, isAbortError } = require('../../ai/error')

class WorkflowExecutor {
  constructor({ orchestrator, deepseekClient } = {}) {
    this.orchestrator = orchestrator
    this.deepseek = deepseekClient
  }

  async continueAfterOutlineConfirmation(runId, { signal } = {}) {
    const run = this.orchestrator.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    if (run.status === 'completed') return { run, message: agentRepo.findMessageByRunId(runId, { role: 'assistant' }) }

    const outlineStep = run.steps.find(step => step.stepKey === 'outline_generation')
    const writingStep = run.steps.find(step => step.stepKey === 'section_writing')
    if (!outlineStep || outlineStep.status !== 'completed') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '大纲尚未完成，不能开始章节写作', { status: 409 })
    }
    if (!writingStep || (writingStep.status !== 'pending' && writingStep.status !== 'running')) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '章节写作步骤不可执行', { status: 409 })
    }

    this.orchestrator.startStep(runId, 'section_writing', {
      outline: outlineStep.output,
      source: 'outline_confirmation'
    })
    try {
      const request = run.requestSnapshot && run.requestSnapshot.request || {}
      const outline = outlineStep.output || {}
      const sectionText = await this.deepseek.chat({
        instructions: '你是中文知乎文章作者。根据已确认的大纲生成第一章节草稿，只输出章节正文，不要修改原文章，不要输出 JSON。',
        input: `标题：${String(request.title || '').slice(0, 200)}\n已确认大纲：${JSON.stringify(outline).slice(0, 12000)}\n原文上下文：${String(request.content || '').slice(0, 12000)}`,
        signal
      })
      if (signal && signal.aborted) {
        const error = new Error('请求已取消')
        error.name = 'AbortError'
        throw error
      }
      const proposedText = String(sectionText || '').slice(0, 20000)
      const patch = {
        id: agentRepo.newId('patch'),
        target: 'content',
        operation: 'append',
        proposedText,
        reason: '根据用户确认的大纲生成章节草稿，等待用户接受后写入正文。',
        status: 'pending'
      }
      const message = agentRepo.createMessage({
        sessionId: run.sessionId,
        userId: run.userId,
        role: 'assistant',
        type: 'article_patch',
        content: '已根据确认的大纲生成章节草稿，请确认是否应用。',
        payload: [patch],
        runId
      })
      this.orchestrator.completeStep(runId, 'section_writing', { patches: [patch], generated: true })
      this.orchestrator.completeRun(runId)
      return { run: this.orchestrator.getRun(runId), message }
    } catch (error) {
      if (!isAbortError(error)) this.orchestrator.failStep(runId, 'section_writing', error)
      throw error
    }
  }
}

module.exports = { WorkflowExecutor }
