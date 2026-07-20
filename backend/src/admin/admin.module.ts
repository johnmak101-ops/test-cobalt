import { Module } from '@nestjs/common'
import { MeshMissesController } from './mesh-misses.controller'
import { MeshMissesService } from './mesh-misses.service'

@Module({
  controllers: [MeshMissesController],
  providers: [MeshMissesService],
  exports: [MeshMissesService],
})
export class AdminModule {}
