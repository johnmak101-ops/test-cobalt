import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PageAccessService } from './page-access.service'
import { AGENT_PAGE_READ_KEY, PAGE_READ_KEY, PAGE_WRITE_KEY } from './page-access.decorators'
import { LEVEL_RANK } from './pages'

/** Minimum role rank for the agent/service-account carve-out on @AgentPageRead surfaces. */
const ROLE_RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, SUPERADMIN: 3 }

/**
 * Enforces @PageRead / @PageWrite / @AgentPageRead against the superadmin-configured access matrix.
 * Global, but a no-op on routes without the metadata. Runs after JwtAuthGuard (needs req.user);
 * SUPERADMIN always passes because PageAccessService.levelFor returns `edit` for it.
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
    const agentPage = this.reflector.getAllAndOverride<string>(AGENT_PAGE_READ_KEY, [context.getHandler(), context.getClass()])
    const pageId = writePage ?? readPage ?? agentPage
    if (!pageId) return true // not a page-gated route

    const { user } = context.switchToHttp().getRequest()
    const role = user?.role ?? ''
    const level = await this.access.levelFor(pageId, role)

    if (agentPage && !writePage && !readPage) {
      // Access-control v2: hard read-gating + EDITOR+ service-account carve-out for agent HTTP.
      if (LEVEL_RANK[level] >= LEVEL_RANK.view) return true
      if ((ROLE_RANK[role] ?? -1) >= ROLE_RANK.EDITOR) return true
      throw new ForbiddenException({ code: 'PAGE_ACCESS_DENIED', message: `requires view access to ${pageId} (or EDITOR+ service account)` })
    }

    const required: 'edit' | 'view' = writePage ? 'edit' : 'view'
    if (LEVEL_RANK[level] >= LEVEL_RANK[required]) return true
    throw new ForbiddenException({ code: 'PAGE_ACCESS_DENIED', message: `requires ${required} access to ${pageId}` })
  }
}
