// server/repositories/jsonFileStore.js
// 轻量 JSON 文件持久化：为每个 Repository 提供一个集合文件。
// 内部带内存缓存 + 写穿（write-through），业务代码只通过 Repository 访问，
// 不直接操作文件。后续可整体替换为 SQLite / PostgreSQL。

const fs = require('fs')
const path = require('path')

function defaultDataDir() {
  return process.env.AGENT_DATA_DIR || path.join(__dirname, '..', '..', 'mock-server', 'data')
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

class JsonFileStore {
  constructor(collectionName) {
    this.collection = collectionName
    this._data = null
    this._loaded = false
    this._filePath = null
  }

  // 数据目录延迟到首次读写时解析，便于 createApp / 测试注入 AGENT_DATA_DIR 后生效
  _resolvePath() {
    if (!this._filePath) {
      this._filePath = path.join(defaultDataDir(), `${this.collection}.json`)
    }
    return this._filePath
  }

  _load() {
    const filePath = this._resolvePath()
    ensureDir(path.dirname(filePath))
    if (this._loaded) return this._data
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        this._data = Array.isArray(parsed) ? parsed : []
      } else {
        this._data = []
      }
    } catch (e) {
      // 文件损坏时从空集合开始，避免整个服务崩溃
      console.error(`[jsonFileStore] 读取 ${this.collection} 失败，使用空集合:`, e.message)
      this._data = []
    }
    this._loaded = true
    return this._data
  }

  _persist() {
    const filePath = this._resolvePath()
    ensureDir(path.dirname(filePath))
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2), 'utf-8')
    fs.renameSync(tmp, filePath)
  }

  all() {
    return this._load()
  }

  find(predicate) {
    return this._load().find(predicate)
  }

  filter(predicate) {
    return this._load().filter(predicate)
  }

  getById(id) {
    return this._load().find(item => item.id === id)
  }

  insert(item) {
    this._load().push(item)
    this._persist()
    return item
  }

  // 批量插入，单次落盘
  insertMany(items) {
    if (!items || items.length === 0) return
    this._load().push(...items)
    this._persist()
  }

  update(id, patch) {
    const idx = this._load().findIndex(item => item.id === id)
    if (idx === -1) return null
    this._data[idx] = { ...this._data[idx], ...patch, id }
    this._persist()
    return this._data[idx]
  }

  remove(id) {
    const idx = this._load().findIndex(item => item.id === id)
    if (idx === -1) return false
    this._data.splice(idx, 1)
    this._persist()
    return true
  }

  // 按条件删除，返回删除数量
  removeWhere(predicate) {
    const before = this._load().length
    this._data = this._data.filter(item => !predicate(item))
    if (this._data.length !== before) this._persist()
    return before - this._data.length
  }

  // 测试 / 重置用
  clear() {
    this._data = []
    this._loaded = true
    this._persist()
  }

  // 彻底重置：清空缓存并重新解析数据目录（供测试隔离 / 注入新的 AGENT_DATA_DIR 后使用）
  reset() {
    this._data = null
    this._loaded = false
    this._filePath = null
  }
}

module.exports = {
  JsonFileStore,
  defaultDataDir
}
