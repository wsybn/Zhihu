<template>
  <div class="row">
    <div v-for="column in columnList" :key="column.id" class="col-4 mb-4">
      <router-link v-if="column.id" :to="`/column/${column.id}`" class="card-link">
      <div class="card h-100 shadow-sm">
    <div class="card-body text-center">
    <img :src="getColumnAvatar(column)" class="rounded-circle border border-light my-3" :alt="column.title" loading="lazy" @error="onAvatarError">
    <h5 class="card-title">{{ column.title }}</h5>
    <p class="card-text text-left">{{ column.description }}</p>
            <div class="btn btn-outline-primary">查看文档</div>
  </div>
</div>
      </router-link>
    </div>
  </div>
</template>

<script  lang="ts">

import { computed, defineComponent, PropType } from 'vue'
import { useStore } from 'vuex'
import { ColumnProps, GlobalDataProps, UserProps } from '@/store'

export default defineComponent({
  name: 'ColumnList',
  props: {
    list: {
      type: Array as PropType<ColumnProps[]>,
      required: true
    }
  },
  setup (props) {
    const store = useStore<GlobalDataProps>()
    const currentUser = computed<UserProps>(() => store.state.user)
    const defaultAvatar = 'http://via.placeholder.com/80'
    const columnList = computed(() => {
      return props.list
    })
    const isCurrentUserColumn = (column: ColumnProps) => {
      const uid = currentUser.value.columnId
      if (!uid) return false
      return String(column.id) === String(uid)
    }
    const getColumnAvatar = (column: ColumnProps) => {
      if (isCurrentUserColumn(column) && currentUser.value.avatar) {
        return currentUser.value.avatar
      }
      return column.authorAvatar || column.avatar?.url || defaultAvatar
    }
    const onAvatarError = (event: Event) => {
      const target = event.target as HTMLImageElement
      target.src = defaultAvatar
    }
    return {
      columnList,
      getColumnAvatar,
      onAvatarError
    }
  }
})
</script>

<style scoped>
.card-body img {
  width: 50px;
  height: 50px;
}
.card-link {
  text-decoration: none;
  color: inherit;
  display: block;
  transition: transform 0.2s;
}
.card-link:hover {
  text-decoration: none;
  color: inherit;
  transform: translateY(-4px);
}
.card-link:hover .card {
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15) !important;
}
</style>
