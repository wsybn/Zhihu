// mock-server/fakeAiClient.js
// AI_PROVIDER=fake 时注入的假 DeepSeek 客户端。
// 返回确定性输出，覆盖 chat / chatJson / chatStream / chatWithTools 四类调用路径，
// 不消耗真实 DeepSeek 额度，专供 E2E / 集成测试使用。

const FAKE_REPLY = '这是 Fake AI Provider 生成的测试回答。'

// chatJson 结构化输出：同时满足「选题建议」与「系列分类」两类 schema，
// 供 E2E 首页自动加载的 TopicSuggestionCard / SeriesClassificationCard 消费。
// 校验器只读取 schema 中声明的字段，多余字段会被忽略，因此可复用同一份 JSON。
const FAKE_JSON_REPLY = JSON.stringify({
  topics: [{ title: 'Fake 选题', reason: '基于历史文章生成', relatedTo: '' }],
  series: [{ name: 'Fake 系列', articleIds: ['fake-1', 'fake-2'] }]
})

// 把文本转成 DeepSeek 流式事件 async 迭代器（逐字输出，模拟真实 SSE 观感）
function makeTextStream(text) {
  return (async function* () {
    for (const ch of text) {
      yield { type: 'response.output_text.delta', delta: ch }
    }
  })()
}

function createFakeClient({ reply = FAKE_REPLY } = {}) {
  return {
    responses: {
      create: async (params) => {
        // chatJson 会要求「只返回合法 JSON」，此时返回结构化 JSON 而非纯文本
        const jsonMode = /返回合法 JSON/.test(String(params.instructions || ''))
        const text = jsonMode ? FAKE_JSON_REPLY : reply
        if (params.stream) {
          return makeTextStream(text)
        }
        return {
          output: [
            { type: 'message', content: [{ type: 'output_text', text }] }
          ],
          output_text: text
        }
      }
    }
  }
}

module.exports = { createFakeClient, FAKE_REPLY }
