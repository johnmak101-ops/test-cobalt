import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'

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
  app.set('trust proxy', 1) // correct client IP behind the reverse proxy (throttler + secure cookies)
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  // Credentialed CORS so the UI's `credentials:'include'` cookie reaches the API.
  // `origin: true` reflects the request origin (never `*`, which browsers reject with credentials).
  app.enableCors({ origin: true, credentials: true })
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port)
  logger.log(`backend listening on http://localhost:${port}/api`, 'Bootstrap')
}
bootstrap()
