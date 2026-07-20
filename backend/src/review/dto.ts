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
  @IsOptional() @IsString() reason?: string
  /** ISO timestamp from the client load; rejects with 409 when the leg has since been updated. */
  @IsOptional() @IsString() expectedUpdatedAt?: string
}

/** Approve-as-is, optionally with a reviewer note (audited — harvested for agent-soul feedback). */
export class ConfirmDto {
  @IsOptional() @IsString() note?: string
  /** ISO timestamp from the client load; rejects with 409 when the leg has since been updated. */
  @IsOptional() @IsString() expectedUpdatedAt?: string
}

/** Bulk "not a trackable shipment" verdict from the Review Queue (portal echo / no-move noise). */
export class DismissDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) shipmentIds!: string[]
  @IsOptional() @IsString() note?: string
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
