# ShipTrack REST API

_Complete endpoint reference for the NestJS backend. Generated from the controllers on 2026-08-05
(119 routes). The controllers are the source of truth — when this table and the code disagree, the
code wins and this file is the bug._

- **Base path**: every route is mounted under `/api` (`app.setGlobalPrefix('api')` in `backend/src/main.ts`).
- **Dev**: `http://localhost:3000/api` (Vite proxies `/api` from `:5173`).
- **Prod**: `https://StatusTrack.Cobaltknitwear.com/api` — same origin as the SPA, so the browser
  client uses relative `/api` paths (`frontend/src/lib/api.ts`).

Two consumers matter and they authenticate differently:

| Consumer | How | Notes |
|---|---|---|
| The SPA (humans) | `session` httpOnly cookie from `POST /api/auth/login` | Same origin; no `Authorization` header |
| **cobalt-queue** (the AI agent) + IT scripts | `Authorization: Bearer <jwt>` or a reused login cookie | Service account `agent@cobalt.hk`, role `EDITOR` |

---

## Authentication

### Cookie login

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@cobalt.hk","password":"cobalt-change-me"}'
# → 200 { "user": { "id", "email", "name", "role", "avatarInitials", "mustReset" } }
#   Set-Cookie: session=<jwt>; HttpOnly; SameSite=Lax[; Secure]
```

| Property | Value | Where |
|---|---|---|
| Cookie name | `session` | `SESSION_COOKIE`, `backend/src/auth/auth.constants.ts` |
| Lifetime | `SESSION_TTL_HOURS` (default **12 h**) — drives both the JWT `expiresIn` and the cookie `maxAge` | `sessionTtlSeconds()` |
| `Secure` | on when `NODE_ENV=production`; `COOKIE_SECURE=true\|false` overrides | `cookieSecure()` |
| `SameSite` | `lax`, `httpOnly` always | `sessionCookieOptions()` |

`POST /api/auth/logout` clears it with the same attributes (they must match or the browser keeps a
`Secure`/`SameSite` cookie).

### Bearer (service accounts)

The same JWT is accepted in `Authorization: Bearer <token>`. This is how cobalt-queue posts decisions
— it logs in once and reuses the token.

### Forced password reset

Seeded human accounts carry `mustReset: true`. `MustResetGuard` then rejects **every** route except
`@Public()` ones and the two marked `@AllowDuringMustReset()` (`GET /api/auth/me`,
`POST /api/auth/change-password`):

```json
403 { "code": "MUST_RESET", "message": "..." }
```

The agent account (`agent@cobalt.hk`) has `mustReset: false` — a machine login cannot do an
interactive password change.

### Roles

`VIEWER (0) < EDITOR (1) < ADMIN (2) < SUPERADMIN (3)`. `@Roles(...)` is a **minimum**: `@Roles('ADMIN')`
means admin *or higher*, and a route with no `@Roles` allows any authenticated user. Below, the
**Role** column shows the minimum.

```json
403 { "code": "FORBIDDEN", "message": "requires role: ADMIN (or higher)" }
```

A second, runtime-configurable layer sits beside roles: `@PageRead('x')` / `@PageWrite('x')` resolve
against the superadmin-managed page-access matrix (`app_settings.page_access`) instead of a fixed
role. Only `alert_rules` is in the matrix today; `resolution_rules` is retired from it, so those
routes resolve to `none` for everyone below SUPERADMIN. `@AgentPageRead('x')` is the third variant:
page `view` **or** EDITOR-or-higher passes, which is what keeps the agent service account reading
`GET /masters/resolution` and `POST /masters/candidates`. See `backend/src/access/pages.ts`.

```json
403 { "code": "PAGE_ACCESS_DENIED", "message": "requires view access to resolution_rules (or EDITOR+ service account)" }
```

### Guard order

`ThrottlerGuard → JwtAuthGuard → MustResetGuard → RolesGuard → PageAccessGuard` (all global,
`APP_GUARD`). `@Public()` skips the JWT guard — only `POST /auth/login`, `POST /auth/logout` and
`GET /health` are public.

---

## Conventions

**Rate limiting** — 300 requests / 60 s globally. `POST /auth/login` is tightened to 10 / 60 s.
`POST /decisions` is `@SkipThrottle()`d (a rematch posts hundreds of legs in a burst).

**Request bodies** — JSON. A global `ValidationPipe({ transform: true, whitelist: true })` **strips
any property not declared on the DTO**. If a new agent field silently vanishes on ingest, it is
missing from `CreateDecisionDto`.

**Body size** — `JSON_BODY_LIMIT`, default **200mb**. Decision payloads carry attachment bytes for
mail with no Graph id (nothing strippable), and a 63-record consignment exceeded 25mb.

**Errors** — Nest's standard shape; `DbExceptionFilter` maps SQL constraint failures to 400 with a
non-leaky message rather than a 500.

| Status | When |
|---|---|
| `400` | DTO validation, unknown enum/field values, SQL CHECK / unique / NOT NULL violation |
| `401` | No or invalid session/bearer token |
| `403` | `FORBIDDEN` (role) or `MUST_RESET` (password change pending) or page-access denial |
| `404` | Unknown id |
| `409` | Optimistic-concurrency clash — `expectedUpdatedAt` older than the leg's `updated_at` |
| `500` | Genuine server fault (`{ statusCode, message: "Internal server error" }`) |

**Dates** — naive Hong Kong wall-clock strings by convention; the backend's `TZ` (pinned to
`Asia/Hong_Kong` in the image and compose) mints the instant.

---

## Endpoints

### Health

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/health` | *public* | `{ status: 'ok', db: 'up' \| 'down', ts }` — `db` is a live `select 1` |

