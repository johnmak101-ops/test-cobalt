import { Global, Module, forwardRef } from '@nestjs/common'
import { PresentationService } from './presentation.service'
import { EmailPresentationService } from './email-presentation.service'
import { DocumentPresentationService } from './document-presentation.service'
import { PurchaseOrderPresentationService } from './purchase-order-presentation.service'
import { MasterDataPresentationService } from './master-data-presentation.service'
import { ShipmentsModule } from '../shipments/shipments.module'
import { AlertsModule } from '../alerts/alerts.module'
import {
  UiDashboardController,
  UiMastersController,
  UiAlertRulesController,
  UiShipmentHistoryController,
  UiDocumentsController,
  UiPosController,
  UiEmailsController,
} from './ui.controllers'

/**
 * UI presentation/adapter layer. Global so existing controllers (Shipments, Alerts) can inject
 * PresentationService to delegate their colliding GETs without import wiring. Houses the new
 * non-colliding UI read endpoints (/dashboard, /vendors, /alert-rules, /shipments/:id/history, …).
 */
@Global()
@Module({
  imports: [forwardRef(() => ShipmentsModule), AlertsModule],
  controllers: [
    UiDashboardController,
    UiMastersController,
    UiAlertRulesController,
    UiShipmentHistoryController,
    UiDocumentsController,
    UiPosController,
    UiEmailsController,
  ],
  providers: [
    PresentationService,
    EmailPresentationService,
    DocumentPresentationService,
    PurchaseOrderPresentationService,
    MasterDataPresentationService,
  ],
  exports: [
    PresentationService,
    EmailPresentationService,
    DocumentPresentationService,
    PurchaseOrderPresentationService,
    MasterDataPresentationService,
  ],
})
export class PresentationModule {}
