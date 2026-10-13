<template>
  <div v-if="runId || steps.length" class="run-timeline border rounded p-2">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span class="fw-bold small">🧭 Agent 执行时间线</span>
      <span v-if="runId" class="badge bg-light text-dark">run {{ shortId(runId) }}</span>
    </div>
    <ul class="list-unstyled mb-0">
      <li v-for="step in steps" :key="step.stepKey" class="timeline-step d-flex align-items-start">
        <span class="step-dot me-2 mt-1" :class="'dot-' + step.status"></span>
        <span class="flex-grow-1">
          <span class="small d-block" :class="'text-' + step.status">
            {{ stepLabel(step.stepKey) }}
            <span v-if="step.retryCount" class="badge bg-warning text-dark ms-1">重试 {{ step.retryCount }}</span>
          </span>
          <span v-if="step.startedAt && step.status !== 'pending'" class="step-time text-muted">
            {{ formatTime(step.startedAt) }}
            <template v-if="step.completedAt"> → {{ formatTime(step.completedAt) }}</template>
          </span>
          <span v-if="step.error" class="d-block small text-danger">{{ step.error }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { AgentRunStep, WorkflowStepKey } from '../../types/agent'

defineProps<{
  runId: string
  steps: AgentRunStep[]
}>()

const stepLabels: Record<WorkflowStepKey, string> = {
  goal_analysis: '创作目标',
  internal_research: '资料检索',
  outline_generation: '生成大纲',
  outline_confirmation: '确认大纲',
  section_writing: '章节写作',
  article_review: '全文审查',
  publish_preparation: '发布准备'
}

const stepLabel = (key: WorkflowStepKey): string => stepLabels[key] || key
const shortId = (id: string): string => (id.length > 12 ? id.slice(0, 12) + '…' : id)

const formatTime = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString()
}
</script>

<style scoped>
.timeline-step {
  padding: 0.2rem 0;
}
.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-pending {
  background-color: #adb5bd;
}
.dot-running {
  background-color: #0d6efd;
}
.dot-waiting_for_user {
  background-color: #ffc107;
}
.dot-completed {
  background-color: #198754;
}
.dot-failed {
  background-color: #dc3545;
}
.dot-cancelled {
  background-color: #6c757d;
}
.text-pending {
  color: #6c757d;
}
.text-running {
  color: #0d6efd;
}
.text-waiting_for_user {
  color: #b8860b;
}
.text-completed {
  color: #198754;
}
.text-failed {
  color: #dc3545;
}
.text-cancelled {
  color: #6c757d;
}
.step-time {
  font-size: 0.7rem;
}
</style>
