<template>
  <div>
    <Modal
      title="删除文章"
      :visible="modalIsVisible"
      @close="modalIsVisible = false"
      @confirm="hideAndDelete"
    >
      <p>确定要删除这篇文章吗？</p>
    </Modal>
    <div class="article-detail-page w-75 mx-auto" v-if="post">
    <!-- 1. 顶部封面图 -->
    <div class="article-cover mb-4">
      <img
        v-if="post.image"
        :src="typeof post.image === 'string' ? post.image : post.image?.url"
        class="w-100"
        alt="cover"
      >
    </div>

    <!-- 2. 文章标题 -->
    <h2 class="mb-3">{{ post.title }}</h2>

    <!-- 3. 作者信息 + 发布时间（左作者卡片，右日期） -->
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div class="d-flex align-items-center">
        <img
          :src="defaultAvatar"
          class="rounded-circle me-3"
          width="48"
          height="48"
        >
        <div>
          <div class="fw-bold">{{ post.author || '匿名作者' }}</div>
          <div class="text-muted small">作者很低调，什么都没写~</div>
        </div>
      </div>
      <div class="text-muted">
        发布于 {{ formattedDate }}
      </div>
    </div>

    <!-- 4. 正文（markdown 转 html） -->
    <div class="article-content" v-html="htmlContent"></div>

      <!-- 5. 编辑区占位（根据权限显示） -->
      <div v-if="showEditArea" class="article-actions mt-4 p-3 border rounded bg-light">
        <router-link
          type="button"
          class="btn btn-success"
          :to="{ name: 'Created', query: { id: getPostId(post) } }"
        >
          编辑
        </router-link>
        <button type="button" class="btn btn-danger" @click.prevent="modalIsVisible = true">
          删除
        </button>
      </div>
    </div>
    <div v-else class="w-75 mx-auto text-center py-5 text-muted">
      正在加载文章...
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from 'vuex'
import type { GlobalDataProps, PostProps } from '../store'
import { marked } from 'marked'
import Modal from '../components/Model.vue'

export default defineComponent({
  name: 'ArticleDetail',
  components: {
    Modal
  },
  setup () {
    const route = useRoute()
    const router = useRouter()
    const store = useStore<GlobalDataProps>()
    const modalIsVisible = ref(false)
    // 当前文章 id
    const postId = computed(() => String(route.params.id || ''))

    // 当前文章数据
    const post = computed<PostProps | undefined>(() => store.state.currentPost)

    // markdown -> html
    const htmlContent = computed(() =>
      post.value?.content ? marked(post.value.content) : ''
    )

    // 默认头像（可以换成自己的地址）
    const defaultAvatar = 'http://via.placeholder.com/48'

    const getPostId = (p: PostProps & { id?: string }) => {
      return p._id || p.id || ''
    }

    const showEditArea = computed(() => {
      const { isLogin, _id, id } = store.state.user
      if (!isLogin) return false
      const userId = String(_id || id || '')
      if (!userId) return false

      const author = post.value?.author
      if (!author) return false
      const authorId = (() => {
        if (typeof author === 'string') return author
        const a = author as { _id?: string; id?: string }
        return String(a._id || a.id || '')
      })()
      if (!authorId) return false

      return String(authorId) === userId
    })

    const hideAndDelete = async () => {
      if (!post.value) {
        modalIsVisible.value = false
        return
      }
      const id = getPostId(post.value)
      if (!id) {
        modalIsVisible.value = false
        return
      }
      // 删除后跳回该文章所在专栏
      const columnId = post.value.columnId || post.value.column || ''
      await store.dispatch('deletePost', id)
      modalIsVisible.value = false
      if (columnId) {
        router.push(`/column/${columnId}`)
      } else {
        router.push('/')
      }
    }

    // 格式化日期
    const formattedDate = computed(() => {
      if (!post.value?.createdAt) return ''
      return new Date(post.value.createdAt).toLocaleDateString()
    })

    // 进页面时拉取文章详情
    onMounted(() => {
      if (postId.value) {
        store.dispatch('fetchPost', postId.value)
      }
    })

    return {
      post,
      htmlContent,
      defaultAvatar,
      getPostId,
      showEditArea,
      formattedDate,
      modalIsVisible,
      hideAndDelete
    }
  }
})
</script>

<style scoped>
.article-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  background-color: #f8f9fa;
  border-radius: 999px;
  padding: 0.5rem 0.75rem;
}

.article-actions .btn {
  border-radius: 999px;
  padding: 0.35rem 1.1rem;
  font-size: 0.9rem;
  font-weight: 500;
}
</style>
