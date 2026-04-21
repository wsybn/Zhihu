<template>
  <teleport to="#message">
  <div class="message-box d-flex justify-content-between align-items-center"
  :class="classObject" v-if="isVisible">
    <span>{{ message }}</span>
    <button type="button" class="close-btn" aria-label="Close" @click.prevent="hide">
      <span aria-hidden="true">&times;</span>
    </button>
  </div>
</teleport>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { defineComponent, ref, PropType } from 'vue'
import UseDOMCreate from '../hooks/useDOMCreate'
export type MessageType = 'success' | 'error'| 'default'
export default defineComponent({
  props: {
    message: String,
    type: {
      type: String as PropType<MessageType>,
      default: 'default'
    }
  },
  emits: ['close-message'],
  setup(props, context) {
    UseDOMCreate('message')
    const isVisible = ref(true)
    const classObject = {
      'message-success': props.type === 'success',
      'message-error': props.type === 'error',
      'message-default': props.type === 'default'
    }
    const hide = () => {
      isVisible.value = false
      context.emit('close-message', true)
    }
    return {
      isVisible,
      classObject,
      hide
    }
  },
  name: 'Message'
})
</script>

<style scoped>
.message-box {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  z-index: 1050;
  min-width: 200px;
  max-width: 400px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.message-error {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.message-success {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.message-default {
  background-color: #d1ecf1;
  color: #0c5460;
  border: 1px solid #bee5eb;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: #666;
  cursor: pointer;
  padding: 0;
  margin-left: 12px;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}
</style>
