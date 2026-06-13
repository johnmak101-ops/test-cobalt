import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { BookingSummary, BookingDetail, ShipmentDetail } from '../lib/types'

export const useBookings = () =>
  useQuery({ queryKey: ['bookings'], queryFn: () => api.get<BookingSummary[]>('/bookings') })

export const useBooking = (id?: string) =>
  useQuery({ queryKey: ['booking', id], queryFn: () => api.get<BookingDetail>(`/bookings/${id}`), enabled: !!id })

export const useShipment = (id?: string) =>
  useQuery({ queryKey: ['shipment', id], queryFn: () => api.get<ShipmentDetail>(`/shipments/${id}`), enabled: !!id })
