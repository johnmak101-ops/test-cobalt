# Real JWT login (cookie-only) + admin User CRUD + remove Outlook wiring page

- **Date:** 2026-07-07
- **Repo:** `cobalt_track_system` (customer-facing tracking app)
- **Branch:** `feat/jwt-login-hardening`
- **Status:** Design approved, pending spec review → implementation plan

---

## 🧒 一句話（ELI5）

現在的登入是「半真半假」：後端其實已經有 JWT + cookie，但同一組 token **又**被複製到瀏覽器的 `localStorage`（任何 XSS 都能偷），JWT 密鑰預設是公開字串 `dev-secret-change-me`，強制改密碼只擋在前端、後端沒攔，改密碼也沒有伺服器端驗證。這次把它做成**真的**：

1. **只用 httpOnly cookie**（同源部署，最安全、最少程式碼）；瀏覽器不再存 token。Bearer 只留給 VM2→VM1 的服務帳號。
2. 補齊登入強化：JWT 密鑰開機驗證、登入限流、CORS 白名單、伺服器端強制改密碼、統一 8 碼密碼政策、cookie/token 都 12 小時。
3. 在既有的 SUPERADMIN 使用者 API 上，補一個**只有超級管理員看得到的「使用者管理」畫面**（新增 / 改角色 / 停用 / 重設密碼）。新使用者拿臨時密碼、首次登入強制改。刪除採**軟停用**（保留稽核紀錄）。
4. 刪掉設定頁裡那個沒用的 **Outlook 365 連線設定頁**（憑證早就改用後端 env `GRAPH_*`）；**但看信的功能（Inbox、單封信視窗）完全保留**。
5. 鐵則：**前端永遠不碰資料庫、不帶任何密鑰**；只透過有驗證的 `/api` 端點取資料。加一條測試守住這條線。

---

## Context / current state

The system already has JWT auth — the work is to **harden it into a real, safe login**, fill the missing admin UI, and delete a dead config surface.

| Fact | Current value | Source |
|---|---|---|
| Deployment | **Same-origin**: NestJS serves SPA (`/`) + API (`/api`) from one HTTPS host `https://StatusTrackAgent.Cobaltknitwear.com` when `STATIC_ROOT` set | `app.module.ts:32`, user-confirmed |
| Token transport | httpOnly `session` cookie **AND** token returned in body → SPA copies to `localStorage['cobalt_token']` + sends `Authorization: Bearer` | `auth.controller.ts:31-37`, `use-auth.tsx:71-73`, `api.ts:15-23` |
| JWT secret | `process.env.JWT_SECRET ?? 'dev-secret-change-me'` (no boot validation) | `auth.module.ts:15`, `jwt.strategy.ts:17` |
| TTL | token `expiresIn:'8h'` vs cookie `maxAge:7d` (mismatch) | `auth.module.ts:16`, `auth.controller.ts:17` |
| `mustReset` | returned by strategy, enforced **only** in the React router | `jwt.strategy.ts:25`, `App.tsx:46` |
| change-password | inline body, **no DTO** → global `ValidationPipe` is a no-op | `auth.controller.ts:52-60` |
| Password policy | `@MinLength(4)` on user DTOs; 8 only in the UI | `users/dto.ts:17,31` |
| CORS | `origin:true, credentials:true` | `main.ts:21` |
| Guard chain | `JwtAuthGuard` → `RolesGuard` (both `APP_GUARD`) | `auth.module.ts:24-25` |
| Roles | `VIEWER<EDITOR<ADMIN<SUPERADMIN` (rank-based), UI relabels VIEWER→COORDINATOR, EDITOR→MANAGER | `roles.guard.ts:6`, `adapters/enums.ts:25` |
| Users API | `@Roles('SUPERADMIN')` `GET/POST/PATCH/DELETE /api/users`; `create` does **not** set `mustReset`; `DELETE` is a **hard** delete; `safe()` omits `mustReset` | `users.controller.ts`, `users.service.ts`, `users.repository.ts:34` |
| Users UI | **none exists** | (grep) |
| Outlook page | `/settings/email` tab in `SettingsPage.tsx`; Save already disabled; endpoints are stubs; real config is `GRAPH_*` env | `SettingsPage.tsx:476-821`, `ui.controllers.ts:118` |
| Frontend DB access | **none** — no DB driver dep, no connection strings, all traffic via `/api` | verified (greps) |

## Goals

1. **Cookie-only JWT** for the browser (model A); stop mirroring the token into JS-readable storage.
2. Land the full **Phase-1 auth hardening** bundle (secret validation, rate-limit, CORS allow-list, server-side `mustReset`, server-side change-password validation, unified 8-char policy, 12h aligned TTL, seed hardening, helmet).
3. **SUPERADMIN-only Users admin UI** on the existing API, with soft-deactivate and admin-set-temp-password → forced-reset.
4. **Delete the Outlook-365 wiring page** (config already in env), preserving all email *viewing*.
5. Enforce the **frontend-never-touches-DB / holds-no-secrets** invariant with a guardrail test.

