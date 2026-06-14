import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto, UpdateUserDto } from './dto'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

/**
 * User administration.
 *   list / update — ADMIN or higher
 *   create / delete — SUPERADMIN only
 */
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list() {
    return this.users.list()
  }

  @Roles('SUPERADMIN')
  @Post() create(@Body() dto: CreateUserDto) {
    return this.users.create(dto)
  }

  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(id, dto, actor.role)
  }

  @Roles('SUPERADMIN')
  @Delete(':id') remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.remove(id, actor.id)
  }
}
