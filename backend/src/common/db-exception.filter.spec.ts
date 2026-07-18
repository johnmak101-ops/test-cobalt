import { describe, it, expect, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { DbExceptionFilter } from './db-exception.filter'

function mockHost(json = vi.fn()) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => ({
          json: (body: unknown) => {
            json(code, body)
            return body
          },
        }),
      }),
    }),
  } as never
}

describe('DbExceptionFilter', () => {
  const filter = new DbExceptionFilter()

  it('maps SQL 547 (CHECK/FK) to 400 with a clean message', () => {
    const json = vi.fn()
    filter.catch(Object.assign(new Error('ck_shipments_qty_unit'), { number: 547 }), mockHost(json))
    expect(json).toHaveBeenCalledWith(
      400,
      expect.objectContaining({
        statusCode: 400,
        message: "One of the values isn't allowed.",
      }),
    )
  })

  it('maps nested originalError.info.number 2627 (unique) to 400', () => {
    const json = vi.fn()
    filter.catch(
      { message: 'dup', originalError: { info: { number: 2627 } } },
      mockHost(json),
    )
    expect(json).toHaveBeenCalledWith(400, expect.objectContaining({ statusCode: 400 }))
  })

  it('maps 2601 and 515 the same way', () => {
    for (const number of [2601, 515]) {
      const json = vi.fn()
      filter.catch(Object.assign(new Error('x'), { number }), mockHost(json))
      expect(json).toHaveBeenCalledWith(400, expect.objectContaining({ statusCode: 400 }))
    }
  })

  it('passes HttpException through with its own status and message', () => {
    const json = vi.fn()
    filter.catch(new BadRequestException('Total Quantity cannot be negative'), mockHost(json))
    expect(json).toHaveBeenCalledWith(
      400,
      expect.objectContaining({
        statusCode: 400,
        message: 'Total Quantity cannot be negative',
      }),
    )
  })

  it('maps a plain Error to 500 without echoing internals as the constraint message', () => {
    const json = vi.fn()
    filter.catch(new Error('boom secret details'), mockHost(json))
    expect(json).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    )
  })
})
