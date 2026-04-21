import axios, {
  AxiosAdapter,
  AxiosRequestHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import { testData, testPosts } from '../testData'

const columns = testData
const posts = testPosts.map(post => ({
  _id: post.id.toString(),
  title: post.title,
  excerpt: post.content?.slice(0, 80),
  content: post.content,
  createdAt: post.createdAt,
  column: post.columnId.toString()
}))

const mockUser = {
  _id: '1',
  name: 'Mocked User',
  email: 'mock@zhihu.local',
  columnId: 1
}

const mockToken = 'mock-token-123'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const parsePayload = (data: unknown) => {
  if (!data) return {}
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return {}
    }
  }
  return data
}

const buildResponse = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: (config.headers ?? {}) as AxiosRequestHeaders,
  config
})

let mocked = false

export const setupMock = () => {
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  if (mocked) {
    return
  }

  const originalAdapter = axios.defaults.adapter as AxiosAdapter | undefined

  axios.defaults.adapter = async config => {
    const url = (config.url ?? '').replace(/^\/+/, '')
    const method = (config.method ?? 'get').toLowerCase()

    if (method === 'get') {
      if (url === 'columns') {
        return delay(200).then(() =>
          buildResponse(config, {
            data: {
              list: columns
            }
          })
        )
      }

      const columnMatch = url.match(/^columns\/([0-9a-zA-Z_-]+)$/)
      if (columnMatch) {
        const found = columns.find(column => column._id === columnMatch[1])
        return delay(150).then(() =>
          buildResponse(config, {
            data: found
          })
        )
      }

      const postsMatch = url.match(/^columns\/([0-9a-zA-Z_-]+)\/posts$/)
      if (postsMatch) {
        const filtered = posts.filter(post => post.column === postsMatch[1])
        return delay(250).then(() =>
          buildResponse(config, {
            data: {
              list: filtered
            }
          })
        )
      }

      // 新增：获取当前登录用户信息
      if (url === 'user/current') {
        // 这里简单处理，不校验 token，直接返回 mockUser
        return delay(150).then(() =>
          buildResponse(config, {
            data: mockUser
          })
        )
      }
    }

    const createPostMatch = url.match(/^columns\/([0-9a-zA-Z_-]+)\/posts$/)
    if (method === 'post' && createPostMatch) {
      const payload = parsePayload(config.data)
      if (payload.title && payload.content) {
        const newPost = {
          _id: String(Date.now()),
          title: payload.title,
          excerpt: payload.content?.slice(0, 80),
          content: payload.content,
          createdAt: new Date().toISOString(),
          column: createPostMatch[1]
        }
        posts.push(newPost)
        return delay(150).then(() =>
          buildResponse(config, {
            data: newPost
          })
        )
      }
      return delay(100).then(() =>
        buildResponse(config, {
          code: 400,
          error: 'Missing required fields'
        })
      )
    }

    if (method === 'post' && url === 'user/login') {
      const payload = parsePayload(config.data)
      if (payload.email && payload.password) {
        return delay(200).then(() =>
          buildResponse(config, {
            data: {
              token: mockToken,
              ...mockUser
            }
          })
        )
      }
      return delay(100).then(() =>
        buildResponse(config, {
          code: 400,
          error: 'Missing credentials'
        })
      )
    }

    if (originalAdapter && typeof originalAdapter === 'function') {
      return originalAdapter(config)
    }
    return Promise.reject(new Error('No adapter available to handle request'))
  }

  mocked = true
}
