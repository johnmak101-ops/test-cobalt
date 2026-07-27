# ShipTrack — deferred / open work

Fabric SQL migration and Kysely ports are **done** (see `docs/architecture/fabric-sql-migration.md`,
`docs/architecture/adr-database-platform.md`).

## Active themes

- Mesh / master miss UX (forwarders not in Mesh still surface as review ops notes)
- Review desk / Hybrid-C residual polish
- Docker + dual-stack test deploy with cobalt-queue (`docs/ops/docker-deploy.md`)

### Committer party re-resolve — no integration test (2026-07-28)

`CommitterService.reResolveBookingParties` cures the third stale-master-FK path: the committer writes
`vendor_raw` / `customer_raw` onto the LEG while the party master hangs off the BOOKING, and
`fillBooking` is first-writer-wins — so a later email naming a different factory left the original
master linked and winning display (leg 20260405F1: `vendor_raw ELSMCO`, `booking.vendor_id SOUOCE`).

Called on all three branches (amend, sibling leg, new booking). **Covered only by reasoning and by the
sibling rule's tests in `review.service.spec.ts` — nothing exercises the committer path itself.**

What a test should prove:
- the amend path re-points the FK when a later email's raw party resolves elsewhere
- it UNLINKS (not leaves stale) when the raw matches no master
- it writes nothing when the link already agrees — no audit noise on every commit
- the two create branches do not regress a fresh booking's FK
- the raw value itself is never modified (de-correction)

The other two paths (detail edit, review correct/confirm) DO have tests — see
`ReviewService.correct — party/port corrections re-resolve the master FK` and
`ReviewService.confirm — re-links the party master to the raw the leg names`.

## Do not re-open

- Postgres / Drizzle as primary store
- Static gold as production learning fuel (queue ADR-0002; lab gold optional on queue only)
- Treating pure 9+ digit packing tokens (`31900…`) as customer POs
