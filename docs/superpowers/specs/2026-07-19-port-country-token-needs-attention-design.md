# Port country-token Needs attention copy

**Date:** 2026-07-19  
**Status:** Approved for implementation  
**Repo:** cobalt-shiptrack (Review Needs attention humanizer)  
**Related:** #186 / needs-attention layman groups; brand suppress (PR #241); portsLinked drop when LOCODE linked

## Goal

When POL/POD free text is only a **country** (e.g. `"USA"`), Needs attention must **not** claim the value is missing from UN/LOCODE masters or tell ops to “add or alias, then rematch.” Ops should read that the **email named a country, not a port**, and they should **pick a real port**.

True city/port master misses keep today’s LOCODE wording.

## Product decision

| Choice | Detail |
|--------|--------|
| **Approach** | **A — quieter, honest copy** (still show a line) |
| **Not this slice** | Suppress country-only lines (B); country-scoped port picker (C); severity demote |
| **Surface** | Frontend humanizer only (`needs-attention.ts`) |
| **Backend** | No change to committer `masterMiss` strings or linking |

## Problem (current)

Committer leaves country blobs unlinked and emits master-miss reasons like:

- `pod "USA" did not exact/curated-match a port master — left unlinked`
- `Cannot match "USA" as a port UN/LOCODE. Add or alias…`

Humanizer maps these to:

> Port "USA" not in UN/LOCODE masters — add or alias, then rematch

That is misleading: **USA is a country**, not a single port to alias.

## Behavior

### Detection: `looksLikeCountryToken(value)`

Normalize: trim, collapse whitespace, uppercase for codes / lowercase for name set membership.

Treat as **country-like** when the token matches:

1. **Curated country names / aliases** (case-insensitive), including at least:  
   `USA`, `United States`, `United States of America`, `US`, `Vietnam`, `Viet Nam`, `China`, `UK`, `United Kingdom`, `Hong Kong`, `Bangladesh`, `Cambodia`, `Japan`, `Korea`, `South Korea`, `Taiwan`, `India`, `Indonesia`, `Thailand`, `Malaysia`, `Singapore`, `Philippines`, `Australia`, `Canada`, `Mexico`, `Germany`, `France`, `Italy`, `Spain`, `Netherlands`, `Belgium`, `Turkey`  
   (extend as ops hit real emails; list lives next to the helper.)
2. **ISO-3166 alpha-2 or alpha-3** country codes that are **not** valid 5-character UN/LOCODE shape (`/^[A-Z]{2}[A-Z0-9]{3}$/i`).

**Default if uncertain:** not country-like → keep LOCODE master-miss copy (safer: never claim “country” falsely).

### Rewrite (port-miss lines only)

Applies when the humanizer produces a port-miss line (`m-port` / `m-port:…`) and the **quoted token** (or extracted city/name) is country-like.

| Field known? | User sees |
|--------------|-----------|
| POL from `pol "…" did not…` | Email only named country "USA" for POL — pick a real port |
| POD from `pod "…" …` | Email only named country "USA" for POD — pick a real port |
| Field unknown | Email only named country "USA" — pick a real port (POL/POD) |

Preserve the actual display token casing from the quote when possible; detection is case-insensitive.

### Unchanged

| Rule | Detail |
|------|--------|
| portsLinked drop | When either pol or pod is LOCODE-linked, drop port-miss lines (existing) |
| Real city/port miss | e.g. `"Ho Chi Minh City"` without link → existing UN/LOCODE masters copy |
| Party / Mesh lines | Untouched |
| Brand suppress | Untouched |
| Severity / groups | Stay `master_miss` / Master miss; no demote in v1 |
| Linking | Committer behavior unchanged |

## Edge cases

| Case | Result |
|------|--------|
| `"USA"`, `"US"`, `"United States"` | Country copy |
| `"VIETNAM"` + pod already `VNSGN` | Dropped by portsLinked (no line) |
| `"Yantian"` not in master | LOCODE miss copy |
| Token not on list | LOCODE miss copy |
| ISO-2 vs LOCODE collision | None: LOCODE is always 5 chars |

## Architecture

```
riskFlags / reviewReasons
        │
        ▼
 lineFromFlag / lineFromReason  ──►  if port-miss && looksLikeCountryToken(quoted)
        │                                    → country copy + lineId m-port:… (or m-port)
        │                            else → existing LOCODE / master copy
        ▼
 buildNeedsAttention (+ portsLinked drop)
```

- **Helper:** `looksLikeCountryToken(value: string | null | undefined): boolean`  
  Prefer export from `needs-attention.ts` (or tiny `country-tokens.ts` sibling if list is large).
- **No** API, schema, or backend changes.

## Files

| File | Change |
|------|--------|
| `frontend/src/components/review/needs-attention.ts` | Country detect + rewrite in port-miss humanize paths |
| `frontend/src/components/review/needs-attention.test.ts` | Country vs city vs portsLinked cases |

## Success criteria

1. Review Needs attention for USA-only (or similar) POD/POL says **email named a country — pick a real port**, not “not in UN/LOCODE masters / add or alias.”
2. Real port-name misses still show LOCODE master wording when not LOCODE-linked.
3. Existing portsLinked + brand + group tests still pass.
4. No reconcile/link behavior change.

## Out of scope (later)

- Suppress country-only from Needs attention entirely  
- Country-filtered PortPicker suggestions  
- Backend-classified `country_only` reason codes  
- Severity demotion for country lines  
- Exhaustive ISO country name list from a package (YAGNI; curated list first)

## Testing

- Unit: `looksLikeCountryToken` true for USA/US/Vietnam; false for Ho Chi Minh City / CNYTN / random city  
- Unit: `buildNeedsAttention` with `Cannot match "USA"…` → country copy  
- Unit: `pod "USA" did not exact/curated-match…` reason → country copy with POD when field known  
- Unit: `"Ho Chi Minh City"` without portsLinked → LOCODE miss  
- Regression: portsLinked true still drops VIETNAM/HCMC port-miss
