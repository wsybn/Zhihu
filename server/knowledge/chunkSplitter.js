// server/knowledge/chunkSplitter.js
// 把文章正文清理（Markdown/HTML）后按段落切分为 Chunk。
// 设计为后续可替换（如按 token 切分、带语义边界）。

// 清理 Markdown / HTML，得到纯文本
function cleanText(content) {
  if (!content) return ''
  let text = String(content)
  // 去掉 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')
  // 去掉 Markdown 代码块围栏与常见语法符号
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/^#{1,6}\s*/gm, '')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/[*_~|>-]/g, ' ')
  // 合并空白与换行
  text = text.replace(/\r\n?/g, '\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

// 把纯文本按段落切分为 Chunk。
// maxChars 控制单块最大字符数；overlapChars 控制块间重叠，保留上下文。
function splitIntoChunks(text, { maxChars = 600, overlapChars = 60 } = {}) {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  const paragraphs = cleaned
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  const chunks = []
  let buffer = ''
  for (const para of paragraphs) {
    if ((buffer + '\n' + para).trim().length > maxChars && buffer) {
      chunks.push(buffer.trim())
      // 重叠：保留上一块末尾一段，避免语义断裂
      if (overlapChars > 0) {
        const overlap = buffer.trim().slice(-overlapChars)
        buffer = overlap
      } else {
        buffer = ''
      }
    }
    buffer = buffer ? buffer + '\n' + para : para
  }
  if (buffer.trim()) chunks.push(buffer.trim())

  // 兜底：若仍无 chunk（如无换行的长文本），按 maxChars 硬切
  if (chunks.length === 0 && cleaned.length > 0) {
    for (let i = 0; i < cleaned.length; i += maxChars) {
      chunks.push(cleaned.slice(i, i + maxChars).trim())
    }
  }
  return chunks.filter(Boolean)
}

module.exports = {
  cleanText,
  splitIntoChunks
}
