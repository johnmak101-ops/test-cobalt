import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from './decorators'

/** Role hierarchy — a higher rank satisfies any requirement for a lower one. */
const RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, SUPERADMIN: 3 }

/**
 * Enforces @Roles(...) as a MINIMUM role (rank-based): @Roles('ADMIN') = "admin or higher".
 * No @Roles = any authenticated user is allowed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) return true
    const { user } = context.switchToHttp().getRequest()
    const userRank = user ? (RANK[user.role] ?? -1) : -1
    const minRequired = Math.min(...required.map((r) => RANK[r] ?? Number.POSITIVE_INFINITY))
    if (userRank >= minRequired) return true
    throw new ForbiddenException(`requires role: ${required.join(' or ')} (or higher)`)
  }
}
