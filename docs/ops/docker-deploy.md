# Docker deploy / smoke (ShipTrack)

## Bring-up

```bash
# From repo root
docker compose up --build -d
curl -sf http://127.0.0.1:3000/api/health
# Open http://localhost:3000 — login admin@cobalt.hk / cobalt (seeded on first boot)
```

| Env (compose defaults) | Meaning |
|---|---|
| `SQL_SERVER_URL` | Points at compose `db` service |
| `JWT_SECRET` | Demo secret — change for shared envs |
| `RUN_MIGRATIONS=1` | Apply Kysely migrations on start |
| `SEED_ON_START=1` | Demo admin + ports (set `0` after first seed) |
| `STATIC_ROOT` | Serves SPA from image |

## Dual-stack with cobalt-queue

On the queue host `.env`:

```env
TRACKING_API_BASE=http://host.docker.internal:3000/api
TRACKING_AGENT_EMAIL=agent@cobalt.hk
TRACKING_AGENT_PASSWORD=cobalt
```

Then queue `matcher` / `pnpm cli match --all --force` can POST decisions.

## Smoke checklist

| Check | Expect |
|---|---|
| `/api/health` | 200 |
| Login SPA | session cookie set |
| `POST /api/decisions` (agent) | 2xx; leg appears on Shipments |
| DEMO rematch | **5** spines; no Booking `—` / `31900…` shells |
| Incomplete shells filter | 0 noise rows |

## Ports

| Service | Host port |
|---|---|
| App (API+SPA) | 3000 |
| SQL Server | 1433 (optional publish) |

## Reset demo DB

```bash
docker compose down -v
docker compose up --build -d   # re-migrate + re-seed
```
