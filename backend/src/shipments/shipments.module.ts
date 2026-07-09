import { Module } from '@nestjs/common'
import { ShipmentsController } from './shipments.controller'
import { ShipmentsService } from './shipments.service'
import { CommitterService } from '../reconcile/committer.service'

@Module({
  controllers: [ShipmentsController],
  providers: [ShipmentsService, CommitterService],
  exports: [ShipmentsService], // consumed by EmailsModule's review-queue apply-back
})
export class ShipmentsModule {}
