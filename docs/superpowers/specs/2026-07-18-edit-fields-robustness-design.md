# Edit-fields form robustness — design

**Date:** 2026-07-18
**Status:** implemented on `feat/edit-fields-robustness` (commit 239f062)
**Follows:** #221 (numeric sanity gate), #222 (SCAC/container format gates)

## Problem

Dogfooding the shipment **Order Details** edit form surfaced three defects that share one root theme — the form validates *some* fields, but there is no consistent, form-wide validation/error model:

1. **No inline feedback for negatives.** Typing `-20` in Total Quantity shows nothing until Save fails.
2. **Free-text into enum-constrained columns raw-500s.** Typing UOM `wqdqwd` violates the DB CHECK constraint `ck_shipments_qty_unit` (allowed set = the `QTY_UNIT` enum); the driver error is unhandled → HTTP **500 "Internal server error"**. `mode` has the same exposure (`SHIPMENT_MODE` enum: `SEA / SEA_FCL / SEA_LCL / AIR`).
3. **Failure toasts show a success icon.** `Toast.tsx` hardcodes a green `CheckCircle` for every message; `toast()` has no success/error concept, so "Save failed" gets a green tick.

## Field validation model (target)

Every editable leg column falls into one tier; each tier behaves consistently:

| Tier | Fields | UI control | Backend | Bad input |
|---|---|---|---|---|
| **Enum** | `qtyUnit` (UOM), `mode` | dropdown (`<select>`) | enum check in `coerceLegField` | impossible in UI; 400 via API/create |
| **Hard-validated** | `qty`, `grossWeight`, `measurement`, `scacCode`, `containerNo` | input + inline error | reject in `coerceLegField` *(done #221/#222)* | inline error disables Save; 400 if forced |
| **Advisory** | `htsCode` | input + inline warning | none (forms vary) | warning; Save allowed |
| **Free-form** | `bookingNo`, `soNo`, `hbl`, `mbl`, consignee, vessel, voyage, dates, ports, forwarder… | input | none | accepted |

## Thread 1 — Enum fields → dropdowns + backend gate

### Backend
- Add enum validation to `coerceLegField` (`backend/src/shipments/coerce-field.ts`), mirroring the SCAC/container gate:
  - `qtyUnit` must be in `QTY_UNIT`; else `BadRequestException` ("UOM must be one of: cartons, pieces, cbm, packages, pallets, units, containers, sets").
  - `mode` must be in `SHIPMENT_MODE`; else `BadRequestException` ("Mode must be one of: SEA, SEA_FCL, SEA_LCL, AIR").
  - Import both enums from `backend/src/db/enums.ts` (single source of truth — the same arrays the DB CHECK constraints are built from).
  - Match is **exact / case-sensitive** (mirrors the DB constraint: `'cartons'` not `'CARTONS'`, `'SEA'` not `'sea'`). The dropdown always sends exact values; the API/create edge is held to the same rule the DB enforces.
  - Empty / null → null (unchanged; clears the field).
- editFields, `review.correct`, and `createManual` all route through `coerceLegField`, so this gates the edit form, review-correct, the New shipment modal, and the raw API — **human paths only**. The committer/agent write path never hits `coerceLegField`, so agent extractions are never rejected (**de-correction preserved**).

### Frontend
- UOM and Mode render as `<select>` in both the edit form (`ShipmentDetailPage.tsx`) and the create modal (`NewShipmentModal.tsx`).
- Option lists come from a new frontend constant mirroring the backend enums — `frontend/src/lib/enums.ts` (`UOM_OPTIONS`, `MODE_OPTIONS`), with a comment naming `backend/src/db/enums.ts` as the source. (No shared FE/BE package in this repo; a small mirror + comment is the established pattern.)
- **Out-of-enum current value:** if a shipment's current `qtyUnit`/`mode` is not in the enum (legacy/agent data), render it as an extra, selected option (e.g. `<value> (unrecognized)`) so the dropdown shows the true value and never silently rewrites it. The user may pick a valid value to fix it. This is safe because `editFields` only sends **changed** fields — an unchanged out-of-enum value is never re-validated, so it cannot spuriously 400; the enum gate fires only when the user actually selects a new value.
- The edit form renders fields generically from `EDITABLE_FIELDS`; add an optional `options?: readonly string[]` to the field metadata so the render loop emits a `<select>` for those two fields (and a plain input otherwise).

## Thread 2 — Global DB-error → 400 filter

- New `backend/src/common/db-exception.filter.ts`: a Nest `ExceptionFilter` (`@Catch()`), registered globally via `app.useGlobalFilters(new DbExceptionFilter())` in `main.ts`.
- Behaviour:
  - Pass `HttpException`s through untouched (validation 400s etc. keep their status/message).
  - Inspect other errors for a SQL Server error number (mssql/tedious expose it on `err.number` / `err.originalError?.info?.number`): **547** (CHECK / FK), **2627 / 2601** (unique), **515** (NOT NULL) → respond **HTTP 400** with a clean, non-leaky message (e.g. "One of the values isn't allowed." — do NOT echo raw SQL / constraint names).
  - Anything else → delegate to Nest's default handling (still a real 500 + logged).
- Durable guarantee: even a constraint we did not anticipate returns a sane 400 + correct toast, app-wide (every write endpoint benefits, not just this form).

## Thread 3 — Toast success/error variants

- `frontend/src/components/ui/Toast.tsx`: keep `toast(msg)` = success (green `CheckCircle`, `text-status-success`). Add `toast.error(msg)` → red `XCircle` + `text-status-critical`. Implement by attaching `.success` / `.error` to the `toast` function and carrying a `kind` on each toast item; `Toaster` picks icon + colour by kind.
- Update every failure call site to `toast.error(...)`: the edit-form `onError`, plus any other failure toasts (grep `toast(` for failure copy — e.g. review-queue actions, download errors).

## Thread 4 — Inline numeric errors

- New shared helper `numericFieldWarn(column: string, value: string | undefined): string | null` in `frontend/src/lib/review-fields.ts` (testable), mirroring the backend `coerceLegField` numeric rules:
  - `qty`: negative → "Total Quantity cannot be negative"; zero / non-integer → "Total Quantity must be a whole number greater than 0".
  - `grossWeight` / `measurement`: negative → "`<label>` cannot be negative".
  - non-numeric / empty → null.
- Rendered inline under the numeric inputs in the edit form (and the create modal), styled like the existing HTS warning but as an **error** (`text-status-critical`).
- **Save-blocking:** these are hard errors — while any is present, the Save button is disabled (computed alongside the existing changed/note gate). HTS stays advisory (does not block).

## Testing

- **Backend**
  - `coerce-field.spec`: valid + invalid UOM (`'cartons'` ok, `'wqdqwd'` throws) and mode (`'SEA'` ok, `'banana'` throws).
  - `db-exception.filter.spec`: a fake error with `number = 547` → 400; an `HttpException` and a plain `Error` → passthrough.
  - `shipments.service.spec`: `createManual` rejects a bad UOM/mode before `committer.apply`.
- **Frontend**
  - `review-fields.test`: `numericFieldWarn` cases (negative, zero, fractional, valid, empty).
  - a render check that UOM/Mode are `<select>` populated from the enum options.
- **Live e2e** (rebuilt backend on branch)
  - UOM dropdown offers only the 8 values; cannot submit garbage.
  - Forced bad enum via API `PATCH` → **400** (not 500).
  - Negative qty → inline error + Save disabled.
  - A failure toast shows the red X icon.

## Out of scope (YAGNI)

- Cross-field date ordering (ETD ≤ ETA, ATD ≤ ATA).
- Format-gating the free-form ID fields (booking/SO/HBL/MBL) — no universal format.
- Reworking the committer/agent write path — it must stay un-gated per the de-correction principle.

## Files touched

- **Backend:** `shipments/coerce-field.ts` (+`.spec`), `common/db-exception.filter.ts` (+`.spec`, new), `main.ts`, `shipments/shipments.service.spec.ts`.
- **Frontend:** `lib/enums.ts` (new), `lib/review-fields.ts` (+`.test`), `components/ui/Toast.tsx`, `pages/ShipmentDetailPage.tsx`, `components/shipments/NewShipmentModal.tsx`, and misc failure-toast call sites.

## Delivery

One PR, TDD (red → green per unit) then live e2e, same cadence as #221/#222. CI remains GitHub-Actions billing-blocked, so it merges on local verification (backend suite + both typechecks + e2e).
