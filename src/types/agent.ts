// Agent 相关数据类型统一定义。
// 已接入真实 Agent 后端：结构化输出、SSE 标准事件、Run/Step、Tool Calling、RAG。

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

export type AgentMessageType =
  | 'text'
  | 'outline'
  | 'review'
  | 'article_patch'
  | 'article_search'
  | 'knowledge_search'
  | 'tool'
  | 'system'
  | 'tool_call'
  | 'approval_request'
  | 'error'

export interface AgentMessage {
  id: string
  sessionId: string
  role: AgentRole
  type: AgentMessageType
  content: string
  payload?: unknown
  createdAt: string
}

export type AgentSessionStatus = 'active' | 'completed' | 'error'

export interface AgentSession {
  id: string
  title: string
  status: AgentSessionStatus
  createdAt: string
  updatedAt: string
}

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type WorkflowStepKey =
  | 'goal_analysis'
  | 'internal_research'
  | 'outline_generation'
  | 'outline_confirmation'
  | 'section_writing'
  | 'article_review'
  | 'publish_preparation'

export interface WorkflowStep {
  key: WorkflowStepKey
  label: string
  status: WorkflowStepStatus
}

// 与后端 agent_run_steps 对齐
export interface AgentRunStep {
  id: string
  runId?: string
  stepKey: WorkflowStepKey
  status: WorkflowStepStatus
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string | null
  retryCount?: number
  startedAt?: string
  completedAt?: string | null
}

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentRun {
  id: string
  sessionId: string
  type: string
  status: AgentRunStatus
  currentStep: WorkflowStepKey | null
  steps: AgentRunStep[]
  createdAt: string
  updatedAt: string
}

export type ToolCallStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface ToolCallRecord {
  id: string
  toolName: string
  arguments: Record<string, unknown>
  result?: unknown
  error?: string | null
  status: ToolCallStatus
  createdAt: string
}

export interface OutlineSection {
  id: string
  title: string
  keyPoints: string[]
  status: 'pending' | 'writing' | 'completed'
}

export interface ArticleOutline {
  titleCandidates: string[]
  audience: string
  goal: string
  estimatedLength: number
  sections: OutlineSection[]
}

// 与服务端 schema 的规范类别对齐
export type ReviewCategory =
  | 'spelling'
  | 'grammar'
  | 'structure'
  | 'logic'
  | 'format'
  | 'citation'
  | 'technical_accuracy'
  | 'duplicate'
  | 'markdown'

export type ReviewSeverity = 'info' | 'warning' | 'error'

export interface ReviewIssue {
  id: string
  category: ReviewCategory
  severity: ReviewSeverity
  originalText?: string
  message: string
  suggestion?: string
  replacement?: string
  startIndex?: number
  endIndex?: number
}

export interface ReviewReport {
  id: string
  articleId?: string
  score: number
  summary: string
  issues: ReviewIssue[]
  createdAt: string
}

export type ArticlePatchTarget = 'title' | 'content' | 'selection'
export type ArticlePatchOperation = 'replace' | 'append' | 'insert'
export type ArticlePatchStatus = 'pending' | 'accepted' | 'rejected'

export interface ArticlePatch {
  id: string
  target: ArticlePatchTarget
  operation: ArticlePatchOperation
  originalText?: string
  proposedText: string
  reason: string
  status: ArticlePatchStatus
  articleId?: string
  // patch 过期检测：生成时正文的指纹，正文变化后视为过期
  baseContentHash?: string
}

export type QuickActionKey =
  | 'outline'
  | 'research'
  | 'knowledge_search'
  | 'continue'
  | 'polish'
  | 'polish_selection'
  | 'title'
  | 'summary'
  | 'review'
  | 'professional'
  | 'casual'
  | 'zhihu'

export interface QuickAction {
  key: QuickActionKey
  label: string
  prompt: string
  needsSelection?: boolean
}

// ---------- SSE 标准事件 ----------
export type AgentSseEventType =
  | 'run.started'
  | 'step.started'
  | 'message.delta'
  | 'tool.called'
  | 'step.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'

export interface AgentSseEvent {
  runId: string
  stepId: string | null
  timestamp: string
  data: Record<string, unknown>
}

// ---------- 引用 / 知识库 ----------
export interface Citation {
  articleId: string
  title: string
  chunk: string
  score: number
}

export interface ArticleAskResult {
  answer: string
  citations: Citation[]
  confidence: number
  relatedArticles: Citation[]
}

export type RetrievalSource = 'keyword' | 'vector' | 'hybrid'

export interface KnowledgeSearchItem {
  articleId: string
  title: string
  chunk: string
  score: number
  source: RetrievalSource
  metadata: Record<string, unknown>
}

export interface KnowledgeDocument {
  id: string
  articleId: string
  authorId: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface TopicSuggestion {
  title: string
  reason?: string
  relatedTo?: string
}

export interface TopicSuggestionsResult {
  topics: TopicSuggestion[]
}

export interface SeriesGroup {
  name: string
  articleIds: string[]
}

export interface SeriesClassificationResult {
  series: SeriesGroup[]
}
