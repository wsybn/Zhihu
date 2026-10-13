<template>
  <div class="agent-quick-actions border-top pt-2">
    <div class="small text-muted mb-1">快捷操作</div>
    <div class="d-flex flex-wrap gap-1">
      <button
        v-for="action in actions"
        :key="action.key"
        class="btn btn-sm btn-outline-secondary"
        :disabled="disabled"
        @click="$emit('run', action.key)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { QuickAction } from '../../types/agent'

defineProps<{
  actions: QuickAction[]
  disabled: boolean
}>()

defineEmits(['run'])
</script>
