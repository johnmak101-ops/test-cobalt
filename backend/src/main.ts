import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { PinoLoggerService } from './logging/pino-logger.service'

async function bootstrap() {
  const logger = new PinoLoggerService()
  // bufferLogs so Nest's own startup lines are held until our structured logger is installed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  app.useLogger(logger)
  // Agent→tracking decision payloads bundle every evidence row + conflict for a shipment
  // group; deeply threaded multi-PO shipments (e.g. the merged WYSE MACFUN air bookings)
  // exceed Express's default 100kb JSON limit. Raise it for the decisions/* ingest path.
  app.useBodyParser('json', { limit: '25mb' })
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  // Credentialed CORS so the UI's `credentials:'include'` cookie reaches the API.
  // `origin: true` reflects the request origin (never `*`, which browsers reject with credentials).
  app.enableCors({ origin: true, credentials: true })
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port)
  logger.log(`backend listening on http://localhost:${port}/api`, 'Bootstrap')
}
bootstrap()
