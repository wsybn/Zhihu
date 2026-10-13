<template>
  <div v-if="tools.length" class="tool-call-status">
    <div class="small fw-bold text-muted mb-2">🛠 工具调用</div>
    <div v-for="tool in tools" :key="tool.id" class="tool-item border rounded p-2 mb-2">
      <div class="d-flex justify-content-between align-items-center">
        <span class="fw-bold small">{{ toolLabel(tool.toolName) }}</span>
        <span class="badge" :class="statusClass(tool.status)">
          {{ statusText(tool.status) }}
        </span>
      </div>
      <code class="d-block small text-muted mt-1">{{ argPreview(tool.arguments) }}</code>
      <div v-if="tool.error" class="small text-danger mt-1">{{ tool.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCallRecord, ToolCallStatus } from '../../types/agent'

defineProps<{
  tools: ToolCallRecord[]
}>()

const toolLabels: Record<string, string> = {
  search_articles: '站内文章检索',
  read_article: '阅读文章',
  get_current_article_context: '获取当前文章上下文',
  search_knowledge_base: '知识库检索',
  create_outline: '生成大纲',
  create_article_patch: '生成修改建议',
  review_article: '审查文章',
  suggest_topics: '推荐选题'
}

const toolLabel = (name: string): string => toolLabels[name] || name

const statusClass = (status: ToolCallStatus): string => {
  switch (status) {
    case 'running': return 'bg-info text-dark'
    case 'success': return 'bg-success'
    case 'failed': return 'bg-danger'
    case 'cancelled': return 'bg-secondary'
    default: return 'bg-secondary'
  }
}

const statusText = (status: ToolCallStatus): string => {
  switch (status) {
    case 'running': return '运行中'
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const argPreview = (args: Record<string, unknown>): string => {
  const text = JSON.stringify(args)
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}
</script>
