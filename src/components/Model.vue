<template>
  <teleport to="#modal">
    <div
      class="modal fade"
      tabindex="-1"
      role="dialog"
      v-if="visible"
      :class="{ show: visible }"
      :style="{ display: visible ? 'block' : 'none' }"
    >
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ title }}</h5>
            <button type="button" class="close" aria-label="Close" @click="onClose">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body">
            <slot></slot>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="onClose">
              取消
            </button>
            <button type="button" class="btn btn-primary" @click="onConfirm">
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { defineComponent } from 'vue'
import useDOMCreate from '../hooks/useDOMCreate'

export default defineComponent({
  name: 'Modal',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    title: {
      type: String
    }
  },
  emits: ['close', 'confirm'],
  setup (props, context) {
    // 确保存在 id 为 modal 的挂载点
    useDOMCreate('modal')
    const onClose = () => {
      context.emit('close')
    }
    const onConfirm = () => {
      context.emit('confirm')
    }
    return {
      onClose,
      onConfirm
    }
  }
})
</script>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-dialog {
  max-width: 520px;
  margin: 0 auto;
}

.modal-content {
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
  border: none;
}

.modal-header {
  border-bottom: 1px solid #f0f0f0;
  padding: 0.75rem 1.25rem;
}

.modal-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.close {
  border: none;
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
  opacity: 0.6;
  padding: 0;
}

.close:hover {
  opacity: 1;
}

.modal-body {
  padding: 1rem 1.25rem;
  font-size: 0.95rem;
}

.modal-footer {
  border-top: 1px solid #f0f0f0;
  padding: 0.75rem 1.25rem;
}

.btn + .btn {
  margin-left: 0.5rem;
}
</style>
