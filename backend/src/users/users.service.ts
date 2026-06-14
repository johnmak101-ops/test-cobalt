import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { UsersRepository } from '../db/repositories/users.repository'
import { hashPassword } from '../auth/password'
import type { CreateUserDto, UpdateUserDto } from './dto'

/** A user safe to return over the API — never includes passwordHash. */
const safe = (u: {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  avatarInitials: string | null
  createdAt: Date
}) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatarInitials: u.avatarInitials, createdAt: u.createdAt })

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async list() {
    return (await this.repo.list()).map(safe)
  }

  /** Create — controller restricts this to SUPERADMIN. */
  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase()
    if (await this.repo.findByEmail(email)) throw new ConflictException('a user with that email already exists')
    const user = await this.repo.create({
      email,
      name: dto.name,
      role: dto.role as never,
      passwordHash: await hashPassword(dto.password),
      avatarInitials: initials(dto.name),
    })
    return safe(user)
  }

  /** Update — admins may edit, but only a superadmin can touch a superadmin or grant SUPERADMIN. */
  async update(id: string, dto: UpdateUserDto, actorRole: string) {
    const target = await this.repo.findById(id)
    if (!target) throw new NotFoundException(`user ${id} not found`)
    const isSuper = actorRole === 'SUPERADMIN'
    if (target.role === 'SUPERADMIN' && !isSuper) {
      throw new ForbiddenException('only a superadmin can modify a superadmin')
    }
    if (dto.role === 'SUPERADMIN' && !isSuper) {
      throw new ForbiddenException('only a superadmin can grant the superadmin role')
    }

    const patch: Record<string, unknown> = {}
    if (dto.name !== undefined) {
      patch.name = dto.name
      patch.avatarInitials = initials(dto.name)
    }
    if (dto.role !== undefined) patch.role = dto.role
    if (dto.active !== undefined) patch.active = dto.active
    if (dto.password) patch.passwordHash = await hashPassword(dto.password)

    const user = await this.repo.update(id, patch)
    if (!user) throw new NotFoundException(`user ${id} not found`)
    return safe(user)
  }

  /** Delete — controller restricts this to SUPERADMIN; you can't delete yourself. */
  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('you cannot delete your own account')
    const ok = await this.repo.remove(id)
    if (!ok) throw new NotFoundException(`user ${id} not found`)
    return { deleted: true }
  }
}
