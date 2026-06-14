import { IsObject, IsOptional, IsString } from 'class-validator'

/** A human's correction of a provisional shipment: edited fields (camelCase columns) + a reason. */
export class CorrectDto {
  @IsObject() fields!: Record<string, unknown>
  @IsOptional() @IsString() reason?: string
}
