# nestjs-doctor config notes

See `nestjs-doctor.config.json` (`notes` array + structured `ignore` / `rules`).

## Intentional ignores

| Item | Why |
|------|-----|
| `security/require-guards-on-endpoints` | Global JwtAuthGuard via `APP_GUARD`; `@Public` / `@Roles` mark exceptions. |
| `architecture/require-module-boundaries` | Feature modules share `RepositoriesModule`; strict boundaries would be a large restructure. |
| `performance/no-unused-module-exports` | Exports kept for tests, CLI reuse, or future wiring. |
| CLI files + `src/dev/**` | Outside Nest DI; `process.env` + manual `new` / sync I/O are correct. |
| `excludeClasses`: MasterResolver, MastersSyncService, MeshClient, MilestoneSynchronizer | Collaborators / runtime Mesh wiring, not Nest providers. |

## Score gate

`minScore: 90` — run:

```bash
pnpm --filter backend doctor
# or: pnpm exec nestjs-doctor . --score --config nestjs-doctor.config.json
```
