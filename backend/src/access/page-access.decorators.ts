import { SetMetadata } from '@nestjs/common'

export const PAGE_READ_KEY = 'pageRead'
export const PAGE_WRITE_KEY = 'pageWrite'
/** Agent-consumed read surface: hard page-read gate for humans + EDITOR+ service-account carve-out. */
export const AGENT_PAGE_READ_KEY = 'agentPageRead'

/** Require at least VIEW access to `<pageId>` to reach this route (PageAccessGuard enforces it). */
export const PageRead = (pageId: string) => SetMetadata(PAGE_READ_KEY, pageId)

/** Require EDIT access to `<pageId>` to reach this route. */
export const PageWrite = (pageId: string) => SetMetadata(PAGE_WRITE_KEY, pageId)

/**
 * Access-control v2: hard-gate a *read* that humans hit via a config page, but keep cobalt-queue /
 * service accounts working. Enforcement (PageAccessGuard):
 *   - page matrix grants view/edit → allow
 *   - page matrix is `none` but role is EDITOR+ (agent Bearer login tier) → allow (carve-out)
 *   - otherwise → 403 PAGE_ACCESS_DENIED
 */
export const AgentPageRead = (pageId: string) => SetMetadata(AGENT_PAGE_READ_KEY, pageId)
