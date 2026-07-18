import { Type } from 'class-transformer'
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'
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

// carriers — ocean carriers keyed by SCAC (seeded + ops-maintained; the SCAC data home).
export class CreateCarrierDto {
  @IsString() @MinLength(2) scac!: string
  @IsString() @MinLength(1) name!: string
}
export class UpdateCarrierDto {
  @IsOptional() @IsString() @MinLength(2) scac?: string
  @IsOptional() @IsString() @MinLength(1) name?: string
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

// Candidate retrieval for the LLM Master Matcher (agent-consumed; deterministic, recall-oriented).
export class MasterCandidatesDto {
  @IsIn(['customer', 'vendor', 'forwarder', 'consignee', 'port']) type!: 'customer' | 'vendor' | 'forwarder' | 'consignee' | 'port'
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() emailDomain?: string
  @IsOptional() @IsString() country?: string
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number
  // Phase 2 co-occurrence context (agent-supplied; validated loosely — boosts only, never filters)
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  context?: { customerCode?: string; poNumbers?: string[]; brand?: string }
}
