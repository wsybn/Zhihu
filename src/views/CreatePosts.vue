<template>
  <div class="create-post-page">
    <h4 class="mb-3">{{ isEditMode ? '编辑文章' : '新建文章' }}</h4>

    <div class="row g-3">
      <!-- 左侧：创作流程（小屏隐藏） -->
      <div class="col-12 col-lg-2 d-none d-lg-block">
        <div class="workflow-sidebar border rounded p-3 bg-white">
          <WorkflowSteps :steps="workspace.workflowSteps" />
        </div>
      </div>

      <!-- 中间：文章编辑区 -->
      <div class="col-12 col-lg-6">
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
              :rules="titleRules"
              v-model="titleVal"
              placeholder="请输入文章标题"
              type="text"
            />
          </div>
          <div class="mb-3">
            <label class="form-label">文章详情：</label>
            <validate-input
              id="article-content-editor"
              rows="12"
              tag="textarea"
              placeholder="请输入文章详情，支持 Markdown 语法"
              :rules="contentRules"
              v-model="contentVal"
            />
          </div>
          <template #submit="{ submitForm }">
            <button class="btn btn-primary btn-large" @click.prevent="submitForm">{{ isEditMode ? '更新文章' : '发表文章' }}</button>
          </template>
        </validate-form>
      </div>

      <!-- 右侧：AI 创作助手 -->
      <div class="col-12 col-lg-4">
        <AgentPanel :workspace="workspace" />
      </div>
    </div>
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
import WorkflowSteps from '../components/agent/WorkflowSteps.vue'
import AgentPanel from '../components/agent/AgentPanel.vue'
import { useAgentWorkspace } from '../hooks/useAgentWorkspace'
import { API_BASE_URL } from '../services/http'
import type { ArticlePatch, ReviewIssue } from '../types/agent'
import { applyPatch as applyPatchToContext, applyReviewIssue as applyReviewIssueToContext } from '../utils/patchApply'

const getEditor = (): HTMLTextAreaElement | null => {
  return document.getElementById('article-content-editor') as HTMLTextAreaElement | null
}

export default defineComponent({
  name: 'CreatePosts',
  components: {
    ValidateForm,
    ValidateInput,
    Uploader,
    WorkflowSteps,
    AgentPanel
  },
  setup () {
    const uploadedData = ref()
    const titleVal = ref('')
    const contentVal = ref('')
    const router = useRouter()
    const route = useRoute()
    const isEditMode = !!route.query.id
    const store = useStore<GlobalDataProps>()
    let imageUrl = ''
    const titleRules: RulesProp = [
      { type: 'required', message: '文章标题不能为空' }
    ]
    const contentRules: RulesProp = [
      { type: 'required', message: '文章详情不能为空' }
    ]

    const buildImageUrl = (url?: string) => {
      if (!url) return ''
      return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
    }

    const getSelection = (): string => {
      const editor = getEditor()
      if (editor && editor.selectionStart !== editor.selectionEnd) {
        return editor.value.substring(editor.selectionStart, editor.selectionEnd)
      }
      return ''
    }

    const replaceSelection = (text: string): boolean => {
      const editor = getEditor()
      if (!editor) {
        contentVal.value = contentVal.value ? contentVal.value + '\n\n' + text : text
        return true
      }
      const start = editor.selectionStart
      const end = editor.selectionEnd
      if (start !== end) {
        const val = contentVal.value
        contentVal.value = val.substring(0, start) + text + val.substring(end)
        return true
      } else {
        contentVal.value = contentVal.value ? contentVal.value + '\n\n' + text : text
        return true
      }
    }

    // 接受 ArticlePatch 后，由用户主动点击「接受」才更新正文，AI 不会直接覆盖
    // 纯匹配/替换逻辑位于 src/utils/patchApply.ts，便于单测覆盖「唯一匹配才替换」等安全约束
    const applyPatch = (patch: ArticlePatch): boolean => {
      return applyPatchToContext(patch, {
        getTitle: () => titleVal.value,
        setTitle: (value) => { titleVal.value = value },
        getContent: () => contentVal.value,
        setContent: (value) => { contentVal.value = value },
        hasSelection: () => {
          const editor = getEditor()
          return !!editor && editor.selectionStart !== editor.selectionEnd
        },
        getSelection,
        replaceSelection: (text) => { replaceSelection(text) },
        notify: (message, type) => createMessage(message, type)
      })
    }

    const applyReviewIssue = (issue: ReviewIssue): boolean => {
      return applyReviewIssueToContext(issue, {
        getContent: () => contentVal.value,
        setContent: (value) => { contentVal.value = value },
        notify: (message, type) => createMessage(message, type)
      })
    }

    const locateReviewIssue = (issue: ReviewIssue): void => {
      const editor = getEditor()
      if (!editor || !issue.originalText) return
      const idx = contentVal.value.indexOf(issue.originalText)
      if (idx === -1) {
        createMessage('未在正文中找到对应片段', 'error')
        return
      }
      editor.focus()
      editor.setSelectionRange(idx, idx + issue.originalText.length)
      editor.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    // Agent 工作台状态（页面级，随组件卸载自动清理定时器与请求）
    const workspace = useAgentWorkspace({
      getContext: () => ({
        title: titleVal.value,
        content: contentVal.value,
        selection: getSelection()
      }),
      onPatchAccepted: applyPatch,
      onOutlineInsert: (markdown: string) => {
        contentVal.value = contentVal.value
          ? contentVal.value + '\n\n' + markdown
          : markdown
      },
      onTitleApply: (title: string) => {
        titleVal.value = title
      },
      onReviewApply: applyReviewIssue,
      onReviewLocate: locateReviewIssue
    })

    onMounted(() => {
      if (isEditMode && route.query.id) {
        const id = String(route.query.id)
        store.dispatch('fetchPost', id).then((currentPost: PostProps | undefined) => {
          if (!currentPost) return
          titleVal.value = currentPost.title || ''
          contentVal.value = currentPost.content || ''
          if (currentPost.image) {
            const rawUrl = typeof currentPost.image === 'string' ? currentPost.image : currentPost.image.url
            imageUrl = buildImageUrl(rawUrl)
            uploadedData.value = { data: { url: imageUrl } }
          }
        })
      }
    })

    const handleFileUploaded = (rawData: ResponseType<ImageProps>) => {
      imageUrl = buildImageUrl(rawData.data.url)
    }

    const onFormSubmit = async (result: boolean) => {
      if (!result) return
      const { columnId, id } = store.state.user
      if (!columnId) {
        router.push('/login')
        return
      }
      const authorId = id || ''
      const finalColumnId = String(columnId)
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
      workspace.markPublishPreparation('running')
      try {
        await store.dispatch(actionName, sendData)
        workspace.markPublishPreparation('completed')
        createMessage('发表成功，两秒后跳转文章', 'success', 2000)
        setTimeout(() => {
          router.push(`/column/${finalColumnId}`)
        }, 2000)
      } catch (e) {
        workspace.markPublishPreparation('failed')
      }
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
      isEditMode,
      workspace
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
.workflow-sidebar {
  position: sticky;
  top: 1rem;
}
</style>
