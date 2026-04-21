<template>
  <div class="container">
    <global-header :user="currentUser"></global-header>
    <loader v-if="isLoading"></loader>
    <!-- <message :message="error.message" type="error" v-if="error.status"></message> -->
    <router-view></router-view>
    <footer class="text-center py-4 text-secondary bg-light mt-6">
      <small>
        <ul class="list-inline mb-0">
          <li class="list-inline-item">© 2020 者也专栏</li>
          <li class="list-inline-item">课程</li>
          <li class="list-inline-item">文档</li>
          <li class="list-inline-item">联系</li>
          <li class="list-inline-item">更多</li>
        </ul>
      </small>
    </footer>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, watch } from 'vue'
import 'bootstrap/dist/css/bootstrap.min.css'
import { useStore } from 'vuex'
import GlobalHeader from './components/GlobalHeader.vue'
import { GlobalDataProps } from './store'
// import Message from './components/Message.vue'
import createMessage from './components/createMessage'
import Loader from './components/Loader.vue'

export default defineComponent({
  name: 'App',
  components: {
    GlobalHeader,
    Loader
    // Message
  },
  setup () {
    const store = useStore<GlobalDataProps>()
    const isLoading = computed(() => store.state.loading)
    const currentUser = computed(() => store.state.user)
    const error = computed(() => store.state.error)

    watch(() => error.value.status, (newStatus, oldStatus) => {
      if (newStatus && !oldStatus && error.value.message) {
        createMessage(error.value.message, 'error')
      }
    })
    return {
      currentUser,
      isLoading,
      error
    }
  }
})
</script>

<style>
</style>
