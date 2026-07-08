# Config-Page Access Control — design

- **Date:** 2026-07-08
- **Branch:** `feat/config-page-access-control`
- **Status:** Design (approved, pre-plan)
- **Sequencing:** Built BEFORE the Review Policy feature (spec at `2026-07-08-review-policy-design.md`, parked). Review Policy joins this system's page registry when built next.

## Problem

Who can view/edit each config page is **hard-coded** today: route guards in `frontend/src/App.tsx` (`SuperadminRoute`, `AdminRoute`), static `@Roles(...)` on the write endpoints, and hard-coded `canEdit` in each panel. Changing "who can touch Alert Rules" needs a code deploy, and the model is inconsistent (Alert Rules is reachable two ways — the superadmin-only Settings tab *and* the everyone-can-view standalone `/alerts/rules` page — with different gating).

We want the **superadmin to control, per config page, what each role can do** — **No access / View-only / Edit** — at runtime, no deploy.

## Goals

- Superadmin-managed **per-page × per-role** permission: `none | view | edit`.
- Runtime-configurable (`app_settings`), no deploy.
- **Backend-authoritative** enforcement of Edit (writes).
- **Extensible:** governing a new config page = one registry entry.
- **No lockout:** superadmin is always Edit and cannot be lowered.
- **Defaults preserve today's behaviour** on deploy.

## Non-goals (v1)

