# Review: PO membership + per-PO item/style — design

**Date:** 2026-07-19  
**Status:** Approved direction (brainstorm); ready for implementation plan  
**Product surface:** Review Queue expand panel + Shipment Review Focus page  
**Related:** table-truth (`2026-07-18-table-truth-one-shot-design.md`), PurchaseOrdersCard, live Existing hydration (WIP)

---

## 1. Problem

### Operator jobs (must succeed)

1. **PO belongs on the correct shipment** — not a wrong leg, not missing, not only a bag of styles.
2. **Correct item/style is attached to the correct PO** — not a shipment-level comma list.

### What is broken today

| Layer | Reality |
|-------|---------|
| Storage truth | `purchase_orders.item_style_no` per PO + `shipment_pos` membership |
| Leg rollup | `shipment_legs.item_style_no` = denormalized union bag |
| Pipeline | Parser often **broadcasts** one multi-style list onto every PO; enrichment flags this but UI does not help fix pairing |
| Review UI | One conflict row: **Item / Style No.** Existing vs AI Proposed as flat lists |
| Operator | Cannot assign style → PO; cannot re-home a PO to another shipment from Review |

Cargo qty / UOM as shipment-level field conflicts are fine. **Item/Style as one bag field is the wrong object.**

### Causal chain (deep)

```
Email → parse (per-PO records; often broadcast styles)
     → resolvePoEnrichment (pick/flag style per PO)
     → purchase_orders.item_style_no   ← operator truth for job 2
     → shipment_pos link              ← operator truth for job 1
     → leg.item_style_no bag          ← rollup only
     → critic may conflict on bag OR Needs attention "PO X: style…"
     → Review shows bag diff          ← fails both jobs
```

---

## 2. Goals

1. In Review, operators complete **membership** and **style-on-PO** without leaving the queue flow for the happy path.
2. Remove Item/Style bag as a **decision** surface (optional read-only rollup only).
3. When PO is on the wrong shipment: **remove from this shipment** and **search any shipment** to attach (full free search — product choice C).
4. When style is wrong on a PO: Keep current / Take email proposed / Edit free text → write `purchase_orders.item_style_no`.
5. Keep SO#, qty, UOM, ports, etc. on the existing field conflict table; prefer live leg values for Existing (already in progress).

### Non-goals (v1)

- Full Purchase Orders CRUD (qty, brand, delete-everywhere) inside Review — detail page owns that.
- Parser / enrichment algorithm changes (table-truth owns origin).
- Auto-picking the correct shipment without a human.
- Documents drawer / Mesh master-miss redesign.
- Replacing Needs attention copy (only link actions where PO-scoped).

---

## 3. UX design

### Placement

Inside `ReviewCard` (embedded queue expand + focus page), **above** the field conflict table (or between Needs attention and field table):

**Section title:** `POs & styles`  
**Subtitle (muted):** `Confirm each PO is on this shipment, then fix item/style per PO.`

### Row model (one row per linked PO)

| Column | Content |
|--------|---------|
| **PO#** | `poNumber`; link to `/purchase-orders/:id` optional |
| **On this shipment** | Always “Yes” for linked rows; if `shipmentSummary` shows other legs, muted “Also on N other shipment(s)” |
| **Current style** | Live `linkedPOs[].itemStyleNo` (empty → `—`) |
| **From email / AI** | Best available proposed style for this PO (see data) or `—` |
| **Actions** | Style: Keep · Take proposed · Edit. Membership: Remove from this shipment · Move to another shipment… |

### Membership — Move to another shipment (v1)

