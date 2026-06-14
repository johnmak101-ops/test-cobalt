import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { Public, CurrentUser } from './decorators'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const res = await this.auth.login(body.email, body.password)
    if (!res) throw new UnauthorizedException('invalid credentials')
    return res
  }

  @Get('me')
  me(@CurrentUser() user: unknown) {
    return user
  }
}
