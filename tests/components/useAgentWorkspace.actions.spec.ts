// tests/components/useAgentWorkspace.actions.spec.ts
// 工作台动作：大纲/审查/检索/补丁的触发、大纲确认流程、标题/定位回调、重试与停止。
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createAgentSession,
  generateOutline,
  reviewArticle,
  searchKnowledge,
  generateArticlePatch
} from '../../src/services/agentService'
import { searchArticles } from '../../src/services/articleService'
import store from '../../src/store'
import { useAgentWorkspace } from '../../src/hooks/useAgentWorkspace'
import type { AgentMessage, ArticleOutline, ArticlePatch, ReviewIssue } from '../../src/types/agent'

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
const mockOutline = generateOutline as unknown as ReturnType<typeof vi.fn>
const mockReview = reviewArticle as unknown as ReturnType<typeof vi.fn>
const mockKnowledge = searchKnowledge as unknown as ReturnType<typeof vi.fn>
const mockPatch = generateArticlePatch as unknown as ReturnType<typeof vi.fn>
const mockSearchArticles = searchArticles as unknown as ReturnType<typeof vi.fn>

const sessionStub = { id: 'sess-1', title: 't', status: 'active' as const, createdAt: '', updatedAt: '' }
const emptyRun = { id: 'r1', sessionId: 'sess-1', type: 'chat', status: 'completed' as const, currentStep: null, steps: [], createdAt: '', updatedAt: '' }

const outline: ArticleOutline = {
  titleCandidates: ['候选标题'],
  audience: '前端开发者',
  goal: '讲清组合式 API',
  estimatedLength: 2000,
  sections: [
    { id: 's1', title: '组合式 API 简介', keyPoints: ['setup', 'ref'], status: 'pending' }
  ]
}
const report = { id: 'rev1', score: 85, summary: 's', issues: [], createdAt: '' }
const issue: ReviewIssue = { id: 'i1', category: 'grammar', severity: 'warning', originalText: 'a', message: 'm', replacement: 'b' }
const patch: ArticlePatch = { id: 'p1', target: 'content', operation: 'replace', proposedText: '新', reason: 'r', status: 'pending' }

function msg(partial: Partial<AgentMessage>): AgentMessage {
  return { id: partial.id || 'm1', sessionId: 'sess-1', role: 'assistant', type: 'text', content: '', createdAt: '', ...partial }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  store.state.user = { isLogin: true, id: '42' }
  mockCreate.mockResolvedValue(sessionStub)
  mockOutline.mockResolvedValue({ run: emptyRun, message: msg({ id: 'o', type: 'outline', payload: outline }) })
  mockReview.mockResolvedValue({ run: emptyRun, message: msg({ id: 'r', type: 'review', payload: report }) })
  mockKnowledge.mockResolvedValue({ total: 0, items: [] })
  mockSearchArticles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 })
  mockPatch.mockResolvedValue({ run: emptyRun, message: msg({ id: 'p', type: 'article_patch', payload: [patch] }) })
})

describe('模式切换与发布准备', () => {
  it('setAgentMode 切换 agentMode', () => {
    const ws = useAgentWorkspace()
    expect(ws.agentMode).toBe(false)
    ws.setAgentMode(true)
    expect(ws.agentMode).toBe(true)
  })

  it('markPublishPreparation 更新发布准备步骤状态', () => {
    const ws = useAgentWorkspace()
    ws.markPublishPreparation('running')
    expect(ws.workflowSteps.find(s => s.key === 'publish_preparation')?.status).toBe('running')
  })
})

describe('大纲确认流程', () => {
  it('acceptOutline 完成确认并进入章节写作', () => {
    const ws = useAgentWorkspace()
    ws.acceptOutline()
    expect(ws.outlineAccepted).toBe(true)
    expect(ws.workflowSteps.find(s => s.key === 'outline_confirmation')?.status).toBe('completed')
    expect(ws.workflowSteps.find(s => s.key === 'section_writing')?.status).toBe('pending')
  })

  it('rejectOutline 回退确认步骤', () => {
    const ws = useAgentWorkspace()
    ws.acceptOutline()
    ws.rejectOutline()
    expect(ws.outlineAccepted).toBe(false)
    expect(ws.workflowSteps.find(s => s.key === 'outline_confirmation')?.status).toBe('pending')
  })

  it('insertOutline 拼装大纲并回调 onOutlineInsert', () => {
    const onOutlineInsert = vi.fn()
    const ws = useAgentWorkspace({ onOutlineInsert })
    ws.messages.push(msg({ type: 'outline', payload: outline }))
    ws.insertOutline()
    expect(onOutlineInsert).toHaveBeenCalledTimes(1)
    const markdown = onOutlineInsert.mock.calls[0][0]
    expect(markdown).toContain('## 1. 组合式 API 简介')
    expect(markdown).toContain('- setup')
    expect(markdown).toContain('> 目标读者：前端开发者')
  })

  it('无大纲时 insertOutline 不回调', () => {
    const onOutlineInsert = vi.fn()
    const ws = useAgentWorkspace({ onOutlineInsert })
    ws.insertOutline()
    expect(onOutlineInsert).not.toHaveBeenCalled()
  })

  it('selectOutlineTitle 记录标题并回调 onTitleApply', () => {
    const onTitleApply = vi.fn()
    const ws = useAgentWorkspace({ onTitleApply })
    ws.selectOutlineTitle('新标题')
    expect(ws.selectedOutlineTitle).toBe('新标题')
    expect(onTitleApply).toHaveBeenCalledWith('新标题')
  })

  it('regenerateOutline 重新触发大纲生成', async () => {
    const ws = useAgentWorkspace()
    ws.regenerateOutline()
    await vi.waitFor(() => {
      expect(mockOutline).toHaveBeenCalled()
    })
  })
})

