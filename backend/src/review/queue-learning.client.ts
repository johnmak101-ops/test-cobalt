import { Injectable, Logger } from '@nestjs/common'

/** One field signal, in the shape the queue learning feed (POST /review/correction) expects. `kind`
 *  distinguishes a real correction (a human changed the value) from a "looks right" confirm-sentinel
 *  (a human accepted the value) — confirms guard the queue's held-out eval but never train the refiner. */
export interface CorrectionPayload {
  messageId: string
  field: string
  agentSaid: string | null
  humanCorrected: string | null
  forwarder: string | null
  note: string | null
  /** 'correction' (default when omitted) or 'confirm' — the queue rejects any other value. */
  kind?: 'correction' | 'confirm'
}

/**
 * Best-effort push of a human review correction to the cobalt-queue learning feed (the Iterator's TRAIN
 * signal). Fire-and-forget by design: a queue outage must NEVER break the review save, so every error is
 * swallowed. No-op when QUEUE_API_BASE is unset (the tracking system runs standalone by default).
 */
@Injectable()
export class QueueLearningClient {
  private readonly log = new Logger(QueueLearningClient.name)

  async postCorrection(payload: CorrectionPayload): Promise<void> {
    const base = process.env.QUEUE_API_BASE
    if (!base) return // tracking system runs standalone → nothing to push to
    try {
      const res = await fetch(`${base}/review/correction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) this.log.warn(`queue correction POST ${res.status} for field ${payload.field}`)
    } catch (e) {
      this.log.warn(`queue correction POST failed: ${(e as Error).message}`)
    }
  }
}
