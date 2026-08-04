# ERP export API (`/api/erp-export`)

_PO-grained, read-only JSON feed for syncing shipping status and details back to the Mesh ERP — and for the planned "where is PO X?" chatbot. Shipped 2026-08-04._

## Why it looks the way it does

- **The ERP is PO-based**, so the output grain is **one object per PO**, with the shipment legs that carry it nested under `shipments`. PO↔leg is many-to-many (one booking has carried 51 POs; one PO can split across two legs), so nesting is the only shape that stays honest in both directions.
- **Field selection is a request parameter, not a UI.** The consumer is the IT department: they write `?fields=...` in the URL. There is deliberately no settings page and no server-side saved selection.
- **The export is faithful**: raw stored values only (no UI display fallbacks), and pipeline internals (AI confidence, review reasons, committer trail, match keys) are not in the catalog at all — they cannot be requested.

Code: `backend/src/erp-export/` (`field-catalog.ts` is the single source of truth for what can be exported).

## Auth

Standard cookie login, `EDITOR` role or higher. A script logs in once, then reuses the cookie:

```bash
curl -c cookies.txt -X POST https://statustrack.cobaltknitwear.com/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"<service-account>","password":"<...>"}'

curl -b cookies.txt "https://statustrack.cobaltknitwear.com/api/erp-export/pos?limit=5"
```

## `GET /api/erp-export/fields` — the catalog

Returns every exportable field: `{ key, level ('po' | 'shipment'), group, description, always }`. Use it to discover what `fields=` can ask for. Fields marked `always: true` (`po_number`, `shipment_id`, `job_no`, `leg_no`) are identity fields — emitted on every request, not deselectable.

## `GET /api/erp-export/pos` — the data

### Query parameters

| Param | Example | Meaning |
|-------|---------|---------|
| `since` | `2026-08-03T00:00:00` | Only POs where **any** linked leg changed after this instant (`updated_at`). The nested array stays **complete** — the consumer always sees the whole PO picture, including unchanged legs. |
| `poNumber` | `271-018 571` | Single-PO lookup, format-tolerant: separators and case are ignored (normalized against `po_number_norm`). |
| `jobNo` | `S2600144827` | All POs on one booking (case-insensitive). |
| `state` | `RELEASED` | Legs in a given raw state (`BOOKED/CONFIRMED/AT_WAREHOUSE/SAILED/RELEASED/DELIVERED`). Invalid values are rejected with the valid list. |
| `fields` | `state,status_label,eta` | Comma list of catalog keys. Unknown keys → `400` naming them. Omitted → the full catalog. |
| `includeProvisional` | `true` | Also emit legs still awaiting human review. Off by default; when on, each row's `review_status` says `provisional`. |
| `includeCancelled` | `true` | Also emit cancelled legs (`cancelled: true`, `status_label: CANCELLED`). Off by default. |
| `limit` / `offset` | `200` / `0` | Pagination **at the PO grain** (max limit 1000). Response carries `total` (all matching POs) vs `count` (this page). |

### What is always excluded

- `DOCUMENT` rows and `SUPERSEDED`/dismissed legs — pipeline artifacts, never exported.
- POs with no surviving shipment leg — this is shipping-status backfill; an unshipped PO has nothing to report.
- Pipeline internals — not in the catalog, cannot be selected.

### Response envelope

```json
{
  "generated_at": "2026-08-04T14:00:00.000Z",
  "total": 3, "count": 3, "offset": 0, "limit": 200,
  "fields": ["po_number", "shipment_id", "job_no", "leg_no", "..."],
  "pos": [ { "po_number": "...", "...": "...", "shipments": [ { "...": "..." } ] } ]
}
```

## Field catalog summary

**PO tier** (prefixed `po_`, from the PO master + resolved Mesh codes): `po_number`*, `po_brand`, `po_item_style_no`, `po_total_quantity`, `po_quantity_unit`, `po_crd`, `po_customer_code/name`, `po_vendor_code/name`.

**Shipment tier** (per nested leg):

