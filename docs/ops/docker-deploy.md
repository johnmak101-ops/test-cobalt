# Docker deploy / smoke (ShipTrack)

Compose substitutes `${VAR}` from the **repo-root** `.env` (see `../../.env.example`), not
`backend/.env`. Every backend variable and its default is documented in
[`../../backend/.env.example`](../../backend/.env.example); this page covers only the ones that
change how a deploy behaves.

## Bring-up

```bash
# From repo root — optional: copy backend/.env keys for Mesh into a root .env for compose
docker compose up --build -d
curl -sf http://127.0.0.1:3000/api/health
# Open http://localhost:3000
# Human: admin@cobalt.hk / cobalt-change-me  (must reset password on first login)
# Agent:  agent@cobalt.hk / cobalt           (matches TRACKING_AGENT_PASSWORD)
```

## Boot seed (entrypoint + `seed.ts`)

| Env | Default | Meaning |
|-----|---------|---------|
| `RUN_MIGRATIONS` | `1` | Create `cobalt` DB + Kysely migrations |
| `SEED_ON_START` | `1` | Run `backend/dist/db/seed.js` once per boot when set |
| **`SEED_DEMO`** | **`0`** | **Must stay `0` in Docker/prod.** Only `1` adds demo masters, fixture booking legs, and review-queue emails / parsed-style data. |

**With `SEED_DEMO=0` (default), seed creates:**

1. Curated **ports** (bootstrap until CSV sync runs)
2. The **2 factory alert rules** (`ALERT_RULE_FACTORY_DEFAULTS` — draft BOL + final BOL). Every other
   rule id that exists in the table is disabled + locked, not deleted. Thresholds, severity and
   country overrides are user-owned after install; re-seeding never clobbers them.
3. **Users**: `super@cobalt.hk`, `admin@cobalt.hk`, `agent@cobalt.hk`
4. **No** `email_message` / **no** `parsed_record` / **no** demo shipments

Emails and parsed rows arrive only via **cobalt-queue** (`POST /api/decisions` + evidence), not seed.

## Clock-driven jobs

These act without any new email arriving, so they are the two that change data on a quiet system.

| Env | Default | Meaning |
|-----|---------|---------|
| `ALERT_EVAL_INTERVAL_MS` | `900000` (15 min) | Fires + auto-resolves the threshold alerts. Manual trigger: `POST /api/alerts/evaluate`. `0` = off. |
| `STATE_REFRESH_INTERVAL_MS` | `3600000` (1 h) | Re-derives each live leg's lifecycle state from its own dates. Promote-only. `0` = off. |

⚠ **First deploy onto an existing database:** set `STATE_REFRESH_INTERVAL_MS=0`, run the dry-run,
read the `promotions` list, then remove the override. On a database that has never had this run,
the first tick promotes every leg whose dates have quietly come true — correct, but a one-off bulk
move that looks alarming if nobody expected it.

## Master pulls (Nest schedulers — not seed)

| Source | Env | Default |
|--------|-----|---------|
| Cobalt **Mesh** (customers / vendors / forwarders) | `MESH_TENANT_ID`, `MESH_CLIENT_ID`, `MESH_CLIENT_SECRET`, `MESH_SCOPE`, optional `MESH_BASE_URL` | Required for sync; schedule `MESH_SYNC_INTERVAL_MS` = **86400000** (24h). Missing creds → schedule logs off. |
| **Ports CSV** (UN/LOCODE + OurAirports) | optional URL overrides | `PORTS_SYNC_INTERVAL_MS` = **2592000000** (~30d). Set `0` to disable. |

⚠ **The ports sync needs outbound internet** (`raw.githubusercontent.com`, `davidmegginson.github.io`).
On an intranet-only host that is a monthly failed fetch and a log error for no benefit — set
`PORTS_SYNC_INTERVAL_MS=0` there and run the CLI from a machine with egress when the port list
actually needs refreshing.

Pass Mesh secrets via a project-root `.env` (Compose substitution) or orchestrator secrets — never bake them into the image.

```env
# example root .env for compose (do not commit secrets)
MESH_TENANT_ID=...
MESH_CLIENT_ID=...
MESH_CLIENT_SECRET=...
MESH_SCOPE=api://.../.default
MESH_SYNC_INTERVAL_MS=86400000
PORTS_SYNC_INTERVAL_MS=2592000000
SEED_DEMO=0
# first deploy onto an existing DB only — remove after reviewing the dry-run
#STATE_REFRESH_INTERVAL_MS=0
```

Image tag: `shiptrack:latest`, built locally by `build: .`. Set `SHIPTRACK_IMAGE=<registry>/<org>/cobalt-shiptrack:latest`
only when you actually want to publish to or pull from a registry — the default stays local so a
`pull` / `push` from any checkout can't reach a registry nobody agreed on.

## Serving over HTTP, and body size

| Env | Default | Why you would touch it |
|-----|---------|------------------------|
| `COOKIE_SECURE` | Secure when `NODE_ENV=production` | Set `false` on an **HTTP-only** intranet host. A `Secure` cookie over plain HTTP silently never sets, and login fails with no error anywhere. |
| `SESSION_TTL_HOURS` | `12` | Session + JWT lifetime (one knob drives both). |
| `CORS_ORIGINS` | localhost:5173, localhost:3000, statustrack.cobaltknitwear.com | Set explicitly in prod. Never reflect any origin. |
| `JSON_BODY_LIMIT` | `200mb` | Decision payloads carry attachment bytes for mail with no Graph id — nothing is strippable, so the whole attachment rides in the POST. A 63-record consignment blew past 25mb and surfaced as an opaque 500. |

The app trusts exactly **one** proxy hop (the intranet nginx terminating TLS). Revisit that if a CDN
or a second proxy is ever put in front — both `X-Forwarded-Proto` (which drives the Secure cookie)
and `X-Forwarded-For` (which drives throttling) would then read the wrong hop.

## Dual-stack with cobalt-queue

Two links, in opposite directions. Both are needed for the full loop.

**Queue → ShipTrack (decisions).** On the queue host `.env`:

```env
TRACKING_API_BASE=http://host.docker.internal:3000/api
TRACKING_AGENT_EMAIL=agent@cobalt.hk
TRACKING_AGENT_PASSWORD=cobalt
```

**ShipTrack → queue (the learning feed).** Human review corrections are pushed back to the queue's
Iterator as the TRAIN signal. On **this** stack:

```env
QUEUE_API_BASE=http://host.docker.internal:3100/api
QUEUE_API_PASSWORD=<the queue's VIEWER_PASSWORD>
```

Leave `QUEUE_API_BASE` unset and the TRAIN signal is **off** — logged loudly once, then silent. The
push is best-effort by design: a queue outage never fails a review save.

Ingest DEMO mail from the private corpus repo (not seed):

```bash
pnpm exec tsx src/dev/ingest-msg.ts /path/to/cobalt-demo-email-source
pnpm cli match --all --force
```

## Smoke checklist

| Check | Expect |
|---|---|
| `/api/health` | 200 |
| Login SPA | session cookie; force password change for admin if `mustReset` |
| Empty inbox / no legs | before queue match — seed left no demo emails |
| Mesh boot log | `Mesh masters sync every …` (if `MESH_*` set) |
| Ports boot log | `Ports master sync every …` |
| Learning feed | no `QUEUE_API_BASE` warning in the log (or accept that TRAIN is off) |
| After queue rematch | DEMO **5** spines |

## Reset DB volume

```bash
docker compose down -v
docker compose up --build -d   # re-migrate + prod-shape seed
```
