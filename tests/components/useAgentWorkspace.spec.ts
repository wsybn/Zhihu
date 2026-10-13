// tests/components/useAgentWorkspace.spec.ts
// 工作台 composable：会话恢复 / 每用户会话键 / 补丁接受拒绝 / 审查接受忽略 / 重试守卫。
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createAgentSession,
  fetchAgentSession,
  fetchAgentSessionMessages,
  fetchAgentSessionRuns,
  fetchAgentRunSteps,
  retryAgentRun,
  generateArticlePatch
} from '../../src/services/agentService'
import store from '../../src/store'
import { useAgentWorkspace } from '../../src/hooks/useAgentWorkspace'
import type { AgentMessage, ArticlePatch, ReviewIssue } from '../../src/types/agent'

// 隔离底层流式 hook 与全部 service 请求，专注测试工作台状态逻辑
vi.mock('../../src/hooks/useAgentStream', () => ({
  useAgentStream: () => ({
    isStreaming: { value: false },
    runId: { value: '' },
    currentStepId: { value: null },
    error: { value: null },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn()
  }),
  simulateDeltaFallback: vi.fn(() => () => {})
}))

vi.mock('../../src/services/agentService', () => ({
  createAgentSession: vi.fn(),
  sendAgentChat: vi.fn(),
  generateOutline: vi.fn(),
  generateArticlePatch: vi.fn(),
  reviewArticle: vi.fn(),
  searchKnowledge: vi.fn(),
  fetchAgentSession: vi.fn(),
  fetchAgentSessionMessages: vi.fn(),
  fetchAgentSessionRuns: vi.fn(),
  fetchAgentRunSteps: vi.fn(),
  retryAgentRun: vi.fn()
}))

vi.mock('../../src/services/articleService', () => ({
  searchArticles: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 })
}))

const mockCreate = createAgentSession as unknown as ReturnType<typeof vi.fn>
const mockFetchSession = fetchAgentSession as unknown as ReturnType<typeof vi.fn>
const mockFetchMessages = fetchAgentSessionMessages as unknown as ReturnType<typeof vi.fn>
const mockFetchRuns = fetchAgentSessionRuns as unknown as ReturnType<typeof vi.fn>
const mockFetchSteps = fetchAgentRunSteps as unknown as ReturnType<typeof vi.fn>
const mockRetry = retryAgentRun as unknown as ReturnType<typeof vi.fn>
const mockPatch = generateArticlePatch as unknown as ReturnType<typeof vi.fn>

const sessionStub = { id: 'sess-1', title: 't', status: 'active' as const, createdAt: '', updatedAt: '' }

function msg(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || 'm1',
    sessionId: 'sess-1',
    role: 'assistant',
    type: 'text',
    content: '',
    createdAt: '',
    ...partial
  }
}

function patchMsg(patch: ArticlePatch): AgentMessage {
  return msg({ id: 'pm', type: 'article_patch', payload: [patch] })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  store.state.user = { isLogin: true, id: '42' }
})

describe('会话恢复与每用户会话键', () => {
  it('restoreSession 恢复会话 / 消息 / run 步骤', async () => {
    mockFetchSession.mockResolvedValue(sessionStub)
    mockFetchMessages.mockResolvedValue({ items: [msg({ id: 'm1', role: 'user', type: 'text', content: 'hi' })], total: 1, page: 1, pageSize: 100 })
    mockFetchRuns.mockResolvedValue([{ id: 'r1', sessionId: 'sess-1', type: 'chat', status: 'completed', currentStep: null, steps: [], createdAt: '', updatedAt: '' }])
    mockFetchSteps.mockResolvedValue([{ id: 'st1', runId: 'r1', stepKey: 'goal_analysis', status: 'completed' }])

    const ws = useAgentWorkspace()
    await ws.restoreSession('sess-1')

    expect(ws.session?.id).toBe('sess-1')
    expect(ws.messages.length).toBe(1)
    expect(ws.activeRunId).toBe('r1')
    expect(ws.runSteps.length).toBe(1)
  })

  it('restoreSession 遇到 401/404 清除每用户会话缓存', async () => {
    localStorage.setItem('agent_session_id:42', 'sess-bad')
    mockFetchSession.mockRejectedValue({ apiError: { code: 404 } })

    const ws = useAgentWorkspace()
    await ws.restoreSession('sess-bad')

    expect(localStorage.getItem('agent_session_id:42')).toBeNull()
  })

  it('未登录时不恢复任何会话', async () => {
    store.state.user = { isLogin: false }
    const ws = useAgentWorkspace()
    await ws.restoreSession('sess-x')
    expect(mockFetchSession).not.toHaveBeenCalled()
  })

  it('sendMessage 通过 ensureSession 保存每用户会话键', async () => {
    mockCreate.mockResolvedValue(sessionStub)

    const ws = useAgentWorkspace()
    ws.sendMessage('你好')

    await vi.waitFor(() => {
      expect(localStorage.getItem('agent_session_id:42')).toBe('sess-1')
    })
  })
})

