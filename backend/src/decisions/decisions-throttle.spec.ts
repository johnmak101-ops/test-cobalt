import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { DecisionsController } from './decisions.controller'

describe('decisions ingest is exempt from rate limiting', () => {
  it('DecisionsController carries SkipThrottle metadata', () => {
    const keys = Reflect.getMetadataKeys(DecisionsController)
    expect(keys.some((k) => String(k).toLowerCase().includes('throttler'))).toBe(true)
  })
})
