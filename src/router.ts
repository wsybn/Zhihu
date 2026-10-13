import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import type { RouteLocationNormalized } from 'vue-router'
import store from './store'
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
      path: '/search',
      name: 'Search',
      component: () => import('./views/SearchArticles.vue')
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('./views/Login.vue'),
      meta: { redirectAlreadyLogin: true }
    },
    {
      path: '/column/:id',
      name: 'Column',
      component: () => import('./views/ColumnDetail.vue')
    },
    {
      path: '/created',
      name: 'Created',
      component: () => import('./views/CreatePosts.vue'),
      meta: { requiredLogin: true }
    },
    {
      path: '/profile/edit',
      name: 'EditProfile',
      component: () => import('./views/EditProfile.vue'),
      meta: { requiredLogin: true }
    },
    {
      path: '/register',
      name: 'Signup',
      component: () => import('./views/Signup.vue'),
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
      }).catch(() => {
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
