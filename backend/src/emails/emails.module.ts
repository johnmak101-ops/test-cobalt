import { Module } from '@nestjs/common'
import { EmailsController } from './emails.controller'
import { EmailsService } from './emails.service'
import { GraphService } from './graph.service'
import { ReviewQueueController } from './review-queue.controller'
import { ReviewQueueService } from './review-queue.service'
import { ShipmentsModule } from '../shipments/shipments.module'
import { ReviewModule } from '../review/review.module'

@Module({
  imports: [ShipmentsModule, ReviewModule], // ShipmentsService — review-queue apply-back re-applies corrections to the leg
  controllers: [EmailsController, ReviewQueueController],
  providers: [EmailsService, GraphService, ReviewQueueService],
})
export class EmailsModule {}
