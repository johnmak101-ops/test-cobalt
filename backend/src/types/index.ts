// Shared TypeScript types for the ShipTrack backend

export type ShipmentStatus =
  | 'BOOKED'
  | 'CONFIRMED'
  | 'AT_WAREHOUSE'
  | 'SAILED'
  | 'RELEASED'
  | 'DELIVERED'

export type RiskLevel = 'ON_TRACK' | 'AT_RISK' | 'DELAYED'

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO'
export type AlertStatus = 'ACTIVE' | 'DISMISSED' | 'SNOOZED' | 'RESOLVED'

export type EmailType =
  | 'BOOKING_REQUEST'
  | 'SHIPPING_ORDER'
  | 'DRAFT_BL'
  | 'FINAL_BL'
  | 'TELEX_RELEASE'
  | 'DELAY_NOTICE'
  | 'OTHER'

export type MilestoneType =
  | 'BOOKING_SENT'
  | 'SO_RECEIVED'
  | 'DRAFT_BL_RECEIVED'
  | 'FINAL_BL_RECEIVED'
  | 'TELEX_RELEASED'
  | 'DELIVERED'

export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

// Quantity tracking (partial shipments)
export type QuantityUnit = 'cartons' | 'pieces' | 'cbm'

// Review queue (low-confidence extractions)
export type ReviewStatus =
  | 'AUTO_ACCEPTED'       // Confidence > 0.9, auto-linked
  | 'FLAGGED'             // Confidence 0.7-0.9, accepted but flagged
  | 'NEEDS_REVIEW'        // Confidence 0.5-0.7, queued for review
  | 'REVIEWED_OK'         // Manually approved
  | 'REVIEWED_CORRECTED'  // Manually corrected
  | 'REJECTED'            // Not a shipping email

// Shipment history (audit trail)
export type HistorySourceType = 'email' | 'manual' | 'system'

export type HistoryField =
  | 'etd'
  | 'eta'
  | 'vessel_name'
  | 'status'
  | 'cfs_cutoff'
  | 'hbl_number'
  | 'voyage_number'
  | 'quantity_shipped'
  | 'risk_level'

// Vendor/Factory types
export type VendorType = 'factory' | 'subcontractor' | 'agent'
