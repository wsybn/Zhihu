// server/agent/tools/definitions.js
// 工具定义集合。每个工具：
//   name / description / parameters(JSON Schema) / maxCalls / timeoutMs / execute(args, ctx)
// 约束：只读当前用户有权限的数据；不得直接修改 / 删除文章；不得绕过用户确认。

const deepseek = require('../../ai/deepseekClient')
const outlineSchema = require('../../ai/schemas/outlineSchema')
const patchSchema = require('../../ai/schemas/patchSchema')
const reviewSchema = require('../../ai/schemas/reviewSchema')

// 站内文章搜索（json-server posts）
function buildSearchArticles() {
  return {
    name: 'search_articles',
    description: '按关键词搜索站内已发布文章，返回匹配的文章标题与摘要。用于回答「有没有写过某主题」。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        page: { type: 'number', description: '页码，默认 1' },
        pageSize: { type: 'number', description: '每页条数，默认 10' }
      },
      required: ['query']
    },
    maxCalls: 10,
    timeoutMs: 5000,
    execute: async (args, ctx) => {
      const db = ctx.db
      const q = String(args.query || '').toLowerCase()
      const pageSize = Math.min(50, Math.max(1, Number(args.pageSize) || 10))
      const page = Math.max(1, Number(args.page) || 1)
      const posts = db.get('posts').value() || []
      const matched = posts
        .filter(p => String(p.title || '').toLowerCase().includes(q) || String(p.content || '').toLowerCase().includes(q))
        .map(p => ({
          articleId: String(p.id || ''),
          title: p.title,
          excerpt: (p.excerpt || p.content || '').slice(0, 120),
          createdAt: p.createdAt
        }))
      const total = matched.length
      const start = (page - 1) * pageSize
      return {
        items: matched.slice(start, start + pageSize),
        total,
        page,
        pageSize
      }
    }
  }
}

function buildReadArticle() {
  return {
    name: 'read_article',
    description: '读取一篇站内文章的完整正文。用于引用或了解某篇文章的具体内容。',
    parameters: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: '文章 id' }
      },
      required: ['articleId']
    },
    maxCalls: 20,
    timeoutMs: 5000,
    execute: async (args, ctx) => {
      const db = ctx.db
      const post = db.get('posts').find({ id: String(args.articleId) }).value()
      if (!post) return { found: false }
      return {
        found: true,
        articleId: String(post.id),
        title: post.title,
        content: post.content,
        createdAt: post.createdAt
      }
    }
  }
}

function buildGetCurrentArticleContext() {
  return {
    name: 'get_current_article_context',
    description: '获取当前正在编辑的文章的标题、正文与选中内容，用于围绕当前文章创作。',
    parameters: { type: 'object', properties: {} },
    maxCalls: 5,
    timeoutMs: 1000,
    execute: async (args, ctx) => {
      const current = ctx.currentArticle || {}
      return {
        title: current.title || '',
        content: current.content || '',
        selection: current.selection || ''
      }
    }
  }
}

function buildSearchKnowledgeBase() {
  return {
    name: 'search_knowledge_base',
    description: '在已建索引的个人知识库中检索相关 Chunk，返回带相关度分数的片段。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题或关键词' },
        topK: { type: 'number', description: '返回条数，默认 5' }
      },
      required: ['query']
    },
    maxCalls: 10,
    timeoutMs: 10000,
    execute: async (args, ctx) => {
      const topK = Math.min(20, Math.max(1, Number(args.topK) || 5))
      const authorId = ctx.authorId || ctx.userId
      const results = await ctx.knowledgeService.search(args.query, { topK, authorId })
      return { results }
    }
  }
}

function buildCreateOutline() {
  return {
    name: 'create_outline',
    description: '为当前文章生成结构化大纲（候选标题、目标读者、章节要点）。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' }
      },
      required: []
    },
    maxCalls: 5,
    timeoutMs: 60000,
    execute: async (args, ctx) => {
      const title = args.title || (ctx.currentArticle && ctx.currentArticle.title) || ''
      const content = args.content || (ctx.currentArticle && ctx.currentArticle.content) || ''
      return deepseek.chatJson({
        instructions: '你是中文文章策划助手。输出 ArticleOutline：titleCandidates(string[])、audience、goal、estimatedLength(number)、sections(array)，每个 section 含 id/title/keyPoints(string[])/status(pending)。',
        input: `标题：${title || '暂无'}\n正文：${content || '暂无'}`,
        schema: outlineSchema,
        signal: ctx.signal
      })
    }
  }
}

