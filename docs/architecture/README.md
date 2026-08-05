# Architecture notes

Historical decision records. Both are **complete** — do not read their open "options A/B/C" as
undecided.

| Doc | Status |
|-----|--------|
| [adr-database-platform.md](adr-database-platform.md) | COMPLETE — Fabric / SQL Server chosen and shipped |
| [fabric-sql-migration.md](fabric-sql-migration.md) | COMPLETE — migration diary (2026-07) |

Runtime schema: `backend/src/db/kysely-migrations/` (head: `0033`, 2026-08).
Day-to-day T-SQL guidance lives in [../reference/sql-server-gotchas.md](../reference/sql-server-gotchas.md).
