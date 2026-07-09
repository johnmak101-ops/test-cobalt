import { sql, type Kysely } from 'kysely'

/**
 * Phase 0 spike schema: 3 representative tables exercising the Postgres→T-SQL type map, in the default
 * `dbo` schema (the cobalt_test SQL Server DB is isolated). Kysely migrations are TS modules (the
 * `FileMigrationProvider` does NOT read `.sql` files) — the DDL lives in a `sql` template, split on
 * `-- statement-breakpoint` lines (NOT `GO` — tedious doesn't understand `GO`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
-- customers: uuid PK + the Phase-0 enrichment columns (country/contact_email/address)
CREATE TABLE customers (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  code nvarchar(50) NOT NULL,
  name nvarchar(500) NOT NULL,
  country nvarchar(100),
  contact_email nvarchar(500),
  address nvarchar(1000),
  erp_synced_at datetimeoffset(7),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_customers PRIMARY KEY (id),
  CONSTRAINT uq_customers_code UNIQUE (code)
);
-- statement-breakpoint
-- bookings: uuid PK + FK to customers + a json (NVARCHAR(MAX)) column + enum-as-CHECK
CREATE TABLE bookings (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  job_no nvarchar(100) NOT NULL,
  customer_id uniqueidentifier,
  brand nvarchar(100),
  status nvarchar(20) NOT NULL DEFAULT 'ACTIVE',
  notes nvarchar(max),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_bookings PRIMARY KEY (id),
  CONSTRAINT uq_bookings_job_no UNIQUE (job_no),
  CONSTRAINT ck_bookings_status CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);
-- statement-breakpoint
CREATE INDEX ix_bookings_customer_id ON bookings(customer_id);
-- statement-breakpoint
-- shipments: uuid PK + FK to bookings + jsonb→NVARCHAR(MAX) match_keys + enum-as-CHECK + state
CREATE TABLE shipments (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  booking_id uniqueidentifier NOT NULL,
  leg_no int NOT NULL DEFAULT 1,
  state nvarchar(20) NOT NULL DEFAULT 'BOOKED',
  review_status nvarchar(20) NOT NULL DEFAULT 'confirmed',
  confidence int,
  match_keys nvarchar(max),
  etd datetimeoffset(7),
  eta datetimeoffset(7),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_shipments PRIMARY KEY (id),
  CONSTRAINT uq_shipments_booking_leg UNIQUE (booking_id, leg_no),
  CONSTRAINT ck_shipments_state CHECK (state IN ('BOOKED','IN_TRANSIT','DELIVERED','CANCELLED')),
  CONSTRAINT ck_shipments_review CHECK (review_status IN ('confirmed','provisional','rejected')),
  CONSTRAINT fk_shipments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE INDEX ix_shipments_booking_id ON shipments(booking_id);`.execute(db)
}