function buildCreateArticlePatch() {
  return {
    name: 'create_article_patch',
    description: '为文章生成修改建议（补丁）。只返回建议，不直接修改正文。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '润色/续写/优化标题等动作' },
        target: { type: 'string', description: 'title|content|selection' },
        title: { type: 'string' },
        content: { type: 'string' },
        selection: { type: 'string' }
      },
      required: ['action']
    },
    maxCalls: 10,
    timeoutMs: 60000,
    execute: async (args, ctx) => {
      const cur = ctx.currentArticle || {}
      const content = args.content !== undefined ? args.content : cur.content || ''
      const result = await deepseek.chatJson({
        instructions: '你是中文文章编辑。根据 action 与 target 生成 ArticlePatch 数组（可返回对象或数组）。每项含 target、operation(replace|append|insert)、originalText、proposedText、reason、status(pending)。只提出可执行修改，不要覆盖全文。',
        input: `action：${args.action || ''}\ntarget：${args.target || 'content'}\n标题：${args.title !== undefined ? args.title : cur.title || ''}\n正文：${content}\n选中内容：${args.selection !== undefined ? args.selection : cur.selection || ''}`,
        schema: patchSchema.patchList,
        signal: ctx.signal
      })
      return Array.isArray(result) ? result : [result]
    }
  }
}

function buildReviewArticle() {
  return {
    name: 'review_article',
    description: '审查文章，返回结构化审查报告（评分 + 问题列表），只生成建议不改正文。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' }
      },
      required: []
    },
    maxCalls: 5,
    timeoutMs: 60000,
    execute: async (args, ctx) => {
      const cur = ctx.currentArticle || {}
      const title = args.title !== undefined ? args.title : cur.title || ''
      const content = args.content !== undefined ? args.content : cur.content || ''
      const review = await deepseek.chatJson({
        instructions: '你是中文文章审查助手。输出 ReviewReport：score(0-100)、summary、issues(array)。每个 issue 含 severity(error|warning|info)、category、message、suggestion，可选 originalText、replacement、startIndex、endIndex。覆盖错别字、语病、Markdown 格式、标题层级、结构完整性、逻辑冲突、技术结论、引用来源、重复、代码块、概念一致性。',
        input: `请审查以下文章：\n标题：${title || ''}\n正文：${content || ''}`,
        schema: reviewSchema.review,
        signal: ctx.signal
      })
      return { ...review, id: 'review-' + Date.now().toString(36), createdAt: new Date().toISOString() }
    }
  }
}

function buildSuggestTopics() {
  return {
    name: 'suggest_topics',
    description: '根据作者历史文章推荐新选题，返回候选主题列表。',
    parameters: {
      type: 'object',
      properties: {
        authorId: { type: 'string' },
        count: { type: 'number' }
      },
      required: []
    },
    maxCalls: 5,
    timeoutMs: 60000,
    execute: async (args, ctx) => {
      const count = Math.min(10, Math.max(1, Number(args.count) || 5))
      const history = ctx.authorHistory || []
      const topics = await deepseek.chatJson({
        instructions: `你是选题策划助手。基于作者历史文章推荐 ${count} 个新选题。输出 JSON：{ "topics": [{"title": string, "reason": string, "angle": string}] }。`,
        input: `历史文章：${history.map(h => h.title).join('、')}`,
        schema: {
          type: 'object',
          fields: {
            topics: {
              type: 'array',
              required: true,
              minItems: 1,
              maxItems: count,
              item: {
                type: 'object',
                fields: {
                  title: { type: 'string', required: true, maxLength: 100, default: '' },
                  reason: { type: 'string', required: false, maxLength: 300, default: '' },
                  angle: { type: 'string', required: false, maxLength: 300, default: '' }
                }
              }
            }
          }
        },
        signal: ctx.signal
      })
      return topics
    }
  }
}

module.exports = {
  buildSearchArticles,
  buildReadArticle,
  buildGetCurrentArticleContext,
  buildSearchKnowledgeBase,
  buildCreateOutline,
  buildCreateArticlePatch,
  buildReviewArticle,
  buildSuggestTopics
}
