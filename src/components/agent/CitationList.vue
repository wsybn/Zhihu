<template>
  <div v-if="citations.length" class="citation-list">
    <div class="citation-title small fw-bold text-muted mb-2">📚 引用来源</div>
    <div
      v-for="(c, index) in citations"
      :key="c.articleId + '-' + index"
      class="citation-item border rounded p-2 mb-2"
    >
      <router-link
        :to="`/posts/${c.articleId}`"
        class="citation-link fw-bold small text-decoration-none"
      >
        {{ c.title }}
      </router-link>
      <span class="badge bg-light text-dark ms-2">相关度 {{ percent(c.score) }}</span>
      <p class="citation-chunk small text-muted mb-0 mt-1">{{ c.chunk }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Citation } from '../../types/agent'

defineProps<{
  citations: Citation[]
}>()

const percent = (score: number): string => `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`
</script>

<style scoped>
.citation-chunk {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-height: 1.4;
}
.citation-link:hover {
  color: #0d6efd !important;
}
</style>
