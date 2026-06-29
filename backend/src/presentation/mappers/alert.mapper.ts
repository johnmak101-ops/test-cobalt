/** Alert row (+ a nested shipment summary the controller joins) -> UI alert shape. Pure. */
import { isoOrNull } from '../adapters/derive'

type Dateish = Date | string | null | undefined

export interface AlertRow {
  id: string
  ruleId: string
  shipmentId: string | null
  severity: string
  message: string
  status: string
  firedAt: Dateish
  readAt: Dateish
  dismissedAt: Dateish
  snoozedUntil: Dateish
}

export interface UiAlertShipment {
  id: string
  poNumbers: string
  route: string | null
  customer?: { name: string } | null
}

export interface AlertMapperInput {
  alert: AlertRow
  shipment?: UiAlertShipment | null
}

export interface UiAlert {
  id: string
  shipmentId: string | null
  ruleId: string
  severity: string
  message: string
  status: string
  triggeredAt: string | null
  dismissedAt: string | null
  snoozedUntil: string | null
  readAt: string | null
  shipment: UiAlertShipment | null
}

export function toUiAlert(input: AlertMapperInput): UiAlert {
  const { alert } = input
  return {
    id: alert.id,
    shipmentId: alert.shipmentId ?? null,
    ruleId: alert.ruleId,
    severity: alert.severity,
    message: alert.message,
    status: alert.status,
    triggeredAt: isoOrNull(alert.firedAt),
    dismissedAt: isoOrNull(alert.dismissedAt),
    snoozedUntil: isoOrNull(alert.snoozedUntil),
    readAt: isoOrNull(alert.readAt),
    shipment: input.shipment ?? null,
  }
}
