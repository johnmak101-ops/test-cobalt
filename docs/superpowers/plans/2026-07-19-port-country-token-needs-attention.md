# Port country-token Needs attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Needs attention shows a port master-miss for a country-only token (e.g. `"USA"`), rewrite the line to honest ops copy: email named a country — pick a real port; leave real city/port misses on the existing UN/LOCODE wording.

**Architecture:** Pure frontend in the Needs attention humanizer. Add `looksLikeCountryToken` + a small curated name/ISO set. In every port-miss branch of `lineFromReason` (and thus PARTY_OPS via `lineFromFlag` → `lineFromReason`), if the quoted/extracted token is country-like, emit country copy instead of “not in UN/LOCODE masters — add or alias…”. No backend or linking changes.

**Tech Stack:** TypeScript, Vitest; `frontend/src/components/review/needs-attention.ts` + tests.

**Design:** `docs/superpowers/specs/2026-07-19-port-country-token-needs-attention-design.md`

## Global Constraints

- Frontend humanizer only — do **not** change committer `masterMiss` strings or port linking.
- Still **show** a line (Approach A); do **not** suppress country-only (B).
- Country copy exact patterns (use display token from quote when available):
  - Field known: `Email only named country "{token}" for {POL|POD} — pick a real port`
  - Field unknown: `Email only named country "{token}" — pick a real port (POL/POD)`
- Uncertain tokens → existing LOCODE master-miss copy (never false “country” claim).
- Keep category `master_miss`, lineId `m-port` / `m-port:{token}`; no severity demote.
- Existing `portsLinked` drop of port-miss lines stays as-is.
- YAGNI: no ISO package, no PortPicker filter, no backend reason codes.

## File map

| File | Role |
|------|------|
| `frontend/src/components/review/needs-attention.ts` | `looksLikeCountryToken`, country copy helper, rewrite in port-miss branches |
| `frontend/src/components/review/needs-attention.test.ts` | Unit tests for detector + humanize paths |

---

### Task 1: Country token detector + port-miss copy rewrite

**Files:**
- Modify: `frontend/src/components/review/needs-attention.ts`
- Modify: `frontend/src/components/review/needs-attention.test.ts`

**Interfaces:**
- Produces:

```typescript
/** True when free-text looks like a country name or ISO-2/3 (not a 5-char UN/LOCODE). */
export function looksLikeCountryToken(value: string | null | undefined): boolean

/** Ops-facing line when port raw is country-only. field: 'pol' | 'pod' | null */
export function countryOnlyPortMissText(
  token: string,
  field?: 'pol' | 'pod' | null,
): string
// "Email only named country \"USA\" for POD — pick a real port"
// "Email only named country \"USA\" — pick a real port (POL/POD)"
```

- Consumes: existing `extractQuotedParty`, `extractPortName`, port-miss branches in `lineFromReason`, `isPortMissLine` / `portsLinked` (unchanged).

- [ ] **Step 1: Write failing unit tests**

Append to `needs-attention.test.ts` (keep existing imports; add new exports):

