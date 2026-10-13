// 复制自 @vue/eslint-config-standard：用 node + webpack 解析器支持 @/ 别名
const resolver = {
  [require.resolve('eslint-import-resolver-node')]: {}
}

try {
  resolver[require.resolve('eslint-import-resolver-webpack')] = {
    config: require.resolve('@vue/cli-service/webpack.config.js')
  }
} catch (e) {}

module.exports = {
  root: true,
  env: {
    node: true
  },
  extends: [
    'plugin:vue/vue3-essential',
    'standard',
    '@vue/typescript/recommended'
  ],
  parserOptions: {
    ecmaVersion: 2020
  },
  globals: {
    defineProps: 'readonly',
    defineEmits: 'readonly',
    defineExpose: 'readonly',
    withDefaults: 'readonly'
  },
  settings: {
    'import/resolver': resolver,
    'import/extensions': ['.js', '.jsx', '.mjs', '.ts', '.tsx']
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'space-before-function-paren': 'off'
  },
  overrides: [
    {
      // 测试文件允许空函数桩 / 非空断言 / any，避免 mock 代码产生大量 lint 噪音
      files: ['tests/**/*.js', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-unused-vars': 'off'
      }
    }
  ]
}
