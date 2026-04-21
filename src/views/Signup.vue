<template>
  <div>
    <div class="signup-form">
      <validate-form @form-submit="onFormSubmit">
        <div class="mb-3">
          <label class="form-label">邮箱地址</label>
          <validate-input
            :rules="emailRules"
            v-model="emailVal"
            placeholder="请输入邮箱地址"
            type="text"
          />
        </div>
        <div class="mb-3">
          <label class="form-label">昵称</label>
          <validate-input
            :rules="nameRules"
            v-model="nameVal"
            placeholder="请输入昵称"
            type="text"
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
        <div class="mb-3">
          <label class="form-label">重复密码</label>
          <validate-input
            type="password"
            placeholder="请再次输入密码"
            :rules="confirmPasswordRules"
            v-model="confirmPassword"
          />
        </div>
        <template #submit="{ submitForm }">
          <button type="submit" class="btn btn-primary w-100" @click="submitForm">注册新用户</button>
        </template>
      </validate-form>
    </div>
    <div class="mt-3 text-center">
      <span>已有账号？</span>
      <router-link to="/login" class="text-primary">立即登录</router-link>
    </div>
  </div>
</template>

<script lang="ts">
/* eslint-disable vue/multi-word-component-names */
import { defineComponent, ref } from 'vue'
import ValidateInput, { RulesProp } from '@/components/ValidateInput.vue'
import ValidateForm from '@/components/ValidateForm.vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import { GlobalDataProps } from '@/store'
import createMessage from '@/components/createMessage'

export default defineComponent({
  name: 'Signup',
  components: {
    ValidateForm,
    ValidateInput
  },
  setup() {
    const router = useRouter()
    const store = useStore<GlobalDataProps>()
    const emailVal = ref('')
    const nameVal = ref('')
    const password = ref('')
    const confirmPassword = ref('')

    const emailRules: RulesProp = [
      { type: 'required', message: '电子邮箱地址不能为空' },
      { type: 'email', message: '请输入正确的电子邮箱格式' }
    ]

    const nameRules: RulesProp = [
      { type: 'required', message: '昵称不能为空' }
    ]

    const passwordRules: RulesProp = [
      { type: 'required', message: '密码不能为空' }
    ]

    const confirmPasswordRules: RulesProp = [
      { type: 'required', message: '请再次输入密码' }
    ]
    const onFormSubmit = (result: boolean) => {
      if (result) {
        if (password.value !== confirmPassword.value) {
          createMessage('两次输入的密码不一致', 'error')
          return // 密码不一致时停止执行
        }

        // 构建注册数据
        const payload = {
          email: emailVal.value,
          password: password.value,
          name: nameVal.value || undefined
        }

        // 调用注册接口
        store.dispatch('registerAndFetch', payload)
          .then(() => {
            createMessage('注册成功，正在跳转', 'success')
            setTimeout(() => {
              router.push('/')
            }, 1000)
          })
          .catch(err => {
            const errMsg = err.response?.data?.error || '注册失败，请重试'
            createMessage(errMsg, 'error')
            console.error('注册失败：', err)
          })
      }
    }

    return {
      emailVal,
      nameVal,
      password,
      confirmPassword,
      emailRules,
      nameRules,
      passwordRules,
      confirmPasswordRules,
      onFormSubmit
    }
  }
})

</script>

<style scoped>
.signup-form {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
}
</style>
