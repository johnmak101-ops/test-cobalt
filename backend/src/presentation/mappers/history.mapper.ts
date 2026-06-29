/** audit.change_log row (entityType='shipment') -> UI HistoryEntry. Pure. */
import { isoOrNull } from '../adapters/derive'

type Dateish = Date | string | null | undefined

export interface ChangeLogRow {
  id: string
  entityType: string
  entityId: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  sourceType: string
  sourceId: string | null
  actorUserId: string | null
  isDelay: boolean
  note: string | null
  createdAt: Dateish
}

export interface UiHistoryEntry {
  id: string
  shipmentId: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  sourceType: string
  sourceId: string | null
  changedBy: string | null
  changedAt: string | null
  isDelay: boolean
  notes: string | null
}

/** The UI's source enum is email|manual|system; the backend also has 'agent' -> show as 'system'. */
function sourceTypeToUi(s: string): string {
  return s === 'agent' ? 'system' : s
}

export function toUiHistoryEntry(row: ChangeLogRow): UiHistoryEntry {
  return {
    id: row.id,
    shipmentId: row.entityId,
    field: row.field ?? null,
    oldValue: row.oldValue ?? null,
    newValue: row.newValue ?? null,
    sourceType: sourceTypeToUi(row.sourceType),
    sourceId: row.sourceId ?? null,
    changedBy: row.actorUserId ?? null,
    changedAt: isoOrNull(row.createdAt),
    isDelay: row.isDelay,
    notes: row.note ?? null,
  }
}
