// 文章相关 service：全局模糊搜索等。
// 使用统一的 http 实例，避免组件直接依赖全局 axios 配置。

import http, { ApiResponse } from './http'

export type SearchMatchedField = 'title' | 'content'

export interface ArticleSearchItem {
  id: string
  title: string
  excerpt: string
  columnId: string
  author: string
  createdAt: string
  matchedFields: SearchMatchedField[]
}

export interface ArticleSearchResult {
  items: ArticleSearchItem[]
  total: number
  page: number
  pageSize: number
}

export interface ArticleSearchParams {
  q: string
  page?: number
  pageSize?: number
}

export interface ArticleSearchOptions {
  signal?: AbortSignal
}

export async function searchArticles(
  params: ArticleSearchParams,
  options: ArticleSearchOptions = {}
): Promise<ArticleSearchResult> {
  const { data } = await http.get<ApiResponse<ArticleSearchResult>>(
    '/api/articles/search',
    { params, signal: options.signal }
  )
  return data.data
}
