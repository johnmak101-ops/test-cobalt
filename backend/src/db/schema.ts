import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ============================================
// Customers
// ============================================
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Forwarders
// ============================================
export const forwarders = sqliteTable('forwarders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Shipments
// ============================================
export const shipments = sqliteTable('shipments', {
  id: text('id').primaryKey(),
  poNumbers: text('po_numbers').notNull(), // JSON array of strings
  customerId: text('customer_id').references(() => customers.id),
  vendorId: text('vendor_id').references(() => vendors.id),
  forwarderId: text('forwarder_id').references(() => forwarders.id),
  route: text('route'), // "SZ→UK" format

  // State
  status: text('status', {
    enum: ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'],
  })
    .notNull()
    .default('BOOKED'),
  riskLevel: text('risk_level', {
    enum: ['ON_TRACK', 'AT_RISK', 'DELAYED'],
  })
    .notNull()
    .default('ON_TRACK'),

  // Order details
  bookingNo: text('booking_no'),
  soNumber: text('so_number'),
  itemStyleNo: text('item_style_no'),
  consigneeName: text('consignee_name'),
  consigneeAddress: text('consignee_address'),
  containerNo: text('container_no'),
  mblNumber: text('mbl_number'),

  // Dates (stored as unix timestamps)
  crd: integer('crd', { mode: 'timestamp' }),
  cfsCutoff: integer('cfs_cutoff', { mode: 'timestamp' }),
  etd: integer('etd', { mode: 'timestamp' }),
  eta: integer('eta', { mode: 'timestamp' }),
  actualDeparture: integer('actual_departure', { mode: 'timestamp' }),
  actualArrival: integer('actual_arrival', { mode: 'timestamp' }),
  warehouseStartDate: integer('warehouse_start_date', { mode: 'timestamp' }),
  warehouseEndDate: integer('warehouse_end_date', { mode: 'timestamp' }),
  inDcDate: integer('in_dc_date', { mode: 'timestamp' }),

  // Extracted data
  hblNumber: text('hbl_number'),
  vesselName: text('vessel_name'),
  voyageNumber: text('voyage_number'),
  warehouseAddress: text('warehouse_address'),

  // Partial shipment tracking
  quantityShipped: real('quantity_shipped'),
  quantityUnit: text('quantity_unit', {
    enum: ['cartons', 'pieces', 'cbm'],
  }),

  // Metadata
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Shipping Emails
// ============================================
export const shippingEmails = sqliteTable('shipping_emails', {
  id: text('id').primaryKey(),
  messageId: text('message_id'), // Email Message-ID header (dedup)
  subject: text('subject').notNull(),
  sender: text('sender').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),

  // AI processing
  emailType: text('email_type', {
    enum: [
      'BOOKING_REQUEST',
      'SHIPPING_ORDER',
      'DRAFT_BL',
      'FINAL_BL',
      'TELEX_RELEASE',
      'DELAY_NOTICE',
      'OTHER',
    ],
  }).default('OTHER'),
  extractedData: text('extracted_data'), // JSON blob
  extractionConfidence: real('extraction_confidence'),

  // Linking
  shipmentId: text('shipment_id').references(() => shipments.id),
  isMatched: integer('is_matched', { mode: 'boolean' }).notNull().default(false),

  // Pipeline state
  processingStatus: text('processing_status', {
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  })
    .notNull()
    .default('PENDING'),

  // Review workflow
  reviewStatus: text('review_status', {
    enum: [
      'AUTO_ACCEPTED',
      'FLAGGED',
      'NEEDS_REVIEW',
      'REVIEWED_OK',
      'REVIEWED_CORRECTED',
      'REJECTED',
    ],
  }),
  reviewedBy: text('reviewed_by'),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  reviewNotes: text('review_notes'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Shipment Milestones (event log for timeline)
// ============================================
export const shipmentMilestones = sqliteTable('shipment_milestones', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id')
    .notNull()
    .references(() => shipments.id),
  milestoneType: text('milestone_type', {
    enum: [
      'BOOKING_SENT',
      'SO_RECEIVED',
      'DRAFT_BL_RECEIVED',
      'FINAL_BL_RECEIVED',
      'TELEX_RELEASED',
      'DELIVERED',
    ],
  }).notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  emailId: text('email_id').references(() => shippingEmails.id),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Alerts
// ============================================
export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id')
    .notNull()
    .references(() => shipments.id),
  ruleId: text('rule_id').notNull(), // A1-A6
  severity: text('severity', {
    enum: ['CRITICAL', 'WARNING', 'INFO'],
  }).notNull(),
  message: text('message').notNull(),

  // State
  status: text('status', {
    enum: ['ACTIVE', 'DISMISSED', 'SNOOZED', 'RESOLVED'],
  })
    .notNull()
    .default('ACTIVE'),
  triggeredAt: integer('triggered_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  dismissedAt: integer('dismissed_at', { mode: 'timestamp' }),
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp' }),
})

// ============================================
// Users
// ============================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role', {
    enum: ['COORDINATOR', 'MANAGER', 'ADMIN'],
  }).notNull(),
  avatarInitials: text('avatar_initials').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Sessions
// ============================================
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Alert Rules (configurable thresholds)
// ============================================
export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(), // A1, A2, A3, etc.
  name: text('name').notNull(),
  description: text('description').notNull(),

  // Trigger configuration
  state: text('state', {
    enum: ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'],
  }).notNull(),
  triggerType: text('trigger_type', {
    enum: ['days_after', 'days_before'],
  }).notNull(),
  triggerReference: text('trigger_reference', {
    enum: ['booking', 'cutoff', 'draft_bl', 'final_bl', 'eta'],
  }).notNull(),
  thresholdDays: integer('threshold_days').notNull(),

  // Alert settings
  severity: text('severity', {
    enum: ['CRITICAL', 'WARNING', 'INFO'],
  }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),

  // Metadata
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Purchase Orders (PO-level tracking for partial shipments)
// ============================================
export const purchaseOrders = sqliteTable('purchase_orders', {
  id: text('id').primaryKey(),
  poNumber: text('po_number').notNull().unique(),
  customerId: text('customer_id').references(() => customers.id),
  vendorId: text('vendor_id').references(() => vendors.id),
  totalQuantity: real('total_quantity'),
  quantityUnit: text('quantity_unit', {
    enum: ['cartons', 'pieces', 'cbm'],
  }),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Shipment ↔ PO Junction (partial shipment linking)
// ============================================
export const shipmentPos = sqliteTable('shipment_pos', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id')
    .notNull()
    .references(() => shipments.id),
  poId: text('po_id')
    .notNull()
    .references(() => purchaseOrders.id),
  quantity: real('quantity'), // Quantity from this PO in this shipment
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Shipment History (audit trail for field changes)
// ============================================
export const shipmentHistory = sqliteTable('shipment_history', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id')
    .notNull()
    .references(() => shipments.id),

  // What changed
  field: text('field', {
    enum: [
      'etd', 'eta', 'vessel_name', 'status', 'cfs_cutoff',
      'hbl_number', 'voyage_number', 'quantity_shipped', 'risk_level',
      'booking_no', 'so_number', 'item_style_no', 'consignee_name',
      'consignee_address', 'mbl_number', 'container_no',
      'warehouse_start_date', 'warehouse_end_date', 'in_dc_date',
    ],
  }).notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),

  // Source tracking
  sourceType: text('source_type', {
    enum: ['email', 'manual', 'system'],
  }).notNull(),
  sourceId: text('source_id'), // email_id if from email processing
  changedBy: text('changed_by'), // user ID if manual

  // Delay detection
  isDelay: integer('is_delay', { mode: 'boolean' }).notNull().default(false),

  notes: text('notes'),
  changedAt: integer('changed_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Email Integrations (Microsoft Graph API)
// ============================================
export const emailIntegrations = sqliteTable('email_integrations', {
  id: text('id').primaryKey().default('default'), // single-row config
  // Microsoft Graph API / Azure AD credentials
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  clientSecret: text('client_secret').notNull(), // plain text (learning exercise)
  // Mailbox to monitor (auto-detected on test connection, or manually set)
  mailboxEmail: text('mailbox_email'),
  // Sync state
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status', {
    enum: ['SUCCESS', 'PARTIAL', 'FAILED'],
  }),
  lastSyncError: text('last_sync_error'),
  lastSyncCount: integer('last_sync_count').default(0),
  // Metadata
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============================================
// Vendors / Factories
// ============================================
export const vendors = sqliteTable('vendors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code'),
  type: text('type', {
    enum: ['factory', 'subcontractor', 'agent'],
  }).notNull().default('factory'),
  location: text('location'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})
