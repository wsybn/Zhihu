<template>
  <div class="search-page w-75 mx-auto">
    <h4 class="mb-3">搜索结果</h4>

    <div v-if="loading" class="text-center py-5 text-muted">正在搜索…</div>
    <div v-else-if="error" class="text-center py-5 text-danger">{{ error }}</div>
    <div v-else-if="!keyword" class="text-center py-5 text-muted">请输入搜索关键词</div>
    <div v-else-if="items.length === 0" class="text-center py-5 text-muted">
      没有找到与「{{ keyword }}」相关的内容
    </div>

    <template v-else>
      <p class="text-muted small">共 {{ total }} 条结果</p>

      <div v-for="item in items" :key="item.id" class="search-item card mb-3">
        <div class="card-body">
          <h5>
            <router-link :to="`/posts/${item.id}`" v-html="highlight(item.title)"></router-link>
          </h5>
          <p class="text-muted small mb-1">
            {{ item.author }}<span v-if="item.columnId"> · 专栏 {{ item.columnId }}</span>
            <span v-if="item.createdAt"> · {{ formatDate(item.createdAt) }}</span>
          </p>
          <p class="mb-0" v-html="highlight(item.excerpt)"></p>
        </div>
      </div>

      <div v-if="totalPages > 1" class="text-center my-3">
        <button class="btn btn-outline-primary me-2" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
        <span class="mx-2">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button class="btn btn-outline-primary ms-2" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { searchArticles } from '../services/articleService'
import type { ArticleSearchItem } from '../services/articleService'
import { escapeHtml } from '../utils/sanitizeHtml'

const route = useRoute()

const keyword = computed(() => String(route.query.q || '').trim())
const items = ref<ArticleSearchItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const error = ref('')

let controller: AbortController | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const doSearch = async () => {
  controller?.abort()
  controller = new AbortController()

  if (!keyword.value) {
    items.value = []
    total.value = 0
    return
  }

  loading.value = true
  error.value = ''
  try {
    const result = await searchArticles(
      { q: keyword.value, page: page.value, pageSize },
      { signal: controller.signal }
    )
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_CANCELED') return
    error.value = (e as { apiError?: { error?: string } }).apiError?.error || '搜索失败'
  } finally {
    loading.value = false
  }
}

const changePage = (p: number) => {
  page.value = p
  doSearch()
  window.scrollTo({ top: 0 })
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const highlight = (text: string): string => {
  if (!text) return ''
  const escaped = escapeHtml(text)
  if (!keyword.value) return escaped
  const kw = escapeHtml(keyword.value)
  const re = new RegExp(escapeRegExp(kw), 'gi')
  return escaped.replace(re, m => `<mark>${m}</mark>`)
}

const formatDate = (d: string): string => {
  try {
    return new Date(d).toLocaleDateString()
  } catch (e) {
    return d
  }
}

watch(
  () => route.query.q,
  () => {
    page.value = 1
    doSearch()
  },
  { immediate: true }
)

onUnmounted(() => {
  controller?.abort()
})
</script>

<style scoped>
.search-item h5 a {
  text-decoration: none;
  color: #1a1a1a;
}
.search-item h5 a:hover {
  color: #0d6efd;
}
.search-item :deep(mark) {
  background-color: #fff3cd;
  padding: 0 0.1em;
}
</style>
