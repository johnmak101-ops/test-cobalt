# PO item_style_no enrichment

- **Shipment Item/Style:** merge **list-union** (all email tokens).
- **PO Item/Style:** `resolvePoEnrichment` (`backend/src/reconcile/po-enrichment.ts`) —
  - if all statements nested and multi has ≤3 tokens (`STYLE_NESTED_UNION_MAX_TOKENS`) → **union** (fixes incomplete INV/PL singles such as Set1 PO **25312**);
  - else **T1a** fewest tokens (beats large packing-list multi stamps — IZAC).
- **Rematch / upsert:** upgrades PO style only when the new value is a **token superset** (`isStyleTokenSuperset` in `backend/src/lib/style-tokens.ts` → `upsertPo`). Never shrinks an existing multi to a subset.
- **Backfill** (repair existing single-token rows without full rematch):

```powershell
cd D:\cobalt_track_system\backend
pnpm exec ts-node -P tsconfig.json scripts/backfill-po-style-subset-union.ts           # dry-run
pnpm exec ts-node -P tsconfig.json scripts/backfill-po-style-subset-union.ts --apply  # write
```

Dry-run default. Refuses demo-looking DBs unless `--force`.

## Set1 check

```sql
SELECT po_number, item_style_no FROM purchase_orders WHERE po_number = '25312';
-- expect both 56571 and 56572 tokens
```

## Optional rematch (queue)

Uses upsert superset-upgrade on POST decisions:

```powershell
cd D:\cobalt-queue
$env:STORYLINE_JOIN='on'; $env:SUBJECT_PARTY_PIN='on'; $env:IDENTITY_PREEXTRACT='on'; $env:CRITIC='heuristic'
pnpm exec tsx src/dev/run-matcher.ts --all --force
```

**Spec / plan (queue):**  
`docs/superpowers/specs/2026-07-21-po-item-style-subset-union-design.md`  
`docs/superpowers/plans/2026-07-21-po-item-style-subset-union-plan.md`
