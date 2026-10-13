// server/ai/validateStructuredOutput.js
// 轻量 schema 校验器：对 DeepSeek 结构化输出做字段类型、必填、长度、数量、范围校验，
// 支持枚举归一化与默认值填充。返回 { ok, value, errors }。

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function validateField(field, rawValue, path) {
  const errors = []
  let value = rawValue
  const has = rawValue !== undefined && rawValue !== null

  if (!has) {
    if (field.required) {
      if (field.default !== undefined) {
        return { errors: [], value: field.default }
      }
      errors.push(`${path} 缺失`)
      return { errors, value: undefined }
    }
    if (field.default !== undefined) {
      return { errors: [], value: field.default }
    }
    return { errors: [], value: undefined }
  }

  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') {
        // 允许数字转字符串，提升容错
        if (typeof value === 'number') value = String(value)
        else {
          errors.push(`${path} 应为字符串`)
          break
        }
      }
      if (typeof value === 'string') {
        if (field.minLength !== undefined && value.length < field.minLength) {
          errors.push(`${path} 长度不足 ${field.minLength}`)
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          value = value.slice(0, field.maxLength)
        }
      }
      break
    }
    case 'number': {
      if (typeof value !== 'number') {
        if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
          value = Number(value)
        } else {
          errors.push(`${path} 应为数字`)
          break
        }
      }
      if (typeof value === 'number') {
        if (field.min !== undefined && value < field.min) value = field.min
        if (field.max !== undefined && value > field.max) value = field.max
      }
      break
    }
    case 'boolean': {
      if (typeof value !== 'boolean') value = Boolean(value)
      break
    }
    case 'enum': {
      if (field.values && !field.values.includes(value)) {
        if (field.default !== undefined) value = field.default
        else errors.push(`${path} 取值非法，应为 ${field.values.join('|')}`)
      }
      break
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path} 应为数组`)
        break
      }
      if (field.minItems !== undefined && value.length < field.minItems) {
        errors.push(`${path} 数量不足 ${field.minItems}`)
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        value = value.slice(0, field.maxItems)
      }
      if (field.item) {
        value = value.map((item, idx) => {
          const r = validateField(field.item, item, `${path}[${idx}]`)
          errors.push(...r.errors)
          return r.value
        })
      }
      break
    }
    case 'object': {
      if (!isPlainObject(value)) {
        errors.push(`${path} 应为对象`)
        break
      }
      const obj = {}
      for (const key of Object.keys(field.fields || {})) {
        const sub = validateField(field.fields[key], value[key], `${path}.${key}`)
        errors.push(...sub.errors)
        if (sub.value !== undefined) obj[key] = sub.value
      }
      value = obj
      break
    }
    default:
      break
  }

  if (field.normalize && typeof value === 'string') {
    value = field.normalize(value)
  }
  return { errors, value }
}

// 对外唯一入口：校验一个 schema 定义，返回 { ok, value, errors }
function validateAgainstSchema(schema, raw) {
  if (!schema || !schema.type) {
    return { ok: false, value: undefined, errors: ['schema 定义缺失'] }
  }
  const result = validateField(schema, raw, '$')
  return {
    ok: result.errors.length === 0,
    value: result.value,
    errors: result.errors
  }
}

module.exports = {
  validateAgainstSchema,
  validateField,
  isPlainObject
}
