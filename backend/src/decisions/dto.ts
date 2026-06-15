import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

/** One scored shipment decision, POSTed by the Agent VM (Matcher merged it, Critic scored it). */
export class CreateDecisionDto {
  /** The strong-key bag the shipment is matched/upserted on (so_no, booking_no, hbl_awb_fcr_no, mbl, container_no, customer_po). */
  @IsObject() matchKey!: Record<string, unknown>

  /** Consolidated field values (the Matcher's merged picture). */
  @IsObject() fields!: Record<string, unknown>

  @IsOptional() @IsArray() @IsString({ each: true }) pos?: string[]
  @IsOptional() @IsString() mode?: string
  @IsOptional() @IsArray() @IsString({ each: true }) emailTypes?: string[]

  /** Per-email events that built this shipment (for milestones + view-original). */
  @IsOptional() @IsArray() events?: { emailType: string; receivedAt: string; graphId?: string }[]

  /** Human-readable disagreement notes the Matcher surfaced (GENUINE conflicts only). */
  @IsOptional() @IsArray() @IsString({ each: true }) conflicts?: string[]

  /** Lifecycle identity supersedes (Draft → Final B/L etc.) — recorded for history, not penalized.
   *  Accepted now for forward-compat; consumed when identifier history lands (later phase). */
  @IsOptional() @IsArray() @IsString({ each: true }) supersedes?: string[]

  /** The Critic's per-shipment confidence, 0-100. Routes to confirmed/provisional vs the threshold. */
  @IsInt() @Min(0) @Max(100) confidence!: number

  /** Pointers back to the source emails (Graph is the permanent source of truth for "view original"). */
  @IsOptional() @IsArray() evidenceRefs?: { graphId?: string; graphMessageId?: string; sourceFile?: string; receivedAt?: string; emailType?: string }[]

  @IsOptional() @IsString() conversationId?: string
}
