// server/ai/schemas/reviewSchema.js
// ReviewReport 的服务端 schema 校验定义。
// 类别采用「审查增强」后的规范集合，并允许把模型返回的别名归一化。

// 规范化类别：把常见别名映射到规范集合，未知类别回退为 logic
const CATEGORY_ALIASES = {
  typo: 'spelling',
  misspelling: 'spelling',
  错别字: 'spelling',
  grammar: 'grammar',
  syntax: 'grammar',
  语病: 'grammar',
  structure: 'structure',
  结构: 'structure',
  format: 'format',
  markdown: 'format',
  'md-format': 'format',
  格式: 'format',
  logic: 'logic',
  contradiction: 'logic',
  逻辑: 'logic',
  citation: 'citation',
  reference: 'citation',
  引用: 'citation',
  technical: 'technical_accuracy',
  technical_accuracy: 'technical_accuracy',
  accuracy: 'technical_accuracy',
  技术: 'technical_accuracy',
  duplicate: 'duplicate',
  duplication: 'duplicate',
  重复: 'duplicate'
}

const CANONICAL_CATEGORIES = [
  'spelling', 'grammar', 'structure', 'logic', 'format',
  'citation', 'technical_accuracy', 'duplicate', 'markdown'
]

function normalizeCategory(value) {
  if (typeof value !== 'string') return 'logic'
  const key = value.trim().toLowerCase()
  if (CANONICAL_CATEGORIES.includes(key)) return key
  return CATEGORY_ALIASES[key] || 'logic'
}

const issueField = {
  type: 'object',
  fields: {
    id: { type: 'string', required: false, maxLength: 64, default: '' },
    severity: { type: 'enum', required: true, values: ['error', 'warning', 'info'], default: 'info' },
    category: { type: 'string', required: true, maxLength: 40, normalize: normalizeCategory },
    message: { type: 'string', required: true, minLength: 1, maxLength: 500 },
    originalText: { type: 'string', required: false, maxLength: 8000, default: '' },
    suggestion: { type: 'string', required: false, maxLength: 800, default: '' },
    replacement: { type: 'string', required: false, maxLength: 8000, default: '' },
    startIndex: { type: 'number', required: false, min: 0, max: 1000000, default: undefined },
    endIndex: { type: 'number', required: false, min: 0, max: 1000000, default: undefined }
  }
}

module.exports = {
  review: {
    type: 'object',
    fields: {
      score: { type: 'number', required: true, min: 0, max: 100, default: 80 },
      summary: { type: 'string', required: true, maxLength: 800, default: '' },
      issues: {
        type: 'array',
        required: true,
        minItems: 0,
        maxItems: 50,
        item: issueField
      }
    }
  },
  normalizeCategory
}
