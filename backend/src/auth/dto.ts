import { IsString, MinLength } from 'class-validator'
import { PASSWORD_MIN_LENGTH } from './auth.constants'

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword!: string
}
