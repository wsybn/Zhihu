import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Vue 组件 / 组合式函数（composable）测试配置。
// 只测试 src 下的 .ts / .vue，不涉及后端 node:test（后端用 c8 + node --test 测覆盖）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/components/**/*.spec.ts'],
    setupFiles: ['tests/components/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/hooks/useAgentStream.ts',
        'src/hooks/useAgentWorkspace.ts',
        'src/services/agentService.ts',
        'src/utils/patchApply.ts'
      ],
      // 前端覆盖率门槛：与后端 c8 门槛并列，低于门槛时 test:coverage 失败。
      // agentService.ts 为 HTTP 封装层，其网络行为由 API/E2E 测试间接覆盖，不设独立门槛。
      thresholds: {
        'src/utils/patchApply.ts': {
          statements: 90,
          branches: 90,
          functions: 100,
          lines: 90
        },
        'src/hooks/useAgentWorkspace.ts': {
          statements: 75,
          branches: 60,
          functions: 70,
          lines: 75
        },
        'src/hooks/useAgentStream.ts': {
          statements: 85,
          branches: 85,
          functions: 60,
          lines: 85
        }
      }
    }
  }
})
