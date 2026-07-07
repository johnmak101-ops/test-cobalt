import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { PASSWORD_MIN_LENGTH } from '../auth/auth.constants'

const ROLES = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN']

export class CreateUserDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(1)
  name!: string

  @IsIn(ROLES)
  role!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1)
  name?: string

  @IsOptional() @IsIn(ROLES)
  role?: string

  @IsOptional() @IsBoolean()
  active?: boolean

  @IsOptional() @IsString() @MinLength(PASSWORD_MIN_LENGTH)
  password?: string
}
