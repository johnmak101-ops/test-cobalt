import { BadRequestException, Body, Controller, Get, Post, Res, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { Public, CurrentUser, AllowDuringMustReset } from './decorators'
import { mapBackendRoleToUi } from '../presentation/adapters/enums'
import { SESSION_COOKIE, sessionTtlSeconds } from './auth.constants'
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
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.sessionMaxAgeMs,
    })
    return { user: result.user }
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE)
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
    if (body.newPassword === body.currentPassword) {
      throw new BadRequestException('new password must be different from the current password')
    }
    const ok = await this.auth.changePassword(user.id, body.currentPassword, body.newPassword)
    if (!ok) throw new UnauthorizedException('current password is incorrect')
    return { success: true }
  }
}
