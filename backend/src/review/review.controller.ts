import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ReviewService } from './review.service'
import { ConfirmDto, CorrectDto } from './dto'
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

  @Post(':id/confirm') confirm(@Param('id') id: string, @Body() dto: ConfirmDto, @CurrentUser() actor: AuthUser) {
    return this.review.confirm(id, actor.id, dto?.note)
  }

  @Post(':id/correct') correct(@Param('id') id: string, @Body() dto: CorrectDto, @CurrentUser() actor: AuthUser) {
    return this.review.correct(id, dto, actor.id)
  }
}
