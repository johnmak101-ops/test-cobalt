# Real JWT login (cookie-only) + admin User CRUD + remove Outlook wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the half-real JWT login into a hardened cookie-only session, add a SUPERADMIN-only Users admin UI on the existing API, and delete the dead Outlook-365 wiring page — without the browser ever touching the DB or holding a secret.

**Architecture:** Same-origin NestJS (serves SPA + `/api`) + React SPA. Browser auth is an httpOnly `session` cookie (12h); the API still accepts `Authorization: Bearer` for VM2→VM1 service accounts. A global guard chain `JwtAuthGuard → MustResetGuard → RolesGuard` enforces auth, forced-reset, and RBAC. Users admin is a panel inside the existing `SettingsPage` shell (which already swaps panels by pathname).

**Tech Stack:** NestJS 10, Drizzle/Postgres, `@nestjs/jwt` + `passport-jwt`, `bcryptjs`, `zod`, `@nestjs/throttler`, `helmet`; React 19, Vite 7, TanStack Query 5, Zustand, React Router 7, Tailwind 4; Vitest both sides.

## Global Constraints

- **Token model = cookie-only.** Browser never stores the JWT; login returns `{ user }` (no token in body). API keeps Bearer acceptance for service accounts.
- **Session TTL = 12h**, a single constant driving both JWT `expiresIn` and cookie `maxAge`.
- **Frontend never accesses the DB and holds no secret.** No DB driver, no `postgres://`, no `DATABASE_URL`, no non-`VITE_` env in `frontend/`. Enforced by a guardrail test.
- **Password policy = min 8 chars everywhere** (`ChangePasswordDto`, `CreateUserDto`, `UpdateUserDto`).
- **Delete only the `/email-integrations` config surface.** Preserve ALL email viewing: `/inbox`, `/email/:id`, every `/emails/*` endpoint. Do not touch `EmailViewerModal`.
- **Users delete = soft-deactivate** (`active=false`); never hard-delete. Any admin-set password ⇒ `mustReset=true`.
- **Keep the suite green** (~413 tests). Run backend tests with `cd backend && node_modules/.bin/vitest run <path>`; frontend with `cd frontend && node_modules/.bin/vitest run <path>` (root `.bin` lacks vitest). Install deps by editing `package.json` then `CI=true pnpm install` at the repo root (never `pnpm -C`/`--filter add`).
- **Prod URL** `https://StatusTrackAgent.Cobaltknitwear.com` is same-origin; `JWT_SECRET` (≥32 chars) becomes boot-required.
- Docs are force-added: `git add -f docs/...`.

---

## Phase 1 — Backend auth hardening

### Task 1: Boot-time env validation + real JWT secret + session TTL constant

**Files:**
- Create: `backend/src/config/env.validation.ts`
- Create: `backend/src/auth/auth.constants.ts`
- Modify: `backend/src/app.module.ts:26` (ConfigModule), `backend/src/auth/auth.module.ts:14-17` (JwtModule), `backend/src/auth/jwt.strategy.ts:9-19` (secret from config)
- Test: `backend/src/config/env.validation.spec.ts`

**Interfaces:**
- Produces: `validateEnv(config: Record<string, unknown>): Env`; `SESSION_TTL_SECONDS: number`, `SESSION_COOKIE: string`, `PASSWORD_MIN_LENGTH: number` from `auth.constants.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/config/env.validation.spec.ts
import { describe, it, expect } from 'vitest'
import { validateEnv } from './env.validation'

describe('validateEnv', () => {
  it('accepts a valid JWT_SECRET (>=32 chars) and returns the parsed env', () => {
    const env = validateEnv({ JWT_SECRET: 'x'.repeat(32) })
    expect(env.JWT_SECRET).toHaveLength(32)
  })
  it('throws when JWT_SECRET is missing', () => {
    expect(() => validateEnv({})).toThrow(/JWT_SECRET/)
  })
  it('throws when JWT_SECRET is too short', () => {
    expect(() => validateEnv({ JWT_SECRET: 'short' })).toThrow(/at least 32/)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/config/env.validation.spec.ts`
Expected: FAIL — cannot find module `./env.validation`.

- [ ] **Step 3: Implement the constants + validator**

```ts
// backend/src/auth/auth.constants.ts
/** Single source of truth for session lifetime — drives JWT expiry AND cookie maxAge. */
export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_HOURS ?? 12) * 60 * 60
export const SESSION_COOKIE = 'session'
export const PASSWORD_MIN_LENGTH = 8
```

```ts
// backend/src/config/env.validation.ts
import { z } from 'zod'

const envSchema = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  NODE_ENV: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().optional(),
  CORS_ORIGINS: z.string().optional(),
})
export type Env = z.infer<typeof envSchema>

/** Passed to ConfigModule.forRoot({ validate }); throws (aborting boot) on invalid env. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
```

- [ ] **Step 4: Wire it into the app + remove the secret fallback**

In `backend/src/app.module.ts`, replace line 26:
```ts
    ConfigModule.forRoot({ isGlobal: true }),
```
with:
```ts
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
```
and add the import at the top:
```ts
import { validateEnv } from './config/env.validation'
```

In `backend/src/auth/auth.module.ts`, replace the `JwtModule.register({...})` block (lines 14-17) with an async factory that reads the validated secret at DI time (avoids the module-load-order gotcha):
```ts
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: SESSION_TTL_SECONDS },
      }),
    }),
```
and add imports:
```ts
import { ConfigService } from '@nestjs/config'
import { SESSION_TTL_SECONDS } from './auth.constants'
```

In `backend/src/auth/jwt.strategy.ts`, inject config and drop the fallback. Replace the constructor (lines 9-19):
```ts
  constructor(
    private readonly users: UsersRepository,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieTokenExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    })
  }
```
and add `import { ConfigService } from '@nestjs/config'`.

