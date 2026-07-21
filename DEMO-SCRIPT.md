# ShipTrack — DEMO script (Email Sets 1 / 5 / 6)

_Refreshed 2026-07-21. Gold topology = **5 shipments**. Login: `admin@cobalt.hk` / `cobalt` (or Superadmin)._

## Before you start

- **App:** http://localhost:5173 (dev) or http://localhost:3000 (Docker)
- **Backend:** :3000 healthy (`/api/health`)
- **Queue:** rematch complete (`pnpm cli match --all --force` from cobalt-queue)
- Toggle **Hide incomplete shells** if any noise remains (should be **0**)

## Gold spines (what the list should show)

| # | Spine | Mode | Customer PO(s) | Story |
|---|--------|------|----------------|--------|
| 1 | **GZOSA2600021** / FEL-GZ-OSA-2842 | SEA | `25312` | Set1 Doclasse sea — SO + HBL **one** leg |
| 2 | **GZL26258522** | AIR | multi (286xx…) | Set5 Wyse air #1 |
| 3 | **GZL26261147** | AIR | `28739, 28740, 28747` | Set5 Wyse air #2 |
| 4 | **S2600144827** / SNZ260004243 | SEA | `1570988` | Set6 Strauss sea |
| 5 | **A26050003** / SZA26050003 | AIR | `1570988` | Set6 Strauss air (AWB aliases) |

Same PO `1570988` on sea **and** air is correct (mode split).  
`31900…` packing codes are **not** POs and must not appear as orphan rows.

## Suggested walk (~10 min)

1. **Dashboard** — counts, alerts, new emails.
2. **Shipments list** — confirm **5** commercial rows (not 7).
3. **Set5 GZL26261147** — multi-PO air; open email window (HTML body + attachment download after MIME handoff).
4. **Set1 GZOSA** — sea HBL + SO on one leg; milestone / related emails.
5. **Set6 pair** — sea vs air same customer PO; no double-count on sibling HAWB exclusivity.
6. **Review Queue** — residual field conflicts (forwarder Mesh misses, qty) as honest review — not topology bugs.

## Ops notes

- Booking mail that never hit the Graph inbox cannot be recovered by poll alone — see `backend/docs/booking-ingestion-gap.md`.
- Docker smoke: `backend/docs/docker-deploy.md`.
