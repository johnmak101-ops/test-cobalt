import { describe, expect, it } from 'vitest'
import { MultiBookingBackfillController } from './multi-booking-backfill.controller'
import type { MultiBookingBackfillService } from './multi-booking-backfill.service'
import type { AuthUser } from '../auth/auth.service'

/**
 * `change_log.actor_user_id` is a **uniqueidentifier**, not nvarchar. The controller used to send
 * `actor?.email ?? actor?.id`, and because `AuthUser.email` is non-optional the `?? id` fallback could
 * never fire — so every authenticated apply pushed an address at a GUID column (SQL Server 8169), and it
 * did so AFTER the shipment row was already stamped, since the stamp and the audit row are not one
 * transaction. Result: shipment stamped, `applied: 0`, HTTP 500, and a re-run then skips the shipment as
 * already-stamped so the count never reconciles.
 *
 * These assert the CONTRACT (a GUID reaches the audit column), not the shape of today's code.
 */
describe('MultiBookingBackfillController — the audit actor is a user id, never an email', () => {
  const GUID = 'ae9f5cc2-6083-4af0-aead-3c91052e1799'
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  /** A real prod account: every one of the three has a non-GUID email (`admin@cobalt.hk` &c.). */
  const actor: AuthUser = {
    id: GUID,
    email: 'admin@cobalt.hk',
    name: 'Admin',
    role: 'ADMIN',
    mustReset: false,
  }

  const harness = () => {
    const seen: { actor?: string }[] = []
    const svc = {
      apply: async (opts: { actor?: string }) => {
        seen.push(opts)
        return { dryRun: false as const, applied: 0, skipped: 0, shipmentIds: [], stamp: '' }
      },
    } as unknown as MultiBookingBackfillService
    return { seen, ctl: new MultiBookingBackfillController(svc) }
  }

  it('forwards the user id, and it is GUID-shaped', async () => {
    const { seen, ctl } = harness()
    await ctl.apply({ confirm: true }, actor)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.actor).toBe(GUID)
    expect(seen[0]!.actor).toMatch(GUID_RE)
  })

  it('never forwards the email — the column would reject it with 8169', async () => {
    const { seen, ctl } = harness()
    await ctl.apply({ confirm: true }, actor)
    expect(seen[0]!.actor).not.toBe(actor.email)
    expect(seen[0]!.actor).not.toContain('@')
  })

  it('holds even when the email would have won a `??` chain', async () => {
    // The old bug was invisible precisely because email is ALWAYS present. Pin that case.
    const { seen, ctl } = harness()
    await ctl.apply({ confirm: true }, { ...actor, email: 'super@cobalt.hk' })
    expect(seen[0]!.actor).toBe(GUID)
  })

  it('still refuses to apply without confirm, and calls nothing', async () => {
    const { seen, ctl } = harness()
    const res = await ctl.apply({ confirm: false }, actor)
    expect(res).toMatchObject({ error: 'confirm must be true' })
    expect(seen).toHaveLength(0)
  })
})