## Non-goals (out of scope)

- **Refresh-token rotation (model C).** The `refresh_tokens` table is **kept and commented "reserved for future refresh rotation"** — no rotation logic now. A→C later is purely additive.
- **Email invite links / self-service profile editing** beyond the existing change-password.
- **CSRF tokens** — same-origin + `sameSite:'lax'` + CORS allow-list closes the vector for this first-party app.
- **CSRF/god-file/Phase-3 refactors**, and general non-auth test backfill.
- Touching **any email-viewing** code (Inbox, `EmailWindowPage`, `/emails/*`) or the dead `EmailViewerModal` (separate cleanup).
- Restoring the demo-disabled `@Roles('SUPERADMIN')` on alert-rule save — a real but **unrelated** audit item; noted, not in this scope.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| Token | Browser transport | **A — httpOnly cookie only**; Bearer accepted by API for service accounts only |
| Session | Lifetime | **12h fixed**, single constant drives token `expiresIn` **and** cookie `maxAge` |
| Users | Who administers | **SUPERADMIN only** (existing controller guard) |
| Users | Delete semantics | **Soft-deactivate** (`active=false`); never hard-delete |
| Users | New-user credential | **Admin sets temp password → `mustReset=true`** (forced first-login change) |
| Rule D | Admin-set password | **Any admin-set password ⇒ `mustReset=true`**; a user's own change-password ⇒ `mustReset=false` (no separate reset endpoint) |
| Flag A | `helmet` | **Yes** (security headers) |
| Flag B | `refresh_tokens` table | **Keep**, documented as reserved (no destructive migration) |
| Flag C | Users route | **`/settings/users`** (under Settings sub-nav) |

## Hard constraint (customer requirement)

> **The frontend never accesses the database and holds no secrets.** All data access is through authenticated `/api` endpoints. The DB driver (`pg`) and `DATABASE_URL` stay in the backend workspace only. The browser bundle receives no `VITE_`-prefixed secret — only non-sensitive config (API base/port). Guarded API endpoints (e.g. `/api/users`) are **not** DB exposure: the browser sends HTTP, the backend is the sole SQL client.

Verified already true today; deleting the Outlook page removes the **only** spot the frontend handled a secret (`clientSecret`). Enforced going forward by a guardrail test (§ Testing).

---

## Design

### D1 · Session/token model (cookie-only, 12h)

- New `backend/src/auth/auth.constants.ts`: `SESSION_TTL_SECONDS = 12 * 60 * 60` (optionally `Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600`). Used by both `JwtModule.signOptions.expiresIn` and the cookie `maxAge`.
- `login` sets the httpOnly `session` cookie (`httpOnly`, `secure: NODE_ENV==='production'`, `sameSite:'lax'`, `maxAge = SESSION_TTL`) and returns **`{ user }` only** (no `token` in body).
- `JwtStrategy` unchanged in shape: cookie-first, Bearer fallback (service accounts keep working).

### D2 · Backend auth hardening

1. **JWT secret validation (boot).** Add `backend/src/config/env.validation.ts` (zod): require `JWT_SECRET` (min 32 chars), fail fast otherwise; wire via `ConfigModule.forRoot({ validate })`. Remove the `?? 'dev-secret-change-me'` fallback in `auth.module.ts` and `jwt.strategy.ts`. **Gotcha:** `JwtModule.register({ secret: process.env.JWT_SECRET })` is evaluated at module-load time, *before* `ConfigModule` validation runs — so resolve the secret at DI time via **`JwtModule.registerAsync` + `ConfigService`** (or an explicit `validateEnv()` assert at the very top of `main.ts` before `AppModule` is imported). The plan picks one; `registerAsync` is preferred.
2. **`MustResetGuard`** (`backend/src/auth/must-reset.guard.ts`), registered as `APP_GUARD` **between** `JwtAuthGuard` and `RolesGuard`. Logic: skip `@Public` routes; if `req.user?.mustReset` and the handler is **not** marked `@AllowDuringMustReset()`, throw `403 { code:'MUST_RESET' }`. Decorator `@AllowDuringMustReset()` marks `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout`.
3. **`ChangePasswordDto`** (`{ currentPassword: @IsString @MinLength(1); newPassword: @MinLength(8) }`) wired into `auth.controller.ts` so the global `ValidationPipe` runs. Service adds **new ≠ current** check → `400` if equal.
4. **Unified password policy = 8.** Shared `PASSWORD_MIN_LENGTH = 8`; apply to `ChangePasswordDto`, `CreateUserDto`, `UpdateUserDto` (raise from 4).
5. **Rate-limit.** Add `@nestjs/throttler`; global modest default + strict override on `POST /auth/login` (≈10/min/IP) → `429`.
6. **CORS allow-list.** `main.ts` reads `CORS_ORIGINS` (comma-separated; default = prod URL + `http://localhost:5173,http://localhost:3000`), `credentials:true`; drop `origin:true`.
7. **`helmet`** applied globally in `main.ts`.
8. **Seed hardening.** `seed-auth-users.ts` requires `INITIAL_PASSWORD`/`AGENT_PASSWORD` via env outside dev (no shipped weak defaults); log a clear error if unset in prod.
9. **`refresh_tokens`**: keep the table; add a schema comment "reserved for future refresh-token rotation (see spec 2026-07-07)".