- [ ] **Step 5: Run the validator test (PASS) + typecheck**

Run: `cd backend && node_modules/.bin/vitest run src/config/env.validation.spec.ts`
Expected: PASS (3 tests).
Run: `cd backend && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config backend/src/auth/auth.constants.ts backend/src/auth/auth.module.ts backend/src/auth/jwt.strategy.ts backend/src/app.module.ts
git commit -m "feat(auth): validate JWT_SECRET at boot, remove dev-secret fallback, add session TTL constant"
```

---

### Task 2: Login returns `{ user }` only (no token in body); align cookie TTL

**Files:**
- Modify: `backend/src/auth/auth.controller.ts:16-38`
- Test: `backend/src/auth/auth.controller.spec.ts:17-24` (update existing)

**Interfaces:**
- Consumes: `SESSION_TTL_SECONDS`, `SESSION_COOKIE` (Task 1).
- Produces: `POST /auth/login` → body `{ user }`; `Set-Cookie session` with `maxAge = SESSION_TTL_SECONDS*1000`.

- [ ] **Step 1: Update the login test to expect no token in the body**

Replace `auth.controller.spec.ts` lines 17-24 with:
```ts
describe('AuthController.login — issue session cookie, no token in body', () => {
  it('sets an httpOnly session cookie and returns only { user }', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } }) })
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    const out = await controller.login({ email: 'e@x.com', password: 'pw' }, res as any)
    expect(res.cookie).toHaveBeenCalledWith('session', 'tok', expect.objectContaining({ httpOnly: true }))
    expect(out).toEqual({ user: { id: 'u1', role: 'ADMIN' } })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/auth/auth.controller.spec.ts`
Expected: FAIL — received `{ token: 'tok', user: {...} }`, expected `{ user: {...} }`.

- [ ] **Step 3: Change the controller**

In `backend/src/auth/auth.controller.ts`: replace the constant (line 16-17)
```ts
const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
```
with
```ts
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.constants'
const SESSION_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000
```
(Place the `import` with the other imports at the top and keep only the `SESSION_MAX_AGE_MS` line where the constants were.)

Then in `login()` replace `return result` (line 37) with:
```ts
    return { user: result.user }
```

