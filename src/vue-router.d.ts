// src/vue-router.d.ts
import 'vue-router'

declare module 'vue-router' {
  export function useRoute(): import('vue-router').RouteLocationNormalizedLoaded
  export function useRouter(): import('vue-router').Router
}
