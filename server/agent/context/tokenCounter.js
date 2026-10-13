// 保守 Token 估算器。它不是特定模型 tokenizer，但会把中文按字符计数，
// 避免常见的 length / 4 对中文造成严重低估；未来可替换实现而不影响调用方。

function safeStableStringify(value) {
  const seen = new WeakSet()
  try {
    const json = JSON.stringify(value, (key, current) => {
      if (typeof current === 'bigint') return `${current}n`
      if (typeof current === 'function' || typeof current === 'symbol') return undefined
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
        if (!Array.isArray(current)) {
          return Object.keys(current).sort().reduce((out, childKey) => {
            out[childKey] = current[childKey]
            return out
          }, {})
        }
      }
      return current
    })
    return json === undefined ? String(value) : json
  } catch (e) {
    try { return String(value) } catch (error) { return '[Unserializable]' }
  }
}

function estimateTextTokens(text) {
  const value = text === undefined || text === null ? '' : String(text)
  let tokens = 0
  let asciiRun = 0
  const flushAscii = () => {
    if (asciiRun > 0) {
      // 3 个英文、数字或常见空白/符号约为 1 token，并向上取整。
      tokens += Math.ceil(asciiRun / 3)
      asciiRun = 0
    }
  }

  for (const char of value) {
    const code = char.codePointAt(0)
    const isCjk = (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    )
    if (isCjk) {
      flushAscii()
      tokens += 1
    } else {
      asciiRun += 1
    }
  }
  flushAscii()
  return Math.max(0, Math.floor(tokens))
}

function estimateValueTokens(value) {
  return estimateTextTokens(typeof value === 'string' ? value : safeStableStringify(value))
}

function estimateMessageTokens(message) {
  if (!message || typeof message !== 'object') return Math.max(1, estimateValueTokens(message))
  const role = message.role || ''
  const content = message.content === undefined ? message : message.content
  return Math.max(1, 4 + estimateTextTokens(role) + estimateValueTokens(content))
}

function estimateMessagesTokens(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

function truncateTextToTokens(text, maxTokens) {
  const value = text === undefined || text === null ? '' : String(text)
  const budget = Math.max(0, Number.isFinite(Number(maxTokens)) ? Math.floor(Number(maxTokens)) : 0)
  if (budget === 0) return ''
  if (estimateTextTokens(value) <= budget) return value

  let result = ''
  let tokens = 0
  for (const char of value) {
    const next = result + char
    const nextTokens = estimateTextTokens(next)
    if (nextTokens > budget) break
    result = next
    tokens = nextTokens
  }
  return tokens >= budget ? result : `${result}…`
}

function truncateValueToTokens(value, maxTokens) {
  const budget = Math.max(0, Number.isFinite(Number(maxTokens)) ? Math.floor(Number(maxTokens)) : 0)
  if (typeof value === 'string') return truncateTextToTokens(value, budget)
  const serialized = safeStableStringify(value)
  if (estimateTextTokens(serialized) <= budget) return value
  const clipped = truncateTextToTokens(serialized, budget)
  try { return JSON.parse(clipped) } catch (e) { return clipped }
}

module.exports = {
  safeStableStringify,
  estimateTextTokens,
  estimateValueTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  truncateTextToTokens,
  truncateValueToTokens
}