- [ ] **Step 4: Run tests (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/auth/auth.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/auth.controller.ts backend/src/auth/auth.controller.spec.ts
git commit -m "feat(auth): stop returning the JWT in the login body; align cookie maxAge to 12h token TTL"
```

---

### Task 3: Server-side change-password validation (DTO + new≠current)

**Files:**
- Create: `backend/src/auth/dto.ts`
- Modify: `backend/src/auth/auth.controller.ts` (changePassword signature + guard)
- Test: `backend/src/auth/change-password.dto.spec.ts`

**Interfaces:**
- Produces: `ChangePasswordDto { currentPassword: string; newPassword: string }`.

- [ ] **Step 1: Write the failing DTO validation test**

```ts
// backend/src/auth/change-password.dto.spec.ts
import { describe, it, expect } from 'vitest'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { ChangePasswordDto } from './dto'

const errors = (obj: unknown) => validateSync(plainToInstance(ChangePasswordDto, obj))

describe('ChangePasswordDto', () => {
  it('accepts an 8+ char new password', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'abcd1234' })).toHaveLength(0)
  })
  it('rejects a new password shorter than 8', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'short' }).length).toBeGreaterThan(0)
  })
  it('rejects a missing current password', () => {
    expect(errors({ newPassword: 'abcd1234' }).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/auth/change-password.dto.spec.ts`
Expected: FAIL — cannot find `./dto`.

- [ ] **Step 3: Create the DTO**

```ts
// backend/src/auth/dto.ts
import { IsString, MinLength } from 'class-validator'
import { PASSWORD_MIN_LENGTH } from './auth.constants'

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword!: string
}
```

- [ ] **Step 4: Wire the DTO + new≠current into the controller**

In `backend/src/auth/auth.controller.ts`, change `changePassword` to use the DTO and reject an unchanged password. Replace the method body signature:
```ts
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body() body: ChangePasswordDto,
  ) {
    if (body.newPassword === body.currentPassword) {
      throw new BadRequestException('new password must be different from the current password')
    }
    const ok = await this.auth.changePassword(user.id, body.currentPassword, body.newPassword)
    if (!ok) throw new UnauthorizedException('current password is incorrect')
    return { success: true }
  }
```
Add imports: `BadRequestException` to the `@nestjs/common` import list, and `import { ChangePasswordDto } from './dto'`.

- [ ] **Step 5: Run DTO test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/auth/change-password.dto.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/dto.ts backend/src/auth/change-password.dto.spec.ts backend/src/auth/auth.controller.ts
git commit -m "feat(auth): enforce change-password server-side (DTO min-8 + new != current)"
```

---

### Task 4: `MustResetGuard` — enforce forced reset server-side

**Files:**
- Create: `backend/src/auth/must-reset.guard.ts`
- Modify: `backend/src/auth/decorators.ts` (add `@AllowDuringMustReset`), `backend/src/auth/auth.controller.ts` (annotate `me` + `changePassword`), `backend/src/auth/auth.module.ts` (register guard)
- Test: `backend/src/auth/must-reset.guard.spec.ts`

**Interfaces:**
- Consumes: `IS_PUBLIC_KEY` (existing).
- Produces: `ALLOW_DURING_MUST_RESET_KEY`, `AllowDuringMustReset()`, `MustResetGuard`.

- [ ] **Step 1: Write the failing guard test**

```ts
// backend/src/auth/must-reset.guard.spec.ts
import { describe, it, expect } from 'vitest'
import { Reflector } from '@nestjs/core'
import { MustResetGuard } from './must-reset.guard'

const ctx = (user: unknown) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => ({}),
  getClass: () => ({}),
}) as any

const guardWith = (meta: Record<string, boolean>) => {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector
  return new MustResetGuard(reflector)
}

describe('MustResetGuard', () => {
  it('blocks a must-reset user on a normal route', () => {
    const guard = guardWith({})
    expect(() => guard.canActivate(ctx({ id: 'u1', mustReset: true }))).toThrow(/MUST_RESET|reset/i)
  })
  it('allows a must-reset user on an @AllowDuringMustReset route', () => {
    const guard = guardWith({ allowDuringMustReset: true })
    expect(guard.canActivate(ctx({ id: 'u1', mustReset: true }))).toBe(true)
  })
  it('allows a normal user', () => {
    const guard = guardWith({})
    expect(guard.canActivate(ctx({ id: 'u1', mustReset: false }))).toBe(true)
  })
  it('allows @Public routes (no user)', () => {
    const guard = guardWith({ isPublic: true })
    expect(guard.canActivate(ctx(undefined))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/auth/must-reset.guard.spec.ts`
Expected: FAIL — cannot find `./must-reset.guard`.

- [ ] **Step 3: Add the decorator**

Append to `backend/src/auth/decorators.ts`:
```ts
export const ALLOW_DURING_MUST_RESET_KEY = 'allowDuringMustReset'
/** Permit this route even when the authenticated user still has mustReset=true. */
export const AllowDuringMustReset = () => SetMetadata(ALLOW_DURING_MUST_RESET_KEY, true)
```

- [ ] **Step 4: Implement the guard**

```ts
// backend/src/auth/must-reset.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY, ALLOW_DURING_MUST_RESET_KEY } from './decorators'

/**
 * Blocks every route for a user whose password reset is still pending, except @Public routes
 * and those marked @AllowDuringMustReset (/auth/me, /auth/change-password). Runs after JwtAuthGuard.
 */
@Injectable()
export class MustResetGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
    if (isPublic) return true
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_MUST_RESET_KEY, [context.getHandler(), context.getClass()])
    if (allowed) return true
    const { user } = context.switchToHttp().getRequest()
    if (user?.mustReset) {
      throw new ForbiddenException({ code: 'MUST_RESET', message: 'password reset required' })
    }
    return true
  }
}
```

- [ ] **Step 5: Annotate the allow-listed routes + register the guard**

In `backend/src/auth/auth.controller.ts`, add `@AllowDuringMustReset()` above `me()` and above `changePassword()`, and import it:
```ts
import { Public, CurrentUser, AllowDuringMustReset } from './decorators'
```
```ts
  @AllowDuringMustReset()
  @Get('me')
  me(@CurrentUser() user: SessionUser) { /* unchanged */ }
```
```ts
  @AllowDuringMustReset()
  @Post('change-password')
  async changePassword(/* unchanged */) { /* unchanged */ }
```

In `backend/src/auth/auth.module.ts`, insert the guard between the two existing `APP_GUARD` providers (lines 24-25):
```ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustResetGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
```
and import it: `import { MustResetGuard } from './must-reset.guard'`.

- [ ] **Step 6: Run guard test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/auth/must-reset.guard.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth/must-reset.guard.ts backend/src/auth/must-reset.guard.spec.ts backend/src/auth/decorators.ts backend/src/auth/auth.controller.ts backend/src/auth/auth.module.ts
git commit -m "feat(auth): enforce mustReset server-side via MustResetGuard (+ @AllowDuringMustReset allowlist)"
```

---

### Task 5: Rate-limit the login route (`@nestjs/throttler`) + trust proxy

**Files:**
- Modify: `backend/package.json` (add dep), `backend/src/app.module.ts` (ThrottlerModule + guard), `backend/src/auth/auth.controller.ts` (`@Throttle` on login), `backend/src/main.ts` (trust proxy)
- Test: `backend/src/auth/login-throttle.spec.ts`

- [ ] **Step 1: Add the dependency**

Edit `backend/package.json` dependencies, add:
```json
    "@nestjs/throttler": "^6.4.0",
```
Then from the repo root:
```bash
CI=true pnpm install
```
Expected: lockfile updates, `@nestjs/throttler` resolved.

- [ ] **Step 2: Write the failing test (login route carries a strict throttle)**

```ts
// backend/src/auth/login-throttle.spec.ts
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { AuthController } from './auth.controller'

// Version-robust: assert @Throttle put *some* throttler-namespaced metadata on login,
// without depending on the library's exact exported metadata-key constant.
describe('login rate limiting', () => {
  it('POST /auth/login carries throttler metadata', () => {
    const keys = Reflect.getMetadataKeys(AuthController.prototype, 'login')
    expect(keys.some((k) => String(k).toLowerCase().includes('throttler'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/auth/login-throttle.spec.ts`
Expected: FAIL — throttle metadata undefined.

- [ ] **Step 4: Register throttling and annotate login**

In `backend/src/app.module.ts` add the import and module, plus a global guard provider:
```ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
```
Add to `imports` (near the top, after ConfigModule):
```ts
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
```
Add a `providers` array to the `@Module({...})` (app.module currently has none):
```ts
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
```

In `backend/src/auth/auth.controller.ts`, annotate `login` with a strict limit and import `Throttle`:
```ts
import { Throttle } from '@nestjs/throttler'
```
```ts
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('login')
  async login(/* unchanged */) { /* unchanged */ }
```

In `backend/src/main.ts`, after `app.setGlobalPrefix('api')` add:
```ts
  app.set('trust proxy', 1) // correct client IP behind the reverse proxy (throttler + secure cookies)
```

- [ ] **Step 5: Run test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/auth/login-throttle.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/app.module.ts backend/src/auth/auth.controller.ts backend/src/main.ts
git commit -m "feat(auth): rate-limit POST /auth/login (10/min/IP) via @nestjs/throttler + trust proxy"
```
(Run git steps from the repo root, where `pnpm-lock.yaml` lives.)

---

### Task 6: CORS allow-list + `helmet`

**Files:**
- Modify: `backend/package.json` (add `helmet`), `backend/src/main.ts:19-21`
- Test: `backend/src/main.cors.spec.ts`

**Interfaces:**
- Produces: `resolveCorsOrigins(raw?: string): string[]` (exported from `main.ts`).

- [ ] **Step 1: Add the dependency**

Edit `backend/package.json` dependencies, add:
```json
    "helmet": "^8.0.0",
```
Then from repo root: `CI=true pnpm install`.

- [ ] **Step 2: Write the failing CORS-origins test**

```ts
// backend/src/main.cors.spec.ts
import { describe, it, expect } from 'vitest'
import { resolveCorsOrigins } from './main'

describe('resolveCorsOrigins', () => {
  it('defaults to localhost dev origins + the prod URL', () => {
    const o = resolveCorsOrigins(undefined)
    expect(o).toContain('https://StatusTrackAgent.Cobaltknitwear.com')
    expect(o).toContain('http://localhost:5173')
  })
  it('parses and trims a comma-separated CORS_ORIGINS', () => {
    expect(resolveCorsOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com'])
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/main.cors.spec.ts`
Expected: FAIL — `resolveCorsOrigins` is not exported.

- [ ] **Step 4: Implement in `main.ts`**

Add `import helmet from 'helmet'` at the top. Add the exported helper above `bootstrap()`:
```ts
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://StatusTrackAgent.Cobaltknitwear.com',
]
export function resolveCorsOrigins(raw?: string): string[] {
  if (!raw) return DEFAULT_ORIGINS
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}
```
Replace the CORS line (21) and add helmet just before it:
```ts
  app.use(helmet({ contentSecurityPolicy: false })) // security headers; CSP tuning deferred (would block the served SPA)
  app.enableCors({ origin: resolveCorsOrigins(process.env.CORS_ORIGINS), credentials: true })
```

- [ ] **Step 5: Run test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/main.cors.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/main.ts backend/src/main.cors.spec.ts
git commit -m "feat(security): pin CORS to an allow-list + add helmet headers"
```

---

### Task 7: Seed hardening + unified 8-char user DTO policy + refresh_tokens note

**Files:**
- Modify: `backend/src/db/seed-auth-users.ts:5-9`, `backend/src/users/dto.ts:17,31`, `backend/src/db/schema/tracking.ts:117`
- Test: `backend/src/users/dto.spec.ts`

- [ ] **Step 1: Write the failing user-DTO policy test**

```ts
// backend/src/users/dto.spec.ts
import { describe, it, expect } from 'vitest'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CreateUserDto } from './dto'

const errs = (o: unknown) => validateSync(plainToInstance(CreateUserDto, o))

describe('CreateUserDto password policy', () => {
  const base = { email: 'a@b.com', name: 'A', role: 'VIEWER' }
  it('accepts an 8-char password', () => {
    expect(errs({ ...base, password: 'abcd1234' })).toHaveLength(0)
  })
  it('rejects a 4-char password', () => {
    expect(errs({ ...base, password: 'abcd' }).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run src/users/dto.spec.ts`
Expected: FAIL — `abcd` currently passes (`MinLength(4)`).

- [ ] **Step 3: Raise the policy to 8**

In `backend/src/users/dto.ts` add `import { PASSWORD_MIN_LENGTH } from '../auth/auth.constants'` and change both `@MinLength(4)` (lines 17 and 31) to:
```ts
  @MinLength(PASSWORD_MIN_LENGTH)
```

- [ ] **Step 4: Harden the seed + annotate refresh_tokens**

In `backend/src/db/seed-auth-users.ts` replace lines 5-9:
```ts
/** Seed passwords are dev placeholders; in production they MUST come from env (fail otherwise). */
function seedPassword(envVar: string, devFallback: string): string {
  const v = process.env[envVar]
  if (v) return v
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envVar} must be set when seeding auth users in production`)
  }
  return devFallback
}
/** Placeholder password for the 2 human admins (override via SEED_INITIAL_PASSWORD); paired with mustReset. */
const INITIAL_PASSWORD = seedPassword('SEED_INITIAL_PASSWORD', 'cobalt-change-me')
/** Agent VM service-account password — must match the queue's TRACKING_AGENT_PASSWORD. */
const AGENT_PASSWORD = seedPassword('TRACKING_AGENT_PASSWORD', 'cobalt')
```

In `backend/src/db/schema/tracking.ts`, add a comment line directly above `export const refreshTokens` (line 117):
```ts
// RESERVED for future refresh-token rotation (auth model C). Not read/written today — see
// docs/superpowers/specs/2026-07-07-jwt-auth-user-crud-design.md. Kept to avoid a destructive migration.
```

- [ ] **Step 5: Run test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run src/users/dto.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/seed-auth-users.ts backend/src/users/dto.ts backend/src/users/dto.spec.ts backend/src/db/schema/tracking.ts
git commit -m "feat(auth): require seed passwords in prod, unify 8-char policy, document reserved refresh_tokens"
```

---

## Phase 2 — Users admin backend

### Task 8: Soft-deactivate + guards + forced-reset rules + expose mustReset

**Files:**
- Modify: `backend/src/db/repositories/users.repository.ts` (add `countActiveByRole`, remove hard `remove`), `backend/src/users/users.service.ts` (soft-deactivate, guards, mustReset rules, `safe()`)
- Test: `backend/test/users.service.int.spec.ts`

**Interfaces:**
- Consumes: `UsersRepository`, `hashPassword`.
- Produces: `UsersService.create/update/remove` returning `safe()` shape now incl. `mustReset`; `UsersRepository.countActiveByRole(role): Promise<number>`.

- [ ] **Step 1: Write the failing integration test**

```ts
// backend/test/users.service.int.spec.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import { UsersRepository } from '../src/db/repositories/users.repository'
import { UsersService } from '../src/users/users.service'

let db: TestDB
let svc: UsersService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  svc = new UsersService(new UsersRepository(db))
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seedSuper(email = 'boss@cobalt.hk') {
  const [u] = await db.insert(schema.users).values({
    email, name: 'Boss', passwordHash: 'x', role: 'SUPERADMIN' as never,
  }).returning()
  return u
}

describe('UsersService', () => {
  it('create sets mustReset=true and returns it in the safe shape', async () => {
    const u = await svc.create({ email: 'new@cobalt.hk', name: 'New', role: 'VIEWER', password: 'abcd1234' })
    expect(u.mustReset).toBe(true)
    expect((u as Record<string, unknown>).passwordHash).toBeUndefined()
  })

  it('remove soft-deactivates (row persists, active=false)', async () => {
    const boss = await seedSuper()
    const victim = await svc.create({ email: 'v@cobalt.hk', name: 'V', role: 'VIEWER', password: 'abcd1234' })
    await svc.remove(victim.id, boss.id)
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, victim.id))
    expect(row).toBeDefined()
    expect(row.active).toBe(false)
  })

  it('refuses to deactivate the last active superadmin', async () => {
    const boss = await seedSuper()
    await expect(svc.remove(boss.id, boss.id)).rejects.toThrow() // self-guard
    const other = await seedSuper('other@cobalt.hk')
    await expect(svc.remove(boss.id, other.id)).resolves.toBeDefined() // now 2 supers → ok
    await expect(svc.remove(other.id, boss.id)).rejects.toThrow(/last active superadmin/i) // back to 1
  })

  it('admin-set password forces mustReset again', async () => {
    const boss = await seedSuper()
    const u = await svc.create({ email: 'p@cobalt.hk', name: 'P', role: 'VIEWER', password: 'abcd1234' })
    // simulate the user having reset already:
    await new UsersRepository(db).update(u.id, { mustReset: false })
    const updated = await svc.update(u.id, { password: 'newpass12' }, boss.role)
    expect(updated.mustReset).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && node_modules/.bin/vitest run test/users.service.int.spec.ts`
Expected: FAIL — `create` doesn't set mustReset; `remove` hard-deletes; no last-superadmin guard.

- [ ] **Step 3: Add repository helpers**

In `backend/src/db/repositories/users.repository.ts` change the drizzle import to `import { and, eq } from 'drizzle-orm'`, delete the hard-delete `remove()` method (lines 34-37), and add:
```ts
  async countActiveByRole(role: string) {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, role), eq(schema.users.active, true)))
    return rows.length
  }
```

- [ ] **Step 4: Rewrite the service (soft-delete, guards, mustReset, safe)**

In `backend/src/users/users.service.ts`:

Add `mustReset` to `safe()` — change its param type and return:
```ts
const safe = (u: {
  id: string; email: string; name: string; role: string; active: boolean
  avatarInitials: string | null; mustReset: boolean; createdAt: Date
}) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatarInitials: u.avatarInitials, mustReset: u.mustReset, createdAt: u.createdAt })
```

In `create()`, add `mustReset: true` to the `repo.create({...})` call.

In `update()`, after the existing role guards, add the last-superadmin protection and the admin-password rule:
```ts
    const deactivating = dto.active === false
    const demoting = dto.role !== undefined && dto.role !== 'SUPERADMIN'
    if (target.role === 'SUPERADMIN' && (deactivating || demoting)) {
      await this.assertNotLastSuperadmin()
    }
```
and in the patch-building block:
```ts
    if (dto.password) {
      patch.passwordHash = await hashPassword(dto.password)
      patch.mustReset = true // any admin-set password is temporary
    }
```

Replace `remove()` with a soft-deactivate:
```ts
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
```

- [ ] **Step 5: Run test + typecheck (PASS)**

Run: `cd backend && node_modules/.bin/vitest run test/users.service.int.spec.ts && node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/repositories/users.repository.ts backend/src/users/users.service.ts backend/test/users.service.int.spec.ts
git commit -m "feat(users): soft-deactivate + last-superadmin/self guards + forced-reset rules + expose mustReset"
```

---

## Phase 3 — Frontend cookie-only auth

### Task 9: Remove the localStorage token; guard JSON.parse; cookie-only auth

**Files:**
- Modify: `frontend/src/lib/api.ts:12-37,43-62`, `frontend/src/hooks/use-auth.tsx`, `frontend/src/store.ts:18-30`, `frontend/src/pages/ChangePasswordPage.tsx:16-36`
- Test: `frontend/src/hooks/use-auth.test.tsx`

- [ ] **Step 1: Write the failing test (login stores no token)**

```tsx
// frontend/src/hooks/use-auth.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './use-auth'

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'e@x.com', name: 'E', role: 'ADMIN', mustReset: false } }),
    post: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
  },
}))

function Harness() {
  const { user, login } = useAuth()
  return (
    <div>
      <button onClick={() => void login('e@x.com', 'pw')}>login</button>
      <span data-testid="who">{user?.email ?? 'anon'}</span>
    </div>
  )
}

describe('useAuth (cookie-only)', () => {
  beforeEach(() => localStorage.clear())
  it('logs in without writing any token to localStorage', async () => {
    render(<AuthProvider><Harness /></AuthProvider>)
    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('e@x.com'))
    expect(localStorage.getItem('cobalt_token')).toBeNull()
    expect(Object.keys(localStorage)).not.toContain('cobalt_token')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-auth.test.tsx`
Expected: FAIL — current `login` writes `cobalt_token`.

- [ ] **Step 3: Strip the token from `use-auth.tsx`**

In `frontend/src/hooks/use-auth.tsx`: delete `const TOKEN_KEY = 'cobalt_token'` (line 22). In the mount `useEffect`, replace the `.catch` body (lines 59-66) with just:
```ts
      .catch(() => setUser(null))
```
Replace `login` (lines 70-79) with:
```ts
  const login = useCallback(async (email: string, password: string) => {
    await api.post('/auth/login', { email, password })
    const me = await api.get<{ user: User }>('/auth/me')
    setUser(normalize(me.user))
  }, [])
```
Replace `logout` (lines 87-95) with:
```ts
  const logout = useCallback(() => {
    api.post('/auth/logout', {}).catch(() => {})
    setUser(null)
  }, [])
```

- [ ] **Step 4: Strip the token from `api.ts` + guard JSON.parse**

In `frontend/src/lib/api.ts`, replace `request()` (lines 12-37) with:
```ts
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', // httpOnly session cookie
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const error = await res.text()
    throw new Error(`API error ${res.status}: ${error}`)
  }
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`API error ${res.status}: response was not valid JSON`)
  }
}
```
In `downloadAttachment()` (lines 43-62), remove the `token` read and the `Authorization` header — keep `credentials: 'include'`:
```ts
export async function downloadAttachment(attachmentId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/emails/attachments/${encodeURIComponent(attachmentId)}/download`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 5: Guard `store.ts` localStorage + tighten ChangePasswordPage**

In `frontend/src/store.ts` replace `getInitialTheme` and `applyTheme` (lines 18-30):
```ts
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem('shiptrack-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* storage blocked (private mode) — fall through */ }
  return 'dark'
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('shiptrack-theme', theme)
  } catch { /* storage blocked — DOM attribute still applied */ }
}
```

In `frontend/src/pages/ChangePasswordPage.tsx`, add a new≠current check inside `submit`, right after the `newPassword.length < 8` block (after line 22):
```ts
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password')
      return
    }
