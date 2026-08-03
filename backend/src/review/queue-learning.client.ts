import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Best-effort push of a human review correction to the cobalt-queue learning feed (the Iterator's TRAIN
 * signal). A queue outage must NEVER break the review save — errors are logged LOUDLY but not rethrown.
 *
 * Auth (#116): when the queue has VIEWER_PASSWORD set, every route needs a Bearer JWT from
 * `POST {QUEUE_API}/login` with `{ password }`. We login once, cache the token, re-login on 401.
 * Env:
 *   QUEUE_API_BASE       e.g. http://queue:3100/api  (required to push)
 *   QUEUE_API_PASSWORD   viewer (or admin) password matching the queue's VIEWER_PASSWORD / ADMIN_PASSWORD
 *                        (alias: QUEUE_VIEWER_PASSWORD)
 */
@Injectable()
export class QueueLearningClient {
  private readonly log = new Logger(QueueLearningClient.name)
  private token: string | null = null
  /** null = no SUCCESSFUL probe yet; true/false = the queue's actual answer. Failures never latch. */
  private authRequired: boolean | null = null
  /** One-time loud note that the learning feed is off — silence here cost weeks of dead TRAIN signal. */
  private warnedNoBase = false
  /**
   * HTTP transport — defaults to global fetch. Tests assign a stub; do NOT inject via Nest constructor
   * (Nest would try to resolve `FetchLike` as a DI token and AppModule boot fails).
   */
  fetchImpl: FetchLike = fetch

  constructor(private readonly config: ConfigService) {}

  private base(): string | null {
    const b = (this.config.get<string>('QUEUE_API_BASE') ?? '').trim().replace(/\/+$/, '')
    return b || null
  }

  private password(): string {
    return (
      this.config.get<string>('QUEUE_API_PASSWORD') ??
      this.config.get<string>('QUEUE_VIEWER_PASSWORD') ??
      ''
    ).trim()
  }

  /**
   * Probe GET /auth → { required }. A REAL answer is cached for process lifetime (restart after a
   * password policy change). A FAILED probe is NOT cached: it answers `true` for this attempt only
   * (never post bare to an unknown queue) and the next correction re-probes.
   *
   * Why the distinction is load-bearing: this backend deploys BEFORE the queue API. The old code
   * latched the first (dead-queue) probe as authRequired=true for the whole process lifetime, so once
   * the queue came up open, every POST kept failing on a password requirement that did not exist —
   * the entire TRAIN feed stayed dead until someone restarted ShipTrack.
   */
  private async probeAuthRequired(base: string): Promise<boolean> {
    if (this.authRequired != null) return this.authRequired
    try {
      const res = await this.fetchImpl(`${base}/auth`)
      if (!res.ok) return true // transient (queue booting / proxy 502): do NOT latch
      const j = (await res.json().catch(() => ({}))) as { required?: boolean }
      this.authRequired = !!j.required
      return this.authRequired
    } catch {
      return true // queue unreachable: assume locked for THIS attempt only, re-probe next time
    }
  }

  private async login(base: string): Promise<string> {
    const password = this.password()
    if (!password) {
      throw new Error(
        'QUEUE_API_PASSWORD (or QUEUE_VIEWER_PASSWORD) is required when the queue enforces VIEWER_PASSWORD — corrections cannot authenticate',
      )
    }
    const res = await this.fetchImpl(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) throw new Error(`queue login failed: ${res.status}`)
    const j = (await res.json().catch(() => ({}))) as { token?: string | null }
    if (!j.token) throw new Error('queue login returned no token')
    this.token = j.token
    return j.token
  }

  private async authHeaders(base: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const required = await this.probeAuthRequired(base)
    if (!required) return headers
    const token = this.token ?? (await this.login(base))
    headers.authorization = `Bearer ${token}`
    return headers
  }

  private loudFail(msg: string, field: string): void {
    // Never swallow as warn — production 401s were silent and TRAIN signal never arrived (#116).
    this.log.error(`QUEUE LEARNING FEED FAILED — TRAIN signal dropped for field=${field}: ${msg}`)
  }

  async postCorrection(payload: CorrectionPayload): Promise<void> {
    const base = this.base()
    if (!base) {
      // standalone mode is legitimate, but it must never be SILENT: with the iterator running on
      // labels, an unset QUEUE_API_BASE means zero fuel and no error anywhere else in the system.
      if (!this.warnedNoBase) {
        this.warnedNoBase = true
        this.log.warn(
          'QUEUE_API_BASE is unset — queue learning feed DISABLED (review labels will NOT reach the iterator). Set QUEUE_API_BASE to enable.',
        )
      }
      return
    }
    try {
      let headers = await this.authHeaders(base)
      let res = await this.fetchImpl(`${base}/review/correction`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      // Transparent re-login once on 401 (expired JWT or race after password rotate)
      if (res.status === 401) {
        this.token = null
        this.authRequired = true // force auth path
        headers = await this.authHeaders(base)
        res = await this.fetchImpl(`${base}/review/correction`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        this.loudFail(`HTTP ${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`, payload.field)
      }
    } catch (e) {
      this.loudFail((e as Error).message, payload.field)
    }
  }
}
