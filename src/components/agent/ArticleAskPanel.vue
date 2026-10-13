<template>
  <div class="article-ask-panel border rounded bg-white p-3">
    <div class="fw-bold mb-2">💬 问问这篇文章</div>
    <form class="d-flex gap-2 mb-2" @submit.prevent="ask">
      <input
        v-model="question"
        type="text"
        class="form-control form-control-sm"
        placeholder="例如：这篇文章的核心观点是什么？"
        :disabled="loading"
      >
      <button type="submit" class="btn btn-sm btn-primary" :disabled="loading || !question.trim()">
        {{ loading ? '思考中…' : '提问' }}
      </button>
    </form>

    <div v-if="error" class="small text-danger mb-2">{{ error }}</div>

    <div v-if="result" class="ask-answer border-top pt-2">
      <div class="answer-text small mb-2">{{ result.answer }}</div>
      <div v-if="result.confidence" class="small text-muted mb-1">
        置信度 {{ (result.confidence * 100).toFixed(0) }}%
      </div>
      <CitationList :citations="result.citations" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { askArticle } from '../../services/agentService'
import type { ArticleAskResult } from '../../types/agent'
import CitationList from './CitationList.vue'

const props = defineProps<{
  articleId: string
}>()

const question = ref('')
const loading = ref(false)
const error = ref('')
const result = ref<ArticleAskResult | null>(null)

const ask = async () => {
  const q = question.value.trim()
  if (!q || loading.value) return
  loading.value = true
  error.value = ''
  try {
    result.value = await askArticle(props.articleId, q)
  } catch (e) {
    error.value = (e as { apiError?: { error?: string } })?.apiError?.error || '提问失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.answer-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
