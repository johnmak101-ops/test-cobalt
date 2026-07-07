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
  mustReset: boolean
  createdAt: Date
}) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatarInitials: u.avatarInitials, mustReset: u.mustReset, createdAt: u.createdAt })

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
      mustReset: true,
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
    if (target.role === 'SUPERADMIN' && (dto.active === false || (dto.role !== undefined && dto.role !== 'SUPERADMIN'))) {
      await this.assertNotLastSuperadmin()
    }

    const patch: Record<string, unknown> = {}
    if (dto.name !== undefined) {
      patch.name = dto.name
      patch.avatarInitials = initials(dto.name)
    }
    if (dto.role !== undefined) patch.role = dto.role
    if (dto.active !== undefined) patch.active = dto.active
    if (dto.password) {
      patch.passwordHash = await hashPassword(dto.password)
      patch.mustReset = true // any admin-set password is temporary
    }

    const user = await this.repo.update(id, patch)
    if (!user) throw new NotFoundException(`user ${id} not found`)
    return safe(user)
  }

  /** Soft-delete: deactivate (never hard-delete — audit rows reference user ids). SUPERADMIN-only. */
  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('you cannot deactivate your own account')
    const target = await this.repo.findById(id)
    if (!target) throw new NotFoundException(`user ${id} not found`)
    if (target.role === 'SUPERADMIN') await this.assertNotLastSuperadmin()
    const user = await this.repo.update(id, { active: false })
    if (!user) throw new NotFoundException(`user ${id} not found`)
    return safe(user)
  }

  private async assertNotLastSuperadmin() {
    const n = await this.repo.countActiveByRole('SUPERADMIN')
    if (n <= 1) throw new BadRequestException('cannot deactivate or demote the last active superadmin')
  }
}
