import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

/** One scored shipment decision, POSTed by the Agent VM (Matcher merged it, Critic scored it). */
export class CreateDecisionDto {
  /** The strong-key bag the shipment is matched/upserted on (so_no, booking_no, hbl_awb_fcr_no, mbl, container_no, customer_po). */
  @IsObject()
  @Type(() => Object)
  matchKey!: Record<string, unknown>

  /** Consolidated field values (the Matcher's merged picture). */
  @IsObject()
  @Type(() => Object)
  fields!: Record<string, unknown>

  @IsOptional() @IsArray() @IsString({ each: true }) pos?: string[]

  /** POs the agent's B/L-anchored records STATE without committing them as contents (queue: `posStated`,
   *  from `matchKeys.po_list_stated`). MATCHING ONLY — it widens candidate lookup and findExistingLeg so an
   *  AWB reaches the sibling legs holding its other POs; it is NEVER written to shipment_pos. Omitted by
   *  legacy callers → matching behaves exactly as before. Must be declared here or the whitelist
   *  ValidationPipe (main.ts) strips it off the wire. */
  @IsOptional() @IsArray() @IsString({ each: true }) posStated?: string[]

  /** The subset of `pos` the agent swept up rather than stated (queue `posInferred`). Persisted per link
   *  (0029) as claim STRENGTH, so a later email that names the PO displaces this weak claim instead of
   *  losing the cross-HAWB guard on arrival order. Omitted by legacy callers → all claims stated. */
  @IsOptional() @IsArray() @IsString({ each: true }) posInferred?: string[]

  /** Per-PO unambiguous shipped qty, keyed by normalized po_no. Present only when a real qty can be attributed
   *  to an individual PO; absent (or a PO omitted) when the qty is a broadcast total. Omitted by legacy callers. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  poQty?: Record<string, number>

  @IsOptional() @IsString() mode?: string
  @IsOptional() @IsArray() @IsString({ each: true }) emailTypes?: string[]

  /** Per-email events that built this shipment (for milestones + view-original). */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  events?: { emailType: string; receivedAt: string; graphId?: string }[]

  /** Human-readable disagreement notes the Matcher surfaced (GENUINE conflicts only). */
  @IsOptional() @IsArray() @IsString({ each: true }) conflicts?: string[]

  // `supersedes` was declared here for years and consumed by NOTHING — a dead contract prop that only
  // misled readers. It stays QUEUE-INTERNAL (their risk pass reads it off the draft); the queue stopped
  // sending it the same day this line was removed. Re-declare ONLY together with a real consumer.

  /** Every value each identity field ever held (current + alternates) — persisted as searchable history. */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  identifiers?: {
    type: string
    value: string
    docType?: string
    rank?: number
    isCurrent?: boolean
    sourceEmailId?: string | null
    observedAt?: string | null
  }[]

  /** Co-valid customer entities with roles — persisted as shipment_parties. Present only when ≥2 RELATED
   *  customer codes co-occur; the isPrimary one equals fields.customer_code (booking.customer_id). Omitted
   *  by legacy callers → no parties written (unchanged). */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  entities?: {
    type: string
    value: string
    role?: string | null
    docType?: string
    rank?: number
    isPrimary?: boolean
    sourceEmailId?: string | null
    observedAt?: string | null
  }[]

  /** The booking was CANCELLED (e.g. a cancellation notice for an existing booking). When true the
   *  committed leg is marked leg_status='CANCELLED' and the UI surfaces it as Cancelled rather than an
   *  active Booking Request. Omitted by legacy callers → treated as not cancelled (unchanged). */
  @IsOptional() @IsBoolean() cancelled?: boolean

  /** The journey CHAIN of the latest queue record that states one (queue `fields.legs`, MERGE_EXEMPT,
   *  lifted by groupJourney). Every stop has survived the queue's two validate guards: air legs end at
   *  air gateways, and every endpoint is VISIBLE in the email that stated it — so this is extraction,
   *  never lane-knowledge invention. Rendered into the route string (`PVG->DEL->LHR`); stored on
   *  `shipments.journey` as JSON. Omitted by legacy callers -> no journey (unchanged). */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  journey?: { seq: number; mode: string; pol: string; pod: string; doc: string | null }[]

  /** DIVISION statements the queue's matcher acted on (`注：PO28739;PO28740 改为 07-Feb 入仓` — cargo
   *  stated as moved off a booking). The committer's evidence for removing a stated shipment_pos link:
   *  a PO both named here AND absent from `pos` left this leg, audited with the quote. A PARTIAL
   *  division (counted cartons) keeps its PO in `pos` queue-side, so it never qualifies. Omitted by
   *  legacy callers → no links removed (unchanged). */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  divisions?: { pos: string[]; direction?: string; target?: string; quote?: string; statedAt?: string }[]

