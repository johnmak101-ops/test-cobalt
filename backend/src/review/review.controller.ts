import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ReviewService } from './review.service'
import { ConfirmDto, CorrectDto, DismissDto } from './dto'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

/** Human review of provisional (low-confidence) shipments. Editors+ work the queue. */
@Roles('EDITOR', 'ADMIN')
@Controller('review')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get() queue() {
    return this.review.queue()
  }

  /** POST /api/review/dismiss — bulk "not a shipment" verdict from the queue. */
  @Post('dismiss') dismiss(@Body() dto: DismissDto, @CurrentUser() actor: AuthUser) {
    return this.review.dismiss(dto.shipmentIds, actor.id, dto.note)
  }

  /** POST /api/review/:id/restore — undo a dismiss; the leg returns to the pending queue. */
  @Post(':id/restore') restore(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.review.restore(id, actor.id)
  }

  @Post(':id/confirm') confirm(@Param('id') id: string, @Body() dto: ConfirmDto, @CurrentUser() actor: AuthUser) {
    return this.review.confirm(id, actor.id, dto?.note, dto?.expectedUpdatedAt)
  }

  @Post(':id/correct') correct(@Param('id') id: string, @Body() dto: CorrectDto, @CurrentUser() actor: AuthUser) {
    return this.review.correct(id, dto, actor.id)
  }
}
