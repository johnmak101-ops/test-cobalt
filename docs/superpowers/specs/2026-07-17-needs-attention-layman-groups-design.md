# Needs attention — Layman groups (ELI5 + short precise)

**Date:** 2026-07-17  
**Status:** Draft for product review (copy sheet locked after ops edit)  
**Repo:** cobalt-shiptrack (`ReviewCard` Needs attention only)  
**Related:** #167 (taxonomy), #186 (Needs attention block — shipped), #133 (filter chips — unchanged)

## Goal

Operators see **every** relevant warning, **grouped** like the conflict table, with:

1. **ELI5 group title** — what *kind* of problem  
2. **Short & precise line** — what *this* email did  

Not a second field-compare UI. Not engineering codes.

## Product rules

| Rule | Detail |
|------|--------|
| **Surface** | Needs attention on Review Card only |
| **Show all** | **No global cap of 2.** Show every remaining item after suppress rules (grouped). |
| **Group like table** | Section header → bullets under it (same rhythm as Cargo & Logistics / Key Dates) |
| **Hide Fields disagree** | When conflict table is present, omit that entire group (table owns compare) |
| **Dedupe** | Exact human text once; drop reason if a flag already covers that category |
| **Edit mode** | Existing left-border highlight on the whole block; still **show all** groups/lines |
| **Raw audit** | Keep raw string in tooltip / title attribute for engineers |
| **Chips** | Queue filter chips stay #133 labels for this slice |

## Six groups (headers users see)

| Group title (UI) | ELI5 meaning | Maps from |
|------------------|--------------|-----------|
| **Which shipment?** | Unclear which job this email belongs to | `multi_id` |
| **Real shipment?** | May not be trackable freight | `no_identity` + `portal` |
| **Fields disagree** | Two sources differ on the same field | `conflict` *(hide if table shown)* |
| **Master miss** | Party or port not linked to master | `master_miss` |
| **Incomplete data** | Parse/file incomplete; values may be wrong | `extraction` |
| **Other** | Useful note, not the above | `other` + unmapped `MERGE_ADJUSTMENT` |

Order on card: Which shipment? → Real shipment? → Fields disagree → Master miss → Incomplete data → Other.  
Omit empty groups.

## Card shape

```
Needs attention
  Which shipment?
    · Matched more than one job — confirm which
    · Linked by PO only — may be the wrong leg
  Master miss
    · Forwarder "VENA SAIL" not in master
  Incomplete data
    · Attachment mentioned but not received
```

Edit mode: same content + subtle left border (already shipped).

---

## Copy sheet — combined (similar → one line)

**Rule:** Many flags/reasons are the same idea. Map them to **one** short line. On a card, if several sources map to the same line, show **once**.

Format: **User sees** = only text ops read. **Sources** = engineering keys collapsed into that line.

### Which shipment? (6 lines max)

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **This email matches more than one existing shipment — confirm which one** | `AMBIGUOUS_MATCH` · multi-leg reason · `MULTI_LEG_SUSPECT` |
| 2 | **One email has more than one booking/SO/B/L number — may be several shipments** | `INTRA_EMAIL_MULTI_STRONG_ID` · co-current multi booking/SO reason |
| 3 | **PO already on another job — confirm move or split** | `PO_REASSIGN` · PO-on-other-shipment reason · reassigned/other-shipment reason |
| 4 | **Linked by PO only — may be the wrong leg** | `PO_ONLY_WEAK_MATCH` |
| 5 | **One booking appears to cover more than one destination — confirm before cargo is final** | `MULTI_DESTINATION_SUSPECT` |
| 6 | **Same PO(s) but booking/SO changed — confirm this is still one shipment** | identity supersede · `THREAD_SUPERSEDE` |

### Real shipment? (3 lines max)

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **Portal notice — may not be real freight** | `PORTAL_ECHO` · portal/platform-only reasons |
| 2 | **No booking/SO/HBL or PO — cannot place this email** | `WEAK_IDENTITY` · neither booking/SO/HBL nor PO · no booking/B/L/container · no PO · insufficient identity |
| 3 | **Thin mail, not a lifecycle booking — verify it belongs in tracking** | bare_orphan (no lifecycle type) · similar “verify real shipment” reasons |

### Fields disagree (5 lines max) — *hide whole group if conflict table shown*

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **Email and system differ on {fields} — choose which values to keep** | `BACKEND_CONFLICT` · backend conflict reason · “disagrees with shipment” reason |
| 2 | **{N} field(s) disagree — see conflict table** | `INTRA_EMAIL_FIELD_CONFLICT` · `INTRA_EMAIL_CARGO_CONFLICT` · N field conflict(s) reasons |
| 3 | **Would change locked field(s): {fields}** | `FIELD_LOCK_CLASH` |
| 4a | **Transport mode changed ({from} → {to}) — confirm which is correct** | mode change X→Y · sea/air switch |
| 4b | **PO {n}: brand differs ({A} vs {B}, kept {X}) — please verify** | brand conflict reasons |

