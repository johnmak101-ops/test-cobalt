import { pgSchema, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'
import {
  ALERT_SEVERITY, ALERT_STATUS, ALERT_TRIGGER_TYPE, ALERT_TRIGGER_REF, ALERT_WATCH_FOR, COMPUTE_TZ, SHIPMENT_STATE,
} from './enums'

/** ALERTS — Pillar-4 catalogue (A1–A6). Thresholds live in DB so config flips firing with no redeploy. */
export const alerts = pgSchema('alerts')

/**
 * A rule reads: "{threshold_hours} {days_after|days_before} the {trigger_reference},
 *  if {watch_for} is still missing → fire {severity}". Computed in {compute_tz}.
 *  e.g. A3 = 0h after `cutoff`, watch_for `final_bl`, CRITICAL, vessel TZ, locked.
 */
export const alertRules = alerts.table('alert_rules', {
  id: text('id').primaryKey(), // 'A1'..'A6' — stable codes
  name: text('name').notNull(),
  description: text('description').notNull(),
  state: text('state', { enum: SHIPMENT_STATE }), // the leg state it watches (nullable = cross-state)
  triggerType: text('trigger_type', { enum: ALERT_TRIGGER_TYPE }).notNull(),
  triggerReference: text('trigger_reference', { enum: ALERT_TRIGGER_REF }).notNull(),
  watchFor: text('watch_for', { enum: ALERT_WATCH_FOR }).notNull(),
  thresholdHours: integer('threshold_hours').notNull(), // hours, to capture 48h/72h precisely
  severity: text('severity', { enum: ALERT_SEVERITY }).notNull(),
  computeTz: text('compute_tz', { enum: COMPUTE_TZ }).notNull().default('server'),
  enabled: boolean('enabled').notNull().default(true),
  locked: boolean('locked').notNull().default(false), // A3 is locked
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const alertInstances = alerts.table('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: text('rule_id').notNull().references(() => alertRules.id),
  bookingId: uuid('booking_id'), // logical FK → tracking.bookings.id
  shipmentId: uuid('shipment_id'), // logical FK → tracking.shipments.id
  severity: text('severity', { enum: ALERT_SEVERITY }).notNull(),
  status: text('status', { enum: ALERT_STATUS }).notNull().default('ACTIVE'),
  message: text('message').notNull(),
  dedupKey: text('dedup_key').unique(), // rule + shipment + window → no duplicate firings
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
