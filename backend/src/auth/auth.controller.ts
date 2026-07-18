import { Body, Controller, Get, Post, Res, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { Public, CurrentUser, AllowDuringMustReset } from './decorators'
import { mapBackendRoleToUi } from '../presentation/adapters/enums'
import { SESSION_COOKIE, sessionTtlSeconds, sessionCookieOptions } from './auth.constants'
import { ChangePasswordDto } from './dto'

interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  avatarInitials?: string | null
  mustReset?: boolean
}

@Controller('auth')
export class AuthController {
  private readonly sessionMaxAgeMs: number

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.sessionMaxAgeMs = sessionTtlSeconds(config) * 1000
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password)
    if (!result) throw new UnauthorizedException('invalid credentials')
    res.cookie(SESSION_COOKIE, result.token, { ...sessionCookieOptions(), maxAge: this.sessionMaxAgeMs })
    return { user: result.user }
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    // clear MUST carry the same attributes as the set, or the browser won't drop a Secure/SameSite cookie.
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
    return { success: true }
  }

  @AllowDuringMustReset()
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { user: { ...user, role: mapBackendRoleToUi(user.role) } }
  }

  @AllowDuringMustReset()
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body() body: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword)
    return { success: true }
  }
}
