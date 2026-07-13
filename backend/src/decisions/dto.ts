import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

/** One scored shipment decision, POSTed by the Agent VM (Matcher merged it, Critic scored it). */
export class CreateDecisionDto {
  /** The strong-key bag the shipment is matched/upserted on (so_no, booking_no, hbl_awb_fcr_no, mbl, container_no, customer_po). */
  @IsObject() matchKey!: Record<string, unknown>

  /** Consolidated field values (the Matcher's merged picture). */
  @IsObject() fields!: Record<string, unknown>

  @IsOptional() @IsArray() @IsString({ each: true }) pos?: string[]

  /** Per-PO unambiguous shipped qty, keyed by normalized po_no. Present only when a real qty can be attributed
   *  to an individual PO; absent (or a PO omitted) when the qty is a broadcast total. Omitted by legacy callers. */
  @IsOptional() @IsObject() poQty?: Record<string, number>

  @IsOptional() @IsString() mode?: string
  @IsOptional() @IsArray() @IsString({ each: true }) emailTypes?: string[]

  /** Per-email events that built this shipment (for milestones + view-original). */
  @IsOptional() @IsArray() events?: { emailType: string; receivedAt: string; graphId?: string }[]

  /** Human-readable disagreement notes the Matcher surfaced (GENUINE conflicts only). */
  @IsOptional() @IsArray() @IsString({ each: true }) conflicts?: string[]

  /** Lifecycle identity supersedes (Draft → Final B/L etc.) — recorded for history, not penalized. */
  @IsOptional() @IsArray() @IsString({ each: true }) supersedes?: string[]

  /** Every value each identity field ever held (current + alternates) — persisted as searchable history. */
  @IsOptional() @IsArray() identifiers?: {
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
  @IsOptional() @IsArray() entities?: {
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
   *  (review-policy v2 + email disposition). Omitted by legacy callers → payload-only gates. */
  @IsOptional() @IsObject() lookupContext?: {
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

  /** True when EVERY source email came from the CVP/TradeLinkOne notification platform — the leg is a
   *  vendor/PO notification, not a booked move (routed to Documents, classifyKind rule (c)). Omitted by
   *  legacy callers → the committer resolves it from the source emails' senders (defense in depth). */
  @IsOptional() @IsBoolean() fromPlatform?: boolean

  /** Pointers back to the source emails (Graph is the permanent source of truth for "view original"). */
  @IsOptional() @IsArray() evidenceRefs?: { graphId?: string; graphMessageId?: string; sourceFile?: string; receivedAt?: string; emailType?: string }[]

  @IsOptional() @IsString() conversationId?: string

  /** Per-email parsed records + email metadata that back Change-History / PO-enrichment after the DB split.
   *  Additive: legacy callers omit it → no ingest write (unchanged). Populated by cobalt-queue's send-side. */
  @IsOptional() @IsArray() evidence?: {
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
