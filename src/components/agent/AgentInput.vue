<template>
  <div class="agent-input border-top pt-2">
    <textarea
      v-model="draft"
      class="form-control mb-2"
      rows="2"
      placeholder="向 AI 助手提问…"
      :disabled="isGenerating"
      @keydown.enter.exact.prevent="submit"
    ></textarea>
    <div class="d-flex justify-content-end">
      <button
        v-if="!isGenerating"
        class="btn btn-primary btn-sm"
        :disabled="!draft.trim()"
        @click="submit"
      >
        发送
      </button>
      <button
        v-else
        class="btn btn-outline-danger btn-sm"
        @click="$emit('stop')"
      >
        停止生成
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  isGenerating: boolean
}>()

const emit = defineEmits(['send', 'stop'])

const draft = ref('')

const submit = () => {
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
}
</script>
