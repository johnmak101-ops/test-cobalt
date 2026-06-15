import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  // Agent→tracking decision payloads bundle every evidence row + conflict for a shipment
  // group; deeply threaded multi-PO shipments (e.g. the merged WYSE MACFUN air bookings)
  // exceed Express's default 100kb JSON limit. Raise it for the decisions/* ingest path.
  app.useBodyParser('json', { limit: '25mb' })
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.enableCors()
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`backend listening on http://localhost:${port}/api`)
}
bootstrap()
