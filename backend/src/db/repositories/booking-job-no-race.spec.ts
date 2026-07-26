import { describe, it, expect, vi } from 'vitest'
import { BookingRepository } from './booking.repository'
import { formatJobNo } from '../../common/job-no'

/**
 * job_no is minted as MAX(trailing digits)+1, which is not atomic: concurrent POST /decisions requests
 * that each mint a booking read the SAME sequence, and `uq_bookings_job_no` then rejects all but one
 * (SQL 2627 → an unexplained HTTP 400 at the API edge). Observed live: 6 parallel posts → 5 failures.
 * createWithGeneratedJobNo absorbs that by re-reading the sequence and retrying.
 */

/** tedious surfaces SQL Server errors with the code on the error (or a nested originalError). */
function uniqueViolation(): Error {
  return Object.assign(new Error("Violation of UNIQUE KEY constraint 'uq_bookings_job_no'."), {
    number: 2627,
  })
}

/** createWithGeneratedJobNo is pure orchestration over these two primitives — stub them, no DB needed. */
function makeRepo(seq: () => number, create: (v: { jobNo: string }) => Promise<unknown>) {
  const repo = new BookingRepository({} as never)
  const nextJobSeq = vi.spyOn(repo, 'nextJobSeq').mockImplementation(async () => seq())
  const createSpy = vi.spyOn(repo, 'create').mockImplementation(create as never)
  return { repo, nextJobSeq, create: createSpy }
}

describe('BookingRepository.createWithGeneratedJobNo — job_no concurrency race', () => {
  it('inserts once when nothing collides', async () => {
    const { repo, create } = makeRepo(
      () => 7,
      async (v) => ({ id: 'b1', ...v }),
    )
    const row = (await repo.createWithGeneratedJobNo({})) as { jobNo: string }
    expect(row.jobNo).toBe(formatJobNo(7))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('retries with a FRESH sequence when a concurrent writer takes the job_no', async () => {
    // Concurrent writer owns JOB-2026-0001; our first insert loses, the re-read then sees seq 2.
    const taken = new Set([formatJobNo(1)])
    let nextSeq = 1
    const { repo, nextJobSeq, create } = makeRepo(
      () => nextSeq++,
      async (v) => {
        if (taken.has(v.jobNo)) throw uniqueViolation()
        return { id: 'b2', ...v }
      },
    )

    const row = (await repo.createWithGeneratedJobNo({})) as { jobNo: string }

    expect(row.jobNo).toBe(formatJobNo(2)) // recovered onto the next free number
    expect(create).toHaveBeenCalledTimes(2)
    expect(nextJobSeq).toHaveBeenCalledTimes(2) // re-read, not a blind +1
  })

  it('survives a burst where every writer but one loses', async () => {
    // 8 racers against one shared counter: each collides until it reads past the winners.
    const taken = new Set<string>()
    let counter = 0
    const repos = Array.from({ length: 8 }, () =>
      makeRepo(
        () => counter + 1,
        async (v) => {
          if (taken.has(v.jobNo)) throw uniqueViolation()
          taken.add(v.jobNo)
          counter++
          return { id: v.jobNo, ...v }
        },
      ),
    )
    const rows = (await Promise.all(
      repos.map((r) => r.repo.createWithGeneratedJobNo({})),
    )) as { jobNo: string }[]

    expect(rows).toHaveLength(8)
    expect(new Set(rows.map((r) => r.jobNo)).size).toBe(8) // all distinct, none lost
  })

  it('rethrows a non-unique error immediately (no retry storm)', async () => {
    const { repo, create } = makeRepo(
      () => 1,
      async () => {
        throw new Error('FK violation: customer_id')
      },
    )
    await expect(repo.createWithGeneratedJobNo({})).rejects.toThrow(/FK violation/)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
