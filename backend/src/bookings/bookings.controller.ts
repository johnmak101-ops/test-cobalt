import { Controller, Get, Param } from '@nestjs/common'
import { BookingsService } from './bookings.service'

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get() list() { return this.bookings.list() }
  @Get(':id') getOne(@Param('id') id: string) { return this.bookings.getOne(id) }
}
