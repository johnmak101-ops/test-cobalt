import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database('./db.sqlite')
export const db = drizzle(sqlite, { schema })

// Initialize all database tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    avatar_initials TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS forwarders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id TEXT PRIMARY KEY,
    po_numbers TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    forwarder_id TEXT REFERENCES forwarders(id),
    route TEXT,
    status TEXT NOT NULL DEFAULT 'BOOKED',
    risk_level TEXT NOT NULL DEFAULT 'ON_TRACK',
    crd INTEGER,
    cfs_cutoff INTEGER,
    etd INTEGER,
    eta INTEGER,
    actual_departure INTEGER,
    actual_arrival INTEGER,
    hbl_number TEXT,
    vessel_name TEXT,
    voyage_number TEXT,
    warehouse_address TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shipping_emails (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    subject TEXT NOT NULL,
    sender TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    body_text TEXT,
    body_html TEXT,
    email_type TEXT DEFAULT 'OTHER',
    extracted_data TEXT,
    extraction_confidence REAL,
    shipment_id TEXT REFERENCES shipments(id),
    is_matched INTEGER NOT NULL DEFAULT 0,
    processing_status TEXT NOT NULL DEFAULT 'PENDING',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shipment_milestones (
    id TEXT PRIMARY KEY,
    shipment_id TEXT NOT NULL REFERENCES shipments(id),
    milestone_type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    email_id TEXT REFERENCES shipping_emails(id),
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    shipment_id TEXT NOT NULL REFERENCES shipments(id),
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    triggered_at INTEGER NOT NULL DEFAULT (unixepoch()),
    dismissed_at INTEGER,
    snoozed_until INTEGER
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_reference TEXT NOT NULL,
    threshold_days INTEGER NOT NULL,
    severity TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    po_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id),
    vendor_id TEXT REFERENCES vendors(id),
    total_quantity REAL,
    quantity_unit TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shipment_pos (
    id TEXT PRIMARY KEY,
    shipment_id TEXT NOT NULL REFERENCES shipments(id),
    po_id TEXT NOT NULL REFERENCES purchase_orders(id),
    quantity REAL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shipment_history (
    id TEXT PRIMARY KEY,
    shipment_id TEXT NOT NULL REFERENCES shipments(id),
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT,
    changed_by TEXT,
    is_delay INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    changed_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'factory',
    location TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS email_integrations (
    id TEXT PRIMARY KEY DEFAULT 'default',
    tenant_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    mailbox_email TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER,
    last_sync_status TEXT,
    last_sync_error TEXT,
    last_sync_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`)

// Add columns to existing tables if they don't exist (safe for re-runs)
const addColumnIfMissing = (table: string, column: string, type: string) => {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch {
    // Column already exists — ignore
  }
}

// Shipments: partial shipment tracking
addColumnIfMissing('shipments', 'quantity_shipped', 'REAL')
addColumnIfMissing('shipments', 'quantity_unit', 'TEXT')

// Shipping emails: review workflow
addColumnIfMissing('shipping_emails', 'review_status', 'TEXT')
addColumnIfMissing('shipping_emails', 'reviewed_by', 'TEXT')
addColumnIfMissing('shipping_emails', 'reviewed_at', 'INTEGER')
addColumnIfMissing('shipping_emails', 'review_notes', 'TEXT')

console.log('Database initialized with all tables')
