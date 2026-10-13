<template>
<div class="validate-input-container pb-3">
    <textarea
      v-if="tag === 'textarea'"
      class="form-control"
      :class="{'is-invalid': inputRef.error}"
      @blur="validateInput"
      v-model="inputRef.val"
      @keydown="onKeydown"
      v-bind="$attrs"
    ></textarea>
    <input v-else type="text"
      class="form-control"
      :class="{'is-invalid': inputRef.error}"
      @blur="validateInput"
      v-model="inputRef.val"
      @keydown="onKeydown"
      v-bind="$attrs"
    >
    <span v-if="inputRef.error" class="invalid-feedback">{{inputRef.message}}</span>
  </div>
</template>

<script lang="ts">
import { reactive, computed, PropType, watch, defineComponent, onMounted, ref } from 'vue'
import { emitter } from './ValidateForm.vue'
const emailReg = /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/

interface RuleProp {
  type : 'required'|'email'
  message : string
}
export type RulesProp = RuleProp[]
export type TagType = 'input'|'textarea'
export default defineComponent({
  emits: ['update:modelValue', 'keydown'],
  props: {
    rules: Array as PropType<RulesProp>,
    modelValue: String,
    tag: {
      type: String as PropType<TagType>
    }
  },
  inheritAttrs: false,
  setup (props, contest) {
    // console.log(contest.attrs)
    const inputRef = reactive({
      val: computed({
        get: () => props.modelValue || '',
        set: val => {
          contest.emit('update:modelValue', val)
        }
      }),
      error: false,
      message: ''
    })
    watch(() => props.modelValue, (newvalue) => {
      inputRef.val = newvalue || ''
    })
    const hasInteracted = ref(false) // 标记用户是否已经交互过
    const onKeydown = (e: KeyboardEvent) => {
      contest.emit('keydown', e)
    }
    const validateInput = () => {
      if (props.rules) {
        let firstErrorMsg = ''
        // 按順序檢查規則，找到第一個失敗的規則就停止
        for (const rule of props.rules) {
          let passed = true
          switch (rule.type) {
            case 'required':
              passed = (inputRef.val.trim() !== '')
              break
            case 'email':
              // 如果值為空，跳過 email 驗證（因為 required 規則會處理）
              if (inputRef.val.trim() === '') {
                passed = true
              } else {
                passed = emailReg.test(inputRef.val)
              }
              break
            default:
              break
          }
          if (!passed) {
            firstErrorMsg = rule.message
            break // 找到第一個失敗的規則就停止
          }
        }
        const allPassed = firstErrorMsg === ''
        // 只有在用户已经交互过（输入过内容）后才显示错误
        inputRef.error = !allPassed && hasInteracted.value
        inputRef.message = firstErrorMsg
        return allPassed
      }
      return true
    }
    onMounted(() => {
      emitter.emit('form-item-created', validateInput)
    })
    return {
      inputRef,
      validateInput,
      onKeydown,
      hasInteracted
    }
  }
})
</script>
