// HTML Sanitization：marked / AI 返回的 Markdown 与文本都不可信，
// 渲染到 v-html 前必须经过白名单过滤，防止 XSS。

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
  'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div', 'figure', 'figcaption'
])

// 完全移除（连同内容）的危险标签
const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'link', 'style', 'meta', 'base',
  'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'source',
  'svg', 'math', 'template'
])

// 允许出现的属性（按标签细分）
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  '*': ['class']
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  if (trimmed === '') return false
  if (/^(javascript|vbscript|data|file):/.test(trimmed)) return false
  if (trimmed.startsWith('//')) return true
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) return true
  return /^https?:\/\//.test(trimmed)
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el)
  }
  parent.removeChild(el)
}

function sanitizeAttributes(node: Element): void {
  Array.from(node.children).forEach(child => sanitizeAttributes(child))

  Array.from(node.attributes).forEach(attr => {
    const name = attr.name.toLowerCase()
    // 移除所有事件属性与 style（style 可注入 expression）
    if (name.startsWith('on') || name === 'style') {
      node.removeAttribute(attr.name)
      return
    }
    const tagAllowed = ALLOWED_ATTRS[node.tagName.toLowerCase()] || []
    const globallyAllowed = ALLOWED_ATTRS['*'] || []
    if (!tagAllowed.includes(name) && !globallyAllowed.includes(name)) {
      node.removeAttribute(attr.name)
      return
    }
    if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
      node.removeAttribute(attr.name)
    }
  })
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body

  // 1. 完全移除危险标签（连同内容）
  const blocked = Array.from(
    body.querySelectorAll(Array.from(BLOCKED_TAGS).join(','))
  )
  blocked.forEach(el => el.remove())

  // 2. 移除不在白名单的标签（保留其文本内容）
  const unwrapUnknown = (node: Node): void => {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        unwrapUnknown(el)
        if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
          unwrapElement(el)
        }
      }
    })
  }
  unwrapUnknown(body)

  // 3. 清理属性
  sanitizeAttributes(body)

  return body.innerHTML
}

// HTML 转义：用于搜索关键词高亮等场景，避免把用户输入直接插进 HTML
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
