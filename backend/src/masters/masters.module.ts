import { Module } from '@nestjs/common'
import { MastersController } from './masters.controller'
import { MastersService } from './masters.service'
import { CandidatesService } from './candidates.service'

@Module({ controllers: [MastersController], providers: [MastersService, CandidatesService] })
export class MastersModule {}
