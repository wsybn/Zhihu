<template>
  <div class="agent-panel d-flex flex-column border rounded bg-white overflow-hidden">
    <div class="agent-panel-header d-flex align-items-center border-bottom px-3 py-2">
      <span class="fw-bold">🤖 AI 创作助手</span>
      <span v-if="workspace.isGenerating" class="badge bg-primary ms-2">生成中…</span>
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

    <div v-if="workspace.activeRunId || workspace.toolCalls.length" class="agent-panel-status border-bottom px-2 py-2">
      <AgentRunTimeline
        v-if="workspace.activeRunId"
        :run-id="workspace.activeRunId"
        :steps="workspace.runSteps"
      />
      <ToolCallStatus :tools="workspace.toolCalls" />
    </div>

    <AgentMessageList :workspace="workspace" class="flex-grow-1" />

    <div class="agent-panel-footer px-2 pb-2">
      <AgentQuickActions
        :actions="workspace.quickActions"
        :disabled="workspace.isGenerating"
        @run="workspace.runQuickAction"
      />
      <AgentInput
        :is-generating="workspace.isGenerating"
        @send="workspace.sendMessage"
        @stop="workspace.stopGeneration"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentWorkspace } from '../../hooks/useAgentWorkspace'
import AgentMessageList from './AgentMessageList.vue'
import AgentQuickActions from './AgentQuickActions.vue'
import AgentInput from './AgentInput.vue'
import AgentRunTimeline from './AgentRunTimeline.vue'
import ToolCallStatus from './ToolCallStatus.vue'

defineProps<{
  workspace: AgentWorkspace
}>()
</script>

<style scoped>
.agent-panel {
  height: min(72vh, 720px);
  min-height: 520px;
  max-height: 720px;
}
.agent-panel-footer {
  flex: 0 0 auto;
  background: #fff;
}
@media (max-width: 991.98px) {
  .agent-panel {
    height: 620px;
    min-height: 520px;
  }
}
</style>
