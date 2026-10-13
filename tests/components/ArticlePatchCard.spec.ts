// tests/components/ArticlePatchCard.spec.ts
// 文章修改建议卡片：渲染 / 目标标签 / 接受拒绝重新生成事件。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ArticlePatchCard from '../../src/components/agent/ArticlePatchCard.vue'
import type { ArticlePatch } from '../../src/types/agent'

function makePatch(overrides: Partial<ArticlePatch> = {}): ArticlePatch {
  return {
    id: 'p1',
    target: 'content',
    operation: 'replace',
    originalText: '旧',
    proposedText: '新',
    reason: '更清晰',
    status: 'pending',
    ...overrides
  }
}

describe('ArticlePatchCard', () => {
  it('渲染原文 / 建议 / 原因', () => {
    const wrapper = mount(ArticlePatchCard, { props: { patch: makePatch() } })
    expect(wrapper.text()).toContain('旧')
    expect(wrapper.text()).toContain('新')
    expect(wrapper.text()).toContain('更清晰')
  })

  it('按 target 显示中文标签', () => {
    const cases: Array<[ArticlePatch['target'], string]> = [
      ['title', '标题'],
      ['content', '正文'],
      ['selection', '选中内容']
    ]
    for (const [target, label] of cases) {
      const wrapper = mount(ArticlePatchCard, { props: { patch: makePatch({ target }) } })
      expect(wrapper.find('.badge').text()).toBe(label)
    }
  })

  it('pending 状态点击接受/拒绝触发对应事件', async () => {
    const wrapper = mount(ArticlePatchCard, { props: { patch: makePatch() } })
    const buttons = wrapper.findAll('button')
    const accept = buttons.find(b => b.text() === '接受')
    const reject = buttons.find(b => b.text() === '拒绝')
    expect(accept).toBeTruthy()
    expect(reject).toBeTruthy()

    await accept!.trigger('click')
    expect(wrapper.emitted('accept')![0][0]).toMatchObject({ id: 'p1' })

    await reject!.trigger('click')
    expect(wrapper.emitted('reject')![0][0]).toMatchObject({ id: 'p1' })
  })

  it('已接受后不再显示接受/拒绝按钮', () => {
    const wrapper = mount(ArticlePatchCard, { props: { patch: makePatch({ status: 'accepted' }) } })
    const text = wrapper.text()
    expect(text).toContain('已接受')
    expect(wrapper.findAll('button').some(b => b.text() === '接受')).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text() === '拒绝')).toBe(false)
  })
})
