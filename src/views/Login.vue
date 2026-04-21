<template>
  <div class="login-form">
    <validate-form @form-submit="onFormSubmit">
      <div class="mb-3">
        <label class="form-label">邮箱地址</label>
        <validate-input
          :rules="emailRules"
          v-model="emailVal"
          placeholder="请输入邮箱"
          type="text"
          ref="inputRef"
        />
      </div>
      <div class="mb-3">
        <label class="form-label">密码</label>
        <validate-input
          type="password"
          placeholder="请输入密码"
          :rules="passwordRules"
          v-model="password"
        />
      </div>
      <div class="mb-3 form-check">
        <input type="checkbox" class="form-check-input" id="exampleCheck1">
        <label class="form-check-label" for="exampleCheck1">Check me out</label>
      </div>
      <template #submit="{ submitForm }">
        <button type="submit" class="btn btn-danger" @click="submitForm">Submit</button>
      </template>
    </validate-form>
  </div>
  <div class="mt-3 text-center">
  <span>还没有账号？</span>
  <router-link to="/register" class="text-primary">立即注册</router-link>
</div>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineComponent, ref } from 'vue'
import ValidateInput, { RulesProp } from '../components/ValidateInput.vue'
import ValidateForm from '../components/ValidateForm.vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import { GlobalDataProps } from '../store'
import createMessage from '@/components/createMessage'

const emailVal = ref('')
const emailRules: RulesProp = [
  { type: 'required', message: '电子邮箱地址不能为空' },
  { type: 'email', message: '请输入正确的电子邮箱格式' }
]
const password = ref('')
const passwordRules: RulesProp = [
  { type: 'required', message: '密码不能为空' }
]
const inputRef = ref<any>()

export default defineComponent({
  name: 'Login',
  components: {
    ValidateInput,
    ValidateForm
  },
  setup () {
    const router = useRouter()
    const store = useStore<GlobalDataProps>()
    const onFormSubmit = (result: boolean) => {
      if (result) {
        const payload = {
          email: emailVal.value,
          password: password.value
        }
        store.dispatch('loginAndFetch', payload).then(data => {
          createMessage('登陆成功 正在跳转', 'success')
          setTimeout(() => {
            router.push('/')
          }, 1000)
        })
          .catch(err => {
            console.log(err)
          })
      }
    }
    return {
      emailRules,
      emailVal,
      onFormSubmit,
      inputRef,
      password,
      passwordRules
    }
  }
})
</script>

<style scoped>
</style>
