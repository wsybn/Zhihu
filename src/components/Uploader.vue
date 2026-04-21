<!-- eslint-disable vue/multi-word-component-names -->
<template>
<div class="file-upload">
  <div class="file-upload-container" @click="triggerUpload" :disabled="fileStatus === 'loading'" v-bind="$attrs">
    <slot v-if="fileStatus === 'loading'" name="loading">
      <button class="btn btn-primary" disabled>上传中....</button>
    </slot>
    <div v-else-if="fileStatus === 'success'" class="upload-success-area" @click.stop>
      <slot name="uploaded" :uploadedData="uploadedData"></slot>
      <button class="btn btn-primary" @click="deleteImage" :disabled="deleting">删除图片</button>
    </div>
    <slot v-else-if="fileStatus === 'error'" name="error">
      <button class="btn btn-primary">上传失败</button>
    </slot>
    <slot v-else name="default">
      <button class="btn btn-primary">点击上传</button>
    </slot>
  </div>
  <input
    type="file"
    class="file-input d-none"
    ref="fileinput"
    @change="handleFileChange"
  >
</div>
</template>
<script lang="ts">
import { defineComponent, PropType, ref, computed, watch } from 'vue'
import axios from 'axios'
import createMessage from './createMessage'

type UploadStatus = 'ready' | 'loading' | 'error' | 'success'
type CheckFunction = (file: File) => boolean
export default defineComponent({
  props: {
    action: {
      type: String,
      required: true
    },
    beforeUpload: {
      type: Function as PropType<CheckFunction>
    },
    uploaded: {
      type: Object
    }
  },
  inheritAttrs: false,
  emits: ['file-upLoad', 'file-upLoad-error'],
  setup(props, context) {
    const fileinput = ref<HTMLInputElement | null>(null)
    const fileStatus = ref<UploadStatus>(props.uploaded ? 'success' : 'ready')
    const uploadedData = ref(props.uploaded)
    watch(
      () => props.uploaded,
      (newValue) => {
        if (newValue) {
          fileStatus.value = 'success'
          uploadedData.value = newValue
        } else {
          fileStatus.value = 'ready'
          uploadedData.value = undefined
        }
      }
    )
    const uploadedFilename = computed(() => {
      const url = uploadedData.value?.data?.url
      if (!url) return ''
      return url.split('/').filter(Boolean).pop() ?? ''
    })
    const deleting = ref(false)
    const triggerUpload = () => {
      if (fileinput.value) {
        fileinput.value.click()
      }
    }
    const deleteImage = () => {
      deleting.value = true
      if (!window.confirm('确定要删除吗？')) {
        deleting.value = false
        return
      }
      axios.delete(`${props.action}/${uploadedFilename.value}`)
        .then(() => {
          fileStatus.value = 'ready'
          uploadedData.value = undefined
        })
        .catch(() => {
          createMessage('删除失败', 'error')
        })
        .then(() => {
          deleting.value = false
        })
    }
    const handleFileChange = (e: Event) => {
      const currentTarget = e.target as HTMLInputElement
      if (currentTarget.files) {
        const files = Array.from(currentTarget.files as FileList)
        if (props.beforeUpload) {
          const result = props.beforeUpload(files[0])
          if (!result) {
            return
          }
        }
        fileStatus.value = 'loading'
        const formData = new FormData()
        formData.append('file', files[0])
        axios.post(props.action, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
          .then(resp => {
            context.emit('file-upLoad', resp.data)
            uploadedData.value = resp.data
            fileStatus.value = 'success'
          })
          .catch((error) => {
            context.emit('file-upLoad-error', { error })
            fileStatus.value = 'error'
          })
          .then(() => {
            if (fileinput.value) {
              fileinput.value.value = ''
            }
          })
      }
    }
    return {
      fileinput,
      triggerUpload,
      fileStatus,
      handleFileChange,
      uploadedData,
      uploadedFilename,
      deleting,
      deleteImage
    }
  }
})
</script>

<style scoped>
.file-upload {
  display: flex;
  align-items: center;
  gap: 10px;
}

.upload-success-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.file-name {
  color: #6c757d;
  font-size: 14px;
}

.d-none {
  display: none;
}
</style>
