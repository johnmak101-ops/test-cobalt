import { Type } from 'class-transformer'
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator'

/** A reviewer's action on a queued email extraction. `corrections.extractedData` is the full edited record. */
export class ReviewEmailDto {
  @IsIn(['approve', 'correct', 'reject']) action!: 'approve' | 'correct' | 'reject'
  @IsOptional() @IsString() notes?: string
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  corrections?: { extractedData?: Record<string, unknown> }
}
