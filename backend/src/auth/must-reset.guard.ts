import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY, ALLOW_DURING_MUST_RESET_KEY } from './decorators'

/**
 * Blocks every route for a user whose password reset is still pending, except @Public routes and
 * those marked @AllowDuringMustReset (/auth/me, /auth/change-password). Runs after JwtAuthGuard.
 */
@Injectable()
export class MustResetGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
    if (isPublic) return true
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_MUST_RESET_KEY, [context.getHandler(), context.getClass()])
    if (allowed) return true
    const { user } = context.switchToHttp().getRequest()
    if (user?.mustReset) {
      throw new ForbiddenException({ code: 'MUST_RESET', message: 'password reset required' })
    }
    return true
  }
}
