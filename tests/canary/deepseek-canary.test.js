// tests/canary/deepseek-canary.js
// DeepSeek 连通性哨兵测试（Canary）。
//
// 这是唯一允许真实消耗 DeepSeek 额度的测试：用最小输出做一次连通性检查，
// 用于在发布前快速验证密钥有效、网络可达、模型可响应。
//
// 安全约束：
//   - 未配置 DEEPSEEK_API_KEY 时自动 skip，不报错、不消耗额度；
//   - 任何情况下绝不把密钥打印到日志 / 断言信息 / 测试输出；
//   - 依赖 deepseekClient 的 classifyAiError 脱敏，失败信息不会携带原始请求体。

require('dotenv').config()

const test = require('node:test')
const assert = require('node:assert')
const deepseek = require('../../server/ai/deepseekClient')

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

test(
  'DeepSeek Canary：真实连通性与最小额度消耗',
  { skip: !hasKey && '未配置 DEEPSEEK_API_KEY，跳过 Canary' },
  async () => {
    // 30s 超时兜底，避免网络异常时无限挂起
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30 * 1000)
    try {
      const reply = await deepseek.chat({
        instructions: '你是连通性测试助手，无论输入什么，只回复两个字母：ok',
        input: 'ping',
        // 说明：DEEPSEEK_MODEL 指向的 deepseek-flash 为推理模型，会先产出 reasoning 内容，
        // 其 token 计入 max_output_tokens；8 会触发 status=incomplete（推理未完成即截断）。
        // 256 仍属「最小额度」，但足以容纳推理 + 最终回答。
        maxOutputTokens: 256,
        signal: controller.signal
      })
      assert.ok(typeof reply === 'string', '回复必须是字符串')
      assert.ok(reply.trim().length > 0, '回复不能为空')
    } finally {
      clearTimeout(timer)
    }
  }
)