```typescript
import {
  buildNeedsAttention,
  looksLikeCountryToken,
  countryOnlyPortMissText,
  // ...existing
} from './needs-attention'

describe('looksLikeCountryToken', () => {
  it('detects common country names and ISO codes', () => {
    expect(looksLikeCountryToken('USA')).toBe(true)
    expect(looksLikeCountryToken('usa')).toBe(true)
    expect(looksLikeCountryToken('United States')).toBe(true)
    expect(looksLikeCountryToken('US')).toBe(true)
    expect(looksLikeCountryToken('Vietnam')).toBe(true)
    expect(looksLikeCountryToken('VIETNAM')).toBe(true)
    expect(looksLikeCountryToken('CN')).toBe(true)
    expect(looksLikeCountryToken('CHN')).toBe(true)
  })

  it('rejects cities, LOCODEs, and unknown free text', () => {
    expect(looksLikeCountryToken('Ho Chi Minh City')).toBe(false)
    expect(looksLikeCountryToken('CNYTN')).toBe(false)
    expect(looksLikeCountryToken('Yantian')).toBe(false)
    expect(looksLikeCountryToken('')).toBe(false)
    expect(looksLikeCountryToken(null)).toBe(false)
  })
})

describe('countryOnlyPortMissText', () => {
  it('names field when known', () => {
    expect(countryOnlyPortMissText('USA', 'pod')).toBe(
      'Email only named country "USA" for POD — pick a real port',
    )
    expect(countryOnlyPortMissText('USA', 'pol')).toBe(
      'Email only named country "USA" for POL — pick a real port',
    )
  })

  it('uses POL/POD when field unknown', () => {
    expect(countryOnlyPortMissText('USA')).toBe(
      'Email only named country "USA" — pick a real port (POL/POD)',
    )
  })
})

describe('buildNeedsAttention country-only port miss', () => {
  it('rewrites Cannot match "USA" as a port to country copy', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "USA" as a port UN/LOCODE. Add or alias the port in ShipTrack port masters (UN/LOCODE), then rematch.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Email only named country "USA"/i.test(i.text))).toBe(true)
    expect(items.every((i) => !/UN\/LOCODE masters|add or alias/i.test(i.text))).toBe(true)
  })

  it('rewrites pod "USA" did not exact/curated-match with POD field', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [],
      reviewReasons: ['pod "USA" did not exact/curated-match a port master — left unlinked'],
    })
    const hit = items.find((i) => i.lineId === 'm-port:USA' || i.lineId.startsWith('m-port'))
    expect(hit?.text).toMatch(/Email only named country "USA" for POD/i)
    expect(hit?.text).not.toMatch(/not in master/i)
  })

  it('keeps LOCODE miss copy for real city names', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message: 'Cannot match "Ho Chi Minh City" as a port UN/LOCODE. Add alias, then rematch.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Ho Chi Minh/i.test(i.text))).toBe(true)
    expect(items.some((i) => /UN\/LOCODE|not in master|add or alias|left unlinked/i.test(i.text))).toBe(
      true,
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd frontend
npx vitest run src/components/review/needs-attention.test.ts
```

Expected: FAIL — `looksLikeCountryToken` / `countryOnlyPortMissText` not exported or not defined.

- [ ] **Step 3: Implement detector + copy helper**

In `needs-attention.ts`, near `looksLikeLocode` (after LOCODE_RE), add:

```typescript
/** ISO-3166 alpha-2 codes commonly seen as pol/pod blobs (not exhaustive of world). */
const ISO2_COUNTRY = new Set(
  [
    'US', 'CN', 'HK', 'VN', 'BD', 'KH', 'JP', 'KR', 'TW', 'IN', 'ID', 'TH', 'MY', 'SG', 'PH',
    'AU', 'CA', 'MX', 'GB', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'TR', 'AE', 'SA', 'PK',
  ].map((s) => s.toUpperCase()),
)

/** ISO-3166 alpha-3 commonly seen as email tokens. */
const ISO3_COUNTRY = new Set(
  ['USA', 'CHN', 'HKG', 'VNM', 'BGD', 'KHM', 'JPN', 'KOR', 'TWN', 'IND', 'IDN', 'THA', 'MYS', 'SGP', 'PHL', 'AUS', 'CAN', 'MEX', 'GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'NLD', 'BEL', 'TUR'].map(
    (s) => s.toUpperCase(),
  ),
)

/** Lowercase country names / aliases (match after normalize). */
const COUNTRY_NAMES = new Set(
  [
    'usa',
    'united states',
    'united states of america',
    'vietnam',
    'viet nam',
    'china',
    'uk',
    'united kingdom',
    'great britain',
    'hong kong',
    'bangladesh',
    'cambodia',
    'japan',
    'korea',
    'south korea',
    'taiwan',
    'india',
    'indonesia',
    'thailand',
    'malaysia',
    'singapore',
    'philippines',
    'australia',
    'canada',
    'mexico',
    'germany',
    'france',
    'italy',
    'spain',
    'netherlands',
    'belgium',
    'turkey',
  ].map((s) => s.toLowerCase()),
)

export function looksLikeCountryToken(value: string | null | undefined): boolean {
  if (value == null) return false
  const raw = String(value).trim()
  if (!raw) return false
  // Never treat a resolved LOCODE as a country.
  if (LOCODE_RE.test(raw)) return false
  const upper = raw.toUpperCase()
  if (upper.length === 2 && ISO2_COUNTRY.has(upper)) return true
  if (upper.length === 3 && ISO3_COUNTRY.has(upper)) return true
  const nameKey = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  return COUNTRY_NAMES.has(nameKey)
}

export function countryOnlyPortMissText(
  token: string,
  field?: 'pol' | 'pod' | null,
): string {
  const t = token.trim()
  if (field === 'pol') return `Email only named country "${t}" for POL — pick a real port`
  if (field === 'pod') return `Email only named country "${t}" for POD — pick a real port`
  return `Email only named country "${t}" — pick a real port (POL/POD)`
}
```

