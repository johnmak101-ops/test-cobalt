# Fix: Preview Not Working — Empty Database

## Root Cause

The SQLite database (`backend/db.sqlite`) exists and has all tables created, but **every table is empty** — 0 rows. The login page fetches `/api/auth/users` which returns `{"users":[]}`, so no persona cards are displayed and the user cannot log in.

## Fix

Run the database seed script to populate all tables (users, customers, shipments, etc.):

```bash
pnpm --filter backend db:seed
```

Then **restart the dev server** so the backend picks up the seeded data.

## Verification

After seeding and restarting:
1. Open the preview at `http://localhost:5219`
2. The login page should show persona cards for 3 users (Sunny, Amon, Admin)
3. Click any user card to log in
4. Confirm the dashboard loads with sample data

## Why This Happened

The database file (`backend/db.sqlite`) was likely deleted or recreated during a previous version change, and the seed script was not re-run afterward. The schema tables are auto-created on startup by `local.ts` using `CREATE TABLE IF NOT EXISTS`, but the seed must be run manually.

## Optional Improvement

Consider adding an auto-seed check to `backend/src/index.ts` that runs the seed if the users table is empty, so this doesn't happen again.