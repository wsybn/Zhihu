// server/ai/schemas/outlineSchema.js
// ArticleOutline 的服务端 schema 校验定义。

module.exports = {
  type: 'object',
  fields: {
    goal: { type: 'string', required: true, maxLength: 500, default: '' },
    audience: { type: 'string', required: true, maxLength: 500, default: '' },
    estimatedLength: { type: 'number', required: true, min: 100, max: 20000, default: 2000 },
    titleCandidates: {
      type: 'array',
      required: true,
      minItems: 1,
      maxItems: 5,
      item: { type: 'string', minLength: 1, maxLength: 80 }
    },
    sections: {
      type: 'array',
      required: true,
      minItems: 1,
      maxItems: 20,
      item: {
        type: 'object',
        fields: {
          id: { type: 'string', required: true, maxLength: 64, default: '' },
          title: { type: 'string', required: true, maxLength: 120, default: '' },
          keyPoints: {
            type: 'array',
            required: true,
            minItems: 1,
            maxItems: 10,
            item: { type: 'string', minLength: 1, maxLength: 200 }
          },
          status: { type: 'enum', required: false, values: ['pending', 'writing', 'completed'], default: 'pending' }
        }
      }
    }
  }
}
