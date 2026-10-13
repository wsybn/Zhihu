<template>
  <div class="series-classification-card card mb-2">
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>🗂 系列归类</strong>
        <button class="btn btn-sm btn-outline-primary" :disabled="loading" @click="load">
          {{ loading ? '归类中…' : '重新归类' }}
        </button>
      </div>
      <div v-if="loading" class="small text-muted">正在分析文章并归类…</div>
      <div v-else-if="error" class="small text-danger">{{ error }}</div>
      <div v-else-if="series.length === 0" class="small text-muted">暂时没有可归类的系列。</div>
      <div v-else>
        <div v-for="(group, index) in series" :key="index" class="series-group border-top py-2">
          <div class="fw-bold small mb-1">📁 {{ group.name }}</div>
          <div class="d-flex flex-wrap gap-1">
            <router-link
              v-for="articleId in group.articleIds"
              :key="articleId"
              :to="`/posts/${articleId}`"
              class="badge bg-light text-dark text-decoration-none"
            >
              文章 #{{ articleId }}
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getSeriesClassification } from '../../services/agentService'
import type { SeriesGroup } from '../../types/agent'

const loading = ref(false)
const error = ref('')
const series = ref<SeriesGroup[]>([])

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await getSeriesClassification()
    series.value = res.series || []
  } catch (e) {
    error.value = (e as { apiError?: { error?: string } })?.apiError?.error || '系列归类失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