- **Per-user** overrides — role-based only.
- Governing non-config pages (Dashboard, Shipments, POs, …) — only the config/settings pages.
- The **Users** page — stays SUPERADMIN-only, out of the matrix (delegating identity/access management is the one thing we don't make configurable).
- The **Vendors** page — a read-only ERP mirror (Cobalt Mesh); nothing to Edit, so it stays out of the matrix and keeps its current read-only tab untouched.
- **Hard backend read-gating** of `none` — see "Enforcement boundary" below. v1 blocks writes at the API and hides pages in the UI; it does not block a direct API read of shared reference data.

## Design

### Roles & levels

- **Configurable roles (matrix columns):** `VIEWER`, `EDITOR`, `ADMIN` (UI labels: Coordinator, Manager, Admin).
- **`SUPERADMIN`** is always `edit`, locked — never stored, never settable.
- **Levels:** `type Level = 'none' | 'view' | 'edit'`, ordered `LEVEL_RANK = { none: 0, view: 1, edit: 2 }`.

### Page registry (`backend/src/access/pages.ts`)

One list; each entry declares its per-role defaults. Adding a governed page = append one entry.

```ts
export type Level = 'none' | 'view' | 'edit'
export const CONFIG_ROLES = ['VIEWER', 'EDITOR', 'ADMIN'] as const
export interface ConfigPage {
  id: string
  label: string
  defaults: Record<(typeof CONFIG_ROLES)[number], Level>
}
```

**v1 pages:**

| id | label | VIEWER | EDITOR | ADMIN |
|----|-------|--------|--------|-------|
| `alert_rules` | Alert Rules | view | view | edit |
| `resolution_rules` | Resolution Rules | none | none | edit |

*(Review Policy joins later as `review_policy`: VIEWER none / EDITOR edit / ADMIN edit.)*

Defaults ≈ current behaviour: Alert Rules is broadly viewable (the standalone page is today), Admin edits; Resolution Rules is Admin-only. **Note:** the Alert Rules *Settings tab* is superadmin-only today; unifying it under `alert_rules` means non-superadmins now see it (View). Acceptable — the superadmin can set it to `none`.

### Storage & resolution (`PageAccessService`)

- `app_settings` key **`page_access`** = a **sparse override map** `{ [pageId]: { [role]: Level } }`. Only cells the superadmin changed are stored; everything else falls back to the registry default.
- `levelFor(pageId, role): Promise<Level>`:
  - `role === 'SUPERADMIN'` → `'edit'`
  - else `override[pageId]?.[role] ?? registryDefault(pageId, role) ?? 'none'`
- `forUser(role): Promise<Record<string, Level>>` — the caller's effective level per page (drives the frontend).
- `matrix(): Promise<{ pages: { id, label, levels: Record<Role, Level> }[] }>` — full effective matrix (defaults merged with overrides) for the admin panel.
- `setMatrix(overrides, actorId)` — validate (`pageId ∈ registry`, `role ∈ CONFIG_ROLES`, `level ∈ {none,view,edit}`; SUPERADMIN entries rejected), store under `page_access`.

### Backend enforcement

- Decorators `@PageWrite(pageId)` and `@PageRead(pageId)` (SetMetadata).
- **`PageAccessGuard`** (global `APP_GUARD`, runs after `JwtAuthGuard`/`MustResetGuard`, coexists with `RolesGuard`):
  - No `@PageWrite`/`@PageRead` metadata on the handler → **pass** (non-page routes untouched).
  - `@PageWrite(id)` → require `levelFor(id, user.role) === 'edit'`, else 403.
  - `@PageRead(id)` → require `level ≥ 'view'`, else 403.
  - SUPERADMIN always passes (`levelFor` returns `edit`).
- **Retrofit (v1 — writes + the alert-rules read, which is NOT shared):**
  - `PUT /api/alert-rules` (`presentation/ui.controllers.ts`): drop `@Roles('ADMIN')`, add `@PageWrite('alert_rules')`.
  - `GET /api/alert-rules`: add `@PageRead('alert_rules')` — this endpoint serves only the rules-config views (Settings tab + standalone page); the dashboard reads a *different* endpoint (`GET /api/alerts`), so gating it is safe.
  - Resolution write endpoints (`POST`/`PATCH /api/masters/resolution*`): drop `@Roles('ADMIN')`, add `@PageWrite('resolution_rules')`.

### Enforcement boundary (explicit v1 scope)

`GET /api/masters/resolution` is **shared with cobalt-queue** (the parser reads the curated facts over HTTP). It is therefore **left ungated** in v1 — so `none` for `resolution_rules` hides the page in the UI and blocks writes, but does not hard-block a direct API read of the (non-secret) resolution facts. Hard read-gating of shared/agent-consumed endpoints is a v2 concern (needs endpoint splitting or a service-account carve-out). **Authoritative guarantee in v1: no role can *write* a config page above its configured level.**

### Access API (`PageAccessController`)

- `GET /api/page-access/me` → `{ pages: Record<pageId, Level> }` for the current user (any authenticated). Drives the frontend route/nav/editability.
- `GET /api/page-access` → the full matrix. **SUPERADMIN only** (`@Roles('SUPERADMIN')`).
- `PUT /api/page-access` body `{ overrides: { [pageId]: { [role]: Level } } }` → `setMatrix`. **SUPERADMIN only.** Validated DTO.

### Frontend

- **`use-page-access.ts`** — `usePageAccess()` fetches `GET /api/page-access/me`, exposes `levelFor(pageId)` and `canEdit(pageId)` (= `level === 'edit'`).
- **`PageAccessRoute`** — `<PageAccessRoute page="resolution_rules">…</PageAccessRoute>`: `none` → `<Navigate to="/" replace />`; `view`/`edit` → render (the panel handles editability). Replaces the hard-coded `SuperadminRoute`/`AdminRoute` on the config routes; the standalone `/alerts/rules` is wrapped with `page="alert_rules"`.
- **Settings nav** (`SettingsPage.tsx`): show a tab only when `levelFor(pageId) !== 'none'`.
- **Panels** (`AlertRulesSettings`, `ResolutionRulesSettings`, `AlertRulesPage`): replace the hard-coded `canEdit` with `canEdit('alert_rules')` / `canEdit('resolution_rules')` from `usePageAccess`.
- **`AccessControlSettings.tsx`** — the superadmin-only matrix editor: rows = pages, columns = Coordinator/Manager/Admin, each cell a None/View/Edit select; SUPERADMIN column shown locked at Edit. Loads `GET /api/page-access`, saves `PUT /api/page-access`. New superadmin-only nav tab "Access Control" + route.

### Superadmin safety

SUPERADMIN is never in the stored map and `levelFor` hard-returns `edit` for it → cannot be locked out. `setMatrix` rejects any SUPERADMIN entry. The Access Control UI renders the SUPERADMIN column as a disabled "Edit".

## Data flow

```
Admin opens a config page ─▶ PageAccessRoute ─usePageAccess()▶ GET /api/page-access/me
   none → redirect · view → read-only panel · edit → editable panel

Save on a config page ─PUT /api/…─▶ PageAccessGuard(@PageWrite(id)) ─levelFor(id, role)=edit?─▶ handler | 403

Superadmin ▸ Settings ▸ Access Control ─PUT /api/page-access { overrides }─▶ app_settings.page_access
```

## Testing

- **`PageAccessService`**: `levelFor` — registry defaults; override wins; SUPERADMIN always `edit`; unknown page/role → `none`. `setMatrix` — validation rejects bad page/role/level and SUPERADMIN entries; `matrix`/`forUser` shapes.
- **`PageAccessGuard`**: `@PageWrite` allows at `edit`, 403 below; `@PageRead` allows at `view`+, 403 at `none`; SUPERADMIN bypass; no-metadata passthrough.
- **`PageAccessController`**: `GET /me` any authenticated; `GET`/`PUT /page-access` 403 for non-superadmin; PUT validation.
- **Frontend**: `usePageAccess` maps levels; `PageAccessRoute` redirects on `none`, renders on `view`/`edit`; `AccessControlSettings` renders the matrix + saves; a panel's editability follows the level (view → inputs disabled, no Save).
- **Retrofit regression**: `PUT /alert-rules` and the resolution write endpoints reject a role below `edit` and accept `edit`/SUPERADMIN.

## Files

**Backend — new (`src/access/`):** `pages.ts` (registry + types), `page-access.service.ts`, `page-access.guard.ts`, `page-access.decorators.ts`, `page-access.controller.ts`, `access.module.ts` (+ `.spec.ts` for service/guard/controller).
**Backend — edit:** `app.module.ts` (import `AccessModule`, register the global `PageAccessGuard`), `presentation/ui.controllers.ts` (alert-rules `@Roles` → `@PageRead`/`@PageWrite`), the masters resolution controller (`@Roles('ADMIN')` → `@PageWrite('resolution_rules')`).
**Frontend — new:** `hooks/use-page-access.ts`, `components/PageAccessRoute.tsx`, `components/settings/AccessControlSettings.tsx` (+ tests).
**Frontend — edit:** `App.tsx` (config-route guards → `PageAccessRoute`; wrap `/alerts/rules`), `pages/SettingsPage.tsx` (nav gating + Access Control tab), `components/settings/AlertRulesSettings.tsx`, `components/settings/ResolutionRulesSettings.tsx`, `pages/AlertRulesPage.tsx` (`canEdit` ← `usePageAccess`).

## Out of scope / future

- Per-user overrides.
- Hard backend read-gating of `none` for shared/agent-consumed endpoints (`GET /masters/resolution`).
- Governing non-config pages.
- Review Policy registers itself here (`review_policy`) when built next.
