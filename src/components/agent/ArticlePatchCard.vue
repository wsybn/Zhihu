<template>
  <div class="patch-card card mb-2">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="badge bg-primary">{{ targetLabel }}</span>
        <span
          v-if="patch.status !== 'pending'"
          class="badge"
          :class="patch.status === 'accepted' ? 'bg-success' : 'bg-secondary'"
        >
          {{ patch.status === 'accepted' ? '已接受' : '已拒绝' }}
        </span>
      </div>

      <div v-if="patch.originalText" class="patch-original small">
        <span class="text-muted">原文：</span><del>{{ patch.originalText }}</del>
      </div>
      <div class="patch-proposed small">
        <span class="text-muted">建议：</span>{{ patch.proposedText }}
      </div>
      <div class="patch-reason small text-muted">原因：{{ patch.reason }}</div>

      <div class="d-flex flex-wrap gap-1 mt-1">
        <button v-if="patch.status === 'pending'" class="btn btn-sm btn-success" @click="$emit('accept', patch)">接受</button>
        <button v-if="patch.status === 'pending'" class="btn btn-sm btn-outline-secondary" @click="$emit('reject', patch)">拒绝</button>
        <button class="btn btn-sm btn-outline-secondary" @click="$emit('regenerate', patch)">重新生成</button>
        <button class="btn btn-sm btn-outline-primary" @click="copyPatch">复制</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ArticlePatch } from '../../types/agent'
import createMessage from '../createMessage'

const props = defineProps<{
  patch: ArticlePatch
}>()

defineEmits(['accept', 'reject', 'regenerate'])

const targetLabel = computed(() => {
  const map: Record<ArticlePatch['target'], string> = {
    title: '标题',
    content: '正文',
    selection: '选中内容'
  }
  return map[props.patch.target] || props.patch.target
})

const copyPatch = async () => {
  try {
    await navigator.clipboard.writeText(props.patch.proposedText)
    createMessage('已复制建议内容', 'success')
  } catch (e) {
    createMessage('复制失败，请手动复制', 'error')
  }
}
</script>
