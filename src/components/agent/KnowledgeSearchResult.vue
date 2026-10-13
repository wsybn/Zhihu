<template>
  <div class="knowledge-search-result card mb-2">
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>🧠 知识库检索</strong>
        <span class="badge bg-primary">{{ results.length }} 条</span>
      </div>
      <p v-if="query" class="small text-muted mb-2">关键词：「{{ query }}」</p>
      <div v-if="results.length">
        <router-link
          v-for="(item, index) in results"
          :key="item.articleId + '-' + index"
          :to="`/posts/${item.articleId}`"
          class="result-item d-block border-top py-2 text-decoration-none"
        >
          <div class="d-flex justify-content-between align-items-center">
            <span class="fw-bold text-dark small">{{ item.title }}</span>
            <span class="badge" :class="sourceBadgeClass(item.source)">{{ sourceLabel(item.source) }}</span>
          </div>
          <div class="result-chunk text-muted">{{ item.chunk }}</div>
        </router-link>
      </div>
      <div v-else class="small text-muted">知识库中暂时没有相关结果。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeSearchItem, RetrievalSource } from '../../types/agent'

defineProps<{
  results: KnowledgeSearchItem[]
  query?: string
}>()

const sourceLabel = (s: RetrievalSource): string => {
  const map: Record<RetrievalSource, string> = {
    keyword: '关键词',
    vector: '向量',
    hybrid: '混合'
  }
  return map[s] || s
}

const sourceBadgeClass = (s: RetrievalSource): string =>
  s === 'hybrid' ? 'bg-success' : s === 'vector' ? 'bg-info text-dark' : 'bg-secondary'
</script>

<style scoped>
.result-chunk {
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
