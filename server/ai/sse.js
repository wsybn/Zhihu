// server/ai/sse.js
// SSE 标准事件格式化。每个事件统一携带 { runId, stepId, timestamp, data }。

function now() {
  return new Date().toISOString()
}

// 生成一条 `event: xxx\ndata: {...}\n\n` 帧
function formatSseEvent(eventName, payload = {}) {
  const data = {
    runId: payload.runId || '',
    stepId: payload.stepId !== undefined && payload.stepId !== null ? payload.stepId : null,
    timestamp: now(),
    data: payload.data || {}
  }
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
}

// 事件名白名单（客户端据此分发）
const SSE_EVENTS = [
  'run.started',
  'step.started',
  'message.delta',
  'tool.called',
  'step.completed',
  'run.completed',
  'run.failed',
  'run.cancelled'
]

module.exports = {
  formatSseEvent,
  SSE_EVENTS
}