```

> **On the spec's "defensive 403 `MUST_RESET`" note:** no extra client interceptor is added. The primary path already covers it — on load `AuthProvider` calls the allow-listed `GET /auth/me`, and `authGate` returns `'reset'` for `user.mustReset`, redirecting to `/change-password`; the new server `MustResetGuard` is the hard enforcement. An api-client redirect-on-403 was intentionally skipped (loop-prone on `/change-password` itself).

- [ ] **Step 6: Run tests (PASS) + typecheck**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-auth.test.tsx`
Expected: PASS.
Run: `cd frontend && node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-auth.tsx frontend/src/store.ts frontend/src/pages/ChangePasswordPage.tsx frontend/src/hooks/use-auth.test.tsx
git commit -m "feat(auth-ui): cookie-only auth — drop localStorage token, guard JSON.parse + theme storage"
```

---

### Task 10: Guardrail — frontend never touches the DB or holds a secret

**Files:**
- Create: `frontend/src/test/no-db-access.test.ts`

- [ ] **Step 1: Write the guardrail test**

```ts
// frontend/src/test/no-db-access.test.ts
import { describe, it, expect } from 'vitest'

// Read every frontend source file as a raw string at build time.
const modules = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'pg driver import', re: /from\s+['"]pg['"]/ },
  { label: 'drizzle-orm import', re: /from\s+['"]drizzle-orm['"]/ },
  { label: 'postgres connection string', re: /postgres(?:ql)?:\/\// },
  { label: 'DATABASE_URL reference', re: /\bDATABASE_URL\b/ },
  { label: 'non-VITE env secret', re: /import\.meta\.env\.(?!DEV\b|PROD\b|MODE\b|BASE_URL\b|SSR\b|VITE_)[A-Za-z_]+/ },
]

describe('frontend never accesses the database or holds secrets', () => {
  const entries = Object.entries(modules).filter(([p]) => !p.includes('no-db-access.test'))
  it('scans at least the whole src tree', () => expect(entries.length).toBeGreaterThan(20))
  for (const [path, source] of entries) {
    it(`${path} has no DB access or secret reference`, () => {
      for (const { label, re } of FORBIDDEN) {
        expect(source, `${path} must not contain ${label}`).not.toMatch(re)
      }
    })
  }
})
```

