// 统一 Axios 实例：AI / 文章搜索等新增 service 层共用。
// 与 src/main.ts 中的全局 axios 相互独立，避免 AI 请求触发全局 loading 遮罩。
// 旧模块（store.ts / Uploader 等）仍使用全局 axios，后续可逐步迁移到这里。

import axios, { AxiosInstance } from 'axios'

// 后端地址由构建期环境变量 VUE_APP_API_BASE_URL 注入，绝不写死 localhost。
// 未配置时退化为同源相对路径（生产环境一般由反向代理同域转发）。
export const API_BASE_URL = (process.env.VUE_APP_API_BASE_URL || '').replace(/\/+$/, '')

// 后端统一错误对象（server/ai/error.js -> AppError.toResponse()）：
//   { success:false, error:{ code, message, retryable, requestId } }
export interface ApiError {
  code: number // HTTP 状态码
  error: string // 用户可读的错误信息
  errorCode?: string // 业务错误码，如 AI_RATE_LIMITED / VALIDATION_FAILED
  retryable?: boolean
  requestId?: string
}

export interface ApiResponse<T = unknown> {
  code: number
  msg?: string
  data: T
  error?: string
}

const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL ? `${API_BASE_URL}/` : '/',
  timeout: 30000
})

http.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  resp => resp,
  error => {
    const respData = error?.response?.data
    const errBody = respData?.error
    const isStructured = typeof errBody === 'object' && errBody !== null
    const apiError: ApiError = {
      code: error?.response?.status ?? 0,
      error: isStructured
        ? (errBody as { message?: string }).message || '请求失败'
        : errBody || error?.message || '请求失败',
      errorCode: isStructured ? (errBody as { code?: string }).code : undefined,
      retryable: isStructured ? (errBody as { retryable?: boolean }).retryable : undefined,
      requestId: isStructured ? (errBody as { requestId?: string }).requestId : undefined
    }
    // 把统一错误信息附加到原错误上继续抛出，调用方可自行解析
    Object.assign(error, { apiError })
    return Promise.reject(error)
  }
)

// 从 Axios 错误中提取用户可读信息（兼容新旧两种错误格式）
export function extractApiError(e: unknown): ApiError | null {
  const err = e as { apiError?: ApiError }
  return err?.apiError || null
}

export default http
