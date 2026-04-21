<template>
  <div class="post-list">
    <article
      v-for="post in list"
      :key="getPostId(post)"
      class="card mb-3 shadow-sm"
    >
      <div class="card-body">
        <h4>
          <router-link :to="`/posts/${getPostId(post)}`">
            {{ post.title }}
          </router-link>
        </h4>
        <div class="row my-3 align-items-center">
          <div v-if="post.image" class="col-3">
            <img
              :src="typeof post.image === 'string' ? post.image : post.image?.url"
              :alt="post.title"
              class="rounded-lg w-100"
            >
          </div>
          <p :class="{ 'col-9': post.image }">{{ post.excerpt || post.content }}</p>
        </div>
        <span class="text-muted">{{ post.createdAt }}</span>
      </div>
    </article>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue'
import { PostProps } from '../store'
export default defineComponent({
  props: {
    list: {
      required: true,
      type: Array as PropType<PostProps[]>
    }
  },
  methods: {
    getPostId (post: PostProps & { id?: string }) {
      return post._id || post.id || ''
    },
    formatDate (dateString: string) {
      return new Date(dateString).toLocaleDateString()
    }
  }
})
</script>

<style scoped>
.post-list h4 a {
  text-decoration: none;
  color:#1a1a1a;
}
.post-list h4 a:hover {
  color:#0d6efd;
}
</style>
