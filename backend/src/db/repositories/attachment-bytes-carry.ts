/**
 * #177 / queue #151 — when decisions re-POST attachments after the queue purged local
 * raw_bytes, incoming rawBytesB64 is null. Do NOT wipe ShipTrack's previously stored
 * originals: carry forward by graphAttachmentId, else filename + sizeBytes.
 */

export type IncomingAttachment = {
  graphAttachmentId?: string | null
  filename: string
  sizeBytes?: number | null
  rawBytesB64?: string | null
}

export type StoredAttachmentBytes = {
  graphAttachmentId: string | null
  filename: string
  sizeBytes: number | null
  rawBytes: Buffer | null
}

/**
 * Resolve bytes for one incoming attachment row.
 * Prefer incoming base64; else match prior stored non-null rawBytes.
 */
export function resolveAttachmentRawBytes(
  incoming: IncomingAttachment,
  prior: StoredAttachmentBytes[],
): Buffer | null {
  if (incoming.rawBytesB64 != null && incoming.rawBytesB64 !== '') {
    try {
      return Buffer.from(incoming.rawBytesB64, 'base64')
    } catch {
      // fall through to carry-forward
    }
  }

  const ga = (incoming.graphAttachmentId ?? '').trim()
  if (ga) {
    const byId = prior.find(
      (p) => p.rawBytes && p.rawBytes.length > 0 && (p.graphAttachmentId ?? '').trim() === ga,
    )
    if (byId?.rawBytes) return byId.rawBytes
  }

  const name = (incoming.filename ?? '').trim()
  if (!name) return null
  const size = incoming.sizeBytes ?? null
  const byName = prior.find((p) => {
    if (!p.rawBytes || p.rawBytes.length === 0) return false
    if ((p.filename ?? '').trim() !== name) return false
    if (size == null || p.sizeBytes == null) return true
    return p.sizeBytes === size
  })
  return byName?.rawBytes ?? null
}
