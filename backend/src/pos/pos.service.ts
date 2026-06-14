import { Injectable } from '@nestjs/common'
import { BookingRepository } from '../db/repositories/booking.repository'

/** PO master read for the Matcher (resolve a customer_po → customer/vendor). */
@Injectable()
export class PosService {
  constructor(private readonly bookings: BookingRepository) {}

  /** open=true drops POs whose linked bookings are all terminal (CLOSED/CANCELLED). */
  list(open = false) {
    return this.bookings.listPos(open)
  }
}
