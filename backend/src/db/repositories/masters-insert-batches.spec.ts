import { describe, it, expect, vi } from 'vitest'
import { insertInBatches, MastersRepository } from './masters.repository'

/** SQL Server / tedious hard limit on parameters per prepared statement. */
const SQL_SERVER_PARAM_LIMIT = 2100

describe('insertInBatches (Mesh masters bulk insert under 2100-param cap)', () => {
  it('no-ops on empty rows (does not call insertChunk)', async () => {
    const insertChunk = vi.fn(async () => undefined)
    await insertInBatches([], 100, insertChunk)
    expect(insertChunk).not.toHaveBeenCalled()
  })

  it('single batch when rows fit under batchSize', async () => {
    const insertChunk = vi.fn(async () => undefined)
    const rows = [1, 2, 3]
    await insertInBatches(rows, 10, insertChunk)
    expect(insertChunk).toHaveBeenCalledTimes(1)
    expect(insertChunk).toHaveBeenCalledWith([1, 2, 3])
  })

  it('splits into full batches + remainder, sequential order', async () => {
    const seen: number[][] = []
    await insertInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (chunk) => {
      seen.push([...chunk])
    })
    expect(seen).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })

  it('rejects non-positive batchSize', async () => {
    await expect(insertInBatches([1], 0, async () => undefined)).rejects.toThrow(/batchSize/)
    await expect(insertInBatches([1], -5, async () => undefined)).rejects.toThrow(/batchSize/)
  })

  it('batch constants keep bound params under the SQL Server 2100 limit', () => {
    // Bound columns match insertCustomers / insertVendors / insertForwarders value shapes.
    const customerCols = 6 // code, name, country, contactEmail, address, erpSyncedAt
    const vendorCols = 7 // code, name, type, location, contactEmail, contactPhone, erpSyncedAt
    const forwarderCols = 2 // code, name

    expect(MastersRepository.CUSTOMER_INSERT_BATCH * customerCols).toBeLessThan(SQL_SERVER_PARAM_LIMIT)
    expect(MastersRepository.VENDOR_INSERT_BATCH * vendorCols).toBeLessThan(SQL_SERVER_PARAM_LIMIT)
    expect(MastersRepository.FORWARDER_INSERT_BATCH * forwarderCols).toBeLessThan(SQL_SERVER_PARAM_LIMIT)
  })
})
