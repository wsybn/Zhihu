<template>
  <nav class="navbar app-navbar navbar-dark bg-primary justify-content-between mb-4 px-4">
    <div class="d-flex align-items-center flex-grow-1 me-3">
      <router-link class="navbar-brand mb-0" to="/">zhihuhu专栏</router-link>
      <form class="d-flex flex-grow-1" style="max-width: 420px;" @submit.prevent="onSearch">
        <input
          v-model="keyword"
          class="form-control form-control-sm"
          type="search"
          placeholder="搜索文章标题或正文…"
          aria-label="搜索文章"
        >
        <button class="btn btn-outline-light btn-sm ms-2" type="submit">搜索</button>
      </form>
    </div>
    <ul v-if="!user.isLogin" class="list-inline mb-0">
      <li class="list-inline-item"><router-link to="login" class="btn btn-outline-light my-2">登录</router-link></li>
      <li class="list-inline-item"><router-link to="/register" class="btn btn-outline-light my-2">注册</router-link></li>
    </ul>
    <ul v-else class="list-inline mb-0">
      <li class="list-inline-item">
        <drop-down :title="`你好 ${user.nickName }`">
          <dropdown-item>
            <a href="#" class="dropdown-item" @click.prevent="goMyColumn">我的专栏</a>
          </dropdown-item>
          <dropdown-item>
            <router-link to="/created" class="dropdown-item">新建文章</router-link>
          </dropdown-item>
          <dropdown-item>
            <router-link to="/profile/edit" class="dropdown-item">编辑资料</router-link>
          </dropdown-item>
          <dropdown-item>
            <a href="#" class="dropdown-item" @click.prevent="handleLogout">退出登录</a>
          </dropdown-item>
        </drop-down>
      </li>
    </ul>
  </nav>
</template>

<script lang="ts">
import { defineComponent, PropType, ref } from 'vue'
import DropDown from './DropDown.vue'
import DropDownItem from './DropDownItem.vue'
import { UserProps, GlobalDataProps } from '../store'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import createMessage from './createMessage'

export default defineComponent({
  name: 'GlobalHeader',
  components: {
    DropDown,
    'dropdown-item': DropDownItem
  },
  props: {
    user: {
      type: Object as PropType<UserProps>,
      required: true
    }
  },
  setup () {
    const store = useStore<GlobalDataProps>()
    const router = useRouter()
    const keyword = ref('')

    const onSearch = () => {
      const q = keyword.value.trim()
      router.push({ path: '/search', query: q ? { q } : {} })
    }

    const handleLogout = () => {
      store.dispatch('logout')
      router.push('/')
    }

    const goMyColumn = () => {
      const { columnId } = store.state.user
      if (!columnId) {
        createMessage('当前用户还没有专栏', 'error')
        return
      }
      router.push(`/column/${columnId}`)
    }

    return {
      handleLogout,
      goMyColumn,
      keyword,
      onSearch
    }
  }
})
</script>

<style scoped>
.app-navbar {
  min-height: 76px;
}
</style>
