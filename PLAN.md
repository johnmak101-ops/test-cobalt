# Plan: Microsoft Graph API Email Integration — Remaining Work

## Status

**Backend: COMPLETE.** All backend files have been created/modified:
- `backend/src/db/schema.ts` — `emailIntegrations` table added
- `backend/src/db/local.ts` — `CREATE TABLE IF NOT EXISTS email_integrations` added
- `backend/src/services/graph-mail.ts` — OAuth2 client credentials + Graph API fetch/transform
- `backend/src/services/email-sync.ts` — Sync orchestrator (fetch → dedup → pipeline)
- `backend/src/routes/email-integrations.ts` — GET/PUT config, POST test, POST sync
- `backend/src/app.ts` — Router registered
- `backend/src/index.ts` — Background 5-min sync interval added

**Frontend: NOT STARTED.** Two files remain:
1. `frontend/src/hooks/use-email-integrations.ts` — React Query hooks
2. `frontend/src/pages/SettingsPage.tsx` — Email Integration tab + component

**Migrations & Type Check: NOT STARTED.**

---

## Step 1: Create `frontend/src/hooks/use-email-integrations.ts`

React Query hooks for the 4 API endpoints:

```ts
// GET /api/email-integrations
useEmailIntegration() → { config: EmailIntegrationConfig | null }

// PUT /api/email-integrations
useSaveEmailIntegration() → mutation

// POST /api/email-integrations/test
useTestEmailConnection() → mutation

// POST /api/email-integrations/sync
useSyncEmails() → mutation
```

Interface:
```ts
interface EmailIntegrationConfig {
  id: string
  tenantId: string
  clientId: string
  clientSecret: string    // masked on GET (••••••••xxxx)
  _secretMasked: boolean
  mailboxEmail: string | null
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
  lastSyncError: string | null
  lastSyncCount: number
  createdAt: string
  updatedAt: string
}
```

---

## Step 2: Add "Email Integration" tab to `SettingsPage.tsx`

### 2a. Update nav items

Add a new nav item:
```ts
{ to: '/settings/email', label: 'Email Integration', end: false }
```

### 2b. Add route detection

```ts
const isEmailSettings = location.pathname.includes('/settings/email')
```

### 2c. Create `EmailIntegrationSettings` component

Layout matches existing design patterns (Card components, similar input styling as AlertRulesSettings and VendorsSettings):

```
┌──────────────────────────────────────────────────────┐
│  Microsoft 365 Email Connection                       │
│  Connect to your shared mailbox to automatically     │
│  import shipping emails into Cobalt Track.           │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─ Connection Status ────────────────────────────┐  │
│  │ ● Connected     Last sync: 2 minutes ago      │  │
│  │   12 emails synced                              │  │
│  │ OR                                              │  │
│  │ ● Not connected  Click "Test Connection"       │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  Azure AD / Entra ID Credentials                    │
│  ┌────────────────────────────────────────────────┐  │
│  │ Tenant ID      [________________________]      │  │
│  │ Client ID      [________________________]      │  │
│  │ Client Secret  [••••••••xxxx] (masked)        │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Mailbox                                             │
│  ┌────────────────────────────────────────────────┐  │
│  │ Email Address  [________________________]      │  │
│  │                Auto-filled on test connection  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ Auto-sync     [////]  ON                       │  │
│  │               Polls every 5 minutes when on    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [ Test Connection ]  [ Sync Now ]  [ Save ]        │
│                                                      │
│  ┌─ ▶ Setup Guide ───────────────────────────────┐  │
│  │ 1. Go to Azure Portal > App Registrations      │  │
│  │ 2. Register a new application                  │  │
│  │ 3. Grant Mail.Read (Application) permission    │  │
│  │ 4. Create a client secret                       │  │
│  │ 5. Copy Tenant ID, Client ID, and Secret      │  │
│  │ 6. Enter above and click "Test Connection"     │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Features:
- **Status card**: Green/red dot indicator, last sync time (relative), email count, error message if FAILED
- **Credential fields**: Tenant ID, Client ID, Client Secret (masked on load, editable to change — if user types a new value it overwrites; if they leave the masked value, it keeps the existing)
- **Mailbox email**: Input field, auto-populated after "Test Connection" fills it on the backend
- **Auto-sync toggle**: `isActive` field, shows "Polls every 5 minutes when on"
- **Test Connection**: Calls `POST /api/email-integrations/test`, shows success/error, then refetches config (which may have updated `mailboxEmail`)
- **Sync Now**: Calls `POST /api/email-integrations/sync`, shows result count
- **Save**: `PUT /api/email-integrations`, then invalidates query
- **Setup Guide**: Collapsible accordion with step-by-step instructions

### 2d. Add the route in App.tsx

The Settings page uses nested routing via `location.pathname` checks instead of React Router routes, so we just need the nav + conditional rendering — no route change needed in `App.tsx`.

---

## Step 3: Run Drizzle migration

```bash
cd backend && npx drizzle-kit generate
```

This generates a migration SQL file for the `email_integrations` table.

---

## Step 4: TypeScript type check

```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

Fix any type errors that arise.

---

## Step 5: Verify end-to-end

1. Start backend: `cd backend && pnpm dev`
2. Start frontend: `cd frontend && pnpm dev`
3. Navigate to Settings → Email Integration tab
4. Fill in credentials, click "Test Connection"
5. Click "Save", then "Sync Now"
6. Check that emails appear in the Inbox page

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/hooks/use-email-integrations.ts` | React Query hooks for email integration API |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/pages/SettingsPage.tsx` | Add Email Integration tab nav item + `EmailIntegrationSettings` component |

## Files Already Created/Modified (Done)

| File | Change |
|------|--------|
| `backend/src/db/schema.ts` | Added `emailIntegrations` table |
| `backend/src/db/local.ts` | Added `CREATE TABLE IF NOT EXISTS email_integrations` |
| `backend/src/services/graph-mail.ts` | New: Graph API client (token + fetch + transform) |
| `backend/src/services/email-sync.ts` | New: Sync orchestrator (fetch → dedup → pipeline) |
| `backend/src/routes/email-integrations.ts` | New: API routes for config, test, sync |
| `backend/src/app.ts` | Registered email-integrations router |
| `backend/src/index.ts` | Added background sync interval |