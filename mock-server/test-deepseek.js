require('dotenv').config()

const OpenAI = require('openai')

const apiKey = process.env.DEEPSEEK_API_KEY
const baseURL =
  process.env.DEEPSEEK_BASE_URL ||
  'https://api.deepseek.com'
const model =
  process.env.DEEPSEEK_MODEL ||
  'deepseek-flash'

if (!apiKey) {
  console.error('错误：没有读取到 DEEPSEEK_API_KEY')
  process.exit(1)
}

const client = new OpenAI({
  apiKey,
  baseURL
})

async function main() {
  console.log('正在测试 DeepSeek API...')
  console.log('API 地址：', baseURL)
  console.log('模型：', model)

  const response = await client.responses.create({
    model,
    instructions: '你是一个中文技术内容助手，请简洁回答。',
    input: '请用一句话说明 Vue 3 Composition API 的作用。',
    max_output_tokens: 300
  })

  console.log('\nDeepSeek 返回：')
  console.log(response.output_text)

  console.log('\nToken 使用：')
  console.log(response.usage)
}

main().catch(error => {
  console.error('\nDeepSeek API 调用失败')

  if (error.status === 401) {
    console.error('原因：API Key 无效或未正确读取')
  } else if (error.status === 402) {
    console.error('原因：账户余额不足')
  } else if (error.status === 429) {
    console.error('原因：请求频率过高、额度不足或触发限流')
  } else if (error.status) {
    console.error('HTTP 状态：', error.status)
    console.error('错误信息：', error.message)
  } else {
    console.error('网络或本地错误：', error.message)
  }

  process.exit(1)
})