### D3 · Frontend auth changes

- **`lib/api.ts`**: remove the `localStorage` token read + `Authorization` header from `request()` **and** `downloadAttachment()`; rely on `credentials:'include'`. Wrap the response `JSON.parse` in try/catch → `throw new Error(\`API \${status}: <snippet>\`)`.
- **`hooks/use-auth.tsx`**: delete `TOKEN_KEY` and all `localStorage` usage; `login` = `POST /auth/login` → `GET /auth/me`; `logout` = `POST /auth/logout` → clear state. Types drop `token`.
- **`store.ts`**: wrap the theme `localStorage` get/set in try/catch (the missed Phase-0 hardening that white-screens private-mode browsers).
- **403 `MUST_RESET`** (defensive): on any API `403` whose body `code==='MUST_RESET'`, force-navigate to `/change-password` (the existing `authGate` already covers the normal path via `/auth/me`).

### D4 · Users admin — backend (targeted edits to existing module)

- **Soft-deactivate.** `UsersService.remove(id, actor)` → set `active:false` (not `repo.remove`). `UsersRepository`: replace the hard `delete` path with an `update({active:false})` (or add `deactivate`). Reactivate via existing `PATCH {active:true}`.
- **Guards:** cannot deactivate/demote the **last active SUPERADMIN** (add `UsersRepository.countActive(role)` check); cannot deactivate **self** (extend the existing self-guard from delete to deactivate).
- **`create` sets `mustReset:true`.**
- **Rule D:** in `update`, if `dto.password` is present, also set `patch.mustReset = true`.
- **`safe()`** gains `mustReset` (for the "Pending first login" badge). Still never returns `passwordHash`.
- DTO: `password @MinLength(8)`, `role @IsIn(ROLES)` (unchanged set).

### D5 · Users admin — frontend (new)

- **Route** `/settings/users`, wrapped in `SuperadminRoute` (existing), rendering new `pages/UsersPage.tsx`. Add a **"Users"** item to the Settings sub-nav array in `SettingsPage.tsx` (alongside alerts/vendors).
- **`pages/UsersPage.tsx`**: table — Name · Email · Role badge · Status (`active` + "must-reset" badge) · Created · Actions. Actions: **Edit**, **Deactivate/Reactivate**, **Reset password**. "Add user" button opens the create modal.
- **Modals** (follow existing modal patterns, e.g. `NewShipmentModal`): Create (email, name, role select, temp password), Edit (name, role, active), Reset-password (new temp password).
- **`hooks/use-users.ts`**: react-query `useUsers`, `useCreateUser`, `useUpdateUser`, `useDeactivateUser`/`useReactivateUser`, `useResetPassword`. Add matching methods to the `api` client (`/users` CRUD).
- Role `<select>` shows UI labels (COORDINATOR/MANAGER/ADMIN/SUPERADMIN) mapped to backend roles; SUPERADMIN option present (only a superadmin is here anyway).

### D6 · Remove Outlook-365 wiring page

**DELETE (only the `/email-integrations` config surface):**

| Layer | Target |
|---|---|
| Route | `App.tsx:134` `/settings/email` |
| Panel | `SettingsPage.tsx` — `EmailIntegrationSettings()` (476-821), `isEmailSettings` (827), sub-nav item (835), render branch (860), the `use-email-integrations` import (18), now-unused icons, `payload as any` (516) |
| Hook | delete `hooks/use-email-integrations.ts` (imported only by SettingsPage) |
| Backend | delete `@Controller('email-integrations')` in `ui.controllers.ts:118` + `emailIntegration*` methods in `presentation.service.ts:584-624` |
| Copy | reword the General-settings email placeholder text |

**KEEP — explicitly preserve all email viewing (do NOT touch):** `/inbox` (`InboxPage`), `/email/:id` (`EmailWindowPage`), and every `/emails/*` endpoint (`emails.controller.ts`, `review-queue.controller.ts`). `GRAPH_*` env config untouched. Dead `EmailViewerModal.tsx` left for separate cleanup.

