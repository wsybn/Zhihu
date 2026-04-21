<template>
  <div class="create-post-page">
    <h4>{{ isEditMode ? '编辑文章' : '新建文章' }}</h4>
    <uploader
    :beforeUpload="uploadCheck"
    action="/api/upload"
    @file-upLoad="handleFileUploaded"
    :uploaded="uploadedData"
    class="d-flex align-items-center justify-content-center bg-light text-secondary w-100 my-4"
    >
    <h2>点击上传头图</h2>
    <template #loading>
      <div class="create-post-loading">
        <div class="spinner-border text-secondary" role="status" aria-hidden="true"></div>
        <span class="create-post-loading-text">正在上传...</span>
      </div>
    </template>
    <template #uploaded="dataProps">
      <img v-if="dataProps.uploadedData?.data?.url" :src="uploadedImageUrl(dataProps.uploadedData)" alt="头图" class="w-100">
    </template>
    </uploader>
    <validate-form @form-submit="onFormSubmit">
      <div class="mb-3">
        <label class="form-label">文章标题：</label>
        <validate-input
          :rules="titleRules" v-model="titleVal"
          placeholder="请输入文章标题"
          type="text"
        />
      </div>
      <div class="mb-3">
        <label class="form-label">文章详情：</label>
        <validate-input
          rows="10"
          tag="textarea"
          placeholder="请输入文章详情"
          :rules="contentRules"
          v-model="contentVal"
        />
      </div>
      <template #submit="{ submitForm }">
        <button class="btn btn-primary btn-large" @click.prevent="submitForm">{{ isEditMode ? '更新文章' : '发表文章' }}</button>
      </template>
    </validate-form>
  </div>
</template>
<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { defineComponent, ref, onMounted } from 'vue'
import { useStore } from 'vuex'
import { useRouter, useRoute } from 'vue-router'
import ValidateInput, { RulesProp } from '../components/ValidateInput.vue'
import ValidateForm from '../components/ValidateForm.vue'
import { GlobalDataProps, ImageProps, PostProps, ResponseType } from '../store'
import Uploader from '../components/Uploader.vue'
import { beforeUploadCheck } from '../helper'
import createMessage from '../components/createMessage'
export default defineComponent({
  name: 'CreatePosts',
  components: {
    ValidateForm,
    ValidateInput,
    Uploader
  },
  setup () {
    const uploadedData = ref()
    const titleVal = ref('')
    const router = useRouter()
    const route = useRoute()
    const isEditMode = !!route.query.id
    const store = useStore<GlobalDataProps>()
    let imageUrl = ''
    const titleRules: RulesProp = [
      { type: 'required', message: '文章标题不能为空' }
    ]
    const contentVal = ref('')
    const contentRules: RulesProp = [
      { type: 'required', message: '文章详情不能为空' }
    ]
    onMounted(() => {
      if (isEditMode && route.query.id) {
        const id = String(route.query.id)
        store.dispatch('fetchPost', id).then((rawData: ResponseType<PostProps> | PostProps) => {
          const currentPost = (rawData as ResponseType<PostProps>)?.data || (rawData as PostProps)
          if (!currentPost) return
          // 回填标题与内容
          titleVal.value = currentPost.title || ''
          contentVal.value = currentPost.content || ''
          // 回填图片（兼容字符串或对象）
          if (currentPost.image) {
            const rawUrl = typeof currentPost.image === 'string' ? currentPost.image : currentPost.image.url
            imageUrl = buildImageUrl(rawUrl)
            uploadedData.value = { data: { url: imageUrl } }
          }
        })
      }
    })
    const buildImageUrl = (url?: string) => {
      if (!url) return ''
      return url.startsWith('http') ? url : `http://localhost:3000${url.startsWith('/') ? '' : '/'}${url}`
    }
    const handleFileUploaded = (rawData: ResponseType<ImageProps>) => {
      imageUrl = buildImageUrl(rawData.data.url)
    }
    const onFormSubmit = async (result: boolean) => {
      if (!result) return
      const { columnId, _id } = store.state.user
      if (!columnId) {
        console.warn('用户没有 columnId，跳转到登录页')
        router.push('/login')
        return
      }
      const authorId = _id || store.state.user.id || ''
      const finalColumnId = String(columnId)
      // 根据模式构造发送给后端的数据
      const basePayload = {
        title: titleVal.value,
        content: contentVal.value,
        column: finalColumnId,
        author: authorId,
        image: imageUrl || undefined
      }
      const actionName = isEditMode ? 'updatePost' : 'createPost'
      const sendData = isEditMode
        ? {
            id: String(route.query.id || ''),
            ...basePayload
          }
        : basePayload
      await store.dispatch(actionName, sendData).then(() => {
        createMessage('发表成功，两秒后跳转文章', 'success', 2000)
        setTimeout(() => {
          router.push(`/column/${finalColumnId}`)
        }, 2000)
      })
    }
    const uploadedImageUrl = (data: { data?: { url?: string } } | null | undefined) => {
      return buildImageUrl(data?.data?.url)
    }
    const uploadCheck = (file: File) => {
      const result = beforeUploadCheck(file, { format: ['image/jpeg', 'image/png'], size: 1 })
      const { passed, error } = result
      if (error === 'format') {
        createMessage('上传图片只能是JPG/PNG格式', 'error')
      }
      if (error === 'size') {
        createMessage('上传图片大小不能超过11Mb', 'error')
      }
      return passed
    }
    return {
      titleRules,
      titleVal,
      contentVal,
      contentRules,
      onFormSubmit,
      uploadedImageUrl,
      uploadCheck,
      handleFileUploaded,
      uploadedData,
      isEditMode
    }
  }
})
</script>
<style scoped>
.create-post-page :deep(.file-upload-container) {
  min-height: 200px;
  cursor: pointer;
  overflow: visible;
}
.create-post-page :deep(.file-upload-container img) {
  width: 100%;
  max-height: 200px;
  height: auto;
  object-fit: cover;
  display: block;
}
.create-post-page :deep(.upload-success-area) {
  min-height: 200px;
  align-items: center;
}
.create-post-page :deep(.upload-success-area .btn) {
  flex-shrink: 0;
  margin-top: 0.5rem;
}
.create-post-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  width: 100%;
  height: 100%;
  min-height: 200px;
}
.create-post-loading .spinner-border {
  width: 2.5rem;
  height: 2.5rem;
  border-width: 0.2em;
  animation: create-post-spinner 0.75s linear infinite;
}
.create-post-loading-text {
  font-size: 1rem;
  color: #6c757d;
}
@keyframes create-post-spinner {
  to {
    transform: rotate(360deg);
  }
}
.uploaded-area {
  position: relative;
}
.uploaded-area:hover h3 {
  display: block;
}
.uploaded-area h3 {
  display: none;
  position: absolute;
  color: #999;
  text-align: center;
  width: 100%;
  top: 50%;
}
</style>
