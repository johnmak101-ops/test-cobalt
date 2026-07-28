import type { ColumnType } from 'kysely'
import type {
  DB as GeneratedDB,
  AlertRules as GenAlertRules,
  Shipments as GenShipments,
  Bookings as GenBookings,
  ReviewEmail as GenReviewEmail,
  ShipmentMilestones as GenShipmentMilestones,
  ParsedRecord as GenParsedRecord,
  Customers as GenCustomers,
  Vendors as GenVendors,
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
import type { CriticReview } from '../../decisions/critic-review.types'

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
  /** Migration 0024. Declared here rather than in db.generated.ts because codegen runs against
   *  `cobalt_test`, which only gains the column once migrations are applied there — this keeps the
   *  type correct without a codegen round-trip. Fold into the generated shape on the next `db:codegen`. */
  cartons: number | null
  /** Migration 0025 — review-desk "parked, going to ask" stamp. Same codegen caveat as `cartons`. */
  waitingAt: Date | null
  waitingReason: string | null
  /** Migration 0027 — what the committer DID with the agent's advice. Same codegen caveat as `cartons`.
   *  Never inferred from absence: every outcome has a name (see the migration). */
  committerAction: 'matched' | 'created' | 'created_pending_dedup' | 'adopted_zero_id' | 'sibling_leg' | null
  committerTargetLegId: string | null
  committerCandidatesConsidered: number | null
  /** Migration 0028 — a PERSON typed this leg (POST /shipments), not the pipeline. Same codegen caveat
   *  as `cartons`. Two committer rules read it so they surface rather than act: see
   *  `findPoOnlyDuplicateRisk` and `findManualIdentityClash`. */
  createdManually: Generated<boolean>
  reviewReasons: Json<string[] | null>
  matchKeys: Json<Record<string, unknown> | null>
  criticReview: Json<CriticReview | null>
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

/** Append-only shadow log of gate vs band routing at decision ingest (Phase 2a). Not in codegen until regenerating after 0013. */
export interface RoutingShadow {
  id: Generated<string>
  shipmentId: string | null
  ingestedAt: Generated<Date>
  gateRouting: 'confirmed' | 'provisional' | 'skip'
  bandRouting: 'confirmed' | 'provisional' | 'skip'
  band: 'low' | 'medium' | 'high' | null
  differs: boolean
  reasonsJson: Json<string[] | null>
}

export type CalibrationOutcome = 'approved' | 'corrected' | 'dismissed'

/** Append-only critic band vs human outcome (Phase 3 calibration). Not in codegen until regenerating after 0014. */
export interface CriticCalibration {
  id: Generated<string>
  shipmentId: string | null
  decidedAt: Generated<Date>
  band: 'low' | 'medium' | 'high' | null
  outcome: CalibrationOutcome
  correctedFieldCount: number
  actorId: string | null
  reasonsJson: Json<string[] | null>
}

/** Admin Mesh-miss ack table (0016). Not in codegen until regenerating after 0016. */
export interface MeshMissAck {
  id: Generated<string>
  type: string
  normalizedName: string
  ackedBy: string
  ackedAt: Generated<Date>
}

/** 0022 — Mesh FullNameCh (Chinese legal name), a retrieval alias for the LLM master matcher. */
export interface Customers extends GenCustomers {
  nameCh: string | null
}
export interface Vendors extends GenVendors {
  nameCh: string | null
}

export interface DB
  extends Omit<
    GeneratedDB,
    | 'shipments'
    | 'bookings'
    | 'shipmentMilestones'
    | 'alertRules'
    | 'reviewEmail'
    | 'parsedRecord'
    // Hand-typed overrides (codegen Generated<> vs app ColumnType) — omit then re-add below
    | 'routingShadow'
    | 'criticCalibration'
    | 'meshMissAck'
    // 0022 name_ch columns (codegen not rerun) — omit then re-add below
    | 'customers'
    | 'vendors'
  > {
  shipments: Shipments
  bookings: Bookings
  shipmentMilestones: ShipmentMilestones
  alertRules: AlertRules
  reviewEmail: ReviewEmail
  parsedRecord: ParsedRecord
  routingShadow: RoutingShadow
  criticCalibration: CriticCalibration
  meshMissAck: MeshMissAck
  customers: Customers
  vendors: Vendors
}
