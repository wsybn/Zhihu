<template>
  <div class="home-agent-panel d-flex flex-column border rounded bg-white overflow-hidden">
    <div class="d-flex justify-content-between align-items-center border-bottom px-3 py-2">
      <strong>🤖 AI 内容助手</strong>
      <span v-if="workspace.isGenerating" class="badge bg-primary">处理中…</span>
    </div>

    <div class="mode-switch d-flex gap-2 px-3 pt-3">
      <button
        class="btn btn-sm"
        :class="mode === 'chat' ? 'btn-primary' : 'btn-outline-primary'"
        :disabled="workspace.isGenerating"
        @click="mode = 'chat'"
      >
        AI 对话
      </button>
      <button
        class="btn btn-sm"
        :class="mode === 'search' ? 'btn-primary' : 'btn-outline-primary'"
        :disabled="workspace.isGenerating"
        @click="mode = 'search'"
      >
        查询文章
      </button>
      <button
        class="btn btn-sm ms-auto"
        :class="workspace.agentMode ? 'btn-warning' : 'btn-outline-secondary'"
        :disabled="workspace.isGenerating"
        title="开启后 AI 可自主调用检索工具（站内文章 / 知识库）"
        @click="workspace.setAgentMode(!workspace.agentMode)"
      >
        {{ workspace.agentMode ? '🧠 Agent 模式' : 'Agent 模式' }}
      </button>
    </div>

    <div class="px-3 pt-2 small text-muted">
      {{ mode === 'chat' ? '询问创作思路、文章结构或技术内容。' : '输入关键词，AI 会查询站内相关文章。' }}
    </div>

    <AgentMessageList :workspace="workspace" class="flex-grow-1" />

    <div class="home-agent-footer px-2 pb-2">
      <div class="d-flex flex-wrap gap-1 px-1 pb-2">
        <button
          v-for="example in examples"
          :key="example"
          class="btn btn-sm btn-light border"
          :disabled="workspace.isGenerating"
          @click="submit(example)"
        >
          {{ example }}
        </button>
      </div>
      <AgentInput
        :is-generating="workspace.isGenerating"
        @send="submit"
        @stop="workspace.stopGeneration"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentWorkspace } from '../../hooks/useAgentWorkspace'
import AgentInput from './AgentInput.vue'
import AgentMessageList from './AgentMessageList.vue'

const props = defineProps<{
  workspace: AgentWorkspace
}>()

const mode = ref<'chat' | 'search'>('chat')
const examples = computed(() => mode.value === 'chat'
  ? ['如何开始写技术文章？', '帮我梳理写作思路']
  : ['Vue3', '性能优化', 'Node.js'])

const submit = (text: string) => {
  if (mode.value === 'search') {
    props.workspace.searchArticles(text)
  } else {
    props.workspace.sendMessage(text)
  }
}
</script>

<style scoped>
.home-agent-panel {
  height: 520px;
  max-height: 520px;
}
.home-agent-footer {
  flex: 0 0 auto;
  background: #fff;
}
</style>
