// 组件测试统一 setup：补齐 jsdom 缺失的浏览器 API。
import { vi } from 'vitest'

// jsdom 默认没有 navigator.clipboard，ArticlePatchCard 复制按钮会用到
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })
}

// 组件里的打字动画 / 滚动依赖这些 API，jsdom 缺失时静默兜底
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia
}
