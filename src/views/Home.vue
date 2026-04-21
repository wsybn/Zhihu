<template>
  <div class="home">
    <section class="py-5 text-center container">
      <div class="row py-lg-5">
        <div class="col-lg-6 col-md-8 mx-auto">
          <img src="../assets/callout.svg" alt="callout" class="w-50"/>
          <h2 class="font-weight-light">随心写作，自由表达</h2>
          <uploader action="/api/upload" :before-upload="beforeUpload" @file-up-load="onFileUploaded">
            <template #loading>
              <div class="upload-loading-spinner">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading.....</span>
                </div>
                <span class="upload-loading-text">上传中...</span>
              </div>
            </template>
            <template #uploaded="slotProps">
              <img v-if="slotProps.uploadedData?.data?.url" :src="uploadedImageUrl(slotProps.uploadedData)" width="500" alt="上传的图片">
            </template>
          </uploader>
          <p>
            <router-link to="/created" class="btn btn-primary my-2">开始写文章</router-link>
          </p>
        </div>
      </div>
    </section>
    <h4 class="font-weight-bold text-center">发现精彩</h4>
    <column-list :list="list"></column-list>
  </div>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { computed, defineComponent, onMounted } from 'vue'
import Uploader from '@/components/Uploader.vue'
import ColumnList from '../components/ColumnList.vue'
import { useStore } from 'vuex'
import { GlobalDataProps, ResponseType, ImageProps } from '../store'
import createMessage from '@/components/createMessage'

export default defineComponent({
  name: 'Home',
  components: {
    ColumnList,
    Uploader
  },
  setup () {
    const store = useStore<GlobalDataProps>()
    const list = computed(() => store.state.columns)
    onMounted(() => {
      store.dispatch('fetchColumns')
    })
    const beforeUpload = (file: File) => {
      const isJpg = file.type === 'image/jpeg'
      if (!isJpg) {
        createMessage('只能上传jpg格式的文件！', 'error')
      }
      return isJpg
    }
    const onFileUploaded = (rawData: ResponseType<ImageProps>) => {
      createMessage(`上传图片ID ${rawData.data._id}`, 'success')
    }
    const uploadedImageUrl = (data: ResponseType<ImageProps> | null | undefined) => {
      const url = data?.data?.url
      if (!url) return ''
      return url.startsWith('http') ? url : `http://localhost:3000${url.startsWith('/') ? '' : '/'}${url}`
    }
    return {
      list,
      beforeUpload,
      onFileUploaded,
      uploadedImageUrl
    }
  }
})
</script>

<style scoped>
.upload-loading-spinner {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.upload-loading-spinner .spinner-border {
  width: 2rem;
  height: 2rem;
  border-width: 0.2em;
  animation: upload-spinner-rotate 0.75s linear infinite;
}
.upload-loading-text {
  font-size: 0.875rem;
  color: var(--bs-primary);
}
@keyframes upload-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
