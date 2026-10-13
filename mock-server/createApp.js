// mock-server/createApp.js
// 把 mock 后端做成可注入、可独立测试的 createApp 工厂。
//   返回已注册全部路由、但**未监听端口**的 http server，由调用方决定何时 listen。
//   这样测试可以用 supertest 直接发请求，无需真正占用端口。
//
// 可注入项：
//   - aiClient      假 DeepSeek 客户端（默认走真实 deepseekClient）
//   - dataDir       Agent / 知识库持久化目录（默认 mock-server/data）
//   - databasePath  json-server 数据库文件（默认 mock-server/db.json）
//   - rateLimiter   { check(req, opts) }（默认内存限流）
//   - clock         { now() }（默认 Date.now，用于测试确定性）

require('dotenv').config() // 默认读项目根目录的 .env

const jsonServer = require('json-server')
const path = require('path')
const multer = require('multer')
const fs = require('fs')
const express = require('express')

const deepseek = require('../server/ai/deepseekClient')
const { registerAgentRoutes } = require('../server/routes/agentRoutes')
const knowledgeService = require('../server/knowledge/knowledgeService')
const { createFakeClient } = require('./fakeAiClient')

function createApp(options = {}) {
  const databasePath = options.databasePath || path.join(__dirname, 'db.json')
  if (options.dataDir) {
    process.env.AGENT_DATA_DIR = options.dataDir
  }

  // AI_PROVIDER=fake：注入假 DeepSeek 客户端，E2E / 冒烟测试不消耗真实额度。
  // 显式传入 aiClient 时以 aiClient 优先；fake 模式需补一个哑 key 以通过 hasApiKey 校验。
  if (options.aiClient) {
    deepseek._setClientForTest(options.aiClient)
  } else if (process.env.AI_PROVIDER === 'fake') {
    if (!process.env.DEEPSEEK_API_KEY) {
      process.env.DEEPSEEK_API_KEY = 'fake-key-for-e2e'
    }
    deepseek._setClientForTest(createFakeClient())
  }

  const server = jsonServer.create()
  const router = jsonServer.router(databasePath)
  const middlewares = jsonServer.defaults()

  server.use(middlewares)
  server.use(jsonServer.bodyParser)

  const getAuthUser = req => {
    const header = req.headers.authorization || ''
    const token = header.replace(/^Bearer\s+/i, '').trim()
    return token ? router.db.get('users').find({ token }).value() || null : null
  }

  const sendAuthError = (res, status, error) => res.status(status).jsonp({ code: status, error })
  const requireAuthMiddleware = (req, res, next) => {
    const user = getAuthUser(req)
    if (!user) return sendAuthError(res, 401, '未登录')
    req.authUser = user
    next()
  }

  // 配置 multer 用于文件上传
  const uploadsDir = path.join(__dirname, 'uploads')
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir)
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
      cb(null, uniqueSuffix + '-' + file.originalname)
    }
  })

  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024
    }
  })

  // 模拟登录接口：POST /user/login
  server.post('/user/login', (req, res) => {
    const { email, password } = req.body || {}
    const db = router.db
    const user = db.get('users').find({ email }).value()

    if (!user || password !== user.password) {
      return res.status(404).jsonp({
        code: 404,
        error: '用户不存在或密码错误'
      })
    }

    const { token, password: _pwd, ...safeUser } = user

    return res.jsonp({
      code: 0,
      data: {
        token,
        ...safeUser
      },
      msg: '登录成功'
    })
  })

  // 模拟注册接口：POST /user/register
  server.post('/user/register', (req, res) => {
    const { email, password, name } = req.body || {}
    const db = router.db

    if (!email || !password) {
      return res.status(400).jsonp({
        code: 400,
        error: '邮箱和密码不能为空'
      })
    }

    const existingUser = db.get('users').find({ email }).value()
    if (existingUser) {
      return res.status(409).jsonp({
        code: 409,
        error: '该邮箱已被注册'
      })
    }

    const users = db.get('users').value()
    const newId = String(
      users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1
    )
    const token = `mock-token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const newUser = {
      id: newId,
      name: name || `用户${newId}`,
      email: email,
      password: password,
      columnId: newId,
      token: token
    }

    const existingColumn = db.get('columns').find({ id: newId }).value()
    if (!existingColumn) {
      const newColumn = {
        id: newId,
        title: `${name || `用户${newId}`}的专栏`,
        description: `这是 ${name || `用户${newId}`} 专栏的简介`,
        avatar: {
          url: 'http://via.placeholder.com/150'
        }
      }
      db.get('columns').push(newColumn).write()
    }

    db.get('users').push(newUser).write()

    const { password: _pwd, ...safeUser } = newUser
    return res.jsonp({
      code: 0,
      data: {
        token,
        ...safeUser
      },
      msg: '注册成功'
    })
  })

  // 获取当前用户信息：GET /user/current
  server.get('/user/current', (req, res) => {
    const db = router.db
    const authHeader = req.headers.authorization
    const token = authHeader ? authHeader.replace('Bearer ', '') : (req.query.token || '')

    let user = null
    if (token) {
      user = db.get('users').find({ token }).value()
    }

    if (!token || !user) {
      return res.status(401).jsonp({
        code: 401,
        error: '未登录'
      })
    }

    const { password: _pwd, ...safeUser } = user
    return res.jsonp({
      code: 0,
      data: safeUser,
      msg: '获取成功'
    })
  })

  // 更新当前用户资料：PATCH /user/profile
  server.patch('/user/profile', (req, res) => {
    const db = router.db
    const authHeader = req.headers.authorization
    const token = authHeader ? authHeader.replace('Bearer ', '') : ''

    if (!token) {
      return res.status(401).jsonp({ code: 401, error: '未登录' })
    }

    const user = db.get('users').find({ token }).value()
    if (!user) {
      return res.status(401).jsonp({ code: 401, error: '未登录' })
    }

    const { name, avatar, bio } = req.body || {}
    const updatedUser = { ...user }
    if (typeof name === 'string') updatedUser.name = name
    if (typeof avatar === 'string') updatedUser.avatar = avatar
    if (typeof bio === 'string') updatedUser.bio = bio

    db.get('users').find({ id: user.id }).assign(updatedUser).write()

    const { password: _pwd, ...safeUser } = updatedUser
    return res.jsonp({
      code: 0,
      data: safeUser,
      msg: '资料更新成功'
    })
  })

  // 自定义获取专栏接口：GET /columns/:id
  server.get('/columns/:id', (req, res) => {
    const db = router.db
    const columnId = req.params.id

    const column = db.get('columns').find({ id: columnId }).value()

    if (column) {
      return res.jsonp(column)
    }

    const user = db.get('users').find({ columnId: columnId }).value()

    if (user) {
      const newColumn = {
        id: columnId,
        title: `${user.name || `用户${columnId}`}的专栏`,
        description: `这是 ${user.name || `用户${columnId}`} 专栏的简介`,
        avatar: {
          url: 'http://via.placeholder.com/150'
        }
      }
      db.get('columns').push(newColumn).write()
      return res.jsonp(newColumn)
    }

    return res.status(404).jsonp({
      code: 404,
      error: '专栏不存在'
    })
  })

  // 文件上传处理函数
  const handleFileUpload = (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).jsonp({
          code: 400,
          error: '没有上传文件'
        })
      }

      const fileUrl = `/uploads/${req.file.filename}`
      router.db.get('uploads').push({
        filename: req.file.filename,
        ownerId: req.authUser && String(req.authUser.id),
        originalName: String(req.file.originalname || '').slice(0, 200),
        size: req.file.size,
        createdAt: new Date().toISOString()
      }).write()

      setTimeout(() => {
        res.jsonp({
          code: 0,
          data: {
            url: fileUrl,
            _id: String(Date.now()),
            filename: req.file.originalname,
            size: req.file.size,
            createdAt: new Date().toISOString()
          },
          msg: '上传成功'
        })
      }, 1000)
    } catch (error) {
      console.error('文件上传错误:', error)
      return res.status(500).jsonp({
        code: 500,
        error: '文件上传失败: ' + error.message
      })
    }
  }

  const uploadHandler = upload.single('file')
  server.post('/upload', requireAuthMiddleware, uploadHandler, handleFileUpload)
  server.post('/api/upload', requireAuthMiddleware, uploadHandler, handleFileUpload)

  // 删除已上传的图片：DELETE /api/upload/:filename
  server.delete('/api/upload/:filename', (req, res) => {
    const user = getAuthUser(req)
    if (!user) return sendAuthError(res, 401, '未登录')
    const filename = req.params.filename
    if (!filename) {
      return res.status(400).jsonp({ code: 400, error: '缺少文件名' })
    }
    if (path.basename(filename) !== filename) return res.status(400).jsonp({ code: 400, error: '文件名不合法' })
    const filePath = path.join(uploadsDir, filename)
    if (!fs.existsSync(filePath)) {
      return res.status(404).jsonp({ code: 404, error: '文件不存在' })
    }
    const uploadRecord = router.db.get('uploads').find({ filename }).value()
    if (!uploadRecord) return res.status(404).jsonp({ code: 404, error: '文件记录不存在' })
    if (String(uploadRecord.ownerId) !== String(user.id)) return sendAuthError(res, 403, '无权删除该文件')
    try {
      fs.unlinkSync(filePath)
      router.db.get('uploads').remove({ filename }).write()
      return res.jsonp({ code: 0, msg: '删除成功' })
    } catch (err) {
      console.error('删除文件失败:', err)
      return res.status(500).jsonp({ code: 500, error: '删除失败' })
    }
  })

  server.use('/uploads', express.static(uploadsDir))

  // 自定义创建文章接口：POST /columns/:id/posts
  server.post('/columns/:id/posts', (req, res) => {
    const db = router.db
    const user = getAuthUser(req)
    if (!user) return sendAuthError(res, 401, '未登录')
    const columnId = req.params.id
    const { title, content, column, image, author } = req.body || {}

    if (!title || !content) {
      return res.status(400).jsonp({
        code: 400,
        error: '标题和内容不能为空'
      })
    }

    const finalColumnId = columnId || column || '1'
    if (String(finalColumnId) !== String(user.columnId)) return sendAuthError(res, 403, '只能向自己的专栏创建文章')
    const newId = String(Date.now()) + '-' + Math.random().toString(36).substr(2, 9)

    const newPost = {
      id: newId,
      title: title,
      content: content,
      createdAt: new Date().toISOString(),
      column: finalColumnId,
      columnId: finalColumnId,
      image: image || null,
      author: author || null
    }

    db.get('posts').push(newPost).write()

    knowledgeService.indexArticle(newPost, { authorId: String(finalColumnId) })
      .catch(err => console.error('知识库索引失败（不影响发表）:', err.message))

    return res.jsonp({
      code: 0,
      data: {
        _id: newPost.id,
        title: newPost.title,
        content: newPost.content,
        createdAt: newPost.createdAt,
        column: newPost.column,
        columnId: newPost.columnId,
        image: newPost.image,
        author: newPost.author
      },
      msg: '创建成功'
    })
  })

  // ===================== 文章模糊搜索 =====================
  server.get('/api/articles/search', (req, res) => {
    const db = router.db
    const q = String(req.query.q || '').trim()
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10))

    if (!q) {
      return res.jsonp({ code: 0, data: { items: [], total: 0, page, pageSize }, msg: 'ok' })
    }

    const keyword = q.toLowerCase()
    const posts = db.get('posts').value() || []
    const columns = db.get('columns').value() || []
    const columnById = {}
    columns.forEach(c => { columnById[String(c.id)] = c })

    const resolveAuthor = (post, column) => {
      if (column && column.author) return column.author
      const a = post.author
      if (a && typeof a === 'object') return a.name || a.email || '匿名作者'
      if (a && typeof a === 'string' && !/^\d+$/.test(a)) return a
      return '匿名作者'
    }

    const matched = posts
      .filter(post => {
        const title = String(post.title || '').toLowerCase()
        const content = String(post.content || '').toLowerCase()
        return title.includes(keyword) || content.includes(keyword)
      })
      .map(post => {
        const title = String(post.title || '')
        const content = String(post.content || '')
        const matchedFields = []
        if (title.toLowerCase().includes(keyword)) matchedFields.push('title')
        if (content.toLowerCase().includes(keyword)) matchedFields.push('content')
        const cid = String(post.columnId || post.column || '')
        const column = columnById[cid] || {}
        return {
          id: String(post.id || ''),
          title: title,
          excerpt: (post.excerpt || content).slice(0, 120),
          columnId: cid,
          author: resolveAuthor(post, column),
          createdAt: post.createdAt || '',
          matchedFields: matchedFields
        }
      })

    const total = matched.length
    const start = (page - 1) * pageSize
    const items = matched.slice(start, start + pageSize)

    return res.jsonp({ code: 0, data: { items, total, page, pageSize }, msg: 'ok' })
  })

  // ===================== Agent / 知识库 / 检索 / 问答 API =====================
  registerAgentRoutes(server, { router, rateLimiter: options.rateLimiter, clock: options.clock })

  // 其他 REST 接口走 json-server 默认路由。所有写入默认路由必须先登录，
  // 并对常见资源做归属校验，防止绕过上面的自定义安全路由。
  server.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const user = getAuthUser(req)
    if (!user) return sendAuthError(res, 401, '未登录')
    const postMatch = req.path.match(/^\/posts\/([^/]+)$/)
    const columnMatch = req.path.match(/^\/columns\/([^/]+)$/)
    if (postMatch) {
      const post = router.db.get('posts').find({ id: postMatch[1] }).value()
      if (!post) return sendAuthError(res, 404, '文章不存在')
      if (String(post.columnId || post.column || '') !== String(user.columnId)) return sendAuthError(res, 403, '无权操作他人文章')
    }
    if (columnMatch) {
      const column = router.db.get('columns').find({ id: columnMatch[1] }).value()
      if (!column) return sendAuthError(res, 404, '专栏不存在')
      if (String(column.id) !== String(user.columnId)) return sendAuthError(res, 403, '无权操作他人专栏')
    }
    if (req.path === '/posts' && req.body) {
      const requestedColumn = req.body.columnId || req.body.column
      if (requestedColumn && String(requestedColumn) !== String(user.columnId)) return sendAuthError(res, 403, '只能向自己的专栏创建文章')
    }
    next()
  })
  server.use(router)

  return server
}

module.exports = { createApp }
