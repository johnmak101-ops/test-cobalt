import { Module } from '@nestjs/common'
import { PosController } from './pos.controller'
import { PosService } from './pos.service'

/** BookingRepository (which owns purchase_orders access) comes from the global RepositoriesModule. */
@Module({ controllers: [PosController], providers: [PosService] })
export class PosModule {}
