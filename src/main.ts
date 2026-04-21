import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import axios from 'axios'
import './helper'

const app = createApp(App)

// 使用本地 json-server 作为接口地址
axios.defaults.baseURL = 'http://localhost:3000/'

// 请求和响应拦截器：只负责切换 loading 状态
axios.interceptors.request.use(config => {
  store.commit('setLoading', true)
  store.commit('setErorr', { status: false, message: '' })
  // 添加 token 到请求头
  const token = store.state.token || localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
axios.interceptors.response.use(
  resp => {
    store.commit('setLoading', false)
    return resp
  },
  e => {
    const errorMsg = e.response?.data?.error || '请求失败'
    store.commit('setErorr', { status: true, message: errorMsg })
    store.commit('setLoading', false)
    // 关键：把错误继续抛给调用方，避免返回 undefined
    return Promise.reject(e)
  }
)

app.use(router)
app.use(store)
app.mount('#app')
