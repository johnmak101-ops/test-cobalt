import { Controller, Get, Query } from '@nestjs/common'
import { PosService } from './pos.service'

/** GET /api/pos[?open=true] — the PO master the Agent VM matches against. */
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get() list(@Query('open') open?: string) {
    return this.pos.list(open === 'true' || open === '1')
  }
}
