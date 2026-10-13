<template>
  <RecycleScroller
    class="post-list"
    :items="list"
    key-field="id"
    :item-size="220"
    :grid-items="2"
    :item-secondary-size="420"
    v-slot="{ item: post }"
  >
    <article class="card post-card shadow-sm">
      <div class="card-body">
        <h4>
          <router-link :to="`/posts/${post.id}`">
            {{ post.title }}
          </router-link>
        </h4>
        <div class="row my-3 align-items-center">
          <div v-if="post.image" class="col-3">
            <img
              :src="typeof post.image === 'string' ? post.image : post.image?.url"
              :alt="post.title"
              loading="lazy"
              class="rounded-lg w-100"
            >
          </div>
          <p :class="{ 'col-9': post.image }">{{ post.excerpt || post.content }}</p>
        </div>
        <span class="text-muted">{{ post.createdAt }}</span>
      </div>
    </article>
  </RecycleScroller>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { PostProps } from '../store'
export default defineComponent({
  components: {
    RecycleScroller
  },
  props: {
    list: {
      required: true,
      type: Array as PropType<PostProps[]>
    }
  }
})
</script>

<style scoped>
.post-list {
  min-height: 200px;
  max-height: 70vh;
}
.post-card {
  margin: 8px;
  height: 204px;
}
.post-list h4 a {
  text-decoration: none;
  color:#1a1a1a;
}
.post-list h4 a:hover {
  color:#0d6efd;
}
@media (max-width: 900px) {
  .post-list {
    max-height: 60vh;
  }
}
</style>
