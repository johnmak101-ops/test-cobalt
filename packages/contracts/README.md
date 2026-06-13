# @cobalt/contracts

The **single source of truth** for the Cobalt ShipTrack database + the cross-service contracts.
Imported by **both** services so they can't drift:

- `cobalt-queue` (VM2) writes `queue` + `evidence`
- `cobalt_track_system` NestJS (VM1) writes `tracking` + `audit` + `alerts`, and reads `evidence`
- the `match` schema is the VM2-agent → VM1-committer boundary (carried over Postgres, no cross-VM HTTP)

## What's inside

| Export | What |
|--------|------|
| `@cobalt/contracts` | everything (schema + zod) |
| `@cobalt/contracts/schema` | Drizzle tables for all 6 Postgres schemas + enum arrays |
| `@cobalt/contracts/zod` | `ParsedFields`, `MatchKeys`, `ParsedRecordZ`, `MatchDecisionZ` — the runtime contracts |

## Ownership & migrations

**One database, many schemas.** This package owns ALL migrations (it sees the whole picture).
`drizzle.config.ts` lists every custom schema in `schemaFilter` (drizzle-kit skips custom pg schemas otherwise).

```bash
pnpm db:push       # dev: sync the DB to the schema (no migration files)
pnpm db:generate   # prod: emit SQL migration files under ./drizzle
pnpm db:studio     # browse
```

> **Convergence TODO:** `cobalt-queue/src/db/schema.ts` currently defines `queue`+`evidence` itself.
> Once this package is linked there, replace that file with `export * from '@cobalt/contracts/schema'`
> so the writer and the contract are literally the same definition.

## Bring up Postgres (dev)

```bash
docker run -d --name cobalt-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cobalt -p 5432:5432 postgres:16
cp .env.example .env
pnpm install
pnpm db:push
```

## Usage

```ts
import { bookings, shipments, parsedRecord, MatchDecisionZ } from '@cobalt/contracts'
// NestJS: drizzle(pg, { schema }) ; agent: MatchDecisionZ.parse(llmJson)
```
