import { useStore } from 'vuex'
import { ref, computed, ComputedRef } from 'vue'

interface LoadParams {
  currentPage: number;
  pageSize: number;
}
type ExtraParams = Record<string, string | number | boolean>
type ExtraParamsResolver = ExtraParams | (() => ExtraParams)
const useLoadMore = (actionName: string, total: ComputedRef<number>,
  extraParams: ExtraParamsResolver = {},
  params: LoadParams = { currentPage: 2, pageSize: 5 }) => {
  const store = useStore()
  const currentPage = ref(params.currentPage)
  const noMoreData = ref(false)
  const requestParams = computed(() => ({
    ...(typeof extraParams === 'function' ? extraParams() : extraParams),
    currentPage: currentPage.value,
    pageSize: params.pageSize
  }))
  const loadMorePage = async () => {
    if (noMoreData.value) return
    const result = await store.dispatch(actionName, requestParams.value)
    const pageList = (() => {
      if (Array.isArray(result)) return result
      if (result?.data?.list && Array.isArray(result.data.list)) return result.data.list
      if (result?.data && Array.isArray(result.data)) return result.data
      return []
    })()
    currentPage.value++
    // 优先使用总数判断；总数不可用时，用“本页数量不足 pageSize”判断到达末页
    if (total.value > 0) {
      noMoreData.value = (currentPage.value - 1) * params.pageSize >= total.value
    } else {
      noMoreData.value = pageList.length < params.pageSize
    }
  }
  const isLastPage = computed(() => {
    return noMoreData.value
  })
  return {
    loadMorePage,
    isLastPage,
    currentPage
  }
}

export default useLoadMore
