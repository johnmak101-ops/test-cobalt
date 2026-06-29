import { Global, Module } from '@nestjs/common'
import { PresentationService } from './presentation.service'
import {
  UiDashboardController,
  UiMastersController,
  UiAlertRulesController,
  UiShipmentHistoryController,
  UiPosController,
  UiEmailsController,
  UiEmailIntegrationController,
} from './ui.controllers'

/**
 * UI presentation/adapter layer. Global so existing controllers (Shipments, Alerts) can inject
 * PresentationService to delegate their colliding GETs without import wiring. Houses the new
 * non-colliding UI read endpoints (/dashboard, /vendors, /alert-rules, /shipments/:id/history, …).
 */
@Global()
@Module({
  controllers: [
    UiDashboardController,
    UiMastersController,
    UiAlertRulesController,
    UiShipmentHistoryController,
    UiPosController,
    UiEmailsController,
    UiEmailIntegrationController,
  ],
  providers: [PresentationService],
  exports: [PresentationService],
})
export class PresentationModule {}
