import { describe, it, expect, vi } from 'vitest'
import type pino from 'pino'
import { PinoLoggerService } from './pino-logger.service'

const fakePino = () => {
  const calls = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() }
  return { calls, logger: calls as unknown as pino.Logger }
}

describe('PinoLoggerService (tracking) — maps Nest log levels to pino', () => {
  it('log → info, warn → warn, debug → debug, verbose → trace', () => {
    const { calls, logger } = fakePino()
    const svc = new PinoLoggerService(logger)
    svc.log('a', 'Ctx'); svc.warn('b', 'Ctx'); svc.debug('c'); svc.verbose('d')
    expect(calls.info).toHaveBeenCalledWith({ context: 'Ctx' }, 'a')
    expect(calls.warn).toHaveBeenCalledWith({ context: 'Ctx' }, 'b')
    expect(calls.debug).toHaveBeenCalledWith({ context: undefined }, 'c')
    expect(calls.trace).toHaveBeenCalledWith({ context: undefined }, 'd')
  })

  it('error → error, carrying the trace', () => {
    const { calls, logger } = fakePino()
    new PinoLoggerService(logger).error('boom', 'stack…', 'Ctx')
    expect(calls.error).toHaveBeenCalledWith({ context: 'Ctx', trace: 'stack…' }, 'boom')
  })
})
