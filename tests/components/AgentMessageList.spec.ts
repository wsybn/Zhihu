// tests/components/AgentMessageList.spec.ts
// 消息列表：空状态 / 用户消息 / 助手消息 / 错误重试。
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentMessageList from '../../src/components/agent/AgentMessageList.vue'
import type { AgentMessage } from '../../src/types/agent'

function makeMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'assistant',
    type: 'text',
    content: '',
    createdAt: '',
    ...partial
  }
}

// 构造组件需要的极简 workspace（只提供被渲染分支访问的字段与方法）
function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    isGenerating: false,
    outlineAccepted: false,
    selectedOutlineTitle: '',
    reviewIssueStates: {},
    retry: vi.fn(),
    selectOutlineTitle: vi.fn(),
    acceptOutline: vi.fn(),
    rejectOutline: vi.fn(),
    regenerateOutline: vi.fn(),
    insertOutline: vi.fn(),
    acceptAllSafeIssues: vi.fn(),
    acceptReviewIssue: vi.fn(),
    ignoreReviewIssue: vi.fn(),
    locateReviewIssue: vi.fn(),
    acceptPatch: vi.fn(),
    rejectPatch: vi.fn(),
    regeneratePatch: vi.fn(),
    ...overrides
  }
}

describe('AgentMessageList', () => {
  it('无消息时显示引导文案', () => {
    const wrapper = mount(AgentMessageList, { props: { workspace: makeWorkspace() } })
    expect(wrapper.text()).toContain('我是你的 AI 创作助手')
  })

  it('渲染用户消息', () => {
    const wrapper = mount(AgentMessageList, {
      props: {
        workspace: makeWorkspace({
          messages: [makeMessage({ id: 'u1', role: 'user', type: 'text', content: '帮我写标题' })]
        })
      }
    })
    expect(wrapper.find('.user-bubble').text()).toBe('帮我写标题')
  })

  it('渲染助手文本消息', () => {
    const wrapper = mount(AgentMessageList, {
      props: {
        workspace: makeWorkspace({
          messages: [makeMessage({ id: 'a1', role: 'assistant', type: 'text', content: '好的' })]
        })
      }
    })
    expect(wrapper.find('.assistant-bubble').text()).toContain('好的')
  })

  it('渲染错误消息并提供重试按钮', async () => {
    const retry = vi.fn()
    const wrapper = mount(AgentMessageList, {
      props: {
        workspace: makeWorkspace({
          retry,
          messages: [makeMessage({ id: 'e1', role: 'assistant', type: 'error', content: 'AI 请求失败' })]
        })
      }
    })
    expect(wrapper.find('.error-bubble').text()).toContain('AI 请求失败')
    const btn = wrapper.find('button')
    expect(btn.text()).toBe('重试')
    await btn.trigger('click')
    expect(retry).toHaveBeenCalled()
  })
})
