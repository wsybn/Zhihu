// Agent 流式输出 hook：消费真实后端 SSE 标准事件。
// 不再使用 setTimeout 逐字模拟（已移除）。
//
// 【fallback 说明】仅当 SSE 流式请求本身失败、但上层已通过非流式接口拿到完整结果时，
// 才调用 simulateDeltaFallback 将完整文本分段渲染出来。它是「渲染兜底」，不是 AI 结果，
// 不会凭空伪造内容，且调用点会显式标注为 fallback。

import { ref, onUnmounted, getCurrentInstance } from 'vue'
import { streamAgentChat } from '../services/agentService'
import type { ChatRequest, ToolCallEvent } from '../services/agentService'
import type { AgentMessage, AgentRun, AgentSseEvent } from '../types/agent'

export interface StreamCallbacks {
  onEvent?: (event: AgentSseEvent) => void
  onRunStarted?: (runId: string, run: AgentRun) => void
  onStepStarted?: (stepKey: string, stepId: string) => void
  onDelta?: (chunk: string) => void
  onToolCalled?: (event: ToolCallEvent) => void
  onStepCompleted?: (stepKey: string) => void
  onRunCompleted?: (content: string, message?: AgentMessage, run?: AgentRun) => void
  onRunFailed?: (error: unknown) => void
  onRunCancelled?: () => void
}

export interface AgentStream {
  isStreaming: import('vue').Ref<boolean>
  runId: import('vue').Ref<string>
  currentStepId: import('vue').Ref<string | null>
  error: import('vue').Ref<string | null>
  start: (payload: ChatRequest, callbacks?: StreamCallbacks) => Promise<void>
  stop: () => void
}

export function useAgentStream(): AgentStream {
  const isStreaming = ref(false)
  const runId = ref('')
  const currentStepId = ref<string | null>(null)
  const error = ref<string | null>(null)

  let abortController: AbortController | null = null

  const stop = () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    isStreaming.value = false
  }

  const start = async (
    payload: ChatRequest,
    callbacks: StreamCallbacks = {}
  ): Promise<void> => {
    stop()
    error.value = null
    isStreaming.value = true
    abortController = new AbortController()

    try {
      await streamAgentChat(
        payload,
        {
          onRunStarted: (id, run) => {
            runId.value = id
            callbacks.onRunStarted?.(id, run)
          },
          onStepStarted: (id, stepId, stepKey) => {
            currentStepId.value = stepId
            callbacks.onStepStarted?.(stepKey, stepId)
          },
          onDelta: chunk => callbacks.onDelta?.(chunk),
          onToolCalled: event => callbacks.onToolCalled?.(event),
          onStepCompleted: (id, stepId, stepKey) => callbacks.onStepCompleted?.(stepKey),
          onRunCompleted: (id, content, message, run) => {
            if (message || run) callbacks.onRunCompleted?.(content, message, run)
            else callbacks.onRunCompleted?.(content)
          },
          onRunFailed: (id, err) => {
            error.value = 'AI 生成失败'
            callbacks.onRunFailed?.(err)
          },
          onRunCancelled: () => callbacks.onRunCancelled?.(),
          onEvent: callbacks.onEvent
        },
        { signal: abortController.signal }
      )
    } catch (e) {
      const aborted = (e as { name?: string }).name === 'AbortError'
      if (!aborted) {
        error.value = '连接中断，请检查网络后重试。'
        callbacks.onRunFailed?.(e)
      }
      // 重新抛出，让上层（useAgentWorkspace）据此区分「用户主动停止」与「失败」，
      // 从而保留已显示内容或标记失败。
      throw e
    } finally {
      isStreaming.value = false
      abortController = null
    }
  }

  if (getCurrentInstance()) onUnmounted(stop)

  return { isStreaming, runId, currentStepId, error, start, stop }
}

// 【fallback】SSE 流式不可用、但已拿到完整文本时的渲染兜底。
// 不生成任何新内容，只把传入的完整文本分段吐出，让界面保持流式观感。
export function simulateDeltaFallback(
  fullText: string,
  onDelta: (chunk: string) => void,
  onDone: () => void,
  delay = 16
): () => void {
  if (!fullText) {
    onDone()
    return () => undefined
  }
  let index = 0
  let timer: number | null = null
  const tick = () => {
    if (index >= fullText.length) {
      onDone()
      return
    }
    const chunk = fullText.slice(index, index + 3)
    index += 3
    onDelta(chunk)
    timer = window.setTimeout(tick, delay)
  }
  timer = window.setTimeout(tick, delay)
  return () => {
    if (timer !== null) window.clearTimeout(timer)
  }
}
