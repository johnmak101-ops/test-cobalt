import { z } from 'zod'

const envSchema = z
  .object({
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    NODE_ENV: z.string().optional(),
    SESSION_TTL_HOURS: z.coerce.number().positive().optional(),
    CORS_ORIGINS: z.string().optional(),
  })
  // ConfigModule.forRoot({ validate }) uses this function's RETURN VALUE as the new process.env —
  // without .passthrough(), safeParse() strips every key not in the schema (e.g. DATABASE_URL),
  // so anything read bare off process.env (drizzle.provider.ts, main.ts) would go missing at boot.
  .passthrough()
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
