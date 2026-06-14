import { Module } from '@nestjs/common'
import { ReviewController } from './review.controller'
import { ReviewService } from './review.service'

/** All repositories come from the global RepositoriesModule. */
@Module({ controllers: [ReviewController], providers: [ReviewService] })
export class ReviewModule {}
