<template>
  <div class="row">
    <div v-for="column in columnList" :key="getColumnId(column)" class="col-4 mb-4">
      <router-link v-if="getColumnId(column)" :to="`/column/${getColumnId(column)}`" class="card-link">
      <div class="card h-100 shadow-sm">
    <div class="card-body text-center">
    <img :src="column.avatar&&column.avatar.url" class="rounded-circle border border-light my-3" :alt="column.title">
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
import { ColumnProps } from '@/store'

export default defineComponent({
  name: 'ColumnList',
  props: {
    list: {
      type: Array as PropType<ColumnProps[]>,
      required: true
    }
  },
  setup (props) {
    const columnList = computed(() => {
      return props.list.map(column => {
        if (!column.avatar) {
          column.avatar = {
            url: require('../assets/column.jpg')
          }
        }
        // 移除 OSS 处理参数，避免 SSL 证书错误
        // 如果需要图片处理，应该在服务端完成
        return column
      })
    })
    // 获取专栏 ID，兼容 _id 和 id 字段
    const getColumnId = (column: ColumnProps & { id?: string }) => {
      return column._id || column.id || ''
    }
    return {
      columnList,
      getColumnId
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
