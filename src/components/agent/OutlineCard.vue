<template>
  <div class="outline-card card mb-2">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>📋 文章大纲</strong>
        <span v-if="accepted" class="badge bg-success">已接受</span>
      </div>

      <div class="outline-meta small mb-2">
        <div><span class="text-muted">创作目标：</span>{{ outline.goal }}</div>
        <div><span class="text-muted">目标读者：</span>{{ outline.audience }}</div>
        <div><span class="text-muted">预计篇幅：</span>约 {{ outline.estimatedLength }} 字</div>
      </div>

      <div class="mb-2">
        <span class="small text-muted">候选标题（点击应用到标题）：</span>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button
            v-for="t in outline.titleCandidates"
            :key="t"
            class="candidate-title btn btn-sm"
            :class="selectedTitle === t ? 'btn-primary' : 'btn-outline-primary'"
            @click="$emit('select-title', t)"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <ol class="outline-sections small mb-2">
        <li v-for="s in outline.sections" :key="s.id" class="mb-1">
          <strong>{{ s.title }}</strong>
          <ul class="mb-0">
            <li v-for="p in s.keyPoints" :key="p">{{ p }}</li>
          </ul>
        </li>
      </ol>

      <div class="d-flex flex-wrap gap-1">
        <button v-if="!accepted" class="btn btn-sm btn-success" @click="$emit('accept')">接受大纲</button>
        <button v-if="!accepted" class="btn btn-sm btn-outline-secondary" @click="$emit('reject')">拒绝</button>
        <button class="btn btn-sm btn-outline-secondary" @click="$emit('regenerate')">重新生成</button>
        <button class="btn btn-sm btn-outline-primary" @click="$emit('insert')">插入正文</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ArticleOutline } from '../../types/agent'

defineProps<{
  outline: ArticleOutline
  accepted: boolean
  selectedTitle: string
}>()

defineEmits(['select-title', 'accept', 'reject', 'regenerate', 'insert'])
</script>
