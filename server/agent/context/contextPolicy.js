// 上下文窗口策略集中定义。所有数值都经过范围校验，避免错误环境变量
// 让模型请求直接超过窗口或把可用预算压到负数。

const DEFAULT_CONTEXT_POLICY = Object.freeze({
  contextWindowTokens: 64000,
  reservedOutputTokens: 4000,
  safetyMarginTokens: 2000,
  maxHistoryTokens: 16000,
  maxArticleTokens: 24000,
  maxSelectionTokens: 6000,
  maxRagTokens: 12000,
  maxToolResultTokens: 6000,
  maxSummaryTokens: 2500,
  maxInstructionTokens: 3000,
  minCurrentUserTokens: 1,
  recentTurnsToKeep: 8,
  summaryTriggerRatio: 1.2
})

const LIMITS = {
  contextWindowTokens: [1024, 200000],
  reservedOutputTokens: [256, 50000],
  safetyMarginTokens: [0, 20000],
  maxHistoryTokens: [256, 100000],
  maxArticleTokens: [256, 100000],
  maxSelectionTokens: [64, 50000],
  maxRagTokens: [0, 100000],
  maxToolResultTokens: [64, 50000],
  maxSummaryTokens: [64, 20000],
  maxInstructionTokens: [64, 20000],
  minCurrentUserTokens: [1, 500],
  recentTurnsToKeep: [1, 100],
  summaryTriggerRatio: [1, 10]
}

const ENV_NAMES = {
  contextWindowTokens: 'AGENT_CONTEXT_WINDOW_TOKENS',
  reservedOutputTokens: 'AGENT_RESERVED_OUTPUT_TOKENS',
  safetyMarginTokens: 'AGENT_CONTEXT_SAFETY_MARGIN_TOKENS',
  maxHistoryTokens: 'AGENT_MAX_HISTORY_TOKENS',
  maxArticleTokens: 'AGENT_MAX_ARTICLE_TOKENS',
  maxSelectionTokens: 'AGENT_MAX_SELECTION_TOKENS',
  maxRagTokens: 'AGENT_MAX_RAG_TOKENS',
  maxToolResultTokens: 'AGENT_MAX_TOOL_RESULT_TOKENS',
  maxSummaryTokens: 'AGENT_MAX_SUMMARY_TOKENS',
  maxInstructionTokens: 'AGENT_MAX_INSTRUCTION_TOKENS',
  minCurrentUserTokens: 'AGENT_MIN_CURRENT_USER_TOKENS',
  recentTurnsToKeep: 'AGENT_RECENT_TURNS_TO_KEEP',
  summaryTriggerRatio: 'AGENT_SUMMARY_TRIGGER_RATIO'
}

function validNumber(value, key) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const [min, max] = LIMITS[key]
  if (number < min || number > max) return null
  return key === 'summaryTriggerRatio' ? number : Math.floor(number)
}

function resolveContextPolicy(overrides = {}, env = process.env) {
  const policy = { ...DEFAULT_CONTEXT_POLICY }
  Object.keys(DEFAULT_CONTEXT_POLICY).forEach(key => {
    const raw = overrides[key] !== undefined
      ? overrides[key]
      : (env && env[ENV_NAMES[key]])
    if (raw === undefined || raw === null || raw === '') return
    const parsed = validNumber(raw, key)
    if (parsed !== null) policy[key] = parsed
  })

  const maxInput = policy.contextWindowTokens - policy.reservedOutputTokens - policy.safetyMarginTokens
  if (maxInput < 128) return { ...DEFAULT_CONTEXT_POLICY }
  return policy
}

function getInputBudget(policy) {
  const resolved = resolveContextPolicy(policy)
  return Math.max(1, resolved.contextWindowTokens - resolved.reservedOutputTokens - resolved.safetyMarginTokens)
}

module.exports = {
  DEFAULT_CONTEXT_POLICY,
  resolveContextPolicy,
  getInputBudget
}