Grep-gate: after edits, `grep -rn "EmailIntegration\|email-integrations\|use-email-integrations"` returns **zero** hits.

---

## Data flow

```
POST /api/auth/login {email,password}
   → validate (bcrypt) → Set-Cookie session=<jwt> (httpOnly, 12h) → 200 { user }
Any request → browser auto-sends cookie (credentials:include)
   → guard chain: JwtAuthGuard(cookie→user) → MustResetGuard → RolesGuard → handler
   (service accounts: Authorization: Bearer → same JwtStrategy header extractor)
mustReset=true → 403 {code:MUST_RESET} on everything except me/change-password/logout
POST /api/auth/change-password → verify current, new≠current, ≥8 → clear mustReset → 200
Admin: POST /api/users (mustReset=true) · PATCH /api/users/:id (password ⇒ mustReset=true;
   active toggle; role) · DELETE /api/users/:id → active=false (guards: last-super, self)
```

## Error handling / status codes

| Situation | Response |
|---|---|
| Missing/short `JWT_SECRET` at boot | process exits with a clear message (no silent dev-secret) |
| Bad credentials | `401` generic (no user enumeration) |
| Login flood | `429` |
| change-password invalid (min-8 / new==current) | `400` |
| Wrong current password | `401` |
| Non-superadmin hits `/users` | `403` (RolesGuard) |
| `mustReset` user hits gated route | `403 { code:'MUST_RESET' }` |
| Duplicate email on create | `409` |
| Deactivate last superadmin / self | `400` with explicit message |
| Frontend: `401` | clear state → `/login`; `403 MUST_RESET` → `/change-password`; other → toast |

## Testing

**Backend unit** (`*.spec.ts`): env validation throws on missing/short secret · `auth.service` login + change-password (new≠current, clears mustReset) · `MustResetGuard` allow-list vs block · throttler limit · `users.service` (create sets mustReset, soft-deactivate keeps row, last-superadmin guard, self-guard, admin-password⇒mustReset, dup-email 409) · DTO min-8 + role-in-set.

**Backend integration** (`backend/test/*.int.spec.ts`): login sets cookie and **no** token in body · protected route `401` without cookie · **Bearer still authenticates a service account** · mustReset user blocked then freed after change-password · superadmin-only `/users` · `DELETE` soft-deactivates (row persists, `active=false`).

**Frontend** (`*.test.tsx`): LoginPage submit · ChangePasswordPage (min-8 / new≠current) · UsersPage CRUD flows (create/edit/deactivate/reset) · auth store holds no `localStorage` token · `api.ts` JSON.parse guard. Net-new coverage on the previously-untested auth UI.

**Guardrail** (`frontend/src/test/no-db-access.test.ts`): scan `frontend/src` and fail on any DB driver import (`pg`/`drizzle`), `postgres://`, `DATABASE_URL`, or non-`VITE_` secret reference — enforces the hard constraint on every `vitest run`. (Wiring this into a real CI pipeline is the separate Phase-2 audit item; there is no CI today.)

**Regression:** update any test asserting token-in-body or `MinLength(4)`; keep the existing ~413 green.

## Files touched (estimate)

**Add (7):** `auth/auth.constants.ts`, `auth/must-reset.guard.ts` (+ `@AllowDuringMustReset` decorator in `auth/decorators.ts`), `config/env.validation.ts`, `auth/dto.ts` (`ChangePasswordDto`), `frontend/src/pages/UsersPage.tsx`, `frontend/src/hooks/use-users.ts`, `frontend/src/test/no-db-access.test.ts`.

**Modify (~17):** backend — `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `auth/decorators.ts` (`@AllowDuringMustReset`), `main.ts`, `app.module.ts`, `users/dto.ts`, `users.service.ts`, `users.repository.ts`, `db/seed-auth-users.ts`, `presentation/ui.controllers.ts`, `presentation/presentation.service.ts`, `package.json` (throttler, helmet). frontend — `lib/api.ts`, `hooks/use-auth.tsx`, `store.ts`, `App.tsx`, `pages/SettingsPage.tsx`, `components/layout/Sidebar.tsx` (optional Users link), `package.json` snapshot as needed.

**Delete (2):** `frontend/src/hooks/use-email-integrations.ts`, the `email-integrations` controller/methods.

## Rollout / ops notes

- New required env: **`JWT_SECRET`** (≥32 chars) — set in prod before deploy or the app **won't boot** (intended). Optional: `SESSION_TTL_HOURS` (default 12), `CORS_ORIGINS` (default prod+localhost), `INITIAL_PASSWORD`/`AGENT_PASSWORD` for seed.
- Existing sessions: users on old 8h tokens simply re-login; no data migration.
- No DB schema migration required (soft-delete uses existing `active`; `mustReset` column already exists; `refresh_tokens` kept).
- Document the new env vars in `.env.example`/README as part of the change.
