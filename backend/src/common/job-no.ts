/** Prefix for generated booking job numbers. Both the generator (committer.nextJobNo) and the
 *  sequence query (booking.repository.nextJobSeq) MUST use this constant — a drift between the two
 *  would reset the sequence to 1 and collide with a just-minted job_no. The year is intentionally a
 *  fixed single family; switching to a per-year scheme (JOB-<year>-NNNN) is a product decision. */
export const JOB_NO_PREFIX = 'JOB-2026-'

/** Format a job number from its sequence, e.g. formatJobNo(7) === 'JOB-2026-0007'. */
export function formatJobNo(seq: number): string {
  return `${JOB_NO_PREFIX}${String(seq).padStart(4, '0')}`
}
