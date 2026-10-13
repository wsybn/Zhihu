// tests/components/agentService.spec.ts
// agentService 纯函数：SSE 帧解析 + 结构化 payload 类型守卫。
import { describe, it, expect } from 'vitest'
import {
  parseSseFrame,
  extractPayload,
  isOutlinePayload,
  isReviewPayload,
  isPatchPayload
} from '../../src/services/agentService'
import type { AgentMessage } from '../../src/types/agent'

describe('parseSseFrame', () => {
  it('解析标准帧：event 名 + data JSON', () => {
    const frame = parseSseFrame(
      'event: message.delta\ndata: {"runId":"r1","stepId":"s1","timestamp":"t","data":{"content":"hi"}}'
    )
    expect(frame).not.toBeNull()
    expect(frame!.name).toBe('message.delta')
    expect(frame!.event.runId).toBe('r1')
    expect(frame!.event.stepId).toBe('s1')
    expect(frame!.event.data.content).toBe('hi')
  })

  it('忽略 id/retry 注释行，容忍 CRLF', () => {
    const frame = parseSseFrame(
      'id: 1\r\nretry: 3000\r\nevent: run.completed\r\ndata: {"runId":"r1","data":{"content":"ok"}}\r\n'
    )
    expect(frame).not.toBeNull()
    expect(frame!.name).toBe('run.completed')
    expect(frame!.event.data.content).toBe('ok')
  })

  it('缺少 data 行返回 null', () => {
    expect(parseSseFrame('event: message.delta\nid: 1')).toBeNull()
  })

  it('data 不是合法 JSON 返回 null', () => {
    expect(parseSseFrame('event: run.started\ndata: {not-json}')).toBeNull()
  })

  it('data 缺少 runId 时回退为空串', () => {
    const frame = parseSseFrame('event: run.cancelled\ndata: {"data":{}}')
    expect(frame).not.toBeNull()
    expect(frame!.event.runId).toBe('')
  })
})

describe('类型守卫与 extractPayload', () => {
  it('extractPayload 原样返回 message.payload', () => {
    const msg = { payload: { a: 1 } } as unknown as AgentMessage
    expect(extractPayload<{ a: number }>(msg)).toEqual({ a: 1 })
  })

  it('isOutlinePayload 只认 sections 数组', () => {
    expect(isOutlinePayload({ sections: [] })).toBe(true)
    expect(isOutlinePayload({ goal: 'g' })).toBe(false)
    expect(isOutlinePayload(null)).toBe(false)
    expect(isOutlinePayload('str')).toBe(false)
  })

  it('isReviewPayload 只认 issues 数组', () => {
    expect(isReviewPayload({ issues: [] })).toBe(true)
    expect(isReviewPayload({ score: 80 })).toBe(false)
    expect(isReviewPayload(undefined)).toBe(false)
  })

  it('isPatchPayload 只认数组', () => {
    expect(isPatchPayload([])).toBe(true)
    expect(isPatchPayload([{ target: 'content' }])).toBe(true)
    expect(isPatchPayload({ target: 'content' })).toBe(false)
    expect(isPatchPayload('x')).toBe(false)
  })
})
