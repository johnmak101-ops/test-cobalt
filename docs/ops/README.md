# Ops

| Doc | Status |
|-----|--------|
| [docker-deploy.md](docker-deploy.md) | Current |
| [booking-ingestion-gap.md](booking-ingestion-gap.md) | Current (structural mailbox limitation) |

Related: every backend env var is documented in [`../../backend/.env.example`](../../backend/.env.example);
the API surface is in [`../reference/api.md`](../reference/api.md).

Before **any** production migration, read the ledger first — see
[`../reference/sql-server-gotchas.md`](../reference/sql-server-gotchas.md#test-engine).
