import { Global, Module } from '@nestjs/common'
import { DRIZZLE, drizzleProvider } from './drizzle.provider'

/** Global so any module can inject DRIZZLE without re-importing. */
@Global()
@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
