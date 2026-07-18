# Edit-fields form robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipment Order Details edit form (and create modal) validate enum/numeric fields consistently, map DB constraint errors to HTTP 400, and show red error toasts on failure.

**Architecture:** Backend gates enums in `coerceLegField` (human paths only); a global Nest filter maps SQL constraint numbers to 400. Frontend mirrors enums as dropdowns, blocks Save on numeric errors via `numericFieldWarn`, and adds `toast.error`.

**Tech Stack:** NestJS 11, Kysely/SQL Server, React 19 + Vite, Vitest, lucide-react.

## Global Constraints

- Human edit paths only (`coerceLegField`) — never gate committer/agent writes (de-correction).
- Enum match is exact / case-sensitive (`cartons` not `CARTONS`, `SEA` not `sea`).
- Enum source of truth: `backend/src/db/enums.ts` (`QTY_UNIT`, `SHIPMENT_MODE`); FE mirrors with a comment.
- Out-of-enum current values: extra selected option `"${value} (unrecognized)"`; unchanged values never re-sent.
- DB filter messages must not echo SQL / constraint names.
- `toast()` remains success; failures use `toast.error(...)`.
- No DB migrations. No poller. Work on branch `feat/edit-fields-robustness`.

---

### Task 1: Backend enum gates in `coerceLegField`

**Files:**
- Modify: `backend/src/shipments/coerce-field.ts`
- Test: `backend/src/shipments/coerce-field.spec.ts`
- Test: `backend/src/shipments/shipments.service.spec.ts`

**Interfaces:**
- Consumes: `QTY_UNIT`, `SHIPMENT_MODE` from `../db/enums`
- Produces: `coerceLegField` rejects invalid `qtyUnit` / `mode` with `BadRequestException`

- [ ] **Step 1: Write the failing tests** (append to `coerce-field.spec.ts`)

```ts
it('rejects an out-of-enum UOM with 400', () => {
  expect(() => coerceLegField('qtyUnit', 'wqdqwd')).toThrow(BadRequestException)
  try { coerceLegField('qtyUnit', 'wqdqwd') } catch (e) {
    expect((e as BadRequestException).message).toMatch(/UOM must be one of/)
  }
})
it('accepts a valid UOM and clears blank', () => {
  expect(coerceLegField('qtyUnit', 'cartons')).toBe('cartons')
  expect(coerceLegField('qtyUnit', '')).toBeNull()
})
it('rejects case-mismatched UOM (DB is exact)', () => {
  expect(() => coerceLegField('qtyUnit', 'CARTONS')).toThrow(BadRequestException)
})
it('rejects an out-of-enum mode with 400', () => {
  expect(() => coerceLegField('mode', 'banana')).toThrow(BadRequestException)
})
it('accepts valid modes SEA / SEA_FCL / SEA_LCL / AIR', () => {
  for (const m of ['SEA', 'SEA_FCL', 'SEA_LCL', 'AIR']) {
    expect(coerceLegField('mode', m)).toBe(m)
  }
})
```

Append to `shipments.service.spec.ts`:

```ts
it('rejects a bad UOM before committing anything', async () => {
  const { svc, committer } = makeService()
  await expect(svc.createManual({ bookingNo: 'BK1', qtyUnit: 'wqdqwd' }, 'user-1'))
    .rejects.toBeInstanceOf(BadRequestException)
  expect(committer.apply).not.toHaveBeenCalled()
})
it('rejects a bad mode before committing anything', async () => {
  const { svc, committer } = makeService()
  await expect(svc.createManual({ bookingNo: 'BK1', mode: 'banana' }, 'user-1'))
    .rejects.toBeInstanceOf(BadRequestException)
  expect(committer.apply).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && pnpm exec vitest run src/shipments/coerce-field.spec.ts src/shipments/shipments.service.spec.ts
```

- [ ] **Step 3: Implement enum gates in `coerce-field.ts`**

After SCAC/container checks, before `return text`:

