import { Module } from '@nestjs/common'
import { ReviewController } from './review.controller'
import { ReviewService } from './review.service'
import { QueueLearningClient } from './queue-learning.client'

/** All repositories come from the global RepositoriesModule. */
@Module({
  controllers: [ReviewController],
  providers: [ReviewService, QueueLearningClient],
  // ShipmentsService.editFields (detail-page P3) reuses the same learning client.
  exports: [QueueLearningClient],
})
export class ReviewModule {}