- [ ] **Step 2: Run it and confirm it PASSES on the current tree**

Run: `cd frontend && node_modules/.bin/vitest run src/test/no-db-access.test.ts`
Expected: PASS (this is a guardrail, green today; it will FAIL only if someone later leaks DB access). Note: this runs after Task 9 removed the last secret handling, and before/independent of the Outlook deletion.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/no-db-access.test.ts
git commit -m "test(security): guardrail — frontend holds no DB driver, connection string, or non-VITE secret"
```

---

## Phase 4 — Remove the Outlook-365 wiring page

### Task 11: Frontend removal (Settings panel, hook, route)

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx` (imports, `EmailIntegrationSettings`, sub-nav, switch, copy), `frontend/src/App.tsx:134`
- Delete: `frontend/src/hooks/use-email-integrations.ts`

- [ ] **Step 1: Delete the panel component + its imports**

In `frontend/src/pages/SettingsPage.tsx`:
- Delete the entire `import { useEmailIntegration, useSaveEmailIntegration, useTestEmailConnection, useSyncEmails } from '../hooks/use-email-integrations'` block (lines 10-15).
- Change the lucide import (line 16) to keep only what other panels use: `import { Factory } from 'lucide-react'` (drop `RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Zap`).
- Delete the whole `function EmailIntegrationSettings() { ... }` (lines 322 through the line immediately before `export default function SettingsPage()` at 669).

