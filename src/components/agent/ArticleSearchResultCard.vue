<template>
  <div class="search-result-card card mb-2">
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>🔎 文章查询</strong>
        <span class="badge bg-primary">{{ result.total }} 条结果</span>
      </div>
      <p class="small text-muted mb-2">{{ message }}</p>
      <div v-if="result.items.length">
        <router-link
          v-for="item in result.items"
          :key="item.id"
          :to="`/posts/${item.id}`"
          class="result-item d-block border-top py-2 text-decoration-none"
        >
          <div class="fw-bold text-dark small">{{ item.title }}</div>
          <div class="result-excerpt text-muted">{{ item.excerpt }}</div>
        </router-link>
        <router-link
          v-if="result.total > result.items.length"
          :to="{ path: '/search', query: { q: queryKeyword } }"
          class="btn btn-sm btn-outline-primary mt-2"
        >
          查看全部结果
        </router-link>
      </div>
      <div v-else class="small text-muted">可以换一个更短或更常见的关键词再试。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ArticleSearchResult } from '../../services/articleService'

const props = defineProps<{
  result: ArticleSearchResult
  message: string
}>()

const queryKeyword = computed(() => {
  const match = props.message.match(/「(.+?)」/)
  return match?.[1] || ''
})
</script>

<style scoped>
.result-excerpt {
  display: -webkit-box;
  overflow: hidden;
  font-size: 0.78rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.result-item:hover .fw-bold {
  color: #0d6efd !important;
}
</style>
