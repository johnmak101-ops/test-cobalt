import { Module } from '@nestjs/common'
import { EmailsController } from './emails.controller'
import { EmailsService } from './emails.service'
import { GraphService } from './graph.service'

@Module({
  controllers: [EmailsController],
  providers: [EmailsService, GraphService],
})
export class EmailsModule {}