### Master miss (4 lines max)

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **{Party/port} "{value}" not in master — left unlinked** | exact-match party/port failures · `PARTY_UNRESOLVED` · `PARTY_OPS` · generic “did not match master” |
| 2 | **Customer not in master — confirm who owns this shipment** | unknown / unresolved customer · PO but customer unknown |
| 3 | **Add or alias in Mesh/port masters, then rematch** | Mesh cannot match · port UN/LOCODE cannot match |
| 4 | **Master system unavailable or empty — rematch after sync** | API unreachable · masters catalog empty |

### Incomplete data (5 lines max)

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **Parse incomplete — key fields may be missing** | `EXTRACTION_INCOMPLETE` · vision_pending · output/input truncated · content_filter |
| 2 | **Attachment missing — cargo details may be incomplete** | `MISSING_ATTACHMENT` · all “attachment not ingested / not on thread” reasons |
| 3 | **Qty / weight / volume missing or look wrong — please verify** | missing cargo detail · `CARGO_SANITY` · `SCAN_OCR_RISK` (was “verify by hand”) |
| 4 | **Detail may be in an unlabeled screenshot — please verify** | ack-only + screenshot · unlabeled screenshot |

**Do not show to user (suppress from Needs attention):**

| Internal signal | Why hide |
|-----------------|----------|
| Broadcast / shared order total across POs (`total_quantity looks like a broadcast total`, etc.) | Ops only see the **shipment-level total** on shipment detail — they do not work “per-PO qty vs shared total” as a review warning. That distinction is engineering merge logic, not a human review action on the card. |

### Other (keep distinct; less combining)

| # | User sees | Combined sources |
|---|-----------|------------------|
| 1 | **Booking cancelled** | cancel reasons |
| 2 | **ETD {date} is {n} days before this email** | ETD-before-email reasons |
| 3 | **Air mode but seaport code — check airport vs seaport** | air+seaport / UNLOCODE seaport reasons |
| 4 | **Deadline / cutoff: {label} {date}** | SI, VGM, MDGF, pickup, voucher, CY/warehouse cutoff notes |
| 5 | **New booking should be a new email thread — verify booking** | “new email” / new booking thread reasons |
| 6 | **Merge note: {text}** | `MERGE_ADJUSTMENT` (variable text — do not force one phrase) |
| 7 | **{cleaned raw}** | unmatched only |

**Canonical count for UI design:** ~**28 unique lines** (not 50+ raw variants). A given card still **shows all that apply**, each at most once.

**Copy notes (2026-07-17):**
- W1: no “multi-leg / 拼柜” parenthetical — plain confirm-which-shipment.
- W5 / W6: rephrased for ops clarity.
- F1: “choose which values to keep” not “decide which wins”.
- F4 split: mode (4a) vs brand (4b).
- No “strong ID”; “please verify” not “verify by hand”; broadcast total never shown.

---

## Suppress matrix (what users do **not** see)

| Condition | Hidden |
|-----------|--------|
| Conflict table has rows | Whole **Fields disagree** group |
| Same **combined line** twice | Second source dropped (collapse) |
| Flag already covers category | Extra reasons in that category (if they map to same or weaker line) |
| Broadcast / shared order-total reasons | **Never show** — qty is shipment total on detail only (committer already mostly does not flag; FE must still suppress if a legacy reason slips through) |
| Collapsed card | Entire Needs attention block (unchanged) |

## Technical approach (implementation later)

1. Extend `buildNeedsAttention` → `buildNeedsAttentionGroups()` returning  
   `{ groupId, title, items: { key, text, raw?, severity }[] }[]`  
2. Map `ReasonCategory` (+ portal → Real shipment?) to the six titles above.  
3. Apply **copy sheet** as the preferred message layer (flag messages may be shortened to match; reasons via humanize updates or a thin rewrite map).  
4. **Remove `NEEDS_ATTENTION_MAX = 2`** (or set unlimited).  
5. ReviewCard: render group headers + all bullets.  
6. Tests: every fixture string → group + expected short text; table-present hides Fields disagree; show-all when 3+ groups.

## Out of scope

- Queue chip rename  
- Matcher / auto-apply changes  
- Full #167 “what to do” CTA cards  
- Backend class API  
- 繁中 titles (optional follow-up; EN copy sheet first)

## Success

- Multi-flag legs show **all** groups present, not only two bullets.  
- Ops can answer “what kind of problem?” from the **header** alone.  
- Conflict table not restated when visible.  
- Copy stays short enough to scan in under 10 seconds.

## Open for product edit

Mark edits on this file:

- [ ] Any group title wording change  
- [ ] Any bullet rephrase  
- [ ] Portal under **Real shipment?** (default: yes)  
- [ ] PO-only stays under **Which shipment?** (default: yes; no separate “Weak link” group in v1)  

After product signs the copy sheet → implementation plan → code.
