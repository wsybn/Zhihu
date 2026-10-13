// src/utils/patchApply.ts
// 文章修改建议 / 审查建议的「应用」纯逻辑，从 CreatePosts.vue 抽出以便单测。
//
// 核心安全约束（与产品要求一致）：
//   - AI 绝不自动覆盖文章正文，所有修改都必须由用户点击「接受」后，经本模块精确匹配才落盘；
//   - 仅当 originalText 在正文中「唯一出现」时才自动替换，多处出现或找不到时拒绝并提示，防止误替换。

import type { ArticlePatch, ReviewIssue } from '../types/agent'

// 计算 needle 在 source 中出现的次数（用于唯一性判断）
export function countOccurrences(source: string, needle: string): number {
  if (!needle) return 0
  return source.split(needle).length - 1
}

export interface PatchApplyContext {
  getTitle: () => string
  setTitle: (value: string) => void
  getContent: () => string
  setContent: (value: string) => void
  // 是否有选中内容，及当前选中文本
  hasSelection: () => boolean
  getSelection: () => string
  // 替换选中区域（或追加到正文末尾）
  replaceSelection: (text: string) => void
  notify: (message: string, type: 'success' | 'error') => void
}

export function applyPatch(patch: ArticlePatch, ctx: PatchApplyContext): boolean {
  // 标题类建议
  if (patch.target === 'title') {
    if (patch.operation === 'replace') {
      if (patch.originalText && ctx.getTitle() !== patch.originalText) {
        ctx.notify('标题已发生变化，请重新生成建议', 'error')
        return false
      }
      ctx.setTitle(patch.proposedText)
    } else {
      ctx.setTitle((ctx.getTitle() ? ctx.getTitle() + ' ' : '') + patch.proposedText)
    }
    return true
  }

  // 追加：直接追加到正文末尾
  if (patch.operation === 'append') {
    ctx.setContent(ctx.getContent() ? ctx.getContent() + '\n\n' + patch.proposedText : patch.proposedText)
    return true
  }

  // 选中内容替换：优先替换当前选中区域
  if (patch.target === 'selection') {
    if (ctx.hasSelection()) {
      const selected = ctx.getSelection()
      if (patch.originalText && selected !== patch.originalText) {
        ctx.notify('当前选中内容与建议原文不一致，请重新生成建议', 'error')
        return false
      }
      ctx.replaceSelection(patch.proposedText)
      return true
    }
  }

  // 正文精确替换：originalText 唯一出现才替换
  if (!patch.originalText) {
    ctx.notify('该建议缺少原文，无法自动应用', 'error')
    return false
  }
  const count = countOccurrences(ctx.getContent(), patch.originalText)
  if (count === 1) {
    ctx.setContent(ctx.getContent().replace(patch.originalText, patch.proposedText))
    return true
  } else if (count > 1) {
    ctx.notify('原文在正文中出现多处，请先选中目标区域再润色', 'error')
  } else {
    ctx.notify('未在正文中找到原文，无法自动替换', 'error')
  }
  return false
}

export interface ReviewApplyContext {
  getContent: () => string
  setContent: (value: string) => void
  notify: (message: string, type: 'success' | 'error') => void
}

export function applyReviewIssue(issue: ReviewIssue, ctx: ReviewApplyContext): boolean {
  if (!issue.replacement) return false
  const original = issue.originalText
  if (!original) return false
  const count = countOccurrences(ctx.getContent(), original)
  if (count === 1) {
    ctx.setContent(ctx.getContent().replace(original, issue.replacement))
    return true
  } else if (count > 1) {
    ctx.notify('该片段在正文中出现多处，请手动修改', 'error')
  } else {
    ctx.notify('未在正文中找到对应片段', 'error')
  }
  return false
}