- [ ] **Step 4: Wire rewrite into port-miss branches of `lineFromReason`**

Apply country rewrite in **each** place that returns `m-port` / `m-port:…` with LOCODE/master wording. Pattern: if `looksLikeCountryToken(name)` use `countryOnlyPortMissText(name, field)`.

**A. `pol|pod "…" did not exact/curated-match a port master`** (existing match around lines 430–437):

```typescript
const port = raw.match(/^(\w+)\s+"([^"]+)"\s+did not exact(?:\/curated)?-match a port master/i)
if (port) {
  const fieldRaw = port[1]!.toLowerCase()
  const field = fieldRaw === 'pol' || fieldRaw === 'pod' ? (fieldRaw as 'pol' | 'pod') : null
  const name = port[2]!
  if (looksLikeCountryToken(name)) {
    return {
      lineId: `m-port:${name}`,
      text: countryOnlyPortMissText(name, field),
      category: 'master_miss',
    }
  }
  return {
    lineId: `m-port:${name}`,
    text: `${partyFieldLabel(port[1]!)} "${name}" not in master — left unlinked`,
    category: 'master_miss',
  }
}
```

**B. Port city prose / extractPortName block** (~546–555): if `looksLikeCountryToken(name)` → country text (field null).

**C. Generic UN/LOCODE miss** (~559–567): no token → leave generic LOCODE line (cannot claim country without a value).

**D. `Cannot match … as a port`** (~570–583):

```typescript
if (/Cannot match .+ as a port/i.test(raw)) {
  const quoted = extractQuotedParty(raw)
  if (quoted && looksLikeCountryToken(quoted)) {
    return {
      lineId: `m-port:${quoted}`,
      text: countryOnlyPortMissText(quoted, null),
      category: 'master_miss',
    }
  }
  // existing LOCODE miss returns...
}
```

**E. Generic `did not exact/curated-match a port master` without field** (~450–456): no quoted country → leave as-is.

Also handle `partyFieldLabel` path if any other port-only branch exists — grep `m-port` in the file after edits.

PARTY_OPS already calls `lineFromReason(message, message)` so flag path is covered once D/A are done.

- [ ] **Step 5: Run unit tests**

```bash
cd frontend
npx vitest run src/components/review/needs-attention.test.ts
```

Expected: all PASS (including existing portsLinked / brand / group tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/review/needs-attention.ts frontend/src/components/review/needs-attention.test.ts
git commit -m "fix(review): honest Needs attention copy when port is country-only"
```

---

### Task 2: Spec/plan already on branch (docs commit if not yet)

**Files:**
- `docs/superpowers/specs/2026-07-19-port-country-token-needs-attention-design.md`
- `docs/superpowers/plans/2026-07-19-port-country-token-needs-attention.md`

- [ ] **Step 1: Ensure design + plan are committed**

```bash
git add docs/superpowers/specs/2026-07-19-port-country-token-needs-attention-design.md \
        docs/superpowers/plans/2026-07-19-port-country-token-needs-attention.md
git commit -m "docs: port country-token Needs attention design and plan"
```

(Skip if already committed with the feature branch setup.)

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Honest country copy, still show line | Task 1 steps 3–4 |
| Keep LOCODE copy for real cities | Task 1 test “keeps LOCODE miss” |
| Frontend only | Global constraints + file map |
| portsLinked unchanged | No code change; regression via existing tests |
| Field-aware POL/POD when known | `countryOnlyPortMissText` + branch A |
| Curated list + ISO2/3; uncertain → LOCODE | `looksLikeCountryToken` |
| No severity demote / no backend | Global constraints |

No placeholders. Types consistent: `looksLikeCountryToken`, `countryOnlyPortMissText`.
