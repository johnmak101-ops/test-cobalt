# Plan: Redesign Order Details UI — Full End-to-End Implementation

## Overview

Add all 20 order detail fields to the database schema, API, seed data, and redesign the UI to display them in a well-organized layout. Keep the existing Key Dates card and add a comprehensive Order Details card below it.

**Target fields (20 total):**
| # | Field | Current DB? | New? |
|---|---|---|---|
| 1 | Email Date | No (receivedAt on email) | Shown from email |
| 2 | Customer Code | Yes (customer.code) | Wire to UI |
| 3 | Vendor Code | Partial (vendorId on PO) | Add to shipment |
| 4 | Item No./Style No. | No | New column |
| 5 | Booking No. | No | New column |
| 6 | Cargo Ready Date | Yes (crd) | Already shown |
| 7 | Forwarder Name | Yes (forwarder.name) | Already shown |
| 8 | Consignee Name | No | New column |
| 9 | Consignee Address | No | New column |
| 10 | Customer PO | Yes (poNumbers) | Already shown |
| 11 | SO# | No | New column |
| 12 | Warehouse Start Date | No | New column |
| 13 | Warehouse End Date | No | New column |
| 14 | HBL/AWB/FCR No. | Yes (hblNumber) | Rename label |
| 15 | MBL | No | New column |
| 16 | ETD | Yes | Already shown |
| 17 | ATD | Yes (actualDeparture) | Already shown |
| 18 | ETA | Yes | Already shown |
| 19 | In DC Date | No | New column |
| 20 | Container No. | No | New column |

---

## Phase 1 — Database Schema

**File:** `backend/src/db/schema.ts`

Add these 10 new columns to the `shipments` table:

| Column | Type | Notes |
|---|---|---|
| `itemStyleNo` | `text` | Item No./Style No. |
| `bookingNo` | `text` | Booking number |
| `soNumber` | `text` | SO# (Shipping Order number) |
| `consigneeName` | `text` | Consignee name |
| `consigneeAddress` | `text` | Consignee address |
| `mblNumber` | `text` | MBL (Master Bill of Lading) |
| `containerNo` | `text` | Container number |
| `warehouseStartDate` | `integer (timestamp)` | Warehouse start date |
| `warehouseEndDate` | `integer (timestamp)` | Warehouse end date |
| `inDcDate` | `integer (timestamp)` | In DC (distribution center) date |

Also add `vendorId` to the `shipments` table as a foreign key to `vendors`.

---

## Phase 2 — Local DB Schema

**File:** `backend/src/db/local.ts`

Add the new columns to the `CREATE TABLE shipments` SQL statement:

```sql
vendor_id TEXT REFERENCES vendors(id),
item_style_no TEXT,
booking_no TEXT,
so_number TEXT,
consignee_name TEXT,
consignee_address TEXT,
mbl_number TEXT,
container_no TEXT,
warehouse_start_date INTEGER,
warehouse_end_date INTEGER,
in_dc_date INTEGER,
```

Also add `quantity_shipped` and `quantity_unit` columns to the local.ts `CREATE TABLE shipments` if they're missing.

---

## Phase 3 — Drizzle Migration

Run `npx drizzle-kit generate` in the `backend/` directory after schema changes. This creates a new SQL migration file in `backend/drizzle/`.

---

## Phase 4 — Seed Data

**File:** `backend/src/db/seed.ts`

Update each seeded shipment with sample values for the new fields. Examples:
- ship-001: `bookingNo: 'BK-2026-001'`, `soNumber: 'SO-NLOB-001'`, `consigneeName: 'New Lobster Logistics'`, etc.
- ship-002: `bookingNo: 'BK-2026-002'`, `soNumber: 'SO-SKIM-002'`, etc.
- Each shipment gets realistic sample data for all new fields.

---

## Phase 5 — API Routes

**File:** `backend/src/routes/shipments.ts`

1. **GET /shipments/:id** — Add vendor lookup and include `vendorCode` in the response. Already includes `customer.code`. Also join vendor info:
   ```ts
   const vendor = shipment.vendorId
     ? await db.select().from(vendors).where(eq(vendors.id, shipment.vendorId)).get()
     : null
   ```
   Add to response: `vendor: vendor ? { id: vendor.id, name: vendor.name, code: vendor.location } : null`
   (Note: vendors table doesn't have a `code` column, so we'll use `location` or add a `code` column)

2. **POST /shipments** — Add new fields to insert values
3. **PATCH /shipments/:id** — Add new fields to updateable fields

**Add `code` column to vendors table:**
- `backend/src/db/schema.ts`: Add `code: text('code')` to vendors table
- `backend/src/db/local.ts`: Add `code TEXT` to vendors CREATE TABLE
- Update seed data with vendor codes