describe('补丁接受 / 拒绝', () => {
  const patch: ArticlePatch = { id: 'p1', target: 'content', operation: 'replace', proposedText: '新', reason: 'r', status: 'pending' }

  it('acceptPatch 置为 accepted，onPatchAccepted 返回 false 时保持 pending', () => {
    const ws = useAgentWorkspace({ onPatchAccepted: () => false })
    ws.messages.push(patchMsg(patch))
    ws.acceptPatch('p1')
    expect(ws.currentPatches[0].status).toBe('pending')
  })

  it('acceptPatch / rejectPatch 更新补丁状态', () => {
    const ws = useAgentWorkspace({ onPatchAccepted: () => true })
    ws.messages.push(patchMsg(patch))
    ws.acceptPatch('p1')
    expect(ws.currentPatches[0].status).toBe('accepted')
    ws.rejectPatch('p1')
    expect(ws.currentPatches[0].status).toBe('rejected')
  })

  it('runPatch 在选择为空时阻断「润色选中」', () => {
    const ws = useAgentWorkspace({ getContext: () => ({ title: 't', content: 'c', selection: '' }) })
    ws.runQuickAction('polish_selection')
    expect(mockPatch).not.toHaveBeenCalled()
    expect(ws.messages.some(m => m.type === 'error')).toBe(true)
  })
})

describe('审查接受 / 忽略', () => {
  const issue: ReviewIssue = { id: 'i1', category: 'grammar', severity: 'warning', originalText: 'a', message: 'm', replacement: 'b' }
  const reviewMsg = (): AgentMessage => msg({
    id: 'rm',
    type: 'review',
    payload: { id: 'rev1', score: 80, summary: 's', issues: [issue], createdAt: '' }
  })

  it('acceptReviewIssue 触发 onReviewApply 并置 accepted', () => {
    const onReviewApply = vi.fn().mockReturnValue(true)
    const ws = useAgentWorkspace({ onReviewApply })
    ws.messages.push(reviewMsg())
    ws.acceptReviewIssue('i1')
    expect(onReviewApply).toHaveBeenCalledWith(issue)
    expect(ws.reviewIssueStates.i1).toBe('accepted')
  })

  it('ignoreReviewIssue 置 ignored，不触发 onReviewApply', () => {
    const onReviewApply = vi.fn()
    const ws = useAgentWorkspace({ onReviewApply })
    ws.messages.push(reviewMsg())
    ws.ignoreReviewIssue('i1')
    expect(onReviewApply).not.toHaveBeenCalled()
    expect(ws.reviewIssueStates.i1).toBe('ignored')
  })

  it('acceptAllSafeIssues 只接受有替换且非 error 的建议', () => {
    const onReviewApply = vi.fn().mockReturnValue(true)
    const errorIssue: ReviewIssue = { id: 'e1', category: 'logic', severity: 'error', message: '严重', replacement: 'x' }
    const noReplacement: ReviewIssue = { id: 'n1', category: 'structure', severity: 'info', message: '仅提示' }
    const ws = useAgentWorkspace({ onReviewApply })
    ws.messages.push(msg({
      id: 'rm',
      type: 'review',
      payload: { id: 'rev1', score: 60, summary: 's', issues: [issue, errorIssue, noReplacement], createdAt: '' }
    }))
    ws.acceptAllSafeIssues()
    expect(onReviewApply).toHaveBeenCalledTimes(1)
    expect(ws.reviewIssueStates.i1).toBe('accepted')
    expect(ws.reviewIssueStates.e1).toBeUndefined()
    expect(ws.reviewIssueStates.n1).toBeUndefined()
  })
})

describe('重试守卫', () => {
  it('已取消的 run 不可重试', async () => {
    const ws = useAgentWorkspace()
    ws.activeRunId = 'r-cancelled'
    ws.activeRun = { id: 'r-cancelled', sessionId: 'sess-1', type: 'chat', status: 'cancelled', currentStep: null, steps: [], createdAt: '', updatedAt: '' }
    await ws.retryActiveRun()
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it('未取消的 run 走服务端 requestSnapshot 重试', async () => {
    mockRetry.mockResolvedValue({
      run: { id: 'r1', sessionId: 'sess-1', type: 'chat', status: 'completed', currentStep: null, steps: [], createdAt: '', updatedAt: '' },
      message: msg({ id: 'm2', type: 'text', content: 'ok' })
    })
    const ws = useAgentWorkspace()
    ws.activeRunId = 'r1'
    ws.activeRun = { id: 'r1', sessionId: 'sess-1', type: 'chat', status: 'failed', currentStep: null, steps: [], createdAt: '', updatedAt: '' }
    await ws.retryActiveRun()
    expect(mockRetry).toHaveBeenCalledWith('r1', expect.anything())
    expect(ws.activeRun?.status).toBe('completed')
  })
})
