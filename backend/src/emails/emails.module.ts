import { Module } from '@nestjs/common'
import { EmailsController } from './emails.controller'
import { EmailsService } from './emails.service'
import { GraphService } from './graph.service'
import { ReviewQueueController } from './review-queue.controller'
import { ReviewQueueService } from './review-queue.service'

@Module({
  controllers: [EmailsController, ReviewQueueController],
  providers: [EmailsService, GraphService, ReviewQueueService],
})
export class EmailsModule {}
