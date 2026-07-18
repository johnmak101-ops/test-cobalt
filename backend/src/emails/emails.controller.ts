import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
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

  /**
   * GET /api/emails/attachments?messageId=… — the email's attachments with inline content
   * (images/PDF as base64, text/csv/html as text) for the standalone email window.
   */
  @Get('attachments') attachments(@Query('messageId') messageId?: string) {
    return this.emails.getAttachments(messageId ?? '')
  }

  /**
   * GET /api/emails/attachments/:id/download — stream ONE attachment's original file
   * (office rawBytes / image / pdf / text-native) with a save-as filename.
   */
  @Get('attachments/:id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.emails.getAttachmentOriginal(id)
    if (!file) {
      // Graph-first: distinguish "no local blob" paths for ops (UI shows message).
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message:
          'Attachment not available: no local copy and Graph re-fetch failed or is not configured. ' +
          'If this was a MIME-only file never handed off at match, re-parse/match the email once. ' +
          'If Graph-sourced, check mailbox access / graph_attachment_id.',
        code: 'ATTACHMENT_UNAVAILABLE',
      })
    }
    res.setHeader('Content-Type', file.mime)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
    res.send(file.body)
  }
}
