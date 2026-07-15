import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTERED_MIGRATIONS } from './migrate-cli'

/**
 * migrate-cli's MIGRATIONS map is a STATIC registry: a migration file that exists on disk but is not
 * imported + listed there is silently skipped by `db:migrate` — no error, no log. Unit tests never run
 * migrations, so CI stays green while the deploy quietly does nothing (0013/0014 shipped unapplied for
 * days this way; 0015 was caught in review). This guard makes the omission fail here instead.
 */
describe('migration registry', () => {
  it('every migration file on disk is registered in migrate-cli', () => {
    const onDisk = readdirSync(join(__dirname, 'kysely-migrations'))
      .filter((f) => /^\d{4}_.+\.ts$/.test(f) && !f.endsWith('.spec.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort()
    expect(onDisk.length).toBeGreaterThan(0) // the glob itself must not silently match nothing
    expect([...REGISTERED_MIGRATIONS].sort()).toEqual(onDisk)
  })
})