### Auth

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | *public* | `{ email, password }` → `{ user }` + `session` cookie. 10/min |
| POST | `/api/auth/logout` | *public* | Clears the cookie |
| GET | `/api/auth/me` | any | Current user (allowed during `mustReset`) |
| POST | `/api/auth/change-password` | any | `{ currentPassword, newPassword }`, min 8 chars (allowed during `mustReset`) |

### Decisions — the agent write path

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/decisions` | EDITOR | The **only** write path from cobalt-queue. Not throttled |

This is the app ↔ agent contract; keep it stable. Full shape:
`backend/src/decisions/dto.ts` (`CreateDecisionDto`). Required: `matchKey`, `fields`, `confidence`.

```jsonc
{
  "matchKey":   { "so_no": "FEL-GZ-OSA-2842", "hbl_awb_fcr_no": "GZOSA2600021" },
  "fields":     { "etd": "2026-02-08", "pol_raw": "YANTIAN", "vendor_raw": "..." },
  "pos":        ["25312"],
  "confidence": 92,                    // 0-100, Critic score (informational)
  "autoApply":  true,                  // AUTHORITATIVE: true → confirmed, false → provisional
  "disposition": "auto",               // 'auto' | 'review' | 'skip' (skip = 不需處理, acknowledged, no leg)
  "mode": "SEA",
  "reviewReasons": [],                 // why the gate withheld auto-apply
  "criticReview": { },                 // advisory only — never changes routing
  "evidence": [ { "graphMessageId": "...", "fields": { }, "attachments": [ ] } ]
}
```

Optional groups worth knowing (all additive — legacy callers omitting them behave as before):

| Field | Meaning |
|---|---|
| `posStated` / `posInferred` | Claim strength. `posStated` widens matching only and is **never** written to `shipment_pos`; `posInferred` is persisted per link so a later email that *states* the PO displaces the weak claim |
| `poQty` | Per-PO shipped quantity, keyed by normalized PO number — only when attributable to one PO |
| `identifiers` / `entities` | Every value an identity field ever held; co-valid customer entities with roles |
| `journey` | Multi-stop chain (`PVG→DEL→LHR`), stored on `shipments.journey` |
| `divisions` | "PO moved off this booking" statements — the committer's evidence for removing a stated PO link |
| `cancelled` / `fromPlatform` | Booking cancellation; CVP/TradeLinkOne notification (routes to Documents) |
| `matchAmbiguity` / `dualAutoTarget` | Multi-candidate match set; verified commit target |
| `recommendedRouting` | Queue band-routing recommendation — shadow-only under `critic_routing_mode=gate` |
| `evidenceRefs` / `evidence` | Graph pointers and the per-email parsed records behind change history |

### Shipments

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/shipments` | any | Three modes on one route — see below |
| GET | `/api/shipments/review-queue` | any | `?view=pending\|waiting\|dismissed\|approved` (default `pending`) |
| GET | `/api/shipments/review-queue/counts` | any | `{ provisional, waiting, dismissed }` for the nav badges |
| GET | `/api/shipments/:id` | any | Detail + `contestedLocks` + `humanLockedFields` |
| POST | `/api/shipments` | EDITOR | Manual shipment (committer-backed — see the booking-ingestion gap) |
| PATCH | `/api/shipments/:id` | any | `{ fields, note }` — human edit |
| POST | `/api/shipments/:id/confirm` | EDITOR | Approve a provisional leg |
| POST | `/api/shipments/:id/locks/:field/keep-new` | any | Resolve a CONTESTED field to the new value |
| POST | `/api/shipments/:id/locks/:field/restore` | any | Resolve it back to the locked value |
| GET | `/api/shipments/:id/history` | any | Change log for the leg |

