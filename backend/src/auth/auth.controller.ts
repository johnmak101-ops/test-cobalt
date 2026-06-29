import { Body, Controller, Get, Post, Res, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { Public, CurrentUser } from './decorators'
import { mapBackendRoleToUi } from '../presentation/adapters/enums'

interface SessionUser {
  id: string
  email: string
  name: string
  role: string
}

const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

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
    return result
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
}
