# Shipment Tracker Table — Narrow-Viewport Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shipment Tracker table usable in narrow windows by (1) pinning the Booking ID column during horizontal scroll and (2) hiding low-priority columns below Tailwind breakpoints so a ~640px window fits without scrolling.

**Architecture:** Single-component change to `ShipmentTable.tsx` plus one new design token in `index.css`. The existing horizontal-scroll pattern (`overflow-x-auto` wrapper) stays; we layer `position: sticky; left: 0` on the first column and Tailwind responsive `hidden md|lg:table-cell` classes on low-priority columns. Column widths move from `<colgroup>` onto the `<th>` cells first (a pure refactor) because per-breakpoint hiding needs widths and visibility to live on the same elements.

**Tech Stack:** React 19, Tailwind CSS v4 (CSS-first `@theme` in `frontend/src/index.css`), Vitest 2 + Testing Library (JSDOM), vite dev server already running on :5173 serving this repo (D:\) with HMR.

## Global Constraints

- **Do not change the desktop (≥1024px) rendering.** At `lg+` all 10 columns show with the same widths and colors as today. The mockup look is preserved (see memory: frontend is the restored Shipment Tracker mockup — never simplify it back).
- **Both themes must stay pixel-identical where unchanged.** Dark is default; light is `[data-theme="light"]` set on `document.documentElement` ([store.ts:34](../../frontend/src/store.ts)). The current thead background `bg-surface-900/50` composites over the `bg-surface-800` card — its opaque replacement must render the same color in BOTH themes, hence the `color-mix` token (Task 1), not a hard-coded hex.
- **Sticky page-header is explicitly OUT OF SCOPE:** `position: sticky; top: 0` cannot track *window* scroll from inside the `overflow-x-auto` wrapper (the wrapper is the nearest scroll container). Making it work would require an inner fixed-height vertical scroll region — a UX change nobody asked for. YAGNI.
- **Tooling gotchas (from project memory):** never `pnpm -C <pkg>`; run binaries from the package's own `node_modules\.bin` with cwd = `D:\cobalt_track_system\frontend`. Frontend has no lint script; gates are vitest + tsc.
- **Working tree has unrelated dirt** (README.md, docker files, backend/data etc.). Stage ONLY the files named in each commit step — never `git add -A`.
- Commit trailer required on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch: `fix/shipment-table-responsive` off `main`. PR at the end targets `main` on `johnmak101-ops/cobalt-shiptrack`.

## Column reference (order is stable; comment at [ShipmentTable.tsx:164](../../frontend/src/components/shipments/ShipmentTable.tsx))

| # | Column | Width today (colgroup) | Fate on narrow screens |
|---|--------|------------------------|------------------------|
| 1 | Booking ID | 12% | always visible + **sticky left** |
| 2 | Customer PO# | 9% | always visible |
| 3 | Customer | 12% | always visible |
| 4 | Forwarder | 11% | `hidden md:table-cell` (hidden < 768px) |
| 5 | Route | 12% | always visible |
| 6 | Status | 11% | always visible |
| 7 | ETD | 8% | `hidden lg:table-cell` (hidden < 1024px) |
| 8 | ETA | 8% | `hidden lg:table-cell` |
| 9 | Last Activity | 10% | `hidden lg:table-cell` |
| 10 | Risk | w-14 (3.5rem) | always visible |