---

## Phase 6 — AI Extractor

**File:** `backend/src/services/extractor.ts`

Add new fields to `ExtractedData` interface and extraction prompt:
- `booking_no`
- `so_number`
- `item_style_no`
- `consignee_name`
- `consignee_address`
- `mbl_number`
- `container_no`
- `warehouse_start_date`
- `warehouse_end_date`
- `in_dc_date`

Update the SYSTEM_PROMPT to describe these fields and update EXTRACTION_PROMPT JSON format.

---

## Phase 7 — Pipeline Mapper

**File:** `backend/src/services/pipeline.ts`

Update the shipment update block (around line 222) to map new extracted fields to shipment columns:
```ts
if (extractedData.booking_no) updates.bookingNo = extractedData.booking_no
if (extractedData.so_number) updates.soNumber = extractedData.so_number
if (extractedData.item_style_no) updates.itemStyleNo = extractedData.item_style_no
if (extractedData.consignee_name) updates.consigneeName = extractedData.consignee_name
if (extractedData.consignee_address) updates.consigneeAddress = extractedData.consignee_address
if (extractedData.mbl_number) updates.mblNumber = extractedData.mbl_number
if (extractedData.container_no) updates.containerNo = extractedData.container_no
if (extractedData.warehouse_start_date) updates.warehouseStartDate = new Date(extractedData.warehouse_start_date)
if (extractedData.warehouse_end_date) updates.warehouseEndDate = new Date(extractedData.warehouse_end_date)
if (extractedData.in_dc_date) updates.inDcDate = new Date(extractedData.in_dc_date)
```

---

## Phase 8 — Frontend: Shipment Type Update

**File:** `frontend/src/hooks/use-shipments.ts`

Add new fields to `Shipment` and `ShipmentDetail` interfaces:
```ts
interface Shipment {
  // ... existing fields ...
  vendorId: string | null
  itemStyleNo: string | null
  bookingNo: string | null
  soNumber: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  mblNumber: string | null
  containerNo: string | null
  warehouseStartDate: string | null
  warehouseEndDate: string | null
  inDcDate: string | null
  vendor?: { id: string; name: string; code: string } | null
}
```

---

## Phase 9 — Frontend UI: ShipmentDetailPage Redesign

**File:** `frontend/src/pages/ShipmentDetailPage.tsx`

### 9a. Create helper components

```tsx
function DetailSection({ title, icon, children }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-mono text-sm text-text-primary text-right">
        {value ?? <span className="italic text-text-muted">(pending)</span>}
      </span>
    </div>
  )
}
```

### 9b. Replace "Extracted Data" card with "Order Details" card

Replace the current flat Extracted Data card (lines ~91-115) with a 4-section layout:

**Section 1 — Order Info:** Customer Code, Vendor Code, Customer PO, Email Date
**Section 2 — Cargo & Logistics:** Booking No., SO#, Item/Style No., Qty, Container No.
**Section 3 — Shipping:** Forwarder, Consignee Name, Consignee Address, HBL/AWB/FCR No., MBL
**Section 4 — Key Dates:** Cargo Ready Date, WH Start Date, WH End Date, ETD, ATD, ETA, In DC Date

The existing Key Dates card stays above as a quick-reference timeline.

---

## Phase 10 — Frontend UI: ReviewQueuePage Extracted Data

**File:** `frontend/src/pages/ReviewQueuePage.tsx`

Replace the raw `Object.entries(extractedData)` with a structured display:

1. Define a `FIELD_LABELS` map (e.g., `hbl_number → "HBL/AWB/FCR No."`)
2. Define `FIELD_SECTIONS` grouping fields into logical sections
3. Render each section with a header and labeled rows
4. Dates get formatted using `formatDate()`

---

## Phase 11 — History Tracking

**File:** `backend/src/types/index.ts`

Add new fields to `HistoryField` union type:
```ts
'booking_no' | 'so_number' | 'consignee_name' | 'consignee_address' |
'mbl_number' | 'container_no' | 'warehouse_start_date' | 'warehouse_end_date' | 'in_dc_date'
```

**File:** `backend/src/services/history.ts`

Update `trackShipmentUpdate()` to handle the new fields.

---

## Verification

1. Delete `db.sqlite` and restart the backend to re-seed with new columns
2. Run `npx drizzle-kit generate` in `backend/` directory to create migration
3. Run `npx tsc --noEmit` to check for type errors
4. Navigate to `/shipments/ship-001` and verify:
   - Key Dates card still shows original dates
   - New Order Details card appears with 4 sections and all 20 fields
   - Fields with seed data display values; empty fields show "(pending)"
5. Navigate to Review Queue and expand an email — verify structured extracted data sections
6. Check responsive layout (sections stack on mobile, 2-column on desktop)