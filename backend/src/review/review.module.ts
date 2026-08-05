import { Module } from '@nestjs/common'
import { ReviewController } from './review.controller'
import { ReviewService } from './review.service'
import { QueueLearningClient } from './queue-learning.client'
import { PriorCorrectionService } from './prior-correction.service'

/** All repositories come from the global RepositoriesModule. */
@Module({
  controllers: [ReviewController],
  providers: [ReviewService, QueueLearningClient, PriorCorrectionService],
  // ShipmentsService.editFields (detail-page P3) reuses the same learning client.
  // PriorCorrectionService: ShipmentsService (Order Details) and EmailsModule (review-queue verdict)
  // record the SAME raw-name->code fact through it, so no surface silently learns nothing.
  exports: [QueueLearningClient, PriorCorrectionService],
})
export class ReviewModule {}
