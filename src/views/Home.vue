<template>
  <div class="home">
    <section class="py-5 text-center container">
      <div class="row py-lg-5">
        <div class="col-lg-6 col-md-8 mx-auto">
          <img src="../assets/callout.svg" alt="callout" class="hero-callout" width="320" height="180" loading="lazy">
          <h2 class="font-weight-light">随心写作，自由表达</h2>
          <p>
            <router-link to="/created" class="btn btn-primary my-2">开始写文章</router-link>
          </p>
        </div>
      </div>
    </section>
    <section class="home-ai-section card border-0 shadow-sm mb-5 overflow-hidden">
      <div class="row g-0 align-items-stretch">
        <div class="col-lg-5 ai-intro p-4 p-lg-5 d-flex flex-column justify-content-center">
          <span class="badge bg-primary align-self-start mb-3">AI 内容助手</span>
          <h3>先聊一聊，再找到值得读的文章</h3>
          <p class="text-muted mb-3">
            你可以向 AI 咨询创作思路，也可以切换到文章查询模式，用关键词查找站内内容。
          </p>
          <div class="small text-muted">
            示例：如何写一篇技术文章？｜查询 Vue3｜查找性能优化文章
          </div>
        </div>
        <div class="col-lg-7 p-3 p-lg-4 bg-light">
          <HomeAgentPanel :workspace="homeWorkspace" />
        </div>
      </div>
    </section>
    <section v-if="isLogin" class="home-knowledge-section card border-0 shadow-sm mb-5">
      <div class="card-body p-4">
        <h5 class="fw-bold mb-3">📚 个人知识库</h5>
        <div class="row g-3">
          <div class="col-lg-6">
            <TopicSuggestionCard :count="5" />
          </div>
          <div class="col-lg-6">
            <SeriesClassificationCard />
          </div>
        </div>
      </div>
    </section>
    <h4 class="font-weight-bold text-center">发现精彩</h4>
    <div class="discover-section">
      <column-list :list="list"></column-list>
    </div>
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
/* eslint-disable vue/multi-word-component-names */
import { computed, defineComponent, onMounted } from 'vue'
import ColumnList from '../components/ColumnList.vue'
import { useStore } from 'vuex'
import { GlobalDataProps } from '../store'
import useLoadMore from '../hooks/useLoadMore'
import HomeAgentPanel from '../components/agent/HomeAgentPanel.vue'
import TopicSuggestionCard from '../components/agent/TopicSuggestionCard.vue'
import SeriesClassificationCard from '../components/agent/SeriesClassificationCard.vue'
import { useAgentWorkspace } from '../hooks/useAgentWorkspace'

export default defineComponent({
  name: 'Home',
  components: {
    ColumnList,
    HomeAgentPanel,
    TopicSuggestionCard,
    SeriesClassificationCard
  },
  setup () {
    const store = useStore<GlobalDataProps>()
    const list = computed(() => Object.values(store.state.columns.data))
    const total = computed(() => store.getters.getColumnsTotal)
    const isLogin = computed(() => store.state.user.isLogin)
    const homeWorkspace = useAgentWorkspace()
    const { loadMorePage, isLastPage } = useLoadMore(
      'fetchColumnsByPage',
      total,
      {},
      { currentPage: 1, pageSize: 3 }
    )
    onMounted(async () => {
      if (!list.value.length) {
        loadMorePage()
      }
    })
    return {
      list,
      loadMorePage,
      isLastPage,
      isLogin,
      homeWorkspace
    }
  }
})
</script>

<style scoped>
.hero-callout {
  width: min(50%, 320px);
  height: auto;
  display: block;
  margin: 0 auto;
}
.home-ai-section {
  border-radius: 1rem;
}
.ai-intro {
  background: linear-gradient(145deg, #eef5ff, #ffffff);
}
</style>
