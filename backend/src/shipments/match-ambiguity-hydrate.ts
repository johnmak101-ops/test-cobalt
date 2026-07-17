/**
 * #129 next stage: build / refresh matchAmbiguity for review UI when the agent
 * left AMBIGUOUS_MATCH reasons but no closed-set candidate cards (stale legs).
 */
import type { CriticReview, MatchAmbiguity, MatchAmbiguityCandidate } from '../decisions/critic-review.types'
import { normKey } from '../reconcile/match-keys'

const MAX_CANDIDATES = 8
const MULTI_REASON = /matched multiple backend legs/i

export function needsMatchAmbiguityHydration(
  criticReview: CriticReview | null | undefined,
  reviewReasons: string[] | null | undefined,
): boolean {
  const hasMa = (criticReview?.matchAmbiguity?.candidates?.length ?? 0) >= 2
  if (hasMa) return false
  const flag = (criticReview?.riskFlags ?? []).some((f) => f?.code === 'AMBIGUOUS_MATCH')
  const reason = (reviewReasons ?? []).some((r) => MULTI_REASON.test(String(r)))
  return flag || reason
}

/** Wire leg → lookup query bag (snake_case keys the matcher uses). */
export function lookupQueryFromLeg(leg: {
  bookingNo?: string | null
  soNo?: string | null
  hblAwbFcrNo?: string | null
  mbl?: string | null
  containerNo?: string | null
  matchKeys?: Record<string, unknown> | null
  pos?: string[] | null
}): Record<string, unknown> {
  const mk = (leg.matchKeys ?? {}) as Record<string, unknown>
  const pick = (snake: string, camelVal: string | null | undefined) => {
    const fromMk = mk[snake]
    if (fromMk != null && String(fromMk).trim()) return String(fromMk).trim()
    if (camelVal != null && String(camelVal).trim()) return String(camelVal).trim()
    return undefined
  }
  const q: Record<string, unknown> = {}
  const bk = pick('booking_no', leg.bookingNo)
  const so = pick('so_no', leg.soNo)
  const hbl = pick('hbl_awb_fcr_no', leg.hblAwbFcrNo)
  const mbl = pick('mbl', leg.mbl)
  const ctr = pick('container_no', leg.containerNo)
  if (bk) q.booking_no = bk
  if (so) q.so_no = so
  if (hbl) q.hbl_awb_fcr_no = hbl
  if (mbl) q.mbl = mbl
  if (ctr) q.container_no = ctr
  const poFromMk = mk.customer_po
  if (poFromMk != null && String(poFromMk).trim()) q.customer_po = String(poFromMk).trim()
  else if (leg.pos?.length) {
    const first = leg.pos.map(String).map((p) => p.trim()).find(Boolean)
    if (first) q.customer_po = first
  }
  return q
}

type WireCandidate = {
  id?: string
  jobNo?: string | null
  matchedBy?: string
  bookingNo?: string | null
  soNo?: string | null
  hblAwbFcrNo?: string | null
  mbl?: string | null
  containerNo?: string | null
  mode?: string | null
  etd?: unknown
  vesselName?: string | null
  pos?: string[]
  matchKeys?: Record<string, unknown> | null
}

function emailKeyDisplay(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no', 'customer_po']) {
    const v = q[k]
    if (v != null && String(v).trim()) out[k] = String(v).trim()
  }
  return out
}

function overlap(
  q: Record<string, unknown>,
  c: WireCandidate,
): MatchAmbiguityCandidate['overlap'] {
  const o: NonNullable<MatchAmbiguityCandidate['overlap']> = {}
  const mk = c.matchKeys ?? {}
  const field = (snake: string, camel: string | null | undefined) => {
    const v = mk[snake] ?? camel
    return v != null && String(v).trim() ? String(v).trim() : null
  }
  const pairs: [string, string | null][] = [
    ['booking_no', field('booking_no', c.bookingNo ?? null)],
    ['so_no', field('so_no', c.soNo ?? null)],
    ['hbl_awb_fcr_no', field('hbl_awb_fcr_no', c.hblAwbFcrNo ?? null)],
    ['mbl', field('mbl', c.mbl ?? null)],
    ['container_no', field('container_no', c.containerNo ?? null)],
  ]
  for (const [k, cv] of pairs) {
    const ev = q[k]
    if (ev != null && cv && normKey(ev) === normKey(cv)) (o as Record<string, string>)[k] = cv
  }
  const emailPo = q.customer_po
  if (emailPo && (c.pos ?? []).some((p) => normKey(p) === normKey(emailPo))) o.poHit = true
  return o
}

