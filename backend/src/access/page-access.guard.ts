import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PageAccessService } from './page-access.service'
import { PAGE_READ_KEY, PAGE_WRITE_KEY } from './page-access.decorators'
import { LEVEL_RANK } from './pages'

/**
 * Enforces @PageRead / @PageWrite against the superadmin-configured access matrix. Global, but a
 * no-op on routes without the metadata (so non-config routes are untouched). Runs after JwtAuthGuard
 * (needs req.user); SUPERADMIN always passes because PageAccessService.levelFor returns `edit` for it.
 */
@Injectable()
export class PageAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: PageAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const writePage = this.reflector.getAllAndOverride<string>(PAGE_WRITE_KEY, [context.getHandler(), context.getClass()])
    const readPage = this.reflector.getAllAndOverride<string>(PAGE_READ_KEY, [context.getHandler(), context.getClass()])
    const pageId = writePage ?? readPage
    if (!pageId) return true // not a page-gated route

    const required: 'edit' | 'view' = writePage ? 'edit' : 'view'
    const { user } = context.switchToHttp().getRequest()
    const level = await this.access.levelFor(pageId, user?.role ?? '')
    if (LEVEL_RANK[level] >= LEVEL_RANK[required]) return true
    throw new ForbiddenException({ code: 'PAGE_ACCESS_DENIED', message: `requires ${required} access to ${pageId}` })
  }
}
