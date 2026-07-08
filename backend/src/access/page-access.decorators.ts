import { SetMetadata } from '@nestjs/common'

export const PAGE_READ_KEY = 'pageRead'
export const PAGE_WRITE_KEY = 'pageWrite'

/** Require at least VIEW access to `<pageId>` to reach this route (PageAccessGuard enforces it). */
export const PageRead = (pageId: string) => SetMetadata(PAGE_READ_KEY, pageId)

/** Require EDIT access to `<pageId>` to reach this route. */
export const PageWrite = (pageId: string) => SetMetadata(PAGE_WRITE_KEY, pageId)
