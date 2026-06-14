import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

const ROLES = ['VIEWER', 'EDITOR', 'ADMIN']

export class CreateUserDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(1)
  name!: string

  @IsIn(ROLES)
  role!: string

  @IsString()
  @MinLength(4)
  password!: string
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1)
  name?: string

  @IsOptional() @IsIn(ROLES)
  role?: string

  @IsOptional() @IsBoolean()
  active?: boolean

  @IsOptional() @IsString() @MinLength(4)
  password?: string
}