- [ ] **Step 2: Remove the panel from the shell + reword copy**

In the `SettingsPage()` shell:
- Delete `const isEmailSettings = location.pathname.includes('/settings/email')` (line 673).
- Delete the sub-nav item `{ to: '/settings/email', label: 'Email Integration', end: false },` (line 681).
- In the content switch, delete the leading branch so it starts at Alert Rules:
```tsx
        {isAlertsSettings ? (
          <AlertRulesSettings />
        ) : isVendorsSettings ? (
          <VendorsSettings />
        ) : (
```
- Reword the General placeholder (lines 714-717):
```tsx
            <p className="mt-2 text-sm text-text-secondary">
              Manage alert rules, vendors, and users from the tabs on the left. Email ingestion is
              configured on the server (GRAPH_* environment variables), not in the app.
            </p>
```

- [ ] **Step 3: Remove the route + delete the hook**

In `frontend/src/App.tsx` delete line 134:
```tsx
        <Route path="/settings/email" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
```
Delete the hook file:
```bash
git rm frontend/src/hooks/use-email-integrations.ts
```

- [ ] **Step 4: Verify no dangling references + typecheck + tests**

Run:
```bash
cd frontend && grep -rn "EmailIntegration\|email-integrations\|use-email-integrations" src ; echo "hits: $?"
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run src/pages/SettingsPage.vendors.test.tsx
```
Expected: grep prints nothing (exit 1 = no matches), tsc clean (no unused-import errors), the existing SettingsPage vendors test still PASSES.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/App.tsx frontend/src/hooks/use-email-integrations.ts
git commit -m "refactor(settings): remove the dead Outlook-365 email-integration page (config lives in env)"
```

---

### Task 12: Backend removal (controller, module wiring, service stubs)

**Files:**
- Modify: `backend/src/presentation/presentation.module.ts:11,29`, `backend/src/presentation/ui.controllers.ts:118-134`, `backend/src/presentation/presentation.service.ts:582-624`

- [ ] **Step 1: Remove the controller + its module registration**

In `backend/src/presentation/ui.controllers.ts` delete the entire `@Controller('email-integrations') export class UiEmailIntegrationController { ... }` (lines 118-134). Then remove any import that is now unused (e.g. `Put`, and `Roles` if no other controller in the file uses it — `tsc` will flag it).

In `backend/src/presentation/presentation.module.ts` remove `UiEmailIntegrationController` from the import statement (line 11) and from the `controllers: [...]` array (line 29).

- [ ] **Step 2: Remove the service stub methods**

In `backend/src/presentation/presentation.service.ts` delete the four methods and their header comment (lines 582-624): `emailIntegration()`, `emailIntegrationSave()`, `emailIntegrationTest()`, `emailIntegrationSync()`. Leave `emailMarkRead` (above) and the masters section (below) intact.

- [ ] **Step 3: Verify, typecheck, and run the presentation tests**

Run:
```bash
cd backend && grep -rn "emailIntegration\|email-integrations\|UiEmailIntegrationController" src ; echo "done"
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vitest run src/presentation
```
Expected: grep prints nothing, tsc clean, presentation specs PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/presentation/ui.controllers.ts backend/src/presentation/presentation.module.ts backend/src/presentation/presentation.service.ts
git commit -m "refactor(api): remove the /email-integrations stub endpoints (Graph creds live in env)"
```