| Group | Fields |
|-------|--------|
| identity* | `shipment_id`, `job_no`, `leg_no` |
| status | `state` (raw), `status_label` (business term — `RELEASED→DEPARTED`, `DELIVERED→ARRIVED`, cancelled override), `review_status`, `risk_level`, `cancelled` |
| references | `booking_no`, `so_no`, `warehouse_so`, `hbl_awb_fcr_no`, `mbl`, `mawb`, `container_no` |
| transport | `mode`, `vessel_name`, `voyage_no`, `flight_no`, `scac_code`, `carrier_name`, `route` (multi-stop when a journey chain is known, e.g. `PVG→DEL→LHR`) |
| ports | `pol_code`/`pod_code` (UN/LOCODE sea, IATA air), `pol_name`/`pod_name`, `pol_raw`/`pod_raw` (as stated in email), `origin_country` |
| dates | `cargo_ready_date`, `cfs_cutoff`†, `warehouse_start_date`, `warehouse_end_date`, `etd`, `atd`, `eta`, `ata`, `in_dc_date` — ISO strings |
| po_link | `quantity_shipped` (**this PO on this leg** — the partial-shipment split), `quantity_shipped_unit`, `link_inferred` (link swept up with the group rather than stated), `link_level` (`shipment` or legacy `booking`, the latter has no per-leg quantity) |
| cargo | whole-leg figures (all POs combined): `shipment_total_qty(+_unit)`, `cartons`, `gross_weight`, `net_weight`, `measurement`, `cargo_description`, `hts_code`, `item_style_no` |
| parties | `customer_code/name/raw`, `vendor_code/name/raw`, `forwarder_code/name/raw` (codes = resolved Mesh masters; `*_raw` = email text when unresolved), `consignee_name/address` |
| milestones | `milestones`: `[{milestone_type, occurred_at}]` in time order (`BOOKING_SENT` → `SO_RECEIVED` → `AT_WAREHOUSE` → `DRAFT_BL_RECEIVED` → `FINAL_BL_RECEIVED` → `TELEX_RELEASED` → `INVOICE_RECEIVED` → `DELIVERED`) |
| meta | `created_at`, `updated_at` |

\* always included. † raw column only — the tracker UI displays `warehouse_end_date` when `cfs_cutoff` is empty, the export does **not** substitute.

## Examples

Daily incremental status pull:

```bash
curl -b cookies.txt "https://statustrack.cobaltknitwear.com/api/erp-export/pos?since=2026-08-03T00:00:00&fields=state,status_label,etd,atd,eta,ata"
```

Chatbot answering "where is PO 271018571?" (full dossier, one call):

```bash
curl -b cookies.txt "https://statustrack.cobaltknitwear.com/api/erp-export/pos?poNumber=271018571"
```

A PO split across two shipments — the nested array carries each split honestly:

```json
{
  "po_number": "271099999",
  "po_total_quantity": 5000,
  "shipments": [
    { "job_no": "S2600144827", "leg_no": 1, "status_label": "DEPARTED",     "quantity_shipped": 3000 },
    { "job_no": "S2600145102", "leg_no": 1, "status_label": "AT_WAREHOUSE", "quantity_shipped": 2000 }
  ]
}
```

## Trust semantics (read before importing into the ERP)

1. Default output is **confirmed data only** — rows a human reviewed or the pipeline auto-accepted at high confidence. `includeProvisional=true` widens it, and every provisional row says so; the importer decides what to trust.
2. `link_inferred: true` means the PO↔shipment association was inferred from the email group, not stated outright. `link_level: "booking"` means a legacy booking-level association with no per-leg quantity.
3. Party `*_code` fields are resolved against the Mesh masters mirror, so they are the ERP's own keys. When a `*_code` is null and only `*_raw` is present, ShipTrack could not resolve the name — do not guess the code ERP-side; fix the master or the raw name in ShipTrack.
4. Dates are stored on the Hong Kong wall-clock convention; confirm expected serialization with the ERP importer before mapping.

## Live verification (2026-08-04, local dev stack)

Verified end-to-end against the running backend (`start:prod` dist + mssql-2022, 104 POs / 76 legs of pipeline-ingested demo data):

| Check | Result |
|-------|--------|
| Unauthenticated | `401` |
| `fields=eta,banana` | `400` — "unknown fields: banana — see GET /api/erp-export/fields" |
| `state=JUNK` | `400` with the valid state list |
| Catalog | 75 fields / 12 groups; identity fields always-on |
| Tolerant lookup | ` 024-238 ` → matched `024238` |
| `since` in the future | `total: 0` (filter discriminates) |
| Full catalog, all 104 POs, one page | **~0.25 s** / 283 KB |
| Narrow fields (`state,status_label,etd,eta,quantity_shipped`) | ~0.21 s / 29 KB |
| Single-PO lookup | ~0.21 s |
| `/fields` | ~8 ms |

Two operational notes from the run:

- **A default query returning `total: 0` can be the confirmed-only gate, not an outage.** The local dev DB is 100% pipeline-ingested and unreviewed, so every leg is `provisional` and the default (confirmed-only) output is legitimately empty; `includeProvisional=true` revealed all 104 POs. In production, human-reviewed/auto-accepted rows export by default. Check `review_status` distribution before diagnosing an empty feed.
- **Single-PO lookups cost the same as the full list** (~0.2 s floor): filtering happens in-process after loading active legs + links. Irrelevant at hundreds of legs; if volume reaches tens of thousands, push `poNumber`/`since` into the SQL (tracked below).

## Deliberately deferred (next phases)

- **Sent-state ledger** (`erp_export_batch`/`erp_export_item`) — "what did the ERP already receive" diffs, idempotent re-sends, audit.
- **Push transport** — the Mesh API is masters-read-only today; an import endpoint must be requested from C&R before ShipTrack can push. Until then the consumer pulls.
- **xlsx output** in Mesh's import format.
- **Dedicated service account / read-only role** for the IT and chatbot consumers.
- **SQL-side filter pushdown** (`poNumber`/`since` into the query) — only if leg volume grows to tens of thousands; measured unnecessary at current scale.
