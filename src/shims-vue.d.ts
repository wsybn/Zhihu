/* eslint-disable */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
// 添加 vue-router 的类型声明
declare module 'vue-router' {
  import type { Router, RouteRecordRaw, RouterHistory } from 'vue-router'

  export interface RouterOptions {
    history: RouterHistory
    routes: RouteRecordRaw[]
    scrollBehavior?: any
  }

  export function createRouter(options: RouterOptions): Router
  export function createWebHistory(base?: string): RouterHistory
  export function createWebHashHistory(base?: string): RouterHistory
  export function createMemoryHistory(base?: string): RouterHistory

  // 导出其他常用类型
  export interface RouteLocationNormalized {
    path: string
    name: string | null
    params: Record<string, any>
    query: Record<string, any>
    hash: string
    fullPath: string
    matched: RouteRecordNormalized[]
    meta: Record<string, any>
    redirectedFrom?: RouteLocationNormalized
  }

  export interface RouteRecordNormalized {
    path: string
    name?: string
    components: any
    children: RouteRecordNormalized[]
    meta: Record<string, any>
  }
}