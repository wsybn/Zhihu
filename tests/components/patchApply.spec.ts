// tests/components/patchApply.spec.ts
// 补丁 / 审查建议「应用」纯逻辑：唯一匹配才替换、拒绝多处匹配、标题守卫等安全约束。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { countOccurrences, applyPatch, applyReviewIssue } from '../../src/utils/patchApply'
import type { PatchApplyContext, ReviewApplyContext } from '../../src/utils/patchApply'
import type { ArticlePatch, ReviewIssue } from '../../src/types/agent'

function makeContext(initial: { title?: string; content?: string; selection?: string } = {}) {
  const state = { title: initial.title ?? '', content: initial.content ?? '', selection: initial.selection ?? '' }
  const notify = vi.fn()
  const ctx: PatchApplyContext & { notify: ReturnType<typeof vi.fn> } = {
    getTitle: () => state.title,
    setTitle: v => { state.title = v },
    getContent: () => state.content,
    setContent: v => { state.content = v },
    hasSelection: () => state.selection !== '',
    getSelection: () => state.selection,
    replaceSelection: text => { state.content = text },
    notify
  }
  return { ctx, state, notify }
}

function makePatch(partial: Partial<ArticlePatch> = {}): ArticlePatch {
  return { id: 'p1', target: 'content', operation: 'replace', proposedText: 'B', reason: 'r', status: 'pending', ...partial }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('countOccurrences', () => {
  it('统计出现次数', () => {
    expect(countOccurrences('aa bb aa', 'aa')).toBe(2)
    expect(countOccurrences('hello', 'x')).toBe(0)
    expect(countOccurrences('', 'a')).toBe(0)
    expect(countOccurrences('abc', '')).toBe(0)
  })
})

describe('applyPatch — 标题', () => {
  it('replace 且原文匹配时替换标题', () => {
    const { ctx, state } = makeContext({ title: '旧标题' })
    expect(applyPatch(makePatch({ target: 'title', operation: 'replace', originalText: '旧标题', proposedText: '新标题' }), ctx)).toBe(true)
    expect(state.title).toBe('新标题')
  })

  it('replace 且原文不一致时拒绝并提示', () => {
    const { ctx, state, notify } = makeContext({ title: '已变化的标题' })
    expect(applyPatch(makePatch({ target: 'title', operation: 'replace', originalText: '旧标题', proposedText: '新标题' }), ctx)).toBe(false)
    expect(state.title).toBe('已变化的标题')
    expect(notify).toHaveBeenCalledWith('标题已发生变化，请重新生成建议', 'error')
  })

  it('append 追加标题', () => {
    const { ctx, state } = makeContext({ title: '原' })
    expect(applyPatch(makePatch({ target: 'title', operation: 'append', proposedText: '续' }), ctx)).toBe(true)
    expect(state.title).toBe('原 续')
  })

  it('append 空标题时不额外加空格', () => {
    const { ctx, state } = makeContext({ title: '' })
    expect(applyPatch(makePatch({ target: 'title', operation: 'append', proposedText: '新' }), ctx)).toBe(true)
    expect(state.title).toBe('新')
  })
})

describe('applyPatch — 正文', () => {
  it('append 追加到正文末尾', () => {
    const { ctx, state } = makeContext({ content: 'A' })
    expect(applyPatch(makePatch({ target: 'content', operation: 'append', proposedText: 'B' }), ctx)).toBe(true)
    expect(state.content).toBe('A\n\nB')
  })

  it('append 空正文时直接写入', () => {
    const { ctx, state } = makeContext({ content: '' })
    expect(applyPatch(makePatch({ target: 'content', operation: 'append', proposedText: 'B' }), ctx)).toBe(true)
    expect(state.content).toBe('B')
  })

  it('originalText 唯一出现时精确替换', () => {
    const { ctx, state } = makeContext({ content: 'hello world' })
    expect(applyPatch(makePatch({ originalText: 'world', proposedText: 'vue' }), ctx)).toBe(true)
    expect(state.content).toBe('hello vue')
  })

  it('originalText 多处出现时拒绝并提示', () => {
    const { ctx, state, notify } = makeContext({ content: 'a b a' })
    expect(applyPatch(makePatch({ originalText: 'a', proposedText: 'c' }), ctx)).toBe(false)
    expect(state.content).toBe('a b a')
    expect(notify).toHaveBeenCalledWith('原文在正文中出现多处，请先选中目标区域再润色', 'error')
  })

  it('originalText 找不到时拒绝并提示', () => {
    const { ctx, state, notify } = makeContext({ content: 'abc' })
    expect(applyPatch(makePatch({ originalText: 'zzz', proposedText: 'c' }), ctx)).toBe(false)
    expect(state.content).toBe('abc')
    expect(notify).toHaveBeenCalledWith('未在正文中找到原文，无法自动替换', 'error')
  })

  it('缺少 originalText 时拒绝', () => {
    const { ctx, state, notify } = makeContext({ content: 'abc' })
    expect(applyPatch(makePatch({ operation: 'replace', proposedText: 'c' }), ctx)).toBe(false)
    expect(state.content).toBe('abc')
    expect(notify).toHaveBeenCalledWith('该建议缺少原文，无法自动应用', 'error')
  })
})

describe('applyPatch — 选中替换', () => {
  it('选中内容替换', () => {
    const { ctx, state } = makeContext({ content: '全文', selection: '选中片段' })
    expect(applyPatch(makePatch({ target: 'selection', originalText: '选中片段', proposedText: '替换' }), ctx)).toBe(true)
    expect(state.content).toBe('替换')
  })

  it('选中内容与原文不一致时拒绝', () => {
    const { ctx, state, notify } = makeContext({ content: '全文', selection: '其他' })
    expect(applyPatch(makePatch({ target: 'selection', originalText: '选中片段', proposedText: '替换' }), ctx)).toBe(false)
    expect(state.content).toBe('全文')
    expect(notify).toHaveBeenCalledWith('当前选中内容与建议原文不一致，请重新生成建议', 'error')
  })

  it('目标为 selection 但无选中时回退到正文精确匹配', () => {
    const { ctx, state } = makeContext({ content: 'hello world', selection: '' })
    expect(applyPatch(makePatch({ target: 'selection', originalText: 'world', proposedText: 'vue' }), ctx)).toBe(true)
    expect(state.content).toBe('hello vue')
  })
})

describe('applyReviewIssue', () => {
  function reviewCtx(content: string) {
    const state = { content }
    const notify = vi.fn()
    const ctx: ReviewApplyContext = {
      getContent: () => state.content,
      setContent: v => { state.content = v },
      notify
    }
    return { ctx, state, notify }
  }

  it('唯一匹配时替换', () => {
    const issue: ReviewIssue = { id: 'i1', category: 'grammar', severity: 'warning', originalText: 'bad', replacement: 'good', message: 'm' }
    const { ctx, state } = reviewCtx('a bad word')
    expect(applyReviewIssue(issue, ctx)).toBe(true)
    expect(state.content).toBe('a good word')
  })

  it('多处匹配时拒绝', () => {
    const issue: ReviewIssue = { id: 'i1', category: 'grammar', severity: 'warning', originalText: 'bad', replacement: 'good', message: 'm' }
    const { ctx, state, notify } = reviewCtx('bad bad')
    expect(applyReviewIssue(issue, ctx)).toBe(false)
    expect(state.content).toBe('bad bad')
    expect(notify).toHaveBeenCalledWith('该片段在正文中出现多处，请手动修改', 'error')
  })

  it('找不到对应片段时拒绝', () => {
    const issue: ReviewIssue = { id: 'i1', category: 'grammar', severity: 'warning', originalText: 'bad', replacement: 'good', message: 'm' }
    const { ctx, state, notify } = reviewCtx('nothing here')
    expect(applyReviewIssue(issue, ctx)).toBe(false)
    expect(state.content).toBe('nothing here')
    expect(notify).toHaveBeenCalledWith('未在正文中找到对应片段', 'error')
  })

  it('缺少 replacement 或 originalText 时不动作', () => {
    const noReplacement: ReviewIssue = { id: 'i1', category: 'structure', severity: 'info', message: '仅提示' }
    const noOriginal: ReviewIssue = { id: 'i2', category: 'grammar', severity: 'warning', replacement: 'x', message: 'm' }
    const { ctx, state } = reviewCtx('abc')
    expect(applyReviewIssue(noReplacement, ctx)).toBe(false)
    expect(applyReviewIssue(noOriginal, ctx)).toBe(false)
    expect(state.content).toBe('abc')
  })
})
