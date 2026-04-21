const jsonServer = require('json-server')
const path = require('path')
const multer = require('multer')
const fs = require('fs')

const server = jsonServer.create()
const router = jsonServer.router(path.join(__dirname, 'db.json'))
const middlewares = jsonServer.defaults()

server.use(middlewares)
server.use(jsonServer.bodyParser)

// 配置 multer 用于文件上传
// 创建 uploads 目录（如果不存在）
const uploadsDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// 配置存储：保存到 uploads 目录，保留原始文件名
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：时间戳 + 原始文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制文件大小为 5MB
  }
})

// 模拟登录接口：POST /user/login
server.post('/user/login', (req, res) => {
  const { email, password } = req.body || {}
  const db = router.db
  const user = db.get('users').find({ email }).value()
  console.log('login payload from client:', email, password)
  console.log('matched user in db:', user)

  if (!user || password !== user.password) {
    console.log('login failed, password not match or user not found')
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

  // 验证必填字段
  if (!email || !password) {
    return res.status(400).jsonp({
      code: 400,
      error: '邮箱和密码不能为空'
    })
  }

  // 检查邮箱是否已存在
  const existingUser = db.get('users').find({ email }).value()
  if (existingUser) {
    return res.status(409).jsonp({
      code: 409,
      error: '该邮箱已被注册'
    })
  }

  // 生成用户 ID 和 token
  const users = db.get('users').value()
  const newId = String(users.length + 1)
  const token = `mock-token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  // 创建新用户
  const newUser = {
    id: newId,
    name: name || `用户${newId}`,
    email: email,
    password: password,
    columnId: newId,
    token: token
  }

  // 为新用户创建对应的专栏（如果不存在）
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
    console.log('创建新专栏:', newColumn.title)
  }

  // 保存到数据库
  db.get('users').push(newUser).write()

  console.log('register success:', email)

  // 返回用户信息（不包含密码）
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
  // 从请求头获取 token
  const authHeader = req.headers.authorization
  const token = authHeader ? authHeader.replace('Bearer ', '') : (req.query.token || '')

  console.log('fetchCurrentUser - token:', token)

  // 根据 token 查找用户
  let user = null
  if (token) {
    user = db.get('users').find({ token }).value()
    console.log('fetchCurrentUser - found user:', user ? user.email : 'not found')
  }

  // 如果没有 token 或找不到用户，返回未登录错误
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
    return res.status(401).jsonp({
      code: 401,
      error: '未登录'
    })
  }

  const user = db.get('users').find({ token }).value()
  if (!user) {
    return res.status(401).jsonp({
      code: 401,
      error: '未登录'
    })
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
// 如果专栏不存在，尝试根据用户信息创建
server.get('/columns/:id', (req, res) => {
  const db = router.db
  const columnId = req.params.id

  // 先尝试查找专栏
  const column = db.get('columns').find({ id: columnId }).value()

  if (column) {
    // 专栏存在，直接返回
    return res.jsonp(column)
  }

  // 专栏不存在，尝试根据用户信息创建
  // 查找是否有对应的用户
  const user = db.get('users').find({ columnId: columnId }).value()

  if (user) {
    // 找到对应的用户，创建专栏
    const newColumn = {
      id: columnId,
      title: `${user.name || `用户${columnId}`}的专栏`,
      description: `这是 ${user.name || `用户${columnId}`} 专栏的简介`,
      avatar: {
        url: 'http://via.placeholder.com/150'
      }
    }
    db.get('columns').push(newColumn).write()
    console.log('自动创建专栏:', newColumn.title)
    return res.jsonp(newColumn)
  }

  // 既没有专栏也没有对应的用户，返回 404
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

    console.log('文件上传成功:', req.file.originalname)
    console.log('文件保存路径:', req.file.path)
    console.log('文件大小:', req.file.size, 'bytes')

    // 构建文件访问 URL（相对于服务器根目录）
    const fileUrl = `/uploads/${req.file.filename}`

    // 添加延迟，模拟真实上传场景，让 loading 效果可见
    setTimeout(() => {
      // 返回上传成功的信息
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
    }, 1000) // 延迟 1 秒
  } catch (error) {
    console.error('文件上传错误:', error)
    return res.status(500).jsonp({
      code: 500,
      error: '文件上传失败: ' + error.message
    })
  }
}

// 文件上传接口：POST /upload 和 POST /api/upload
// 使用 multer 中间件处理单个文件上传
const uploadHandler = upload.single('file')
server.post('/upload', uploadHandler, handleFileUpload)
server.post('/api/upload', uploadHandler, handleFileUpload)

// 删除已上传的图片：DELETE /api/upload/:filename
// 前端从上传返回的 data.url 中取文件名（/uploads/ 后面的部分）作为 filename 调用即可
server.delete('/api/upload/:filename', (req, res) => {
  const filename = req.params.filename
  if (!filename) {
    return res.status(400).jsonp({ code: 400, error: '缺少文件名' })
  }
  const filePath = path.join(uploadsDir, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).jsonp({ code: 404, error: '文件不存在' })
  }
  try {
    fs.unlinkSync(filePath)
    console.log('文件已删除:', filename)
    return res.jsonp({ code: 0, msg: '删除成功' })
  } catch (err) {
    console.error('删除文件失败:', err)
    return res.status(500).jsonp({ code: 500, error: '删除失败' })
  }
})

// 提供静态文件访问（用于访问上传的文件）
// json-server 基于 express，可以直接使用 express.static
const express = require('express')
server.use('/uploads', express.static(uploadsDir))

// 自定义创建文章接口：POST /columns/:id/posts
server.post('/columns/:id/posts', (req, res) => {
  const db = router.db
  const columnId = req.params.id
  const { title, content, column, image, author } = req.body || {}

  console.log('createPost - columnId from URL:', columnId)
  console.log('createPost - column from body:', column)
  console.log('createPost - request body:', req.body)

  // 验证必填字段
  if (!title || !content) {
    return res.status(400).jsonp({
      code: 400,
      error: '标题和内容不能为空'
    })
  }

  // 使用 URL 中的 columnId，确保文章保存到正确的专栏
  const finalColumnId = columnId || column || '1'

  // 生成文章 ID
  const newId = String(Date.now()) + '-' + Math.random().toString(36).substr(2, 9)

  // 创建新文章
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

  // 保存到数据库
  db.get('posts').push(newPost).write()

  console.log('createPost success - saved to column:', finalColumnId)

  // 返回创建的文章（转换为前端期望的格式）
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

// 其他 REST 接口走 json-server 默认路由
server.use(router)

const port = 3000
server.listen(port, () => {
  console.log(`Mock server is running at http://localhost:${port}`)
})