  /** The Critic's per-shipment confidence, 0-100. Routes to confirmed/provisional vs the threshold. */
  @IsInt() @Min(0) @Max(100) confidence!: number

  /** The agent's DETERMINISTIC review-gate verdict, now AUTHORITATIVE: true → confirmed, false → provisional
   *  (route to a human) — independent of the confidence score, which is informational. Omitted by legacy
   *  callers → score-vs-threshold routing (unchanged). */
  @IsOptional() @IsBoolean() autoApply?: boolean

  /** The gate's 3-way disposition. `skip` = 不需處理: a notification/invoice with no actionable shipment
   *  data — acknowledged without committing a shipment (see DecisionsService).
   *  `auto`/`review` encode apply vs human review; track also re-evaluates via `resolveEmailDisposition`
   *  when `lookupContext` review signals fire (safe direction only). Omitted → derived from lookupContext. */
  @IsOptional() @IsIn(['auto', 'review', 'skip']) disposition?: 'auto' | 'review' | 'skip'

  /** Cross-leg / master-lookup signals the agent attaches so track can gate review without a full DB scan
   *  (email disposition). Omitted by legacy callers → payload-only gates. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  lookupContext?: {
    knownCustomer?: boolean
    newCustomer?: boolean
    modeChange?: boolean
    movedShipment?: boolean
    latePo?: boolean
    duplicateNumber?: boolean
    statusUpdate?: boolean
  }

  /** Why the gate withheld auto-apply (empty when autoApply) — surfaced in the review queue ahead of raw conflicts. */
  @IsOptional() @IsArray() @IsString({ each: true }) reviewReasons?: string[]

  /**
   * #152 ops-only party notes (Mesh-add / API-down / port LOCODE). Not gate review reasons.
   * Merged into stored reviewReasons + criticReview so they are visible on the leg.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) opsNotes?: string[]

  /** Critic advisory JSON (confidence band, conflicts, risk flags) — persisted on the leg for the review UI.
   *  Loose object at the HTTP boundary; shape documented in critic-review.types.ts. Omitted by legacy callers. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  criticReview?: object

  /**
   * #129 multi-candidate match: closed-set legs the email matched (queue matcher).
   * Merged into criticReview.matchAmbiguity on ingest for ReviewCard candidate picker.
   * Never invent IDs — only pass through agent payload.
   */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  matchAmbiguity?: object

  /** Queue band-routing recommendation (Phase 2 shadow). Independent of disposition/autoApply gate.
   *  ShipTrack dual-computes band vs gate; under default critic_routing_mode=gate this is shadow-only. */
  @IsOptional() @IsIn(['auto', 'review', 'skip']) recommendedRouting?: 'auto' | 'review' | 'skip'

  /**
   * #173 C1.5 — dual-confirm pin: commit onto this shipmentId after verify (intersection+llm).
   * Absent → committer first-match-wins (legacy). Verification fail → provisional, never silent re-match.
   */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  dualAutoTarget?: { shipmentId: string; basis?: string }

  /** True when EVERY source email came from the CVP/TradeLinkOne notification platform — the leg is a
   *  vendor/PO notification, not a booked move (routed to Documents, classifyKind rule (c)). Omitted by
   *  legacy callers → the committer resolves it from the source emails' senders (defense in depth). */
  @IsOptional() @IsBoolean() fromPlatform?: boolean

  /** Pointers back to the source emails (Graph is the permanent source of truth for "view original"). */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  evidenceRefs?: { graphId?: string; graphMessageId?: string; sourceFile?: string; receivedAt?: string; emailType?: string }[]

  @IsOptional() @IsString() conversationId?: string

  /** Per-email parsed records + email metadata that back Change-History / PO-enrichment after the DB split.
   *  Additive: legacy callers omit it → no ingest write (unchanged). Populated by cobalt-queue's send-side. */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  evidence?: {
    graphMessageId: string
    /** Microsoft Graph item id (AAMk…) for on-demand body/attachment re-fetch — distinct from graphMessageId. */
    graphId?: string | null
    recordIdx?: number
    poNo?: string | null
    emailType?: string | null
    senderType?: string | null
    mode?: string | null
    fields?: Record<string, unknown>
    matchKeys?: Record<string, unknown>
    subject?: string | null
    sender?: string | null
    receivedAt?: string | null
    conversationId?: string | null
    sourceFile?: string | null
    bodyText?: string | null
    bodyHtml?: string | null
    /** cobalt-queue soul version (queue.prompt_version.id) that produced this parse — provenance (queue v1, §4.6d). */
    promptVersion?: number | null
    attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string; rawBytesB64?: string | null }[]
  }[]
}
