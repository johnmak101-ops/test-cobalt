# Dashboard alert cards: PO# beside severity, then consignee (Design)

Date: 2026-07-14 · Repo: cobalt-shiptrack · Status: approved  
Issue: https://github.com/johnmak101-ops/cobalt-shiptrack/issues/114

## 0. Context & goal

On Dashboard **Alerts Requiring Attention**, each alert card should show **PO#** immediately to the right of the severity badge, then **consignee** after the PO.

Desired header:

```
[WARNING]  PO# 100-100209  Acme Consignee
No Draft B/L received after ETD
2h ago · CNYTN→FRLEH
```

Today many cards show only the badge + message + relative time/route. Investigation found:

- `AlertCard` already lays out badge → PO → party name when data exists.
- Empty space next to WARNING is usually **missing summary data** (`poNumbers: []` and/or no party), not a flex bug.
- Summary payload exposes `customer`, not `consigneeName`, even though the leg row already has `consigneeName`.
- Product PRD mockups historically said **Customer**; issue #114 and locked decision use **consignee only**.

## 1. Locked decisions

| Decision | Choice |
|----------|--------|
| Party after PO | **Consignee only** (`consigneeName`) |
| Customer fallback | **None** — never render `customer` on alert card header |
| Approach | **A** — UI layout polish + thin summary field |
| Missing PO links in DB | **Out of scope** — separate investigation issue |
| Multi-PO display | When length > 1: `PO# {first} +{n}` (e.g. `PO# 100-100209 +2`); length 1: `PO# {only}`; length 0: omit span |
| Shared component | Same `AlertCard` on Dashboard (compact), Alerts page (full), and shipment detail |

## 2. Architecture

Thin vertical slice: one additive field on the alert shipment summary + shared card render rules.

```
shipment leg (consigneeName already on row)
  → buildShipmentSummary (+ consigneeName)
  → toUiAlert / dashboard.recentAlerts / GET /alerts
  → AlertCard header: badge → PO# → consignee
```

No new tables, no new endpoints, no change to PO link write path.

## 3. Backend

### 3.1 `buildShipmentSummary` (`presentation.service.ts`)

Input leg type gains optional/required `consigneeName: string | null` (available from `findByIds` / `selectAll`).

Return shape:

```ts
{
  id: string
  poNumbers: string          // JSON array string, unchanged source: booking_pos
  route: string | null
  customer: { name: string } | null  // keep for any non-card consumers; AlertCard ignores it
  consigneeName: string | null       // NEW: leg.consigneeName trimmed or null
}
```

Rules for `consigneeName`:

- Use `leg.consigneeName` when non-empty after trim.
- Otherwise `null` (not empty string).

### 3.2 Types / mappers

- `UiAlertShipment` in `alert.mapper.ts`: add `consigneeName: string | null`.
- Specs: `shipment-summary.spec.ts`, `alert.mapper.spec.ts`, any presentation fixture that asserts summary equality.

### 3.3 Explicitly unchanged

- PO source remains `bookingRepo.poNumbersByBooking` (booking_pos).
- No merge with shipment_pos for this ticket.
- No inventing PO from message text or evidence.

## 4. Frontend

### 4.1 Types

- `use-dashboard.ts` recentAlerts shipment shape: add `consigneeName: string | null`.
- `use-alerts.ts` `Alert.shipment`: add `consigneeName`.
- `AlertSection` local interface if duplicated: keep in sync.

### 4.2 `AlertCard`

Header row (flex, gap-2, min-w-0 as needed for truncate):

1. Severity `Badge` (unchanged).
2. If parsed PO list length > 0: monospace span  
   - 1 PO: `PO# {po}`  
   - N>1: `PO# {po[0]} +{N-1}`  
   - Prefer a small pure helper (e.g. `formatPoHeader(pos: string[])`) colocated in `lib/utils` or next to the card, with unit test.
3. If `alert.shipment?.consigneeName` truthy: secondary text span with that name (truncate if long).
4. Read indicator if applicable (existing).

**Remove** rendering of `alert.shipment?.customer` from the card header.

Empty rules: omit PO and/or consignee spans entirely — no placeholders, no “—” chrome.

### 4.3 Shipment detail

`presentation.service` shipment detail maps alerts with `shipment: null` today, so cards there never show PO/consignee.

**In scope:** when rendering `AlertCard` on `ShipmentDetailPage`, pass a minimal nested shipment from the parent detail payload:

```ts
shipment: {
  id: shipment.id,
  poNumbers: shipment.poNumbers,
  route: shipment.route,
  consigneeName: shipment.consigneeName ?? null,
}
```

(Alternatively backend could attach summary on detail alerts; frontend pass-through is enough for A and avoids changing detail alert assembly if the parent already has the fields.)

### 4.4 Out of scope for this card (optional follow-up)

- TopBar notification dropdown still shows first PO only; no consignee required by #114.

## 5. Testing

| Layer | What |
|-------|------|
| Unit | `buildShipmentSummary` includes/nulls `consigneeName` |
| Unit | alert mapper passes through `consigneeName` |
| Unit | `formatPoHeader` (or equivalent): 0 / 1 / many |
| Unit/UI | AlertCard behavior if existing component tests; otherwise helper + mapper coverage is minimum |

No integration DB requirement for the pure summary/mapper tests.

## 6. Acceptance criteria (maps to #114)

- [ ] Dashboard alert header: severity badge → PO# (when present) → consignee (when present)
- [ ] Multiple POs: `PO# first +N`
- [ ] Missing PO and/or consignee: no empty placeholder chrome
- [ ] Same card rules on Alerts page; shipment detail cards receive parent PO/consignee
- [ ] Summary payload exposes `consigneeName` when leg has it
- [ ] Customer is not shown on alert card header
- [ ] PO link data gaps tracked in a separate issue (not fixed here)

## 7. Companion work (separate issue)

Filed: https://github.com/johnmak101-ops/cobalt-shiptrack/issues/121  
Investigate why many active alerts lack booking_pos / PO numbers despite route.

Out of scope for implementation of this design: backfills, dual-source PO merge, evidence-derived POs.

## 8. Non-goals

- Redesigning alert evaluation rules
- Changing severity badge styling
- Customer fallback chain
- Fixing seed/demo data completeness as the primary fix for empty PO
```
