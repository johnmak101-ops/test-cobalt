import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { resolveCorsOrigins } from './config/cors'

async function bootstrap() {
  // bufferLogs so Nest's own startup lines are held until the pino logger is installed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  // Agent→tracking decision payloads bundle every evidence row + conflict for a shipment
  // group; deeply threaded multi-PO shipments (e.g. the merged WYSE MACFUN air bookings)
  // exceed Express's default 100kb JSON limit. Raise it for the decisions/* ingest path.
  app.useBodyParser('json', { limit: '25mb' })
  app.setGlobalPrefix('api')
  // Trust exactly ONE proxy hop — the intranet nginx that terminates TLS on 443 and forwards to the
  // app on :3000. This lets X-Forwarded-Proto drive req.secure (→ the `secure` session cookie) and
  // X-Forwarded-For drive the throttler's client IP. Revisit the hop count if a CDN / second proxy is
  // ever put in front (otherwise both read the wrong hop). See the cobalt-production-url note.
  app.set('trust proxy', 1)
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.use(helmet({ contentSecurityPolicy: false })) // security headers; CSP tuning deferred (would block the served SPA)
  // Credentialed CORS pinned to an allow-list (never `origin:true`, which reflects any site).
  app.enableCors({ origin: resolveCorsOrigins(process.env.CORS_ORIGINS), credentials: true })
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port)
  logger.log(`backend listening on http://localhost:${port}/api`, 'Bootstrap')
}
bootstrap()
