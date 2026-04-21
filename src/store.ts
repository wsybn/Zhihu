import { createStore, Commit } from 'vuex'
import axios, { AxiosRequestConfig } from 'axios'

export interface ResponseType<P = object> {
  code: number
  msg: string
  data: P
}

export interface GlobalErrorProps {
  status: boolean
  message?: string
}

export interface UserProps {
  isLogin: boolean
  _id?: string
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
  _id?: string
  url?: string
  createdAt?: string
}

export interface ColumnProps {
  _id: string
  title: string
  avatar?: ImageProps
  description: string
}

export interface PostProps {
  _id: string
  title: string
  excerpt?: string
  content?: string
  image?: ImageProps | string
  createdAt: string
  // 兼容两种字段：早期数据使用 columnId，后续可能使用 column
  column?: string
  columnId?: string
  author?: string | UserProps
}

export interface GlobalDataProps {
  token: string
  loading: boolean
  columns: ColumnProps[]
  posts: PostProps[]
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
    columns: [],
    posts: [],
    user: { isLogin: false },
    currentPost: undefined
  },
  mutations: {
    // login(state) {
    //   state.user = { ...state.user, isLogin: true, name: 'fmq' }
    // },
    setCurrentPost(state, rawData: PostProps | { data?: PostProps }) {
      const wrapper = rawData as { data?: PostProps }
      const post = wrapper && wrapper.data ? wrapper.data : (rawData as PostProps)
      state.currentPost = post
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
        _id: user._id || user.id || state.user._id,
        // 优先使用接口返回的 nickName，其次是 name，最后才用默认文案
        nickName: user.nickName || user.name || '未命名用户',
        isLogin: true
      }
    },
    createPost(state, newPost: PostProps) {
      state.posts.push(newPost)
    },
    updatePost(state, payload: PostProps | { data?: PostProps }) {
      const wrapper = payload as { data?: PostProps }
      const post = wrapper && wrapper.data ? wrapper.data : (payload as PostProps)
      if (!post) return
      const targetId = (post as any)._id || (post as any).id
      if (!targetId) return

      // 更新 posts 列表中的对应文章
      state.posts = state.posts.map(p => {
        const pid = (p as any)._id || (p as any).id
        if (pid === targetId) {
          return {
            ...p,
            ...post
          }
        }
        return p
      })

      // 如果当前详情就是这篇文章，同步更新 currentPost
      if (state.currentPost) {
        const currentId = (state.currentPost as any)._id || (state.currentPost as any).id
        if (currentId === targetId) {
          state.currentPost = {
            ...state.currentPost,
            ...post
          }
        }
      }
    },
    // 现在使用 json-server，GET /columns 直接返回 ColumnProps[] 数组
    // 兼容两种数据格式：直接数组或 { data: { list: [...] } }
    fetchColumns(state, newData: ColumnProps[] | { data?: { list?: ColumnProps[] } }) {
      let columns: ColumnProps[] = []
      // 处理不同的数据格式
      if (Array.isArray(newData)) {
        columns = newData
      } else if (newData?.data?.list) {
        columns = newData.data.list
      }
      // 将 json-server 的 id 字段转换为 _id
      state.columns = columns.map(col => {
        const columnWithId = col as ColumnProps & { id?: string }
        return {
          ...col,
          _id: columnWithId._id || columnWithId.id || ''
        }
      })
    },
    // GET /columns/:id 返回单个专栏对象
    fetchColumn(state, rawData: ColumnProps | { data?: ColumnProps }) {
      const columnWithData = rawData as { data?: ColumnProps } | ColumnProps
      const column = 'data' in columnWithData && columnWithData.data
        ? columnWithData.data
        : (rawData as ColumnProps)
      const columnWithId = column as ColumnProps & { id?: string }
      // 将 json-server 的 id 字段转换为 _id
      const normalizedColumn = {
        ...column,
        _id: columnWithId._id || columnWithId.id || ''
      }
      state.columns = [normalizedColumn]
    },
    // GET /posts?columnId=xxx 返回 PostProps[] 数组
    fetchPosts(state, rawData: PostProps[]) {
      state.posts = rawData
      // },
      // Login(state, rawData) {
      //   state.token = rawData.data.token
      // }
    },
    deletePost(state, id: string) {
      const targetId = String(id)
      state.posts = state.posts.filter(p => {
        const pid = (p as { _id?: string; id?: string })._id || (p as { _id?: string; id?: string }).id
        return String(pid) !== targetId
      })
      if (state.currentPost) {
        const currentId =
          (state.currentPost as { _id?: string; id?: string })._id ||
          (state.currentPost as { _id?: string; id?: string }).id
        if (String(currentId) === targetId) {
          state.currentPost = undefined
        }
      }
    },
    logout(state) {
      state.token = ''
      state.user = { isLogin: false }
    }
  },
  actions: {
    fetchColumns({ commit }) {
      return getAndCommit('columns', 'fetchColumns', commit)
    },
    fetchColumn({ commit }, cid) {
      return getAndCommit(`columns/${cid}`, 'fetchColumn', commit)
    },
    fetchPosts({ commit }, cid) {
      return getAndCommit(`posts?columnId=${cid}`, 'fetchPosts', commit)
    },
    updatePost({ commit }, payload: { id: string; title: string; content: string; column: string; image?: string; author?: string }) {
      return asyncAndCommit(`posts/${payload.id}`, 'updatePost', commit, { method: 'patch', data: payload })
    },
    async createPost(
      { commit },
      payload: { title: string; content: string; column: string; image?: string; author?: string }
    ) {
      const { data } = await axios.post(`columns/${payload.column}/posts`, payload)
      commit('createPost', data.data)
      return data.data
    },
    // login({ commit }, payload) {
    //   PostAndCommit('/user/login', 'Login', commit, payload)
    // },
    async login({ commit }, payload: { email: string; password: string }) {
      const { data } = await axios.post('/user/login', payload)
      const { token, ...user } = data.data
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
      const { token, ...user } = data.data
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
      const user = data.data
      commit('setUser', user)
      return data
    },
    logout({ commit }) {
      commit('logout')
      localStorage.removeItem('token')
    },
    async updateProfile({ commit }, payload: { name?: string; avatar?: string; bio?: string }) {
      const { data } = await axios.patch('/user/profile', payload)
      const user = data.data
      commit('setUser', user)
      return data
    },
    async deletePost({ commit }, id: string) {
      await axios.delete(`/posts/${id}`)
      commit('deletePost', id)
    },
    async fetchPost({ commit }, id: string) {
      const { data } = await axios.get(`/posts/${id}`)
      commit('setCurrentPost', data)
      return data
    }
  },
  getters: {
    getColumnById: (state: GlobalDataProps) => (id: string) => {
      return state.columns.find((c: ColumnProps) => c._id === id)
    },
    getPostsByCid: (state: GlobalDataProps) => (cid: string) => {
      return state.posts.filter((post: PostProps | undefined | null) => {
        if (!post) return false
        return post.column === cid || post.columnId === cid
      })
    }
  }
})

export default store
