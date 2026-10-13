import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import axios from 'axios'
import 'bootstrap/dist/css/bootstrap.min.css'
import './helper'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { API_BASE_URL } from './services/http'

const app = createApp(App)

// 接口地址由构建期环境变量 VUE_APP_API_BASE_URL 注入，与 service 层共用
axios.defaults.baseURL = API_BASE_URL ? `${API_BASE_URL}/` : '/'

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
