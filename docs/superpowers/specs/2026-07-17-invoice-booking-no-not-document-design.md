# Invoice/Billing + booking_no must not park as DOCUMENT

**Date:** 2026-07-17  
**Status:** Implemented  
**Repo:** cobalt-shiptrack  

## Rule

| Condition | kind | rule |
|-----------|------|------|
| emailTypes only Invoice/Billing, **has booking_no** | SHIPMENT | `invoice_with_booking` + provisional review |
| emailTypes only Invoice/Billing, **no booking_no** | DOCUMENT | `invoice_so_ref` (unchanged) |

## Files

- `backend/src/reconcile/state.ts` — `classifyKindDetail`
- `backend/src/reconcile/committer.service.ts` — review hint
- `state.spec.ts`, `committer.int.spec.ts` — tests

## Out of scope

Queue #130 type rescue; SO/HBL-only invoices stay DOCUMENT.
