import { Body, Controller, Get, Put } from '@nestjs/common'
import { IsObject } from 'class-validator'
import { PageAccessService } from './page-access.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

class PageAccessDto {
  // The full override map { pageId: { role: level } }. The service validates/cleans each cell
  // (drops unknown pages/roles, junk levels, and any SUPERADMIN entry).
  @IsObject() overrides!: Record<string, Record<string, string>>
}

@Controller('page-access')
export class PageAccessController {
  constructor(private readonly access: PageAccessService) {}

  /** The current user's effective level per governed page — drives the frontend route/nav/editability. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { pages: await this.access.forUser(user.role) }
  }

  /** The full matrix for the superadmin Access Control panel. */
  @Roles('SUPERADMIN')
  @Get()
  matrix() {
    return this.access.matrix()
  }

  /** Replace the matrix overrides. Superadmin only. */
  @Roles('SUPERADMIN')
  @Put()
  set(@Body() dto: PageAccessDto, @CurrentUser() actor: AuthUser) {
    return this.access.setMatrix(dto.overrides, actor.id)
  }
}
