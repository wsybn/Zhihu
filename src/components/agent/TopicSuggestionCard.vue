<template>
  <div class="topic-suggestion-card card mb-2">
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>💡 选题建议</strong>
        <button class="btn btn-sm btn-outline-primary" :disabled="loading" @click="load">
          {{ loading ? '生成中…' : '重新生成' }}
        </button>
      </div>
      <div v-if="loading" class="small text-muted">正在分析你的历史文章…</div>
      <div v-else-if="error" class="small text-danger">{{ error }}</div>
      <div v-else-if="topics.length === 0" class="small text-muted">发布文章后可获得选题建议。</div>
      <ul v-else class="list-unstyled mb-0">
        <li v-for="(topic, index) in topics" :key="index" class="topic-item border-top py-2">
          <div class="fw-bold small">{{ topic.title }}</div>
          <div v-if="topic.reason" class="small text-muted">{{ topic.reason }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getTopicSuggestions } from '../../services/agentService'
import type { TopicSuggestion } from '../../types/agent'

const props = defineProps<{
  count?: number
}>()

const loading = ref(false)
const error = ref('')
const topics = ref<TopicSuggestion[]>([])

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await getTopicSuggestions(props.count || 5)
    topics.value = res.topics || []
  } catch (e) {
    error.value = (e as { apiError?: { error?: string } })?.apiError?.error || '选题建议生成失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