---

## Phase 5 — Users admin frontend

### Task 13: `use-users` data hooks

**Files:**
- Create: `frontend/src/hooks/use-users.ts`
- Test: `frontend/src/hooks/use-users.test.tsx`

**Interfaces:**
- Produces: `AdminUser`, `CreateUserInput`, `UpdateUserInput`; `useUsers`, `useCreateUser`, `useUpdateUser`, `useDeactivateUser`.

- [ ] **Step 1: Write the failing hook test**

```tsx
// frontend/src/hooks/use-users.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUsers } from './use-users'

vi.mock('../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.com', name: 'A', role: 'VIEWER', active: true, mustReset: true, avatarInitials: 'A', createdAt: '' }]) },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useUsers', () => {
  it('fetches the users list from GET /users', async () => {
    const { result } = renderHook(() => useUsers(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data![0].email).toBe('a@b.com')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-users.test.tsx`
Expected: FAIL — cannot find `./use-users`.

- [ ] **Step 3: Implement the hooks**

```ts
// frontend/src/hooks/use-users.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  mustReset: boolean
  avatarInitials: string | null
  createdAt: string
}
export interface CreateUserInput { email: string; name: string; role: string; password: string }
export interface UpdateUserInput { name?: string; role?: string; active?: boolean; password?: string }

const KEY = ['users'] as const

export function useUsers() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AdminUser[]>('/users') })
}
export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<AdminUser>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserInput }) => api.patch<AdminUser>(`/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<AdminUser>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
```

- [ ] **Step 4: Run test (PASS)**

Run: `cd frontend && node_modules/.bin/vitest run src/hooks/use-users.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-users.ts frontend/src/hooks/use-users.test.tsx
git commit -m "feat(users-ui): add use-users data hooks (list/create/update/deactivate)"
```

---

### Task 14: `UsersPanel` + wire into Settings + route

**Files:**
- Create: `frontend/src/pages/UsersPage.tsx` (exports `UsersPanel`)
- Modify: `frontend/src/pages/SettingsPage.tsx` (import + `isUsersSettings` + sub-nav + switch), `frontend/src/App.tsx` (route)
- Test: `frontend/src/pages/UsersPage.test.tsx`

**Interfaces:**
- Consumes: `useUsers`, `useCreateUser`, `useUpdateUser`, `useDeactivateUser`, `AdminUser`.

- [ ] **Step 1: Write the failing panel test**

```tsx
// frontend/src/pages/UsersPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsersPanel } from './UsersPage'

