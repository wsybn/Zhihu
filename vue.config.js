// vue-cli-service 配置：开发 / E2E 时把 API 请求代理到 mock 后端（localhost:3000）。
// 前端所有请求走同源相对路径，通过 devServer.proxy 转发到后端，避免跨域。
const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  transpileDependencies: true,
  devServer: {
    port: 8080,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/user': { target: 'http://localhost:3000', changeOrigin: true },
      '/columns': { target: 'http://localhost:3000', changeOrigin: true },
      '/posts': { target: 'http://localhost:3000', changeOrigin: true },
      '/upload': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
})
