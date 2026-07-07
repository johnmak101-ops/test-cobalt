import { Body, Controller, Get, Post, Res, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { Public, CurrentUser } from './decorators'
import { mapBackendRoleToUi } from '../presentation/adapters/enums'
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.constants'

interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  avatarInitials?: string | null
  mustReset?: boolean
}

const SESSION_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
      maxAge: SESSION_MAX_AGE_MS,
    })
    return { user: result.user }
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE)
    return { success: true }
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { user: { ...user, role: mapBackendRoleToUi(user.role) } }
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const ok = await this.auth.changePassword(user.id, body.currentPassword, body.newPassword)
    if (!ok) throw new UnauthorizedException('current password is incorrect')
    return { success: true }
  }
}