```ts
import { QTY_UNIT, SHIPMENT_MODE } from '../db/enums'

// ...
if (field === 'qtyUnit') {
  if (!(QTY_UNIT as readonly string[]).includes(text)) {
    throw new BadRequestException(`UOM must be one of: ${QTY_UNIT.join(', ')}`)
  }
  return text
}
if (field === 'mode') {
  if (!(SHIPMENT_MODE as readonly string[]).includes(text)) {
    throw new BadRequestException(`Mode must be one of: ${SHIPMENT_MODE.join(', ')}`)
  }
  return text
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `fix(shipments): enum-gate UOM and mode on human edit path`

---

### Task 2: Global `DbExceptionFilter`

**Files:**
- Create: `backend/src/common/db-exception.filter.ts`
- Create: `backend/src/common/db-exception.filter.spec.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Produces: `@Catch()` filter; SQL 547/2627/2601/515 → HTTP 400 `"One of the values isn't allowed."`; `HttpException` passthrough; other errors rethrown.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { DbExceptionFilter } from './db-exception.filter'

function mockHost(json = vi.fn()) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: (code: number) => ({ json: (body: unknown) => { json(code, body); return body } }) }),
    }),
  } as never
}

describe('DbExceptionFilter', () => {
  const filter = new DbExceptionFilter()
  it('maps SQL 547 to 400 with a clean message', () => {
    const json = vi.fn()
    filter.catch(Object.assign(new Error('ck'), { number: 547 }), mockHost(json))
    expect(json).toHaveBeenCalledWith(400, expect.objectContaining({
      statusCode: 400,
      message: "One of the values isn't allowed.",
    }))
  })
  it('maps nested originalError.info.number 2627 to 400', () => {
    const json = vi.fn()
    filter.catch({ message: 'dup', originalError: { info: { number: 2627 } } }, mockHost(json))
    expect(json).toHaveBeenCalledWith(400, expect.objectContaining({ statusCode: 400 }))
  })
  it('re-throws HttpException (validation 400s keep their body)', () => {
    expect(() => filter.catch(new BadRequestException('Total Quantity cannot be negative'), mockHost()))
      .toThrow(BadRequestException)
  })
  it('re-throws plain Error (real 500)', () => {
    expect(() => filter.catch(new Error('boom'), mockHost())).toThrow('boom')
  })
})
```

- [ ] **Step 2: Run — expect FAIL (module missing)**
- [ ] **Step 3: Implement filter + register in `main.ts`**

```ts
// db-exception.filter.ts
import { Catch, type ExceptionFilter, type ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'

const CONSTRAINT_NUMBERS = new Set([547, 2627, 2601, 515])

function sqlNumber(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as { number?: number; originalError?: { info?: { number?: number }; number?: number } }
  if (typeof e.number === 'number') return e.number
  const nested = e.originalError
  if (nested && typeof nested.number === 'number') return nested.number
  if (nested?.info && typeof nested.info.number === 'number') return nested.info.number
  return undefined
}

@Catch()
export class DbExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) throw exception
    const n = sqlNumber(exception)
    if (n != null && CONSTRAINT_NUMBERS.has(n)) {
      const res = host.switchToHttp().getResponse()
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "One of the values isn't allowed.",
        error: 'Bad Request',
      })
    }
    throw exception
  }
}
```

In `main.ts` after pipes:

```ts
import { DbExceptionFilter } from './common/db-exception.filter'
// ...
app.useGlobalFilters(new DbExceptionFilter())
```

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit** `fix(api): map SQL constraint violations to HTTP 400`

---

### Task 3: Toast success/error variants

**Files:**
- Modify: `frontend/src/components/ui/Toast.tsx`
- Modify failure call sites: `ShipmentDetailPage.tsx` onError, `use-users.ts` onError×3, `use-resolution.ts` onError
- Leave success toasts as `toast(...)`

- [ ] **Step 1: Implement Toast with kind**

```tsx
import { CheckCircle, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error'
type ToastItem = { id: number; message: string; kind: ToastKind }
type Emit = (message: string, kind: ToastKind) => void
let emit: Emit | null = null

function show(message: string, kind: ToastKind = 'success') { emit?.(message, kind) }
export function toast(message: string): void { show(message, 'success') }
toast.success = (message: string) => show(message, 'success')
toast.error = (message: string) => show(message, 'error')

// Toaster: emit = (message, kind) => ...; icon/colour by kind
// error → XCircle + text-status-critical; success → CheckCircle + text-status-success
```

- [ ] **Step 2: Update failure sites to `toast.error(...)`**
- [ ] **Step 3: Commit** `fix(ui): toast.error for failure messages`

---

### Task 4: FE enums, selects, numeric inline errors

**Files:**
- Create: `frontend/src/lib/enums.ts`
- Modify: `frontend/src/lib/review-fields.ts` (+`.test.ts`)
- Modify: `frontend/src/pages/ShipmentDetailPage.tsx`
- Modify: `frontend/src/components/shipments/NewShipmentModal.tsx`

**Interfaces:**
- `UOM_OPTIONS` / `MODE_OPTIONS` mirror backend enums
- `EditableField.options?: readonly string[]`
- `numericFieldWarn(column, value): string | null`

- [ ] **Step 1: Failing tests for `numericFieldWarn`**

```ts
import { numericFieldWarn } from './review-fields'
it('qty negative', () => expect(numericFieldWarn('qty', '-20')).toBe('Total Quantity cannot be negative'))
it('qty zero', () => expect(numericFieldWarn('qty', '0')).toMatch(/whole number greater than 0/))
it('qty fractional', () => expect(numericFieldWarn('qty', '1.5')).toMatch(/whole number greater than 0/))
it('qty valid', () => expect(numericFieldWarn('qty', '12')).toBeNull())
it('empty', () => expect(numericFieldWarn('qty', '')).toBeNull())
it('weight negative', () => expect(numericFieldWarn('grossWeight', '-1')).toBe('Gross Weight cannot be negative'))
```

- [ ] **Step 2: Implement helper + enums + options on EDITABLE_FIELDS**

```ts
// enums.ts — source: backend/src/db/enums.ts QTY_UNIT / SHIPMENT_MODE
export const UOM_OPTIONS = ['cartons', 'pieces', 'cbm', 'packages', 'pallets', 'units', 'containers', 'sets'] as const
export const MODE_OPTIONS = ['SEA', 'SEA_FCL', 'SEA_LCL', 'AIR'] as const
```

Wire `options: UOM_OPTIONS` / `MODE_OPTIONS` on qtyUnit and mode fields.

```ts
export function numericFieldWarn(column: string, value: string | undefined): string | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const labels: Record<string, string> = {
    qty: 'Total Quantity', grossWeight: 'Gross Weight', measurement: 'Measurement',
  }
  const label = labels[column]
  if (!label) return null
  if (n < 0) return `${label} cannot be negative`
  if (column === 'qty' && (n === 0 || !Number.isInteger(n))) {
    return `${label} must be a whole number greater than 0`
  }
  return null
}
```

- [ ] **Step 3: Edit form + create modal**

`EDIT_SECTIONS` map must pass `options: f.options`.

Render: if `f.options` → `<select>` with empty option + options; if current value not in list, add `<option value={cur}>{cur} (unrecognized)</option>`.

Inline under number inputs: `numericFieldWarn(f.db, draft[f.db])` with `text-status-critical`.

Save gate: `const hasNumericErrors = editing && EDIT_SECTIONS... some numericFieldWarn`; `saveBlocked = (editedCount > 0 && !note.trim()) || hasNumericErrors`; disable Save accordingly; use `toast.error` on save failure.

NewShipmentModal: select for qtyUnit (and mode if added to form — only qtyUnit is in CARGO today; add mode select to ROUTE if mode is a create key). Spec says both UOM and Mode as select in create modal — add mode field to ROUTE if missing.

- [ ] **Step 4: Frontend tests + typecheck PASS**
- [ ] **Step 5: Commit** `feat(ui): enum dropdowns + inline numeric errors on edit form`

---

### Task 5: Verification

```bash
# from D:\cobalt_track_system
pnpm --filter backend exec vitest run src/shipments/coerce-field.spec.ts src/shipments/shipments.service.spec.ts src/common/db-exception.filter.spec.ts
pnpm --filter frontend exec vitest run src/lib/review-fields.test.ts
pnpm --filter backend exec tsc --noEmit -p tsconfig.json
pnpm --filter frontend exec tsc --noEmit -p tsconfig.json
```

Live e2e (dev servers): UOM dropdown only 8 values; PATCH bad UOM → 400; negative qty blocks Save; failure toast red X.

---

## Spec coverage self-check

| Spec thread | Task |
|---|---|
| Enum backend gate | T1 |
| Enum FE selects + unrecognized | T4 |
| DbExceptionFilter | T2 |
| Toast.error | T3 |
| numericFieldWarn + save block | T4 |
| createManual rejects bad UOM/mode | T1 |
| Out of scope (dates, free-form IDs, agent path) | — |