describe('审查定位回调', () => {
  it('locateReviewIssue 回调 onReviewLocate', () => {
    const onReviewLocate = vi.fn()
    const ws = useAgentWorkspace({ onReviewLocate })
    ws.locateReviewIssue(issue)
    expect(onReviewLocate).toHaveBeenCalledWith(issue)
  })
})

describe('快速动作触发', () => {
  it('runQuickAction outline 调用 generateOutline', async () => {
    const ws = useAgentWorkspace()
    ws.runQuickAction('outline')
    await vi.waitFor(() => expect(mockOutline).toHaveBeenCalled())
  })

  it('runQuickAction review 调用 reviewArticle', async () => {
    const ws = useAgentWorkspace()
    ws.runQuickAction('review')
    await vi.waitFor(() => expect(mockReview).toHaveBeenCalled())
  })

  it('runQuickAction title 以 title 为目标调用 generateArticlePatch', async () => {
    const ws = useAgentWorkspace()
    ws.runQuickAction('title')
    await vi.waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'title', action: 'title' }),
        expect.anything()
      )
    })
  })

  it('runQuickAction professional 以 content 为目标调用 generateArticlePatch', async () => {
    const ws = useAgentWorkspace()
    ws.runQuickAction('professional')
    await vi.waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'content' }),
        expect.anything()
      )
    })
  })

  it('未知快速动作静默返回', () => {
    const ws = useAgentWorkspace()
    expect(() => ws.runQuickAction('not_a_key' as never)).not.toThrow()
  })
})

describe('检索动作', () => {
  it('searchArticles 空关键词时提示错误', async () => {
    const ws = useAgentWorkspace()
    ws.searchArticles('   ')
    await vi.waitFor(() => {
      expect(ws.messages.some(m => m.type === 'error')).toBe(true)
    })
    expect(mockSearchArticles).not.toHaveBeenCalled()
  })

  it('searchArticles 命中站内检索并产出 article_search 消息', async () => {
    mockSearchArticles.mockResolvedValue({ items: [{ id: 'a1', title: 'x' }], total: 1, page: 1, pageSize: 5 })
    const ws = useAgentWorkspace()
    ws.searchArticles('vue')
    await vi.waitFor(() => {
      expect(ws.messages.some(m => m.type === 'article_search')).toBe(true)
    })
  })

  it('searchKnowledge 空关键词时提示错误', async () => {
    const ws = useAgentWorkspace()
    ws.searchKnowledge('')
    await vi.waitFor(() => {
      expect(ws.messages.some(m => m.type === 'error')).toBe(true)
    })
    expect(mockKnowledge).not.toHaveBeenCalled()
  })

  it('searchKnowledge 产出 knowledge_search 消息', async () => {
    const ws = useAgentWorkspace()
    ws.searchKnowledge('组合式 API')
    await vi.waitFor(() => {
      expect(ws.messages.some(m => m.type === 'knowledge_search')).toBe(true)
    })
  })
})

describe('补丁重生成与重试', () => {
  it('regeneratePatch 将补丁置为 rejected 并重新生成', async () => {
    const ws = useAgentWorkspace()
    ws.messages.push(msg({ id: 'pm', type: 'article_patch', payload: [patch] }))
    ws.runQuickAction('professional')
    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    ws.regeneratePatch('p1')
    await vi.waitFor(() => {
      expect(ws.currentPatches[0].status).toBe('rejected')
      expect(mockPatch).toHaveBeenCalledTimes(2)
    })
  })

  it('retry 重放最近一次任务', async () => {
    const ws = useAgentWorkspace()
    ws.runQuickAction('title')
    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    ws.retry()
    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2))
  })

  it('无历史任务时 retry 不动作', () => {
    const ws = useAgentWorkspace()
    expect(() => ws.retry()).not.toThrow()
    expect(mockPatch).not.toHaveBeenCalled()
  })
})

describe('停止生成', () => {
  it('stopGeneration 不抛错', () => {
    const ws = useAgentWorkspace()
    expect(() => ws.stopGeneration()).not.toThrow()
  })
})