/**
 * Build closed-set MatchAmbiguity from lookup candidates. Returns null if fewer than 2 valid ids.
 */
export function buildMatchAmbiguityFromCandidates(
  query: Record<string, unknown>,
  rawCandidates: unknown[],
  opts?: { maxCandidates?: number },
): MatchAmbiguity | null {
  const max = opts?.maxCandidates ?? MAX_CANDIDATES
  const mapped: MatchAmbiguityCandidate[] = []
  for (const raw of rawCandidates) {
    const c = raw as WireCandidate
    const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : null
    if (!id) continue
    const mb = c.matchedBy === 'strong_key' || c.matchedBy === 'po' ? c.matchedBy : 'unknown'
    const mk = c.matchKeys ?? {}
    const pick = (snake: string, camel: string | null | undefined) => {
      const v = mk[snake] ?? camel
      return v != null && String(v).trim() ? String(v).trim() : null
    }
    mapped.push({
      shipmentId: id,
      jobNo: c.jobNo ?? null,
      matchedBy: mb,
      overlap: overlap(query, c),
      booking_no: pick('booking_no', c.bookingNo ?? null),
      so_no: pick('so_no', c.soNo ?? null),
      hbl_awb_fcr_no: pick('hbl_awb_fcr_no', c.hblAwbFcrNo ?? null),
      mbl: pick('mbl', c.mbl ?? null),
      container_no: pick('container_no', c.containerNo ?? null),
      mode: c.mode ?? null,
      pos: Array.isArray(c.pos) ? c.pos.map(String).slice(0, 8) : undefined,
      etd: c.etd != null ? String(c.etd) : null,
      vesselOrFlight: c.vesselName ?? null,
    })
  }
  if (mapped.length < 2) return null

  const truncated = mapped.length > max
  const candidates = mapped.slice(0, max)

  const ctrCounts = new Map<string, number>()
  for (const c of candidates) {
    const k = normKey(c.container_no)
    if (k) ctrCounts.set(k, (ctrCounts.get(k) ?? 0) + 1)
  }
  let sharedContainer: string | null = null
  for (const c of candidates) {
    const k = normKey(c.container_no)
    if (k && (ctrCounts.get(k) ?? 0) >= 2) {
      sharedContainer = c.container_no ?? null
      break
    }
  }

  return {
    kind: 'multi_candidate',
    emailKey: emailKeyDisplay(query),
    candidates,
    candidateCount: mapped.length,
    truncated: truncated || undefined,
    sharedContainer,
    suggestion: null,
  }
}

/** Dedupe review reason strings (order preserved). */
export function dedupeReviewReasons(reasons: string[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of reasons ?? []) {
    const t = String(r).trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * When live lookup no longer multi-hits, strip stale multi-candidate signals from the response.
 */
export function stripStaleAmbiguousSignals(
  criticReview: CriticReview | null | undefined,
  reviewReasons: string[] | null | undefined,
): { criticReview: CriticReview | null; reviewReasons: string[] } {
  const reasons = dedupeReviewReasons(reviewReasons).filter((r) => !MULTI_REASON.test(r))
  if (!criticReview) return { criticReview: null, reviewReasons: reasons }
  const riskFlags = (criticReview.riskFlags ?? []).filter((f) => f?.code !== 'AMBIGUOUS_MATCH')
  const { matchAmbiguity: _drop, ...rest } = criticReview
  return {
    criticReview: { ...rest, riskFlags },
    reviewReasons: reasons,
  }
}

/** Attach hydrated matchAmbiguity onto criticReview (response or persist). */
export function withMatchAmbiguity(
  criticReview: CriticReview | null | undefined,
  matchAmbiguity: MatchAmbiguity,
): CriticReview {
  const base: CriticReview = criticReview ?? {
    confidence: { score: 45, band: 'low', label: 'Low' },
    summary: 'Multiple matching shipments — pick which leg this email updates.',
    observations: [],
    priorState: { headline: '', fields: [] },
    proposedChanges: [],
    riskFlags: [],
    recommendedHumanAction: 'review',
    reasons: [],
  }
  const flags = [...(base.riskFlags ?? [])]
  if (!flags.some((f) => f.code === 'AMBIGUOUS_MATCH')) {
    flags.push({
      code: 'AMBIGUOUS_MATCH',
      severity: 'high',
      message:
        'This email matched more than one existing leg — pick which shipment it updates (multiple legs for one PO/booking/container is often normal, including 拼柜).',
    })
  }
  return { ...base, riskFlags: flags, matchAmbiguity }
}