1. Operator clicks **Move to another shipment…** (or Remove + separate Attach if clearer).
2. Panel opens: search input (booking / SO / HBL / container / PO# / free text).
3. Results list: booking, customer, route, status; exclude current shipment id.
4. Operator picks target → system **unlinks** from current shipment (needs `linkId`) and **links** to target (`POST .../link-shipment`).
5. Toast: `PO {n} moved to {booking}`; invalidate shipment + review queries.
6. If unlink succeeds and link fails: toast error; offer retry link only (PO may be unlinked — surface clearly).

**Remove from this shipment only:** unlink; toast; row disappears after refresh.

**Add PO not on list (v1 optional stretch):** “Add PO to this shipment” reuses create+link from PurchaseOrdersCard patterns — **phase 1.5** if time; not required for membership of already-linked POs.

### Style actions

| Action | Behavior |
|--------|----------|
| **Keep** | No write (current is correct). Row marks style “done” for session optional. |
| **Take proposed** | `PATCH /purchase-orders/:id` `{ itemStyleNo: proposed }` when proposed non-empty |
| **Edit** | Inline input; Save → same PATCH |

After style write: invalidate `shipment` so Order Details PO card and rollup refresh.

### Field conflict table interaction

- **Do not** render critic conflict field `item_style_no` / `itemStyleNo` as a bag decision row when `linkedPOs.length > 0`.
- If no linked POs, keep bag row or show empty PO strip + “Add PO” stretch / open full shipment.
- Qty / UOM / SO# unchanged.
- When live Existing equals AI Proposed for a field, prefer hiding that row or showing 0-change count (nice-to-have; separate from PO strip).

### Needs attention

- Keep PO unit-mismatch / style-broadcast bullets.
- Optional later: click bullet scrolls to PO row — not v1 required.

### Approve / Keep Existing

- Still confirms the **shipment** (leg).
- Does **not** auto-rewrite PO styles.
- Operators should fix PO strip first when membership/style is wrong; copy can remind: “POs & styles are separate from field Approve.”

---

## 4. Data & APIs

### Already available

| Need | API / shape |
|------|-------------|
| Linked POs + style | `GET /shipments/:id` → `linkedPOs[]` (`id`, `linkId`, `poNumber`, `itemStyleNo`, …) |
| Update style | `PATCH /purchase-orders/:id` `{ itemStyleNo }` |
| Unlink | `DELETE /purchase-orders/:poId/link-shipment/:linkId` |
| Link | `POST /purchase-orders/:poId/link-shipment` `{ shipmentId }` |
| Match-key lookup | `GET /shipments?booking_no=` / `so_no` / `customer_po` / … (agent matcher path) |

### Gap to close (v1)

**Free shipment search for Move UI** — list endpoint today only filters status/customer/forwarder; match-key path is strong-key only.

**Add:** `GET /api/shipments?q=<text>&limit=20` (or dedicated `GET /api/shipments/search?q=`) that:

- Searches bookingNo, soNo, hbl, container, customer name/code, linked PO numbers (implementation may start with booking/SO/PO/container).
- Returns compact rows: `{ id, bookingNo, soNumber, customerName, route, status, reviewStatus }`.
- Excludes nothing server-side; client excludes current id.
- Auth: same as shipment list (authenticated).

### Proposed style per PO (display)

Priority for **From email / AI** cell:

1. If enrichment left a machine-readable per-PO proposal on the detail payload in future — use it.
2. v1 pragmatic: parse Needs attention / reviewReasons for `PO {poNumber}: item/style ...` kept/competing values when present.
3. Else if critic bag list exists and PO currently has a broadcast multi-token list identical to bag — show bag as weak proposal with badge “shipment list — verify per PO”.
4. Else `—` and only Keep/Edit.

Do **not** invent false per-PO AI if data is only a bag.

### Rollup after PO style change

Optional backend: recompute leg `itemStyleNo` as sorted unique union of linked PO styles on PO patch when linked. If not in v1, next email commit / manual detail edit may lag; document as follow-up. Prefer small backend hook on `PurchaseOrdersService.update` if cheap.

---

## 5. Components (frontend)

| Unit | Responsibility |
|------|----------------|
| `ReviewPoStylesSection` | Section chrome, maps `linkedPOs` → rows, hosts move modal |
| `ReviewPoStyleRow` | One PO: style actions + membership actions |
| `ShipmentSearchPicker` | Debounced `q` search, result list, onSelect(shipmentId) |
| `ReviewCard` | Mount section; filter out itemStyle bag conflicts when POs present |
| Hooks | Reuse `useUpdatePurchaseOrder`, `useUnlinkShipmentFromPO`, `useLinkShipmentToPO`; add `useShipmentSearch(q)` |

### Read-only

When `readOnly` (approved/rejected views): show table without action buttons.

---

## 6. Edge cases

| Case | Behavior |
|------|----------|
| No linked POs | Empty state: “No POs on this shipment” + link to open full shipment; bag conflict row may still show |
| Missing `linkId` | Disable Remove/Move; toast “Open full shipment to manage PO links” |
| Move to same shipment | Disabled / filtered out |
| Search empty | “No shipments match” |
| Concurrent unlink | 404 → toast, refresh |
| Style proposed empty | Hide Take proposed |
| Multi-token style | Single text field (same as PO card); not multi-row bag editor |

---

## 7. Testing

- Unit: filter itemStyle conflicts when POs present; reason parse for proposed style if implemented.
- Component: row renders PO + style; Take proposed calls update; Remove calls unlink; Move calls unlink then link with selected id.
- Search: picker shows results; excludes current shipment.
- ReviewCard: bag row absent when `linkedPOs` non-empty with item_style conflict only.
- Backend: search endpoint returns matches for booking/SO/PO fixtures.

---

## 8. Rollout

1. Backend shipment search (if not already sufficient).  
2. `ReviewPoStylesSection` + wire into ReviewCard.  
3. Suppress bag conflict row.  
4. Move flow end-to-end.  
5. Optional leg rollup refresh.  
6. PR + merge.

---

## 9. Success metrics (qualitative)

- Operators no longer use Copy-all bag to “fix” styles.  
- Wrong-leg PO can be re-homed without leaving Review for a random detail page hunt.  
- Detail PO card and Review strip stay consistent after actions (shared APIs + invalidation).
