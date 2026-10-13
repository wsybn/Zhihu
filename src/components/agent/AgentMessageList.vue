<template>
  <div class="agent-message-list flex-grow-1 overflow-auto px-2 py-2" ref="listRef" @scroll="onScroll">
    <div v-if="props.workspace.messages.length === 0" class="text-center text-muted py-4 small">
      我是你的 AI 创作助手，试试下方的快捷操作吧
    </div>

    <div v-for="msg in props.workspace.messages" :key="msg.id" class="message-row mb-2" :class="msg.role">
      <!-- 用户消息 -->
      <div v-if="msg.role === 'user'" class="bubble user-bubble">{{ msg.content }}</div>

      <!-- 普通文本 / 错误 / 工具与系统事件 -->
      <div
        v-else-if="msg.type === 'text' || msg.type === 'error' || msg.type === 'tool' || msg.type === 'tool_call' || msg.type === 'system' || msg.type === 'approval_request'"
        class="bubble assistant-bubble"
        :class="{ 'error-bubble': msg.type === 'error' }"
      >
        <div v-if="msg.type !== 'text' && msg.type !== 'error'" class="small fw-bold mb-1">
          {{ messageTypeLabel(msg.type) }}
        </div>
        <div v-if="msg.content" class="msg-text">{{ msg.content }}</div>
        <div v-else-if="isTyping(msg)" class="typing-indicator">正在思考<span class="dots">…</span></div>
        <button
          v-if="msg.type === 'error'"
          class="btn btn-sm btn-outline-primary mt-1"
          @click="props.workspace.retry()"
        >
          重试
        </button>
      </div>

      <!-- 结构化大纲 -->
      <OutlineCard
        v-else-if="msg.type === 'outline' && msg.payload"
        :outline="asOutline(msg.payload)"
        :accepted="props.workspace.outlineAccepted"
        :selected-title="props.workspace.selectedOutlineTitle"
        @select-title="props.workspace.selectOutlineTitle"
        @accept="props.workspace.acceptOutline"
        @reject="props.workspace.rejectOutline"
        @regenerate="props.workspace.regenerateOutline"
        @insert="props.workspace.insertOutline"
      />

      <!-- 结构化审查 -->
      <ReviewCard
        v-else-if="msg.type === 'review' && msg.payload"
        :review="asReview(msg.payload)"
        :issue-states="props.workspace.reviewIssueStates"
        @accept="onAcceptIssue"
        @ignore="onIgnoreIssue"
        @accept-all="props.workspace.acceptAllSafeIssues"
        @locate="onLocateIssue"
      />

      <!-- 文章查询结果 -->
      <ArticleSearchResultCard
        v-else-if="msg.type === 'article_search' && msg.payload"
        :result="asSearchResult(msg.payload)"
        :message="msg.content"
      />

      <!-- 知识库检索结果 -->
      <KnowledgeSearchResult
        v-else-if="msg.type === 'knowledge_search' && msg.payload"
        :results="asKnowledgeResult(msg.payload).items || []"
        :query="queryFromMessage(msg.content)"
      />

      <!-- 文章修改建议 -->
      <template v-else-if="msg.type === 'article_patch' && Array.isArray(msg.payload)">
        <ArticlePatchCard
          v-for="patch in asPatches(msg.payload)"
          :key="patch.id"
          :patch="patch"
          @accept="onAcceptPatch"
          @reject="onRejectPatch"
          @regenerate="onRegeneratePatch"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AgentWorkspace } from '../../hooks/useAgentWorkspace'
import type { AgentMessage, ArticleOutline, ArticlePatch, KnowledgeSearchItem, ReviewIssue, ReviewReport } from '../../types/agent'
import OutlineCard from './OutlineCard.vue'
import ReviewCard from './ReviewCard.vue'
import ArticlePatchCard from './ArticlePatchCard.vue'
import ArticleSearchResultCard from './ArticleSearchResultCard.vue'
import KnowledgeSearchResult from './KnowledgeSearchResult.vue'
import type { ArticleSearchResult } from '../../services/articleService'

const props = defineProps<{
  workspace: AgentWorkspace
}>()

const listRef = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)

interface KnowledgeSearchPayload {
  items: KnowledgeSearchItem[]
  total: number
  embeddingProvider?: string
}

const asOutline = (p: unknown): ArticleOutline => p as ArticleOutline
const asReview = (p: unknown): ReviewReport => p as ReviewReport
const asPatches = (p: unknown): ArticlePatch[] => p as ArticlePatch[]
const asSearchResult = (p: unknown): ArticleSearchResult => p as ArticleSearchResult
const asKnowledgeResult = (p: unknown): KnowledgeSearchPayload => p as KnowledgeSearchPayload

const queryFromMessage = (content: string): string => {
  const match = content.match(/「(.+?)」/)
  return match?.[1] || ''
}

const isTyping = (msg: AgentMessage): boolean =>
  msg.type === 'text' && msg.role === 'assistant' && !msg.content && props.workspace.isGenerating

const messageTypeLabel = (type: AgentMessage['type']): string => {
  const labels: Partial<Record<AgentMessage['type'], string>> = {
    tool: '工具结果',
    tool_call: '工具调用',
    system: '系统提示',
    approval_request: '等待确认'
  }
  return labels[type] || 'AI 消息'
}

const onAcceptPatch = (patch: ArticlePatch) => props.workspace.acceptPatch(patch.id)
const onRejectPatch = (patch: ArticlePatch) => props.workspace.rejectPatch(patch.id)
const onRegeneratePatch = (patch: ArticlePatch) => props.workspace.regeneratePatch(patch.id)
const onAcceptIssue = (issue: ReviewIssue) => props.workspace.acceptReviewIssue(issue.id)
const onIgnoreIssue = (issue: ReviewIssue) => props.workspace.ignoreReviewIssue(issue.id)
const onLocateIssue = (issue: ReviewIssue) => props.workspace.locateReviewIssue(issue)

const onScroll = () => {
  const el = listRef.value
  if (!el) return
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

const scrollToBottom = () => {
  const el = listRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => {
    const msgs = props.workspace.messages
    const last = msgs[msgs.length - 1]
    return [msgs.length, last ? last.content.length : 0]
  },
  () => {
    nextTick(() => {
      if (isNearBottom.value) scrollToBottom()
    })
  }
)
</script>

<style scoped>
.agent-message-list {
  min-height: 0;
  overflow-y: auto;
}
.message-row {
  display: flex;
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.assistant,
.message-row.tool,
.message-row.system {
  justify-content: flex-start;
}
.bubble {
  max-width: 92%;
  padding: 0.5rem 0.7rem;
  border-radius: 0.7rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
}
.user-bubble {
  background-color: #0d6efd;
  color: #fff;
  border-bottom-right-radius: 0.2rem;
}
.assistant-bubble {
  background-color: #f1f3f5;
  color: #212529;
  border-bottom-left-radius: 0.2rem;
}
.error-bubble {
  background-color: #f8d7da;
  color: #721c24;
}
.typing-indicator {
  color: #6c757d;
}
.dots {
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink {
  to {
    visibility: hidden;
  }
}
</style>
