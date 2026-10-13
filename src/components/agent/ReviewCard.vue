<template>
  <div class="review-card card mb-2">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong>🔍 审查报告</strong>
        <span class="badge" :class="scoreClass">评分 {{ review.score }}</span>
      </div>
      <p class="small text-muted mb-2">{{ review.summary }}</p>

      <button class="btn btn-sm btn-outline-success mb-2" @click="$emit('accept-all')">
        接受全部安全修改
      </button>

      <div v-for="issue in sortedIssues" :key="issue.id" class="issue-item border rounded p-2 mb-2">
        <div class="mb-1">
          <span class="badge me-1" :class="'sev-' + issue.severity">{{ severityLabel(issue.severity) }}</span>
          <span class="badge bg-secondary me-1">{{ categoryLabel(issue.category) }}</span>
          <span v-if="issueState(issue.id)" class="badge" :class="issueState(issue.id) === 'accepted' ? 'bg-success' : 'bg-secondary'">
            {{ issueState(issue.id) === 'accepted' ? '已处理' : '已忽略' }}
          </span>
        </div>
        <p class="small mb-1">{{ issue.message }}</p>
        <div v-if="issue.originalText" class="original-text small text-muted mb-1">
          <del>{{ issue.originalText }}</del>
        </div>
        <div v-if="issue.suggestion" class="small mb-1">建议：{{ issue.suggestion }}</div>
        <div v-if="issue.replacement" class="small text-success mb-1">替换为：{{ issue.replacement }}</div>
        <div class="d-flex flex-wrap gap-1">
          <button
            v-if="issue.replacement"
            class="btn btn-sm btn-outline-success"
            :disabled="!!issueState(issue.id)"
            @click="$emit('accept', issue)"
          >
            接受
          </button>
          <button
            class="btn btn-sm btn-outline-secondary"
            :disabled="!!issueState(issue.id)"
            @click="$emit('ignore', issue)"
          >
            忽略
          </button>
          <button
            v-if="issue.originalText"
            class="btn btn-sm btn-outline-primary"
            @click="$emit('locate', issue)"
          >
            定位
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ReviewCategory, ReviewReport, ReviewSeverity } from '../../types/agent'

type IssueState = 'pending' | 'accepted' | 'ignored'

const props = defineProps<{
  review: ReviewReport
  issueStates: Record<string, IssueState>
}>()

defineEmits(['accept', 'ignore', 'accept-all', 'locate'])

const severityOrder: Record<ReviewSeverity, number> = { error: 0, warning: 1, info: 2 }

const sortedIssues = computed(() =>
  [...props.review.issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
)

const scoreClass = computed(() => {
  const s = props.review.score
  if (s >= 90) return 'bg-success'
  if (s >= 75) return 'bg-warning text-dark'
  return 'bg-danger'
})

const issueState = (id: string): IssueState | undefined => props.issueStates[id]

const severityLabel = (s: ReviewSeverity): string => {
  const map: Record<ReviewSeverity, string> = { error: '错误', warning: '警告', info: '提示' }
  return map[s]
}

const categoryLabel = (c: ReviewCategory): string => {
  const map: Record<ReviewCategory, string> = {
    spelling: '拼写',
    grammar: '语法',
    structure: '结构',
    logic: '逻辑',
    format: '格式',
    citation: '引用',
    technical_accuracy: '技术准确性',
    duplicate: '重复',
    markdown: 'Markdown'
  }
  return map[c] || c
}
</script>

<style scoped>
.sev-error {
  background-color: #dc3545;
}
.sev-warning {
  background-color: #ffc107;
  color: #212529;
}
.sev-info {
  background-color: #0dcaf0;
  color: #212529;
}
</style>
