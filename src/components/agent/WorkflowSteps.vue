<template>
  <div class="workflow-steps">
    <div class="workflow-title fw-bold mb-2">创作流程</div>
    <ul class="list-unstyled mb-0">
      <li v-for="step in steps" :key="step.key" class="workflow-step d-flex align-items-start">
        <span class="step-dot me-2 mt-1" :class="'dot-' + step.status"></span>
        <span>
          <span class="step-label small d-block" :class="'text-' + step.status">{{ step.label }}</span>
          <span class="step-trigger text-muted">{{ triggerText(step.key) }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { WorkflowStep, WorkflowStepKey } from '../../types/agent'

defineProps<{
  steps: WorkflowStep[]
}>()

const triggerText = (key: WorkflowStepKey): string => {
  const descriptions: Record<WorkflowStepKey, string> = {
    goal_analysis: '发送普通对话后完成',
    internal_research: '点击“查询资料”后完成',
    outline_generation: '点击“生成大纲”后完成',
    outline_confirmation: '接受大纲后完成',
    section_writing: '执行续写或润色后完成',
    article_review: '点击“审查全文”后完成',
    publish_preparation: '提交文章时完成'
  }
  return descriptions[key]
}
</script>

<style scoped>
.workflow-step {
  padding: 0.35rem 0;
}
.step-trigger {
  display: block;
  font-size: 0.68rem;
  line-height: 1.2;
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
.text-pending {
  color: #6c757d;
}
.text-running {
  color: #0d6efd;
  font-weight: 600;
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
</style>
