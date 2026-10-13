// server/agent/agentOrchestrator.js
// 服务端 Agent Workflow 编排器：管理 run 与 7 个步骤的状态机。
// 关键约束：
//   - 大纲生成后进入 waiting_for_user，不自动覆盖文章
//   - 用户接受大纲后才能进入 section_writing
//   - 文章修改只返回 patch，审查只返回 review report
//   - 每个步骤可单独重试；运行失败后可恢复；用户取消后不再调用模型

const agentRepo = require('../repositories/agentRepository')
const { AppError, ERROR_CODES, sanitizeForLog } = require('../ai/error')

const STEPS = [
  { key: 'goal_analysis', label: '创作目标' },
  { key: 'internal_research', label: '资料检索' },
  { key: 'outline_generation', label: '生成大纲' },
  { key: 'outline_confirmation', label: '确认大纲' },
  { key: 'section_writing', label: '章节写作' },
  { key: 'article_review', label: '全文审查' },
  { key: 'publish_preparation', label: '发布准备' }
]

const VALID_STATUS = new Set(['pending', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'])

class AgentOrchestrator {
  constructor() {
    this.cancellers = new Map()
    // 进程内重试互斥：同一 run 同一时刻只允许一个重试在执行。
    // 生产环境应迁移到数据库事务 / 分布式锁（见 beginRetry 注释）。
    this.retryLocks = new Set()
  }

  // 创建一个 run 并预置 7 个步骤（持久化）
  createRun({ sessionId, type, userId = '' }) {
    const run = agentRepo.createRun({ sessionId, type, status: 'pending', userId })
    STEPS.forEach((s, idx) => {
      agentRepo.createRunStep({
        runId: run.id,
        stepKey: s.key,
        status: 'pending',
        input: {},
        output: {}
      })
    })
    run.steps = this._loadSteps(run.id)
    return run
  }

  _loadSteps(runId) {
    return agentRepo.listRunSteps(runId)
  }

  getRun(runId) {
    const run = agentRepo.getRun(runId)
    if (!run) return null
    run.steps = this._loadSteps(runId)
    return run
  }

  // 为 run 注册一个可取消信号，返回 signal
  registerSignal(runId) {
    const controller = new AbortController()
    this.cancellers.set(runId, controller)
    return controller.signal
  }

  clearSignal(runId) {
    this.cancellers.delete(runId)
  }

  cancel(runId) {
    const controller = this.cancellers.get(runId)
    if (controller) controller.abort()
    const run = agentRepo.getRun(runId)
    if (!run) return null
    // completed / cancelled 是终态，取消后不再改写，保持幂等
    if (run.status === 'completed' || run.status === 'cancelled') {
      return this.getRun(runId)
    }
    // pending / running / waiting_for_user 均可取消
    agentRepo.updateRun(runId, { status: 'cancelled', currentStep: null })
    // 正在运行或等待用户确认的步骤置为 cancelled；已完成的步骤保持 completed
    this._loadSteps(runId).forEach(s => {
      if (s.status === 'running' || s.status === 'waiting_for_user') {
        agentRepo.updateRunStep(s.id, { status: 'cancelled', completedAt: new Date().toISOString() })
      }
    })
    return this.getRun(runId)
  }

  // 启动一个步骤：校验前置状态，置 running
  startStep(runId, stepKey, input = {}) {
    const run = agentRepo.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === stepKey)
    if (!step) throw new AppError(ERROR_CODES.NOT_FOUND, '步骤不存在', { status: 404 })
    if (step.status === 'completed') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '已完成步骤不可重复执行', { status: 409 })
    }

    agentRepo.updateRunStep(step.id, {
      status: 'running',
      input,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null
    })
    agentRepo.updateRun(runId, { status: 'running', currentStep: stepKey })
    return this.getRun(runId)
  }

  // 完成一个步骤（run 已取消时拒绝，防止「取消后又完成」的状态回跳）
  completeStep(runId, stepKey, output = {}) {
    const run = agentRepo.getRun(runId)
    if (run && run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === stepKey)
    if (step) {
      if (step.status !== 'running') {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, '只有运行中的步骤可以完成', { status: 409 })
      }
      agentRepo.updateRunStep(step.id, { status: 'completed', output, completedAt: new Date().toISOString() })
    }
    return this.getRun(runId)
  }

  // 进入等待用户确认（大纲生成后调用；run 已取消时拒绝）
  waitingForUser(runId, stepKey) {
    const run = agentRepo.getRun(runId)
    if (run && run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === stepKey)
    if (step) {
      if (step.status !== 'running' && step.status !== 'pending') {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, '当前步骤不可进入等待状态', { status: 409 })
      }
      agentRepo.updateRunStep(step.id, { status: 'waiting_for_user', completedAt: new Date().toISOString() })
    }
    agentRepo.updateRun(runId, { status: 'waiting_for_user', currentStep: stepKey })
    return this.getRun(runId)
  }

  // 步骤失败：run 已取消时绝不覆盖为 failed（取消是终态）
  failStep(runId, stepKey, error) {
    const run = agentRepo.getRun(runId)
    if (run && run.status === 'cancelled') {
      return this.getRun(runId)
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === stepKey)
    if (step) {
      agentRepo.updateRunStep(step.id, {
        status: 'failed',
        error: String(sanitizeForLog(error && error.message ? error.message : error)).slice(0, 500),
        completedAt: new Date().toISOString()
      })
    }
    agentRepo.updateRun(runId, { status: 'failed', currentStep: stepKey })
    return this.getRun(runId)
  }

  // 重试占用检查（原子）：只有 failed 的 run 可以重试；同一 run 同一时刻只允许一个重试在进程内执行。
  // cancelled → 499；其余非 failed 状态（running/pending/waiting_for_user/completed）→ 409；
  // 已在重试中的 run → 409（进程内互斥）。
  // 说明：当前文件存储（JsonFileStore.update 为读改写、无 CAS），本方法依赖 Node 单线程下
  // 「读取状态 + 占用 + 状态迁移」全程同步执行，天然构成进程内原子区。生产环境应迁移为
  // 数据库事务（UPDATE ... WHERE status='failed'）或分布式锁（Redis SETNX / ZooKeeper），
  // 以覆盖多进程 / 多实例并发。
  beginRetry(runId) {
    const run = agentRepo.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    if (run.status !== 'failed') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '只有失败的运行才能重试', { status: 409 })
    }
    if (this.retryLocks.has(runId)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '该运行正在重试中，请勿重复提交', { status: 409 })
    }
    this.retryLocks.add(runId)
    return run
  }

  endRetry(runId) {
    this.retryLocks.delete(runId)
  }

  // 单个步骤重试：retryCount++，重置为「待执行」状态（不伪装成正在执行）。
  // 实际执行由路由层 / SSE 触发，这里只负责状态机层面的复位，
  // 避免出现「只改状态却不重新执行」的假 running 状态。
  retryStep(runId, stepKey) {
    const run = agentRepo.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === stepKey)
    if (!step) throw new AppError(ERROR_CODES.NOT_FOUND, '步骤不存在', { status: 404 })
    agentRepo.updateRunStep(step.id, {
      status: 'pending',
      error: null,
      retryCount: (step.retryCount || 0) + 1,
      startedAt: new Date().toISOString(),
      completedAt: null
    })
    agentRepo.updateRun(runId, { status: 'pending', currentStep: stepKey })
    return this.getRun(runId)
  }

  // 用户确认大纲：必须校验 大纲已生成 / 确认步骤等待中 / run 处于 waiting_for_user，
  // 且 run 未被取消；否则拒绝确认，禁止跳过生成直接确认。
  confirmOutline(runId) {
    const run = agentRepo.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    if (run.status !== 'waiting_for_user') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '当前运行不在等待确认状态', { status: 409 })
    }
    const steps = this._loadSteps(runId)
    const genStep = steps.find(s => s.stepKey === 'outline_generation')
    const confirmStep = steps.find(s => s.stepKey === 'outline_confirmation')
    if (!genStep || genStep.status !== 'completed') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '大纲尚未生成，无法确认', { status: 409 })
    }
    if (!confirmStep || confirmStep.status !== 'waiting_for_user') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '大纲确认步骤未处于等待状态', { status: 409 })
    }
    agentRepo.updateRunStep(confirmStep.id, { status: 'completed', completedAt: new Date().toISOString() })
    agentRepo.updateRun(runId, { status: 'running', currentStep: 'section_writing' })
    return this.getRun(runId)
  }

  completeRun(runId) {
    const run = agentRepo.getRun(runId)
    if (run && run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    agentRepo.updateRun(runId, { status: 'completed', currentStep: null })
    agentRepo.updateRunCheckpoint(runId, { phase: 'completed' })
    return this.getRun(runId)
  }

  // 服务重启时，把仍停留在 running 的 run 与 step 标记为 failed，
  // 避免其永远显示「运行中」。
  recoverInterruptedRuns() {
    const all = agentRepo.listAllRuns()
    let recovered = 0
    all.forEach(run => {
      if (run.status !== 'running') return
      agentRepo.updateRun(run.id, { status: 'failed', currentStep: null })
      this._loadSteps(run.id).forEach(step => {
        if (step.status === 'running') {
          agentRepo.updateRunStep(step.id, {
            status: 'failed',
            error: '服务重启，运行被中断',
            completedAt: new Date().toISOString()
          })
        }
      })
      recovered++
    })
    return recovered
  }

  // 运行失败后恢复：把 failed 步骤重置，从指定步骤继续
  resume(runId, fromStepKey) {
    const run = agentRepo.getRun(runId)
    if (!run) throw new AppError(ERROR_CODES.NOT_FOUND, 'run 不存在', { status: 404 })
    if (run.status === 'cancelled') {
      throw new AppError(ERROR_CODES.CANCELLED, undefined, { status: 499 })
    }
    const step = this._loadSteps(runId).find(s => s.stepKey === fromStepKey)
    if (!step) throw new AppError(ERROR_CODES.NOT_FOUND, '步骤不存在', { status: 404 })
    agentRepo.updateRunStep(step.id, {
      status: 'running',
      error: null,
      retryCount: (step.retryCount || 0) + 1,
      startedAt: new Date().toISOString(),
      completedAt: null
    })
    agentRepo.updateRun(runId, { status: 'running', currentStep: fromStepKey })
    return this.getRun(runId)
  }
}

module.exports = {
  AgentOrchestrator,
  STEPS,
  VALID_STATUS
}