`GET /api/shipments` dispatches on its query:

1. any of `so_no`, `booking_no`, `hbl_awb_fcr_no`, `mbl`, `container_no`, `customer_po` → **Matcher
   candidate lookup** (the agent's read path);
2. `q=` (no strong keys) → compact search for the review desk's "Move PO" target picker (`limit`, default 20);
3. otherwise → the Shipment Tracker list, filterable by `status`, `customerId`, `forwarderId`.

`PATCH /:id` and the two `locks` routes carry **no** `@Roles` on purpose: every authenticated user may
fill gaps the parser missed. Each edit records a field lock — the human's value, kept for
contested-detection, **not** a barrier against the agent.

Field locks are therefore not human-wins: a newer email that disagrees with a locked field is applied
and the field flagged CONTESTED, surfaced on the detail page with `keep-new` (accept the email value
and relock to it) / `restore` (put the human edit back).

### Review desk

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/review` | EDITOR | The queue |
| POST | `/api/review/dismiss` | EDITOR | Bulk "not a trackable shipment": `{ shipmentIds[], note? }` |
| POST | `/api/review/:id/confirm` | EDITOR | `{ note?, keep?[], expectedUpdatedAt? }` |
| POST | `/api/review/:id/correct` | EDITOR | `{ fields, keep?[], reason?, expectedUpdatedAt? }` |
| POST | `/api/review/:id/wait` | EDITOR | Park it: `{ reason? }` (≤1000 chars) |
| POST | `/api/review/:id/restore` | EDITOR | Un-park / un-dismiss |
| POST | `/api/review/:id/identify` | EDITOR | `{ field, value }` on a zero-identity leg; `field` ∈ `booking_no\|so_no\|hbl_awb_fcr_no\|mbl\|container_no` |
| POST | `/api/review/:id/link` | EDITOR | Fold into an existing leg: `{ targetShipmentId, fields?, reason? }` |

`fields` = "write this". `keep` = "**do not** write, but record that I ruled" — the backend locks each
at the value already on the leg and audits it `old === new`. A field named in both is a `400`. `keep`
rides `/confirm` too, because a keep-only card writes nothing.

`expectedUpdatedAt` is the ISO timestamp the client loaded; a stale one gets `409`.

Corrections are forwarded best-effort to the cobalt-queue learning feed (`POST {QUEUE_API_BASE}/review/correction`)
— a queue outage logs loudly and never fails the review save. See `backend/src/review/queue-learning.client.ts`.

### Purchase orders

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/purchase-orders` | any | `?customerId=&open=` |
| GET | `/api/purchase-orders/:id` | any | Detail |
| POST | `/api/purchase-orders` | EDITOR | Create |
| PATCH | `/api/purchase-orders/:id` | EDITOR | Update |
| DELETE | `/api/purchase-orders/:id` | EDITOR | Delete |
| POST | `/api/purchase-orders/:id/dismiss` | EDITOR | Demote a non-customer PO |
| POST | `/api/purchase-orders/:poId/link-shipment` | EDITOR | Link a PO to a leg |
| PATCH | `/api/purchase-orders/:poId/link-shipment/:linkId` | EDITOR | Edit the link (e.g. shipped qty) |
| DELETE | `/api/purchase-orders/:poId/link-shipment/:linkId` | EDITOR | Unlink |
| GET | `/api/pos` | any | Legacy PO list (`?open=true`) |
| GET | `/api/pos/:id` | any | Legacy PO detail |

### Bookings, dashboard, documents

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/bookings` | any | List |
| GET | `/api/bookings/:id` | any | Detail |
| GET | `/api/dashboard` | any | KPI cards + pipeline counts |
| GET | `/api/documents` | any | Unlinked documents |
| GET | `/api/documents/:id` | any | Detail |
| POST | `/api/documents/:id/link` | EDITOR | `{ shipmentId }` |
| POST | `/api/documents/:id/dismiss` | EDITOR | Drop it from the desk |

### Emails

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/emails` | any | Inbox list |
| GET | `/api/emails/unread-count` | any | Nav badge |
| GET | `/api/emails/:id` | any | One message |
| GET | `/api/emails/:id/body` | any | HTML/text body |
| GET | `/api/emails/:id/thread` | any | Conversation |
| GET | `/api/emails/:id/attachments` | any | Attachment list |
| PATCH | `/api/emails/:id/read` | any | Mark read |
| GET | `/api/emails/attachments` | any | Attachment lookup |
| GET | `/api/emails/attachments/:id/download` | any | Bytes — `ATTACHMENT_UNAVAILABLE` when neither `raw_bytes` nor a `graph_attachment_id` exists |
| GET | `/api/emails/original` | any | View-original passthrough (Graph is the permanent source of truth) |
| GET | `/api/emails/review-queue` | EDITOR | Email-extraction review queue (`?status=`) |
| GET | `/api/emails/review-queue/counts` | EDITOR | Tab counts |
| PATCH | `/api/emails/:id/review` | EDITOR | Accept / reject an extraction |

### Alerts

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/alerts` | any | `?status=` |
| POST | `/api/alerts/evaluate` | EDITOR | Force an evaluator tick (fires + auto-resolves) |
| POST | `/api/alerts/:id/dismiss` · PATCH same | EDITOR | Dismiss |
| POST | `/api/alerts/:id/resolve` | EDITOR | Resolve |
| POST | `/api/alerts/:id/snooze` | EDITOR | `{ until }` (ISO) |
| PATCH | `/api/alerts/:id/snooze` | EDITOR | `{ hours }` (default 24) |
| PATCH | `/api/alerts/:id/read` · `/unread` | EDITOR | Read state |
| GET | `/api/alert-rules` | *page* `alert_rules` read | Rule config |
| PUT | `/api/alert-rules` | *page* `alert_rules` write | Save thresholds / severity / country overrides |
| GET | `/api/alert-rules/consignees` | any | Consignee options for rule scoping |

Rule semantics and message text: [alert-rules-and-messages.md](alert-rules-and-messages.md).

### Masters

Customers and vendors are a **read-only** mirror of the Cobalt Mesh ERP — there are deliberately no
write DTOs for them. Ports, forwarders, carriers and consignees are ops-maintained in-app.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/masters/customers` · `/vendors` · `/forwarders` · `/ports` · `/consignees` · `/carriers` | any | Lookup lists (`?q=`) |
| GET | `/api/customers` · `/vendors` · `/forwarders` · `/consignees` | any | Type-ahead projections (`?q=`, vendors also `?type=`) |
| POST | `/api/masters/sync` | ADMIN | Pull Mesh masters now |
| POST | `/api/masters/ports/sync` | ADMIN | Pull the UN/LOCODE + OurAirports port master now |
| POST/PATCH | `/api/masters/forwarders[/:id]` | ADMIN | Create / edit a forwarder |
| POST/PATCH | `/api/masters/ports[/:id]` | ADMIN | `{ unlocode, name, country?, mode: 'sea'\|'air' }` |
| POST/PATCH | `/api/masters/consignees[/:id]` | ADMIN | `{ name, address?, mapsToCustomerId? }` |
| POST/PATCH | `/api/masters/carriers[/:id]` | ADMIN | `{ scac, name }` — the SCAC data home |
| POST | `/api/masters/candidates` | *agent* (page view **or** EDITOR+) | **LLM Master Matcher** candidate retrieval (below) |
| GET | `/api/masters/resolution` | *agent* (page view **or** EDITOR+) | Curated resolution facts — the other half of the agent contract |
| POST | `/api/masters/resolution` | *page* `resolution_rules` write | `{ kind, lhs, rhs?, reason? }` |
| PATCH | `/api/masters/resolution/:id` | *page* write | `{ reason? }` |
| POST | `/api/masters/resolution/:id/deactivate` · `/reactivate` | *page* write | Never deleted |
| GET | `/api/masters/resolution/manage` | *page* read | Management projection of the facts |
| GET | `/api/masters/unmatched` | *page* read | Names with no master |
| GET | `/api/masters/proposals` | *page* read | Proposed facts |
| POST | `/api/masters/proposals/:id/approve` · `/reject` | *page* write | Rule on a proposal |
| POST | `/api/masters/curate` | *page* write | Curation action |

`POST /api/masters/candidates` — deterministic, recall-oriented retrieval that feeds the agent-side
LLM name→master matcher:

```jsonc
{
  "type": "vendor",            // customer | vendor | forwarder | consignee | port
  "name": "MACAU FUNG TAI",
  "emailDomain": "…",          // optional
  "country": "CN",             // optional
  "limit": 20,                 // 1-50
  "context": { "customerCode": "…", "poNumbers": ["…"], "brand": "…" }   // boosts only, never filters
}
```

### Settings

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/settings/threshold` | EDITOR | Review-gate confidence threshold |
| PUT | `/api/settings/threshold` | ADMIN | `{ value }` 0-100 |
| GET | `/api/settings/routing-mode` | EDITOR | `gate` (default) or `band` |
| PUT | `/api/settings/routing-mode` | ADMIN | `{ mode: 'gate' \| 'band' }` |
| GET | `/api/settings/etd-fallback` | SUPERADMIN | Fallback ETD windows |
| PUT | `/api/settings/etd-fallback` | SUPERADMIN | `{ airDays, seaDays }` 0-365 |
| GET | `/api/settings/routing-shadow` | EDITOR | Shadow report, `?days=` |
| GET | `/api/settings/critic-calibration` | EDITOR | Calibration report, `?days=` |

### Users and access control

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/users` | SUPERADMIN | List |
| POST | `/api/users` | SUPERADMIN | `{ email, name, role, password }` (≥8 chars) |
| PATCH | `/api/users/:id` | SUPERADMIN | `{ name?, role?, active?, password? }` |
| DELETE | `/api/users/:id` | SUPERADMIN | Delete |
| GET | `/api/page-access/me` | any | This user's per-page levels — what the SPA hides |
| GET | `/api/page-access` | SUPERADMIN | The page × role matrix |
| PUT | `/api/page-access` | SUPERADMIN | Set it |

### Reconcile and admin

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/reconcile/run` | EDITOR | Rebuild — replays the decision log; never a second brain |
| POST | `/api/reconcile/refresh-state` | EDITOR | Re-derive lifecycle state from each leg's own dates (promote-only) |
| GET | `/api/admin/mesh-misses` | SUPERADMIN | Names Mesh does not hold |
| POST | `/api/admin/mesh-misses/ack` | SUPERADMIN | Acknowledge |
| GET | `/api/admin/multi-booking-backfill` | ADMIN | Dry run |
| POST | `/api/admin/multi-booking-backfill/apply` | ADMIN | Apply |

Never run reconcile against the demo database.

### ERP export

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/erp-export/fields` | EDITOR | The field catalog (75 fields / 12 groups) |
| GET | `/api/erp-export/pos` | EDITOR | PO-grained JSON feed for the Mesh ERP + the "where is PO X?" chatbot |

Full parameter reference, field catalog and trust semantics:
**[erp-export-api.md](erp-export-api.md)**.

---

## Adding an endpoint

1. Controller under `backend/src/<area>/`, DTO with `class-validator` decorators (anything not
   declared is stripped by the whitelist pipe).
2. Decide the gate: `@Roles(...)` for a fixed minimum role, `@PageRead`/`@PageWrite` for a
   superadmin-configurable page, `@Public()` only if it truly needs no session.
3. Add a row here.
4. If it changes the agent contract (`POST /api/decisions`, `GET /api/masters/resolution`), it is a
   cross-repo change — coordinate with cobalt-queue.
