import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from './decorators'

/** Enforces @Roles(...) on a route. No @Roles = any authenticated user is allowed. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) return true
    const { user } = context.switchToHttp().getRequest()
    if (user && required.includes(user.role)) return true
    throw new ForbiddenException(`requires role: ${required.join(' or ')}`)
  }
}
