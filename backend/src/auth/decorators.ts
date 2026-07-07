import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'
/** Mark a route as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

export const ROLES_KEY = 'roles'
/** Restrict a route to the given roles (RolesGuard enforces it). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

/** Inject the authenticated user (set by JwtStrategy.validate). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user)

export const ALLOW_DURING_MUST_RESET_KEY = 'allowDuringMustReset'
/** Permit this route even when the authenticated user still has mustReset=true. */
export const AllowDuringMustReset = () => SetMetadata(ALLOW_DURING_MUST_RESET_KEY, true)
