import { Body, Controller, Post } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { DecisionsService } from './decisions.service'
import { CreateDecisionDto } from './dto'
import { Roles } from '../auth/decorators'

/** Decision ingest — the HTTP seam the Agent VM POSTs scored decisions to (replaces the old
 *  shared-DB pull). The agent authenticates as an EDITOR-tier service account. Exempt from the
 *  global rate limit: the agent posts bulk batches from a single IP and would otherwise stall on 429s. */
@SkipThrottle()
@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Roles('EDITOR', 'ADMIN')
  @Post()
  ingest(@Body() dto: CreateDecisionDto) {
    return this.decisions.ingest(dto)
  }
}
