import type { ColumnType } from 'kysely'
import type {
  DB as GeneratedDB,
  AlertRules as GenAlertRules,
  Shipments as GenShipments,
  Bookings as GenBookings,
  ReviewEmail as GenReviewEmail,
  ShipmentMilestones as GenShipmentMilestones,
  ParsedRecord as GenParsedRecord,
  Generated,
} from './db.generated'
import type {
  SHIPMENT_STATE,
  LEG_STATUS,
  SHIPMENT_MODE,
  RISK_LEVEL,
  REVIEW_STATUS,
  QTY_UNIT,
  BOOKING_STATUS,
  MILESTONE_TYPE,
  WAREHOUSE_SIGNAL,
  ALERT_SEVERITY,
  ALERT_TRIGGER_TYPE,
  ALERT_TRIGGER_REF,
  ALERT_WATCH_FOR,
  COMPUTE_TZ,
} from '../enums'

/**
 * Curated overlay over the kysely-codegen types (`db.generated.ts`).
 *
 * codegen sees only the physical T-SQL schema, so it types every `nvarchar(max)` JSON column as `string`
 * and every CHECK-constrained enum as `string`. At runtime `ParseJSONResultsPlugin` parses JSON columns
 * back into objects on SELECT while writes still pass stringified JSON — `Json<T>` encodes exactly that
 * asymmetry (`ColumnType<parsed, string, string>`) — and the enum literal unions are derived from
 * `src/db/enums.ts` (the same single source of truth zod uses). Regenerating `db.generated.ts` never
 * touches this file; new mismatches surface as tsc errors here.
 */
type Json<T> = ColumnType<T, string | null, string | null>
type U<T extends readonly string[]> = T[number]

export interface Shipments
  extends Omit<
    GenShipments,
    | 'kind'
    | 'mode'
    | 'state'
    | 'legStatus'
    | 'riskLevel'
    | 'reviewStatus'
    | 'qtyUnit'
    | 'reviewReasons'
    | 'matchKeys'
    | 'criticReview'
  > {
  kind: Generated<'SHIPMENT' | 'DOCUMENT'>
  mode: U<typeof SHIPMENT_MODE> | null
  state: Generated<U<typeof SHIPMENT_STATE>>
  legStatus: Generated<U<typeof LEG_STATUS>>
  riskLevel: Generated<U<typeof RISK_LEVEL>>
  reviewStatus: Generated<U<typeof REVIEW_STATUS>>
  qtyUnit: U<typeof QTY_UNIT> | null
  reviewReasons: Json<string[] | null>
  matchKeys: Json<Record<string, unknown> | null>
  /** Temporary loose type; Task 4 can tighten to CriticReviewPayload. */
  criticReview: Json<Record<string, unknown> | null>
}

export interface Bookings extends Omit<GenBookings, 'status'> {
  status: Generated<U<typeof BOOKING_STATUS>>
}

export interface ShipmentMilestones extends Omit<GenShipmentMilestones, 'milestoneType' | 'signal'> {
  milestoneType: U<typeof MILESTONE_TYPE>
  signal: U<typeof WAREHOUSE_SIGNAL> | null
}

export interface AlertRules
  extends Omit<
    GenAlertRules,
    'state' | 'triggerType' | 'triggerReference' | 'watchFor' | 'severity' | 'computeTz' | 'countryThresholds'
  > {
  state: U<typeof SHIPMENT_STATE> | null
  triggerType: U<typeof ALERT_TRIGGER_TYPE>
  triggerReference: U<typeof ALERT_TRIGGER_REF>
  watchFor: U<typeof ALERT_WATCH_FOR>
  severity: U<typeof ALERT_SEVERITY>
  computeTz: Generated<U<typeof COMPUTE_TZ>>
  countryThresholds: Json<Record<string, number> | null>
}

export interface ReviewEmail
  extends Omit<GenReviewEmail, 'extractedData' | 'suggestedData' | 'originalExtractedData'> {
  extractedData: Json<Record<string, unknown> | null>
  suggestedData: Json<Record<string, unknown> | null>
  originalExtractedData: Json<Record<string, unknown> | null>
}

export interface ParsedRecord extends Omit<GenParsedRecord, 'fields' | 'matchKeys'> {
  fields: Json<Record<string, unknown> | null>
  matchKeys: Json<Record<string, unknown> | null>
}

export interface DB
  extends Omit<GeneratedDB, 'shipments' | 'bookings' | 'shipmentMilestones' | 'alertRules' | 'reviewEmail' | 'parsedRecord'> {
  shipments: Shipments
  bookings: Bookings
  shipmentMilestones: ShipmentMilestones
  alertRules: AlertRules
  reviewEmail: ReviewEmail
  parsedRecord: ParsedRecord
}
