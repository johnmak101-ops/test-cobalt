import { ArrayNotEmpty, IsArray, IsObject, IsOptional, IsString } from 'class-validator'

/** A human's correction of a provisional shipment: edited fields (camelCase columns) + a reason. */
export class CorrectDto {
  @IsObject() fields!: Record<string, unknown>
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
