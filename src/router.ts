import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import type { RouteLocationNormalized } from 'vue-router'
import Login from './views/Login.vue'
import ColumnDetail from './views/ColumnDetail.vue'
import CreatePosts from './views/CreatePosts.vue'
import EditProfile from './views/EditProfile.vue'
import store from './store'
import Signup from './views/Signup.vue'
import axios from 'axios'

const routerHistory = createWebHistory()
const router = createRouter({
  history: routerHistory,
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home
    },
    {
      path: '/login',
      name: 'Login',
      component: Login,
      meta: { redirectAlreadyLogin: true }
    },
    {
      path: '/column/:_id',
      name: 'Column',
      component: ColumnDetail
    },
    {
      path: '/created',
      name: 'Created',
      component: CreatePosts,
      meta: { requiredLogin: true }
    },
    {
      path: '/profile/edit',
      name: 'EditProfile',
      component: EditProfile,
      meta: { requiredLogin: true }
    },
    {
      path: '/register',
      name: 'Signup',
      component: Signup,
      meta: { redirectAlreadyLogin: true }
    },
    {
      path: '/posts/:id',
      name: 'PostDetail',
      component: () => import('./views/ArticleDetail.vue')
    }
  ]
})
router.beforeEach((to: RouteLocationNormalized, from: RouteLocationNormalized, next: (to?: string | object | false | void) => void) => {
  const { user, token } = store.state
  const { requiredLogin, redirectAlreadyLogin } = to.meta
  if (!user.isLogin) {
    if (token) {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`
      store.dispatch('fetchCurrentUser').then(() => {
        if (redirectAlreadyLogin) {
          next('/')
        } else {
          next()
        }
      }).catch(e => {
        console.error(e)
        localStorage.removeItem('token')
        next('/login')
      })
    } else {
      if (requiredLogin) {
        next('/login')
      } else {
        next()
      }
    }
  } else {
    if (redirectAlreadyLogin) {
      next('/')
    } else {
      next()
    }
  }
})

export default router
