<template>
  <teleport to="#back">
    <div
      class="d-flex justify-content-center align-items-center h-100 w-100 loading-container"
      :style = "{ backgroundColor: background || '' } "
    >
      <div class="loading-content text-center">
        <div class="loader-spinner spinner-border text-primary mb-2" role="status" aria-hidden="true"></div>
        <span class="visually-hidden">Loading...</span>
        <span v-if="text" class="text-primary small d-block mt-2">{{ text }}</span>
      </div>
    </div>
  </teleport>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import UseDOMCreate from '../hooks/useDOMCreate'
import { defineComponent } from 'vue'

export default defineComponent({
  props: {
    text: {
      type: String
    },
    background: {
      type: String
    }
  },
  name: 'Loader',
  setup() {
    UseDOMCreate('back')
  }
})
</script>

<style>
.loading-container {
  background: rgba(255, 255, 255, .5);
  z-index: 100;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  text-align: center;
  pointer-events: auto;
}
.loader-spinner {
  width: 3rem;
  height: 3rem;
  border-width: 0.25em;
  animation: loader-spin 0.75s linear infinite;
}
@keyframes loader-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
