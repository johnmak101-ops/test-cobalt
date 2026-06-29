import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common'
import { PurchaseOrdersService, type CreatePoInput } from './purchase-orders.service'
import { CurrentUser, Roles } from '../auth/decorators'

type Actor = { id: string }

/**
 * PO write surface (app-owned). Coexists with the read-only UiPosController on /purchase-orders —
 * disjoint by HTTP verb. EDITOR/ADMIN only.
 */
@Controller('purchase-orders')
export class PurchaseOrdersWriteController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  @Roles('EDITOR', 'ADMIN')
  @Post() create(@Body() body: CreatePoInput, @CurrentUser() user: Actor) {
    return this.svc.create(body, user.id)
  }

  @Roles('EDITOR', 'ADMIN')
  @Patch(':id') update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Actor) {
    return this.svc.update(id, body, user.id)
  }

  @Roles('EDITOR', 'ADMIN')
  @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.remove(id, user.id)
  }

  @Roles('EDITOR', 'ADMIN')
  @Post(':poId/link-shipment') link(
    @Param('poId') poId: string,
    @Body() body: { shipmentId: string; quantity?: number },
    @CurrentUser() user: Actor,
  ) {
    return this.svc.link(poId, body.shipmentId, body.quantity ?? null, user.id)
  }

  @Roles('EDITOR', 'ADMIN')
  @Delete(':poId/link-shipment/:linkId') unlink(
    @Param('poId') poId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: Actor,
  ) {
    return this.svc.unlink(poId, linkId, user.id)
  }
}
