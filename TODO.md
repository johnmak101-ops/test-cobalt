# ShipTrack — deferred / open work

Fabric SQL migration and Kysely ports are **done** (see `backend/docs/fabric-sql-migration.md`,
`backend/docs/adr-database-platform.md`).

## Active themes

- Mesh / master miss UX (forwarders not in Mesh still surface as review ops notes)
- Review desk / Hybrid-C residual polish
- Docker + dual-stack test deploy with cobalt-queue (`backend/docs/docker-deploy.md`)

## Do not re-open

- Postgres / Drizzle as primary store
- Static gold as production learning fuel (queue ADR-0002; lab gold optional on queue only)
- Treating pure 9+ digit packing tokens (`31900…`) as customer POs
