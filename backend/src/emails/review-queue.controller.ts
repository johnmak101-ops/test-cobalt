import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common'
import { ReviewQueueService } from './review-queue.service'
import { ReviewEmailDto } from './review-queue.dto'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

/** Email-extraction review queue: list / counts / act. Editors+ work the queue. */
@Roles('EDITOR', 'ADMIN')
@Controller('emails')
export class ReviewQueueController {
  constructor(private readonly reviewQueue: ReviewQueueService) {}

  /** GET /api/emails/review-queue?status=… — emails in one review state (default: pending). */
  @Get('review-queue') queue(@Query('status') status?: string) {
    return this.reviewQueue.queue(status)
  }

  /** GET /api/emails/review-queue/counts — per-status counts for the filter tabs. */
  @Get('review-queue/counts') counts() {
    return this.reviewQueue.counts()
  }

  /** PATCH /api/emails/:id/review — approve / correct / reject a queued extraction. */
  @Patch(':id/review') review(
    @Param('id') id: string,
    @Body() dto: ReviewEmailDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviewQueue.review(id, dto, actor.id)
  }
}
