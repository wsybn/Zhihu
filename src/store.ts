import { createStore, Commit } from 'vuex'
import axios, { AxiosRequestConfig } from 'axios'

export interface ResponseType<P = object> {
  code: number
  msg: string
  data: P
}

interface ListProps<P> {
  [id: string]: P
}

export interface GlobalErrorProps {
  status: boolean
  message?: string
}

export interface UserProps {
  isLogin: boolean
  id?: string
  nickName?: string
  columnId?: number | string // 兼容字符串和数字类型
  email?: string
  avatar?: string
  bio?: string
}

const getAndCommit = async (url: string, mutationName: string, commit: Commit) => {
  const { data } = await axios.get(url)
  commit(mutationName, data)
  return data
}
// const PostAndCommit = async <T>(url: string, mutationName: string, commit: Commit, payload: T) => {
//   const { data } = await axios.post(url, payload)
//   commit(mutationName, data)
//   return data
// }

export interface ImageProps {
  id?: string
  url?: string
  createdAt?: string
}

export interface ColumnProps {
  id: string
  title: string
  avatar?: ImageProps
  description: string
  author?: string
  authorAvatar?: string
  authorBio?: string
}

export interface PostProps {
  id: string
  title: string
  excerpt?: string
  content?: string
  image?: ImageProps | string
  createdAt: string
  // 兼容两种字段：早期数据使用 columnId，后续可能使用 column
  column?: string
  columnId?: string
  author?: string | UserProps
  authorAvatar?: string
  authorBio?: string
}

type EntityWithId = {
  id?: string
}

const normalizeId = (item: EntityWithId): string => {
  return String(item.id || '')
}

type EntityPayload<T> = T | { data?: T }
type ListPayload<T> = T[] | { data?: { list?: T[] } } | { data?: T[] }

const unwrapEntity = <T>(payload: EntityPayload<T>): T | undefined => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data?: T }).data
  }
  return payload as T
}

const unwrapList = <T>(payload: ListPayload<T>): T[] => {
  if (Array.isArray(payload)) return payload
  const data = (payload as { data?: { list?: T[] } | T[] }).data
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'list' in data && Array.isArray(data.list)) {
    return data.list
  }
  return []
}

const normalizeColumn = (raw: ColumnProps | (Partial<ColumnProps> & EntityWithId)): ColumnProps | null => {
  const id = normalizeId(raw)
  if (!id) return null
  return {
    ...(raw as Partial<ColumnProps>),
    id
  } as ColumnProps
}

const normalizePost = (raw: PostProps | (Partial<PostProps> & EntityWithId)): PostProps | null => {
  const id = normalizeId(raw)
  if (!id) return null
  return {
    ...(raw as Partial<PostProps>),
    id,
    columnId: (raw as PostProps).columnId || (raw as PostProps).column
  } as PostProps
}

interface ColumnsState {
  data: ListProps<ColumnProps>
  isLoaded: boolean
  total: number
}

interface PostsState {
  data: ListProps<PostProps>
  loadedColumns: string[]
  totalByColumn: ListProps<number>
}

export interface GlobalDataProps {
  token: string
  loading: boolean
  columns: ColumnsState
  posts: PostsState
  user: UserProps
  error: GlobalErrorProps
  currentPost?: PostProps
}

// 通用的 axios 调用并提交 mutation 的工具函数
const asyncAndCommit = async (
  url: string,
  mutationName: string,
  commit: Commit,
  config: AxiosRequestConfig = { method: 'get' }
) => {
  const { data } = await axios({
    url,
    ...config
  })
  commit(mutationName, data)
  return data
}

