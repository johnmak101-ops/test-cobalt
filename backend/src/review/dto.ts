import { ArrayNotEmpty, IsArray, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator'

/**
 * A human's correction of a provisional shipment: edited fields (camelCase columns) + a reason.
 *
 * IMPORTANT: do NOT put `@Type(() => Object)` on `fields`. With global `ValidationPipe({ transform,
 * whitelist })`, that transformer replaces the payload with `new Object()` and the nested keys are
 * wiped — `/correct` then confirms the leg with `corrected: []` while the client thinks it saved.
 */
export class CorrectDto {
  @IsObject()
  fields!: Record<string, unknown>
  /**
   * Fields the reviewer ruled to LEAVE AS THEY ARE — deliberately apart from `fields`.
   *
   * `fields` means "write this"; these mean "do not write, but record that I ruled". Fusing them
   * would make a keep indistinguishable from a rewrite of the same value, and the whole point is
   * that no value moves. The backend locks each at what the leg already stores.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) keep?: string[]
  @IsOptional() @IsString() reason?: string
  /** ISO timestamp from the client load; rejects with 409 when the leg has since been updated. */
  @IsOptional() @IsString() expectedUpdatedAt?: string
}

/** Approve-as-is, optionally with a reviewer note (audited — harvested for agent-soul feedback). */
export class ConfirmDto {
  @IsOptional() @IsString() note?: string
  /** Per-field keep rulings (see CorrectDto.keep). Present here because a card whose ONLY decision
   *  is "these stored values are right" writes no field and so takes the confirm path. */
  @IsOptional() @IsArray() @IsString({ each: true }) keep?: string[]
  /** ISO timestamp from the client load; rejects with 409 when the leg has since been updated. */
  @IsOptional() @IsString() expectedUpdatedAt?: string
}

/** Bulk "not a trackable shipment" verdict from the Review Queue (portal echo / no-move noise). */
export class DismissDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) shipmentIds!: string[]
  @IsOptional() @IsString() note?: string
}

/**
 * "Parked — I have to go and ask": moves ONE leg off the active desk without answering it.
 * `reason` is who/what we are waiting on ("asked the forwarder", "pending Mesh add") — free text, kept
 * short because the Waiting tab shows it inline. No due date and no assignee by design.
 */
export class WaitDto {
  @IsOptional() @IsString() @Length(0, 1000) reason?: string
}

/** Zero-identity leg: operator types a strong ID; may offer a link candidate or set the field. */
export class IdentifyDto {
  @IsIn(['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'])
  field!: 'booking_no' | 'so_no' | 'hbl_awb_fcr_no' | 'mbl' | 'container_no'

  @IsString()
  @Length(3, 64)
  value!: string
}

/** Fold a provisional into an existing shipment; optional field patches apply to the **target**. */
export class LinkDto {
  @IsString()
  @Length(1, 64)
  targetShipmentId!: string

  /** CamelCase leg columns to write on the target before merge (same shape as CorrectDto.fields). */
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>

  @IsOptional()
  @IsString()
  reason?: string
}
