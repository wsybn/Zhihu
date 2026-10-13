// tests/components/useAgentStream.spec.ts
// 流式 hook：事件分发 / 取消 / 错误处理 / 渲染兜底。
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { streamAgentChat } from '../../src/services/agentService'
import { useAgentStream, simulateDeltaFallback } from '../../src/hooks/useAgentStream'
import type { AgentRun } from '../../src/types/agent'

vi.mock('../../src/services/agentService', () => ({
  streamAgentChat: vi.fn()
}))

const mockStream = streamAgentChat as unknown as ReturnType<typeof vi.fn>

describe('useAgentStream', () => {
  beforeEach(() => {
    mockStream.mockReset()
  })

  it('start 分发 onRunStarted / onDelta / onRunCompleted', async () => {
    mockStream.mockImplementation(async (_payload: unknown, callbacks: any) => {
      callbacks.onRunStarted?.('r1', { id: 'r1' } as AgentRun)
      callbacks.onDelta?.('你好')
      callbacks.onDelta?.('世界')
      callbacks.onRunCompleted?.('r1', '你好世界')
    })

    const stream = useAgentStream()
    const onDelta = vi.fn()
    const onCompleted = vi.fn()
    await stream.start({ message: 'hi' }, { onDelta, onRunCompleted: onCompleted })

    expect(onDelta.mock.calls.map(c => c[0]).join('')).toBe('你好世界')
    expect(onCompleted).toHaveBeenCalledWith('你好世界')
    expect(stream.isStreaming.value).toBe(false)
  })

  it('stop 会中止底层请求，且不把取消当作错误', async () => {
    let capturedSignal: AbortSignal | null = null
    mockStream.mockImplementation((_payload: unknown, _callbacks: unknown, options: any) => {
      capturedSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      })
    })

    const stream = useAgentStream()
    const p = stream.start({ message: 'hi' })
    expect(stream.isStreaming.value).toBe(true)

    stream.stop()
    expect(capturedSignal!.aborted).toBe(true)

    // AbortError 被吞掉（不写入 error，也不触发 onRunFailed）
    await p.catch(() => {})
    expect(stream.error.value).toBeNull()
    expect(stream.isStreaming.value).toBe(false)
  })

  it('非取消错误写入 error 并触发 onRunFailed', async () => {
    mockStream.mockRejectedValue(new Error('network down'))
    const stream = useAgentStream()
    const onFailed = vi.fn()

    await stream.start({ message: 'hi' }, { onRunFailed: onFailed }).catch(() => {})

    expect(stream.error.value).toBe('连接中断，请检查网络后重试。')
    expect(onFailed).toHaveBeenCalled()
    expect(stream.isStreaming.value).toBe(false)
  })
})

describe('simulateDeltaFallback', () => {
  it('把完整文本分段吐出并回调 onDone', () => {
    vi.useFakeTimers()
    const chunks: string[] = []
    const onDone = vi.fn()
    simulateDeltaFallback('abcdef', c => chunks.push(c), onDone, 0)
    vi.runAllTimers()
    expect(chunks.join('')).toBe('abcdef')
    expect(onDone).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('空文本直接 onDone', () => {
    const onDone = vi.fn()
    const cancel = simulateDeltaFallback('', () => {}, onDone)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(cancel()).toBeUndefined()
  })
})
