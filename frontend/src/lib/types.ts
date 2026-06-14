export interface BookingSummary {
  id: string
  jobNo: string
  brand: string | null
  status: string
  legCount: number
  activeMode: string | null
  activeState: string | null
  customerId: string | null
  createdAt: string
}

export interface Leg {
  id: string
  legNo: number
  mode: string | null
  state: string
  legStatus: string
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  containerNo: string | null
  vesselName: string | null
  voyageNo: string | null
  flightNo: string | null
  mawb: string | null
  etd: string | null
  eta: string | null
  atd: string | null
  cfsCutoff: string | null
  cargoReadyDate: string | null
  warehouseStartDate: string | null
  consigneeName: string | null
}

export interface PO {
  id: string
  poNumber: string
  brand: string | null
  itemStyleNo: string | null
  totalQuantity: number | null
  quantityUnit: string | null
}

export interface BookingDetail extends BookingSummary {
  crd: string | null
  pos: PO[]
  legs: Leg[]
}

export interface Milestone {
  id: string
  milestoneType: string
  occurredAt: string
  senderType: string | null
  emailMessageId?: string | null
}

export interface ShipmentDetail extends Leg {
  milestones: Milestone[]
  pos: unknown[]
}

export interface Alert {
  id: string
  ruleId: string
  severity: string
  status: string
  message: string
  bookingId: string | null
  shipmentId: string | null
  firedAt: string
}

export interface User {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  avatarInitials: string | null
  createdAt: string
}