Table min-width tiers: `min-w-[560px]` (base, 6 cols) · `md:min-w-[720px]` (7 cols) · `lg:min-w-[960px]` (all 10 — today's value).

---

### Task 1: Sticky Booking ID column (+ opaque header token)

**Files:**
- Modify: `frontend/src/index.css` (add one token inside the existing `@theme` block, after line 39 `--color-surface-600`)
- Modify: `frontend/src/components/shipments/ShipmentTable.tsx:167-211` (thead row, first th, tbody tr, first td)
- Test: `frontend/src/components/shipments/ShipmentTable.test.tsx` (new describe block)

**Interfaces:**
- Consumes: existing tokens `--color-surface-900/800/700`, `--color-border`; existing `renderTable()` helper in the test file.
- Produces: token `--color-surface-850` (utility `bg-surface-850`) — Task 4's visual check relies on it; class contract on first th/td: `sticky left-0` + opaque bg — Task 3's tests must not remove it.

- [ ] **Step 1: Create the branch**

```powershell
Set-Location D:\cobalt_track_system
git checkout -b fix/shipment-table-responsive main
```

- [ ] **Step 2: Write the failing test**

Append to `frontend/src/components/shipments/ShipmentTable.test.tsx` (JSDOM loads no stylesheets, so responsive/sticky behavior is asserted via class contract; real rendering is verified in the browser in Task 4):

```tsx
describe('ShipmentTable — narrow-viewport behavior', () => {
  it('pins the Booking ID column for horizontal scroll (sticky left, opaque bg)', () => {
    renderTable([baseShipment()])

    const th = screen.getByRole('columnheader', { name: /booking id/i })
    expect(th).toHaveClass('sticky', 'left-0', 'bg-surface-850')

    const td = screen.getByText('BY058417').closest('td')!
    expect(td).toHaveClass('sticky', 'left-0', 'bg-surface-800', 'group-hover:bg-surface-700')

    // hover bg on the pinned cell is driven by the row being a Tailwind group
    expect(td.closest('tr')!).toHaveClass('group')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```powershell
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run src/components/shipments/ShipmentTable.test.tsx
```

Expected: the new test FAILS (`expect(element).toHaveClass("sticky" ...)`); the 5 existing tests still pass.

- [ ] **Step 4: Add the `surface-850` token**

In `frontend/src/index.css`, insert after line 39 (`--color-surface-600: #222222;`), before `--color-border`:

```css
  /* Opaque equivalent of surface-900 at 50% over a surface-800 card (table headers). Sticky
     cells need an opaque bg; color-mix() of the two vars tracks BOTH themes automatically
     because [data-theme="light"] overrides the inputs on the same :root element. */
  --color-surface-850: color-mix(in srgb, var(--color-surface-900) 50%, var(--color-surface-800));
```

(No entry needed in the `[data-theme="light"]` block — the mix re-resolves from the overridden inputs. Dark computes #0E0E0E, light #F7F7F8 — exactly what `bg-surface-900/50` over `bg-surface-800` composites to today.)

- [ ] **Step 5: Make the table cells sticky**

In `frontend/src/components/shipments/ShipmentTable.tsx`, four class changes:

1. thead row (line 183) — translucent bg → the identical opaque token (required so scrolled content can't show through the sticky th; renders the same pixels):

```tsx
<tr className="border-b border-border bg-surface-850">
```

2. First th (line 184):

```tsx
<th className="sticky left-0 z-[1] bg-surface-850 px-3 py-3 text-left text-xs font-medium text-text-muted shadow-[inset_-1px_0_0_var(--color-border)]">Booking ID</th>
```

3. Body row (line 201) — add `group` so the pinned cell can mirror row hover:

```tsx
className="group cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
```

4. First td (line 203):

```tsx
<td className="sticky left-0 z-[1] truncate bg-surface-800 px-3 py-3 font-mono text-sm font-medium text-cobalt-primary-light shadow-[inset_-1px_0_0_var(--color-border)] transition-colors group-hover:bg-surface-700">
```

The `shadow-[inset_-1px_0_0_var(--color-border)]` is a 1px right-edge divider drawn as an inset shadow instead of `border-r` because Tailwind preflight collapses table borders, and collapsed borders historically do not travel with sticky cells in Chromium.

- [ ] **Step 6: Run the test to verify it passes**

```powershell
.\node_modules\.bin\vitest run src/components/shipments/ShipmentTable.test.tsx
```

Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add frontend/src/index.css frontend/src/components/shipments/ShipmentTable.tsx frontend/src/components/shipments/ShipmentTable.test.tsx
git commit -m "feat(ui): pin Booking ID column during horizontal scroll on Shipment Tracker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Move column widths from `<colgroup>` onto header cells (pure refactor)

Per-breakpoint column hiding (Task 3) needs `hidden` + width on the SAME element; `<col>` elements can't carry responsive display utilities reliably. With `table-fixed`, the header-row cell widths define the columns, so `<colgroup>` becomes redundant.

**Files:**
- Modify: `frontend/src/components/shipments/ShipmentTable.tsx:170-194`

**Interfaces:**
- Consumes: Task 1's first-th classes (keep them; only ADD `w-[12%]`).
- Produces: width classes on each `<th>` — Task 3 adds `hidden …` alongside them.

- [ ] **Step 1: Delete the `<colgroup>` block (lines 170-181) and add width classes to every th**

Resulting thead (Booking th keeps all Task 1 classes, plus width):

```tsx
<thead>
  <tr className="border-b border-border bg-surface-850">
    <th className="sticky left-0 z-[1] w-[12%] bg-surface-850 px-3 py-3 text-left text-xs font-medium text-text-muted shadow-[inset_-1px_0_0_var(--color-border)]">Booking ID</th>
    <th className="w-[9%] px-3 py-3 text-left text-xs font-medium text-text-muted">Customer PO#</th>
    <th className="w-[12%] px-3 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
    <th className="w-[11%] px-3 py-3 text-left text-xs font-medium text-text-muted">Forwarder</th>
    <th className="w-[12%] px-3 py-3 text-left text-xs font-medium text-text-muted">Route</th>
    <th className="w-[11%] px-3 py-3 text-left text-xs font-medium text-text-muted">Status</th>
    <th className="w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted">ETD</th>
    <th className="w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted">ETA</th>
    <th className="w-[10%] px-3 py-3 text-left text-xs font-medium text-text-muted">Last Activity</th>
    <th className="w-14 px-2 py-3 text-left text-xs font-medium text-text-muted">Risk</th>
  </tr>
</thead>
```

- [ ] **Step 2: Run the component suite — refactor must be behavior-neutral**

```powershell
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run src/components/shipments/ShipmentTable.test.tsx
```

Expected: all 6 tests PASS (no test references `<colgroup>`).

- [ ] **Step 3: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add frontend/src/components/shipments/ShipmentTable.tsx
git commit -m "refactor(ui): move ShipmentTable column widths from colgroup to header cells

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Column priority — hide Forwarder/ETD/ETA/Last Activity on narrow screens

**Files:**
- Modify: `frontend/src/components/shipments/ShipmentTable.tsx` (table min-w tiers; th 4/7/8/9; td 4/7/8/9)
- Test: `frontend/src/components/shipments/ShipmentTable.test.tsx`

**Interfaces:**
- Consumes: Task 2's th width classes (hidden classes are ADDED next to them).
- Produces: final class contract asserted by tests; Task 4 verifies real rendering.

- [ ] **Step 1: Write the failing tests**

Add `within` to the existing testing-library import (`import { render, screen, within } from '@testing-library/react'`), then append inside the `'ShipmentTable — narrow-viewport behavior'` describe block:

```tsx
  it('drops low-priority columns on narrow screens (column priority)', () => {
    renderTable([baseShipment()])

    for (const name of [/^etd$/i, /^eta$/i, /^last activity$/i]) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('hidden', 'lg:table-cell')
    }
    expect(screen.getByRole('columnheader', { name: /^forwarder$/i })).toHaveClass('hidden', 'md:table-cell')

    // identity columns never hide
    for (const name of [/booking id/i, /customer po#/i, /^customer$/i, /^route$/i, /^status$/i, /^risk$/i]) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden')
    }

    // body cells hide in lockstep with their headers (cols 4, 7, 8, 9 — 0-indexed 3, 6, 7, 8)
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells[3]).toHaveClass('hidden', 'md:table-cell')
    for (const i of [6, 7, 8]) expect(cells[i]).toHaveClass('hidden', 'lg:table-cell')
  })

  it('tiers the table min-width so narrow viewports fit the visible columns', () => {
    renderTable([baseShipment()])
    const table = screen.getByRole('table')
    expect(table).toHaveClass('min-w-[560px]', 'md:min-w-[720px]', 'lg:min-w-[960px]')
    expect(table).not.toHaveClass('min-w-[960px]')
  })
```

- [ ] **Step 2: Run tests to verify the two new ones fail**

```powershell
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run src/components/shipments/ShipmentTable.test.tsx
```

Expected: 2 FAIL (missing `hidden` classes / min-w tiers), 6 PASS.

- [ ] **Step 3: Implement**

In `frontend/src/components/shipments/ShipmentTable.tsx`:

1. Table element (line 169):

```tsx
<table className="w-full table-fixed min-w-[560px] md:min-w-[720px] lg:min-w-[960px]">
```

2. Forwarder th: `className="hidden w-[11%] px-3 py-3 text-left text-xs font-medium text-text-muted md:table-cell"`
3. ETD th: `className="hidden w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell"`
4. ETA th: `className="hidden w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell"`
5. Last Activity th: `className="hidden w-[10%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell"`
6. Forwarder td (renders `s.forwarder?.name ?? s.forwarderRaw ?? '—'`): `className="hidden truncate px-3 py-3 text-sm text-text-secondary md:table-cell"`
7. ETD td: `className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-secondary lg:table-cell"`
8. ETA td: `className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-secondary lg:table-cell"`
9. Last Activity td (`formatRelativeTime`): `className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-muted lg:table-cell"`
10. Update the column comment at line 164 to note the responsive tiers, e.g.:

```tsx
// Columns: Booking · Customer PO# · Customer · Forwarder · Route · Status · ETD · ETA · Last · Risk
// SO No removed from tracker (#119); detail pages still show SO.
// Narrow screens: Forwarder hides <md; ETD/ETA/Last hide <lg (all on the detail page); Booking is sticky-left.
```

Leave the empty-state `colSpan={10}` as-is — browsers clamp a colSpan wider than the rendered column count.

- [ ] **Step 4: Run tests to verify all pass**

```powershell
.\node_modules\.bin\vitest run src/components/shipments/ShipmentTable.test.tsx
```

Expected: all 8 PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add frontend/src/components/shipments/ShipmentTable.tsx frontend/src/components/shipments/ShipmentTable.test.tsx
git commit -m "feat(ui): hide low-priority Shipment Tracker columns on narrow viewports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Full gates + live browser verification + PR

**Files:** none created; fixes (if any) land in the Task 1-3 files.

- [ ] **Step 1: Full frontend suite + typecheck**

```powershell
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run
.\node_modules\.bin\tsc
```

Expected: full suite green (baseline was 62+ frontend tests; now +3), tsc exits 0.

- [ ] **Step 2: Live verification on :5173** (vite serves this repo with HMR — changes are already live; use the Browser pane, logged in as super@cobalt.hk / "password" if prompted)

Navigate to `http://localhost:5173/shipments`, then:

1. Resize to 640×900: expect 6 columns (Booking, PO#, Customer, Route, Status, Risk), little/no horizontal scrollbar. Screenshot.
2. Resize to 375×812 (mobile): horizontal scrollbar present; via javascript_tool set the scroller: `document.querySelector('.overflow-x-auto').scrollLeft = 300`. Screenshot: Booking ID column must stay pinned, fully opaque (no text bleeding under it), 1px divider on its right edge, row separator lines visible under the pinned cells.
3. Hover a row (computer hover): pinned cell's bg must match the row hover color seamlessly.
4. Resize to 800×900 (md tier): Forwarder appears (7 columns).
5. Resize to 1280×900 (desktop): all 10 columns; compare against pre-change look — no visible difference expected.
6. Toggle light theme (sun icon in topbar): header and pinned cells must blend correctly (no dark rectangle); toggle back.
7. Hover the PO chip on a narrow width: popover still portals above everything.

**Contingency (only if check 2 shows row separators missing under the pinned column while scrolled** — Chromium border-collapse + sticky quirk): move the separator onto the sticky td by extending its shadow to `shadow-[inset_-1px_0_0_var(--color-border),inset_0_-1px_0_var(--color-border)]` and add `group-last:shadow-[inset_-1px_0_0_var(--color-border)]` so the last row shows no bottom line (mirrors `last:border-0` on the tr). Re-run the component suite, amend nothing else, commit as `fix(ui): keep row separators under the pinned Booking column`.

- [ ] **Step 3: Push and open PR**

```powershell
Set-Location D:\cobalt_track_system
git push -u origin fix/shipment-table-responsive
gh pr create --base main --title "feat(ui): responsive Shipment Tracker table (sticky Booking column + column priority)" --body "## Summary
- Booking ID column is now pinned (sticky-left) during horizontal scroll, with an opaque themed background and hover parity
- Low-priority columns hide on narrow viewports: Forwarder <md; ETD / ETA / Last Activity <lg (all still on the shipment detail page)
- Table min-width now tiers 560 / 720 / 960px so a ~640px window fits without sideways scrolling
- Desktop (>=1024px) rendering unchanged; both themes verified
- New design token --color-surface-850 = opaque equivalent of the translucent table-header background

## Test plan
- [x] 3 new component tests (sticky class contract, column-priority classes, min-w tiers)
- [x] Full frontend vitest suite + tsc
- [x] Live check at 375 / 640 / 800 / 1280 px, both themes, hover + PO-chip popover

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes (done at plan time)

- **Spec coverage:** Option 1 (sticky identity column) → Task 1; option 2 (column priority) → Task 3; Task 2 is the enabling refactor; verification → Task 4. Sticky *page* header consciously excluded (Global Constraints) with the CSS reason.
- **Why not `border-r` / why `group`:** stated inline (border-collapse + sticky quirk; row-hover parity on the pinned cell).
- **Type consistency:** no new types/signatures; class strings in tests match the implementation strings verbatim.
- **JSDOM limits:** class-contract tests only — real stickiness/breakpoints are browser-verified in Task 4 (JSDOM applies no CSS, so `getByRole` keeps finding "hidden" headers; no existing test breaks).
