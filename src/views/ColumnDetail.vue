<template>
  <div class="column-detail-page w-75 mx-auto">
    <div class="column-info row mb-4 border-bottom pb-4 align-items-center" v-if="column">
      <div class="col-3 text-center">
        <img :src="columnAvatar" :alt="column.title" class="rounded-circle border w-100" @error="onAvatarError">
      </div>
      <div class="col-9">
        <h4>{{ column.title }}</h4>
        <p class="text-muted mb-2">{{ columnDescription }}</p>
        <div class="d-flex align-items-center mt-2">
          <img
            :src="columnAuthorAvatar"
            :alt="columnAuthorName"
            class="rounded-circle me-2"
            width="40"
            height="40"
            @error="onAuthorAvatarError"
          >
          <div class="small text-muted">
            <span>{{ columnAuthorName }}</span>
            <span v-if="columnAuthorBio"> · {{ columnAuthorBio }}</span>
          </div>
        </div>
      </div>
    </div>
    <post-list :list="list"></post-list>
    <div class="text-center my-4">
      <button
        class="btn btn-outline-primary"
        :disabled="isLastPage"
        @click="loadMorePage"
      >
        {{ isLastPage ? '已全部加载' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useStore } from 'vuex'
import PostList from '../components/PostList.vue'
import { GlobalDataProps, UserProps } from '../store'
import useLoadMore from '../hooks/useLoadMore'

export default defineComponent({
  components: {
    PostList
  },
  setup () {
    const route = useRoute()
    const store = useStore<GlobalDataProps>()
    const currentId = String(route.params.id || '')
    const total = computed(() => store.getters.getPostsTotalByCid(currentId))
    const { loadMorePage, isLastPage } = useLoadMore(
      'fetchPostsByPage',
      total,
      { cid: currentId },
      { currentPage: 1, pageSize: 3 }
    )
    onMounted(() => {
      store.dispatch('fetchColumn', currentId)
      loadMorePage()
    })
    const column = computed(() => store.getters.getColumnById(currentId))
    const list = computed(() => store.getters.getPostsByCid(currentId))
    const currentUser = computed<UserProps>(() => store.state.user)
    const defaultAvatar = 'http://via.placeholder.com/80'
    const isCurrentUserColumn = computed(() => {
      const userColumnId = currentUser.value?.columnId
      if (!userColumnId) return false
      return String(userColumnId) === String(currentId)
    })
    const columnAvatar = computed(() => {
      if (isCurrentUserColumn.value && currentUser.value?.avatar) {
        return currentUser.value.avatar
      }
      return column.value?.authorAvatar || column.value?.avatar?.url || defaultAvatar
    })
    const columnDescription = computed(() => {
      if (isCurrentUserColumn.value && currentUser.value?.bio) {
        return currentUser.value.bio
      }
      return column.value?.description || ''
    })
    const columnAuthorName = computed(() => {
      if (column.value?.author) {
        return column.value.author
      }
      if (isCurrentUserColumn.value) {
        return currentUser.value?.nickName || currentUser.value?.email || '匿名作者'
      }
      return '匿名作者'
    })
    const columnAuthorAvatar = computed(() => {
      if (column.value?.authorAvatar) {
        return column.value.authorAvatar
      }
      if (isCurrentUserColumn.value && currentUser.value?.avatar) {
        return currentUser.value.avatar
      }
      return defaultAvatar
    })
    const columnAuthorBio = computed(() => {
      if (column.value?.authorBio) {
        return column.value.authorBio
      }
      if (isCurrentUserColumn.value && currentUser.value?.bio) {
        return currentUser.value.bio
      }
      return '作者很低调，什么都没写~'
    })
    const onAvatarError = (event: Event) => {
      const target = event.target as HTMLImageElement
      target.src = defaultAvatar
    }
    const onAuthorAvatarError = (event: Event) => {
      const target = event.target as HTMLImageElement
      target.src = defaultAvatar
    }
    return {
      route,
      column,
      list,
      currentUser,
      defaultAvatar,
      columnAvatar,
      columnDescription,
      columnAuthorName,
      columnAuthorAvatar,
      columnAuthorBio,
      loadMorePage,
      isLastPage,
      onAvatarError,
      onAuthorAvatarError
    }
  }
})
</script>
