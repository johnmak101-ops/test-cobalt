import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { MASTER_RESOLUTION_KIND } from '../db/enums'

const PORT_MODES = ['sea', 'air']

// Ops-maintained masters only. customers/vendors are a Cobalt Mesh API mirror (read-only) — no write DTOs.

export class CreateForwarderDto {
  @IsOptional() @IsString() code?: string
  @IsString() @MinLength(1) name!: string
}
export class UpdateForwarderDto {
  @IsOptional() @IsString() code?: string
  @IsOptional() @IsString() @MinLength(1) name?: string
}

export class CreatePortDto {
  @IsString() @MinLength(1) unlocode!: string
  @IsString() @MinLength(1) name!: string
  @IsOptional() @IsString() country?: string
  @IsIn(PORT_MODES) mode!: string
}
export class UpdatePortDto {
  @IsOptional() @IsString() @MinLength(1) name?: string
  @IsOptional() @IsString() country?: string
  @IsOptional() @IsIn(PORT_MODES) mode?: string
}

export class CreateConsigneeDto {
  @IsString() @MinLength(1) name!: string
  @IsOptional() @IsString() address?: string
  // a customer id, or '' to leave unmapped (kept loose so the dropdown can clear it)
  @IsOptional() @IsString() mapsToCustomerId?: string
}
export class UpdateConsigneeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string
  @IsOptional() @IsString() address?: string
  @IsOptional() @IsString() mapsToCustomerId?: string
}

// master_resolution curated facts (ADMIN-managed; app-owned, NOT ERP masters).
export class CreateResolutionFactDto {
  @IsIn([...MASTER_RESOLUTION_KIND]) kind!: string
  @IsString() @MinLength(1) lhs!: string
  @IsOptional() @IsString() rhs?: string
  @IsOptional() @IsString() reason?: string
}
export class PatchResolutionFactDto {
  @IsOptional() @IsString() reason?: string
}
