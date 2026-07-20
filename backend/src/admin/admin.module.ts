import { Module } from '@nestjs/common'
import { MeshMissesController } from './mesh-misses.controller'
import { MeshMissesService } from './mesh-misses.service'
import { MultiBookingBackfillController } from './multi-booking-backfill.controller'
import { MultiBookingBackfillService } from './multi-booking-backfill.service'

@Module({
  controllers: [MeshMissesController, MultiBookingBackfillController],
  providers: [MeshMissesService, MultiBookingBackfillService],
})
export class AdminModule {}
