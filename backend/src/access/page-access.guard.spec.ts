import { describe, it, expect } from 'vitest'
import type { Reflector } from '@nestjs/core'
import { PageAccessGuard } from './page-access.guard'
import { AGENT_PAGE_READ_KEY, PAGE_READ_KEY, PAGE_WRITE_KEY } from './page-access.decorators'
import type { PageAccessService } from './page-access.service'

const ctx = (role: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as never

/** Build a guard whose reflector returns `meta[key]` and whose service resolves every lookup to `level`. */
function guard(meta: Record<string, string | undefined>, level: string) {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector
  const access = { levelFor: async () => level } as unknown as PageAccessService
  return new PageAccessGuard(reflector, access)
}

describe('PageAccessGuard', () => {
  it('passes routes with no @PageRead/@PageWrite metadata', async () => {
    expect(await guard({}, 'none').canActivate(ctx('VIEWER'))).toBe(true)
  })

  it('@PageWrite requires edit', async () => {
    expect(await guard({ [PAGE_WRITE_KEY]: 'alert_rules' }, 'edit').canActivate(ctx('ADMIN'))).toBe(true)
    await expect(guard({ [PAGE_WRITE_KEY]: 'alert_rules' }, 'view').canActivate(ctx('EDITOR'))).rejects.toThrow()
    await expect(guard({ [PAGE_WRITE_KEY]: 'alert_rules' }, 'none').canActivate(ctx('VIEWER'))).rejects.toThrow()
  })

  it('@PageRead requires view; edit also passes; none is blocked', async () => {
    expect(await guard({ [PAGE_READ_KEY]: 'alert_rules' }, 'view').canActivate(ctx('VIEWER'))).toBe(true)
    expect(await guard({ [PAGE_READ_KEY]: 'alert_rules' }, 'edit').canActivate(ctx('ADMIN'))).toBe(true)
    await expect(guard({ [PAGE_READ_KEY]: 'alert_rules' }, 'none').canActivate(ctx('VIEWER'))).rejects.toThrow()
  })

  it('@AgentPageRead: none blocks VIEWER but EDITOR+ service-account carve-out passes', async () => {
    await expect(guard({ [AGENT_PAGE_READ_KEY]: 'resolution_rules' }, 'none').canActivate(ctx('VIEWER'))).rejects.toThrow()
    expect(await guard({ [AGENT_PAGE_READ_KEY]: 'resolution_rules' }, 'none').canActivate(ctx('EDITOR'))).toBe(true)
    expect(await guard({ [AGENT_PAGE_READ_KEY]: 'resolution_rules' }, 'none').canActivate(ctx('ADMIN'))).toBe(true)
    expect(await guard({ [AGENT_PAGE_READ_KEY]: 'resolution_rules' }, 'view').canActivate(ctx('VIEWER'))).toBe(true)
  })
})