const store = createStore<GlobalDataProps>({
  state: {
    error: { status: false },
    token: localStorage.getItem('token') || '',
    loading: false,
    columns: { data: {}, isLoaded: false, total: 0 },
    posts: { data: {}, loadedColumns: [], totalByColumn: {} },
    user: { isLogin: false },
    currentPost: undefined
  },
  mutations: {
    // login(state) {
    //   state.user = { ...state.user, isLogin: true, name: 'fmq' }
    // },
    setCurrentPost(state, rawData: EntityPayload<PostProps>) {
      const post = unwrapEntity(rawData)
      if (!post) {
        state.currentPost = undefined
        return
      }
      state.currentPost = normalizePost(post) || undefined
    },
    setLoading(state, status: boolean) {
      state.loading = status
    },
    setErorr(state, e: GlobalErrorProps) {
      state.error = e
    },
    setToken(state, token: string) {
      state.token = token
    },
    setUser(state, user: Partial<UserProps> & { nickname?: string; name?: string }) {
      state.user = {
        ...state.user,
        ...user,
        id: user.id || state.user.id,
        // 优先使用接口返回的 nickName，其次是 name，最后才用默认文案
        nickName: user.nickName || user.name || '未命名用户',
        isLogin: true
      }
    },
    createPost(state, newPost: PostProps) {
      const normalizedPost = normalizePost(newPost)
      if (!normalizedPost) return
      state.posts.data[normalizedPost.id] = normalizedPost
    },
    updatePost(state, payload: EntityPayload<PostProps>) {
      const post = unwrapEntity(payload)
      const normalizedPost = post ? normalizePost(post) : null
      if (!normalizedPost) return

      // 更新 posts 列表中的对应文章
      const current = state.posts.data[normalizedPost.id]
      state.posts.data[normalizedPost.id] = {
        ...(current || {}),
        ...normalizedPost
      } as PostProps

      // 如果当前详情就是这篇文章，同步更新 currentPost
      if (state.currentPost && state.currentPost.id === normalizedPost.id) {
        state.currentPost = {
          ...state.currentPost,
          ...normalizedPost
        }
      }
    },
    // 现在使用 json-server，GET /columns 直接返回 ColumnProps[] 数组
    // 兼容两种数据格式：直接数组或 { data: { list: [...] } }
    fetchColumns(state, newData: ListPayload<ColumnProps>) {
      const columns = unwrapList(newData)
      const normalizedColumns: ListProps<ColumnProps> = {}
      columns.forEach(col => {
        const normalized = normalizeColumn(col)
        if (normalized) {
          normalizedColumns[normalized.id] = normalized
        }
      })
      state.columns.data = normalizedColumns
      state.columns.isLoaded = true
    },
    appendColumns(state, payload: { data: ListPayload<ColumnProps>; total?: number }) {
      const { data, total } = payload
      const columns = unwrapList(data)
      const normalizedColumns: ListProps<ColumnProps> = {}
      columns.forEach(col => {
        const normalized = normalizeColumn(col)
        if (normalized) {
          normalizedColumns[normalized.id] = normalized
        }
      })
      state.columns.data = {
        ...state.columns.data,
        ...normalizedColumns
      }
      state.columns.isLoaded = true
      if (typeof total === 'number' && !Number.isNaN(total)) {
        state.columns.total = total
      }
    },
    // GET /columns/:id 返回单个专栏对象
    fetchColumn(state, rawData: EntityPayload<ColumnProps>) {
      const column = unwrapEntity(rawData)
      if (!column) return
      const normalizedColumn = normalizeColumn(column)
      if (!normalizedColumn) return
      state.columns.data[normalizedColumn.id] = normalizedColumn
      state.columns.isLoaded = true
    },
    fetchPosts(state, payload: { cid: string; data: ListPayload<PostProps>; total?: number }) {
      const { cid, data, total } = payload
      const posts = unwrapList(data)
      const normalizedPosts: ListProps<PostProps> = {}
      posts.forEach(post => {
        const normalized = normalizePost(post)
        if (normalized) normalizedPosts[normalized.id] = normalized
      })
      // 3. 更新状态
      state.posts.data = { ...state.posts.data, ...normalizedPosts }
      // 4. 记录已加载的栏目（去重）
      if (!state.posts.loadedColumns.includes(cid)) {
        state.posts.loadedColumns.push(cid)
      }
      if (typeof total === 'number' && !Number.isNaN(total)) {
        state.posts.totalByColumn[cid] = total
      }
    },
    deletePost(state, id: string) {
      const targetId = String(id)
      delete state.posts.data[targetId]
      if (state.currentPost && String(state.currentPost.id) === targetId) {
        state.currentPost = undefined
      }
    },
    logout(state) {
      state.token = ''
      state.user = { isLogin: false }
    }
  },
  actions: {
    fetchColumns({ state, commit }) {
      if (!state.columns.isLoaded) {
        return getAndCommit('columns', 'fetchColumns', commit)
      }
    },
    fetchColumn({ state, commit }, cid) {
      if (!state.columns.data[cid]) {
        return getAndCommit(`columns/${cid}`, 'fetchColumn', commit)
      }
    },
    async fetchColumnsByPage(
      { commit },
      payload: { currentPage: number; pageSize: number }
    ) {
      const { currentPage, pageSize } = payload
      const { data, headers } = await axios.get(
        `columns?_page=${currentPage}&_limit=${pageSize}`
      )
      const total = Number(headers['x-total-count'] || 0)
      commit('appendColumns', { data, total })
      return data
    },
    async fetchPosts({ state, commit }, cid) {
      const normalizedCid = String(cid)
      // 缓存判断：已加载过就不再请求
      if (state.posts.loadedColumns.includes(normalizedCid)) {
        return Promise.resolve({ data: state.posts.data })
      }
      const { data } = await axios.get(`posts?columnId=${normalizedCid}`)
      commit('fetchPosts', { cid: normalizedCid, data })
      return data
    },
    async fetchPostsByPage(
      { commit },
      payload: { cid: string; currentPage: number; pageSize: number }
    ) {
      const { cid, currentPage, pageSize } = payload
      const normalizedCid = String(cid)
      const { data, headers } = await axios.get(
        `posts?columnId=${normalizedCid}&_page=${currentPage}&_limit=${pageSize}`
      )
      const total = Number(headers['x-total-count'] || 0)
      commit('fetchPosts', { cid: normalizedCid, data, total })
      return data
    },
    updatePost({ commit }, payload: { id: string; title: string; content: string; column: string; image?: string; author?: string }) {
      return asyncAndCommit(`posts/${payload.id}`, 'updatePost', commit, { method: 'patch', data: payload })
    },
    async createPost(
      { commit },
      payload: { title: string; content: string; column: string; image?: string; author?: string }
    ) {
      const { data } = await axios.post(`columns/${payload.column}/posts`, payload)
      const post = unwrapEntity<PostProps>(data)
      if (!post) return undefined
      commit('createPost', post)
      return post
    },
    // login({ commit }, payload) {
    //   PostAndCommit('/user/login', 'Login', commit, payload)
    // },
    async login({ commit }, payload: { email: string; password: string }) {
      const { data } = await axios.post('/user/login', payload)
      const loginData = unwrapEntity<{ token?: string } & Partial<UserProps>>(data)
      const token = loginData?.token
      const user = { ...(loginData || {}) }
      delete (user as { token?: string }).token
      if (token) {
        commit('setToken', token)
        localStorage.setItem('token', token)
      }
      commit('setUser', user)
      return data
    },
    async register({ commit }, payload: { email: string; password: string; name?: string }) {
      // loading 状态由 axios 拦截器统一管理，这里不需要手动设置
      const { data } = await axios.post('/user/register', payload)
      const registerData = unwrapEntity<{ token?: string } & Partial<UserProps>>(data)
      const token = registerData?.token
      const user = { ...(registerData || {}) }
      delete (user as { token?: string }).token
      if (token) {
        commit('setToken', token)
        localStorage.setItem('token', token)
      }
      commit('setUser', user)
      return data
    },
    registerAndFetch({ dispatch }, registerData) {
      // 注册接口已经返回了完整的用户信息，不需要再调用 fetchCurrentUser
      return dispatch('register', registerData)
    },
    loginAndFetch({ dispatch }, loginData) {
      // 登录接口已经返回了完整的用户信息，不需要再调用 fetchCurrentUser
      return dispatch('login', loginData)
    },
    async fetchCurrentUser({ commit }) {
      const { data } = await axios.get('/user/current')
      const user = unwrapEntity<Partial<UserProps>>(data)
      commit('setUser', user)
      return data
    },
    logout({ state, commit }) {
      // 登出时清除当前账号的 Agent 会话缓存，避免下次登录他人账号时误恢复
      const userId = String(state.user.id || '')
      if (userId) {
        localStorage.removeItem(`agent_session_id:${userId}`)
      }
      commit('logout')
      localStorage.removeItem('token')
    },
    async updateProfile({ commit }, payload: { name?: string; avatar?: string; bio?: string }) {
      const { data } = await axios.patch('/user/profile', payload)
      const user = unwrapEntity<Partial<UserProps>>(data)
      commit('setUser', user)
      return data
    },
    async deletePost({ commit }, id: string) {
      await axios.delete(`/posts/${id}`)
      commit('deletePost', id)
    },
    async fetchPost({ state, commit }, id: string) {
      const cached = state.posts.data[id]
      if (cached?.content) {
        commit('setCurrentPost', cached)
        return cached
      }
      const { data } = await axios.get(`/posts/${id}`)
      commit('setCurrentPost', data)
      return unwrapEntity<PostProps>(data)
    }
  },
  getters: {
    getColumnById: (state: GlobalDataProps) => (id: string) => {
      return state.columns.data[id]
    },
    getColumnsTotal: (state: GlobalDataProps) => {
      return state.columns.total
    },
    getPostsByCid: (state: GlobalDataProps) => (cid: string) => {
      return Object.values(state.posts.data).filter((post: PostProps | undefined | null) => {
        if (!post) return false
        return post.columnId === cid
      })
    },
    getPostsTotalByCid: (state: GlobalDataProps) => (cid: string) => {
      return state.posts.totalByColumn[cid] || 0
    }
  }
})

export default store