vi.mock('../hooks/use-users', () => ({
  useUsers: () => ({
    data: [
      { id: 'u1', email: 'sue@cobalt.hk', name: 'Sue Super', role: 'SUPERADMIN', active: true, mustReset: false, avatarInitials: 'SS', createdAt: '' },
      { id: 'u2', email: 'newbie@cobalt.hk', name: 'Newbie', role: 'VIEWER', active: true, mustReset: true, avatarInitials: 'NB', createdAt: '' },
    ],
    isLoading: false,
    isError: false,
  }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('UsersPanel', () => {
  it('lists users and flags the one pending first login', () => {
    render(<UsersPanel />)
    expect(screen.getByText('sue@cobalt.hk')).toBeInTheDocument()
    expect(screen.getByText('newbie@cobalt.hk')).toBeInTheDocument()
    expect(screen.getByText(/must reset/i)).toBeInTheDocument()
  })
  it('shows an Add User control', () => {
    render(<UsersPanel />)
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd frontend && node_modules/.bin/vitest run src/pages/UsersPage.test.tsx`
Expected: FAIL — cannot find `./UsersPage`.

- [ ] **Step 3: Implement `UsersPanel`**

```tsx
// frontend/src/pages/UsersPage.tsx
import { useState, type FormEvent } from 'react'
import { Card } from '../components/ui/Card'
import { cn } from '../lib/utils'
import { UserPlus, KeyRound, Ban, RotateCcw } from 'lucide-react'
import {
  useUsers, useCreateUser, useUpdateUser, useDeactivateUser,
  type AdminUser, type CreateUserInput,
} from '../hooks/use-users'

const ROLES = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN']
const ROLE_LABEL: Record<string, string> = { VIEWER: 'Coordinator', EDITOR: 'Manager', ADMIN: 'Admin', SUPERADMIN: 'Superadmin' }

export function UsersPanel() {
  const { data: users, isLoading, isError } = useUsers()
  const create = useCreateUser()
  const update = useUpdateUser()
  const deactivate = useDeactivateUser()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Users</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <UserPlus size={14} /> Add User
        </button>
      </div>

      {isLoading && <p className="text-sm text-text-muted">Loading users…</p>}
      {isError && <p className="text-sm text-status-critical">Failed to load users. Try again.</p>}

      {users && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-text-primary">{u.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value } })}
                      className="rounded-md border border-border bg-surface-700 px-2 py-1 text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                      u.active ? 'bg-state-sailed/15 text-state-sailed' : 'bg-surface-600 text-text-muted')}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                    {u.mustReset && (
                      <span className="ml-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-medium text-status-warning">
                        Must reset
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Reset password"
                        onClick={() => {
                          const pw = window.prompt(`Temporary password for ${u.email} (min 8 chars):`)
                          if (pw) update.mutate({ id: u.id, patch: { password: pw } })
                        }}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
                      ><KeyRound size={15} /></button>
                      {u.active ? (
                        <button
                          title="Deactivate"
                          onClick={() => { if (window.confirm(`Deactivate ${u.email}?`)) deactivate.mutate(u.id) }}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-status-critical"
                        ><Ban size={15} /></button>
                      ) : (
                        <button
                          title="Reactivate"
                          onClick={() => update.mutate({ id: u.id, patch: { active: true } })}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-state-sailed"
                        ><RotateCcw size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <CreateUserModal
          pending={create.isPending}
          onClose={() => setShowCreate(false)}
          onSubmit={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
        />
      )}
    </div>
  )
}

function CreateUserModal(props: { pending: boolean; onClose: () => void; onSubmit: (input: CreateUserInput) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('VIEWER')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Temporary password must be at least 8 characters'); return }
    props.onSubmit({ email: email.trim().toLowerCase(), name: name.trim(), role, password })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Add user"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface-900 p-5">
        <h3 className="text-sm font-semibold text-text-primary">Add User</h3>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <input required type="text" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Temporary password (min 8, user resets on first login)"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        {error && <p className="text-xs text-status-critical">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={props.onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button type="submit" disabled={props.pending}
            className="rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {props.pending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run the panel test (PASS)**

Run: `cd frontend && node_modules/.bin/vitest run src/pages/UsersPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the Settings shell + add the route**

In `frontend/src/pages/SettingsPage.tsx`:
- Add `import { UsersPanel } from './UsersPage'` near the other imports.
- In `SettingsPage()` add `const isUsersSettings = location.pathname.includes('/settings/users')` beside the other flags.
- Add the sub-nav item after Vendors:
```tsx
          { to: '/settings/users', label: 'Users', end: false },
```
- Add the branch at the front of the content switch:
```tsx
        {isUsersSettings ? (
          <UsersPanel />
        ) : isAlertsSettings ? (
```

In `frontend/src/App.tsx`, add beside the other settings routes:
```tsx
        <Route path="/settings/users" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
```

- [ ] **Step 6: Typecheck + full frontend suite**

Run: `cd frontend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run`
Expected: no type errors; all frontend tests PASS (incl. the new users + guardrail tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/UsersPage.tsx frontend/src/pages/UsersPage.test.tsx frontend/src/pages/SettingsPage.tsx frontend/src/App.tsx
git commit -m "feat(users-ui): SUPERADMIN Users admin panel (list/create/role/deactivate/reset) under /settings/users"
```

---

## Final verification (run after all tasks)

- [ ] **Backend:** `cd backend && node_modules/.bin/tsc -p tsconfig.json --noEmit && node_modules/.bin/vitest run` → all green.
- [ ] **Frontend:** `cd frontend && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run` → all green.
- [ ] **Build:** `cd backend && node_modules/.bin/nest build` and `cd frontend && node_modules/.bin/vite build` → both succeed.
- [ ] **Manual smoke (dev):** set `JWT_SECRET` (≥32 chars) in `backend/.env`; start both; confirm: login sets an httpOnly `session` cookie and no `cobalt_token` in localStorage (DevTools → Application); a fresh seeded admin is forced to `/change-password`; a superadmin sees Settings → Users and can create/deactivate/reset; the Inbox and single-email window still open; `/settings/email` 404s within the SPA.
- [ ] **Docs:** update `README`/`.env.example` with `JWT_SECRET`, `SESSION_TTL_HOURS`, `CORS_ORIGINS`, `SEED_INITIAL_PASSWORD`, `TRACKING_AGENT_PASSWORD` (tracked normally; only `docs/` needs `-f`).
