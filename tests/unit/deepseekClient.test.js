// tests/unit/deepseekClient.test.js
// DeepSeek 返回结构解析：extractResponseText 的兼容性单测。
// 覆盖 output_text 优先、message.output_text/text 回退、reasoning 跳过、空响应等路径，
// 全部为纯函数测试，不消耗真实额度。

const test = require('node:test')
const assert = require('node:assert')
const { extractResponseText } = require('../../server/ai/deepseekClient')

test('extractResponseText：优先读取非空 output_text 并 trim', () => {
  const text = extractResponseText({ output_text: '  你好世界  ' })
  assert.equal(text, '你好世界')
})

test('extractResponseText：output_text 为空字符串时回退到 message 片段', () => {
  const text = extractResponseText({
    output_text: '',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '回退文本' }] }]
  })
  assert.equal(text, '回退文本')
})

test('extractResponseText：output_text 仅空白时回退到 message 片段', () => {
  const text = extractResponseText({
    output_text: '   ',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '  ' }, { type: 'output_text', text: '内容' }] }]
  })
  assert.equal(text, '  内容'.trim())
})

test('extractResponseText：跳过 reasoning 片段，只取 message 文本', () => {
  const text = extractResponseText({
    output_text: '',
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: '这是思考过程' }] },
      { type: 'message', content: [{ type: 'output_text', text: '最终答案' }] }
    ]
  })
  assert.equal(text, '最终答案')
})

test('extractResponseText：兼容 part.type === "text" 的片段', () => {
  const text = extractResponseText({
    output_text: '',
    output: [{ type: 'message', content: [{ type: 'text', text: '兼容片段' }] }]
  })
  assert.equal(text, '兼容片段')
})

test('extractResponseText：多片段拼接（join 不留分隔符）', () => {
  const text = extractResponseText({
    output_text: '',
    output: [
      { type: 'message', content: [{ type: 'output_text', text: '前半' }] },
      { type: 'message', content: [{ type: 'output_text', text: '后半' }] }
    ]
  })
  assert.equal(text, '前半后半')
})

test('extractResponseText：无 output 且无 output_text 返回空串', () => {
  assert.equal(extractResponseText({}), '')
  assert.equal(extractResponseText({ output: [] }), '')
})

test('extractResponseText：response 为 null/undefined 返回空串', () => {
  assert.equal(extractResponseText(null), '')
  assert.equal(extractResponseText(undefined), '')
})

test('extractResponseText：仅含 reasoning 无 message 时返回空串（不误取思考过程）', () => {
  const text = extractResponseText({
    output_text: '',
    output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: '只有思考' }] }]
  })
  assert.equal(text, '')
})
