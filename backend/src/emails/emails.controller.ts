import { Controller, Get, Query } from '@nestjs/common'
import { EmailsService } from './emails.service'

@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  /**
   * GET /api/emails/original?messageId=… — "view original" for a milestone's source email.
   * messageId travels as a query param (Graph ids and `mock:` corpus names contain `/`, spaces, etc.).
   * Authenticated (any role); returns the email or a reason it isn't available.
   */
  @Get('original') original(@Query('messageId') messageId?: string) {
    return this.emails.getOriginal(messageId ?? '')
  }
}
