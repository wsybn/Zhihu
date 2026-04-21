<template>
  <nav class="navbar navbar-dark bg-primary justify-content-between mb-4 px-4">
    <router-link class="navbar-brand" to="/">zhihuhu专栏</router-link>
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
import { defineComponent, PropType } from 'vue'
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
      goMyColumn
    }
  }
})
</script>
