// server/ai/schemas/patchSchema.js
// ArticlePatch 的服务端 schema 校验定义。

const patchField = {
  type: 'object',
  fields: {
    id: { type: 'string', required: false, maxLength: 64, default: '' },
    target: { type: 'enum', required: true, values: ['title', 'content', 'selection'], default: 'content' },
    operation: { type: 'enum', required: true, values: ['replace', 'append', 'insert'], default: 'replace' },
    originalText: { type: 'string', required: false, maxLength: 8000, default: '' },
    proposedText: { type: 'string', required: true, minLength: 1, maxLength: 8000 },
    reason: { type: 'string', required: false, maxLength: 500, default: '' },
    status: { type: 'enum', required: false, values: ['pending', 'accepted', 'rejected'], default: 'pending' }
  }
}

module.exports = {
  patch: patchField,
  // article-patch 接口允许返回单个对象或数组，统一规范化为数组
  patchList: {
    type: 'array',
    required: true,
    minItems: 1,
    maxItems: 20,
    item: patchField
  }
}
