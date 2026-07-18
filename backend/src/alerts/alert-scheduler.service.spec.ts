import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AlertSchedulerService } from './alert-scheduler.service'
import type { AlertEvaluatorService } from './alert-evaluator.service'

describe('AlertSchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete process.env.ALERT_EVAL_INTERVAL_MS
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.ALERT_EVAL_INTERVAL_MS
  })

  const envConfig = { get: (k: string) => process.env[k] } as any
  const make = (evaluate = vi.fn().mockResolvedValue({ evaluated: 2, fired: 1 })) => {
    const evaluator = { evaluate } as unknown as AlertEvaluatorService
    const svc = new AlertSchedulerService(evaluator, envConfig)
    return { svc, evaluate }
  }

  it('tick runs the evaluator and returns counts', async () => {
    const { svc, evaluate } = make()
    const r = await svc.tick('test')
    expect(evaluate).toHaveBeenCalledOnce()
    expect(r).toEqual({ evaluated: 2, fired: 1 })
  })

  it('skips overlapping ticks while a run is in flight', async () => {
    let resolveEval!: (v: { evaluated: number; fired: number }) => void
    const evaluate = vi.fn(
      () =>
        new Promise<{ evaluated: number; fired: number }>((res) => {
          resolveEval = res
        }),
    )
    const { svc } = make(evaluate)
    const first = svc.tick('a')
    const second = await svc.tick('b')
    expect(second).toBeNull()
    expect(evaluate).toHaveBeenCalledOnce()
    resolveEval({ evaluated: 1, fired: 0 })
    await first
  })

  it('onModuleInit schedules boot + interval when interval > 0', async () => {
    process.env.ALERT_EVAL_INTERVAL_MS = String(60_000)
    const { svc, evaluate } = make()
    svc.onModuleInit()
    expect(evaluate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(evaluate).toHaveBeenCalledTimes(2)
    svc.onModuleDestroy()
  })

  it('onModuleInit does nothing when ALERT_EVAL_INTERVAL_MS is 0', async () => {
    process.env.ALERT_EVAL_INTERVAL_MS = '0'
    const { svc, evaluate } = make()
    svc.onModuleInit()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(evaluate).not.toHaveBeenCalled()
  })
})
