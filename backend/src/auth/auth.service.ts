import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UsersRepository } from '../db/repositories/users.repository'
import { verifyPassword } from './password'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.users.findByEmail(email)
    if (!user || !user.active) return null
    if (!(await verifyPassword(password, user.passwordHash))) return null
    return { id: user.id, email: user.email, name: user.name, role: user.role }
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    const user = await this.validateUser(email, password)
    if (!user) return null
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role })
    return { token, user }
  }
}
