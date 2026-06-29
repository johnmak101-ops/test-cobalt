import { Module } from '@nestjs/common'
import { PurchaseOrdersService } from './purchase-orders.service'
import { PurchaseOrdersWriteController } from './purchase-orders.write.controller'

/** PO write endpoints. Repositories come from the global RepositoriesModule. */
@Module({
  controllers: [PurchaseOrdersWriteController],
  providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
