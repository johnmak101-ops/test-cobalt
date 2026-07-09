import { Global, Module } from '@nestjs/common'
import { KYSELY, kyselyProvider } from './kysely.provider'

/** Global so any module can inject KYSELY without re-importing. */
@Global()
@Module({
  providers: [kyselyProvider],
  exports: [KYSELY],
})
export class KyselyModule {}
