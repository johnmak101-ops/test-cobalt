import { Controller, Get, Param, Query } from '@nestjs/common'
import { PosService } from './pos.service'

/** GET /api/pos[?open=true] — PO master; GET /api/pos/:id — PO detail + linked shipments. */
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get() list(@Query('open') open?: string) {
    return this.pos.list(open === 'true' || open === '1')
  }

  @Get(':id') detail(@Param('id') id: string) {
    return this.pos.detail(id)
  }
}
