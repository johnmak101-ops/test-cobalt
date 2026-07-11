/**
 * Structural proof that the multi-stage Docker runtime can migrate/seed without ts-node:
 * package.json exposes db:migrate:prod + seed:prod pointing at compiled dist entrypoints.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const backendPkg = JSON.parse(readFileSync(join(root, 'backend', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const entrypoint = readFileSync(join(root, 'docker-entrypoint.sh'), 'utf8')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')

describe('Docker multi-stage prod migrate/seed path', () => {
  it('backend package.json defines node-dist prod scripts', () => {
    expect(backendPkg.scripts['db:migrate:prod']).toMatch(/node dist\/db\/migrate-cli\.js/)
    expect(backendPkg.scripts['seed:prod']).toMatch(/node dist\/db\/seed\.js/)
  })

  it('entrypoint prefers compiled migrate-cli/seed when dist exists', () => {
    expect(entrypoint).toMatch(/backend\/dist\/db\/migrate-cli\.js/)
    expect(entrypoint).toMatch(/backend\/dist\/db\/seed\.js/)
    expect(entrypoint).toMatch(/node backend\/dist\/db\/migrate-cli\.js/)
  })

  it('Dockerfile is multi-stage runtime without copying full source tree', () => {
    expect(dockerfile).toMatch(/AS build/)
    expect(dockerfile).toMatch(/AS runtime/)
    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile --prod/)
    expect(dockerfile).toMatch(/COPY --from=build \/app\/backend\/dist/)
    // Must not COPY full source into runtime stage after prod install
    const runtimeSection = dockerfile.split('AS runtime')[1] ?? ''
    expect(runtimeSection).not.toMatch(/COPY \. \./)
  })
})
