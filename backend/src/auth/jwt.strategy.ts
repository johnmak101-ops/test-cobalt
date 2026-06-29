import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UsersRepository } from '../db/repositories/users.repository'
import { cookieTokenExtractor } from './cookie-extractor'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersRepository) {
    super({
      // Accept the JWT from the `session` cookie (new UI sends credentials) OR the
      // Authorization header (agent/service accounts). Cookie is tried first.
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieTokenExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    })
  }

  /** Return value is attached to req.user. */
  async validate(payload: { sub: string }) {
    const user = await this.users.findById(payload.sub)
    if (!user || !user.active) throw new UnauthorizedException()
    return { id: user.id, email: user.email, name: user.name, role: user.role }
  }
}
