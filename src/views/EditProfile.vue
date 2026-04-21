<template>
  <div class="edit-profile-page w-75 mx-auto">
    <h3 class="mb-4">编辑资料</h3>
    <validate-form @form-submit="onSubmit">
      <div class="mb-3">
        <label class="form-label">用户名</label>
        <validate-input
          v-model="name"
          :rules="[{ type: 'required', message: '用户名不能为空' }]"
          placeholder="请输入用户名"
        />
      </div>
      <div class="mb-3">
        <label class="form-label d-block">头像</label>
        <uploader
          action="/api/upload"
          :beforeUpload="uploadCheck"
          :uploaded="uploadedData || undefined"
          @file-upLoad="handleFileUploaded"
          class="d-inline-flex align-items-center justify-content-center bg-light text-secondary w-100 profile-avatar-uploader"
        >
          <template #loading>
            <span>正在上传头像...</span>
          </template>
          <template #uploaded="slotProps">
            <img
              v-if="slotProps.uploadedData?.data?.url"
              :src="uploadedImageUrl(slotProps.uploadedData)"
              alt="头像预览"
              class="rounded-circle"
              width="80"
              height="80"
            >
          </template>
        </uploader>
        <small class="text-muted d-block mt-2">支持 JPG / PNG，大小不超过 1MB</small>
      </div>
      <div class="mb-3">
        <label class="form-label">个性签名</label>
        <validate-input
          tag="textarea"
          rows="3"
          v-model="bio"
          placeholder="一句话介绍自己（可选）"
        />
      </div>
      <template #submit="{ submitForm }">
        <button class="btn btn-primary" @click.prevent="submitForm">保存</button>
      </template>
    </validate-form>
  </div>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { defineComponent, ref } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import ValidateForm from '../components/ValidateForm.vue'
import ValidateInput from '../components/ValidateInput.vue'
import Uploader from '../components/Uploader.vue'
import type { GlobalDataProps, ImageProps, ResponseType } from '../store'
import { beforeUploadCheck } from '../helper'
import createMessage from '../components/createMessage'

export default defineComponent({
  name: 'EditProfile',
  components: {
    ValidateForm,
    ValidateInput,
    Uploader
  },
  setup () {
    const store = useStore<GlobalDataProps>()
    const router = useRouter()

    const currentUser = store.state.user
    const name = ref(currentUser.nickName || currentUser.id || '')
    const avatar = ref(currentUser.avatar || '')
    const bio = ref(currentUser.bio || '')
    const uploadedData = ref<ResponseType<ImageProps> | null>()

    const buildImageUrl = (url?: string) => {
      if (!url) return ''
      return url.startsWith('http') ? url : `http://localhost:3000${url.startsWith('/') ? '' : '/'}${url}`
    }

    // 如果已有头像，初始化预览
    if (avatar.value) {
      uploadedData.value = {
        code: 0,
        msg: '',
        data: { _id: '', url: avatar.value }
      }
    }

    const handleFileUploaded = (rawData: ResponseType<ImageProps>) => {
      const url = buildImageUrl(rawData.data.url)
      avatar.value = url
      uploadedData.value = {
        ...rawData,
        data: {
          ...rawData.data,
          url
        }
      }
    }

    const uploadedImageUrl = (data: ResponseType<ImageProps> | null | undefined) => {
      const url = data?.data?.url
      return buildImageUrl(url)
    }

    const uploadCheck = (file: File) => {
      const result = beforeUploadCheck(file, { format: ['image/jpeg', 'image/png'], size: 1 })
      const { passed, error } = result
      if (error === 'format') {
        createMessage('上传图片只能是 JPG/PNG 格式', 'error')
      }
      if (error === 'size') {
        createMessage('上传图片大小不能超过 1MB', 'error')
      }
      return passed
    }

    const onSubmit = async (ok: boolean) => {
      if (!ok) return
      await store.dispatch('updateProfile', {
        name: name.value,
        avatar: avatar.value,
        bio: bio.value
      })
      createMessage('资料更新成功', 'success')
      router.push('/')
    }

    return {
      name,
      avatar,
      bio,
      uploadedData,
      uploadedImageUrl,
      uploadCheck,
      handleFileUploaded,
      onSubmit
    }
  }
})
</script>

<style scoped>
.edit-profile-page {
  padding-top: 1.5rem;
}

.profile-avatar-uploader {
  min-height: 120px;
  cursor: pointer;
}
</style>
