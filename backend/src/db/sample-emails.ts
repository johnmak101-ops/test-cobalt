/**
 * Sample shipping emails for testing the AI email pipeline.
 * These emails are modeled after real Cobalt Knitwear ↔ forwarder
 * communication patterns described in the PRD.
 *
 * Each email is designed to match one of the seeded shipments
 * so we can verify the full classify → extract → match → alert flow.
 */

export interface SampleEmail {
  subject: string
  sender: string
  bodyText: string
  /** Which seeded shipment this should match */
  expectedShipmentId: string
  /** Expected email classification */
  expectedType: string
  /** Brief description for test output */
  description: string
}

export const sampleEmails: SampleEmail[] = [
  // ─── Email 1: Shipping Order for ship-005 (Marine Layer, currently BOOKED) ───
  {
    description: 'SO from DSV for Marine Layer shipment (ship-005)',
    expectedShipmentId: 'ship-005',
    expectedType: 'SHIPPING_ORDER',
    subject: 'RE: 入仓单 / Shipping Order - PO# ML-2026-0045 - SZ→US',
    sender: 'ops@dsv.com',
    bodyText: `Dear Cobalt Team,

Please find below the shipping order / 入仓单 for the following shipment:

PO Number: ML-2026-0045
Customer: Marine Layer US
Route: SZ→US (Shenzhen → Los Angeles)

Cargo Details:
- 85 cartons (箱) knitted garments
- Gross Weight: 1,700 KG
- Volume: 8.5 CBM

Warehouse Details:
Address: Yantian International Container Terminal, Gate 3
CFS Cut-off: 2026-04-20 17:00 (截仓时间)

Please deliver cargo to the above address before the cut-off deadline.

Vessel: COSCO SHIPPING ARIES
Voyage: 038W
ETD: 2026-04-22
ETA: 2026-05-10

If you have any questions, please contact us.

Best regards,
DSV Shenzhen Operations
ops@dsv.com`,
  },

  // ─── Email 2: Draft B/L for ship-001 (New Lobster UK, currently CONFIRMED) ───
  {
    description: 'Draft B/L from Torque/Shipair for New Lobster shipment (ship-001)',
    expectedShipmentId: 'ship-001',
    expectedType: 'DRAFT_BL',
    subject: '请核对提单 / Draft B/L - 100-100209',
    sender: 'docs@torque-shipair.com',
    bodyText: `Hi Sunny,

请核对以下提单草稿 (Please verify the following Draft B/L):

PO: 100-100209
HBL Number: SZTOR88412
Customer: New Lobster UK
Shipper: Cobalt Knitwear Ltd.
Consignee: New Lobster Ltd, London, UK

Route: Shenzhen → UK (SZ→UK)
Vessel: OOCL PIRAEUS
Voyage: 215E
CFS Cut-off: Already passed
ETD: 2026-04-25
ETA: 2026-05-25

Cargo Description:
- 120 cartons knitted garments
- Gross Weight: 2,400 KG
- CBM: 14.2

Please check and confirm the B/L details within 24 hours.
如有任何错误请尽快回复。

Thank you,
Torque/Shipair Documentation Team`,
  },

  // ─── Email 3: Final B/L for ship-002 (SKIM US West, currently AT_WAREHOUSE) ───
  {
    description: 'Final B/L from GFS for SKIM shipment (ship-002)',
    expectedShipmentId: 'ship-002',
    expectedType: 'FINAL_BL',
    subject: '开船提单 / Final B/L Issued - HBL SZ2C54172564',
    sender: 'billing@gfs-logistics.com',
    bodyText: `Dear Cobalt,

开船提单已签发。Final Bill of Lading has been issued for the below shipment:

PO: 2238941
HBL: SZ2C54172564
Customer: SKIM US West

Vessel: CMA CGM MARCO POLO
Voyage: 142E
Port of Loading: Yantian, Shenzhen
Port of Discharge: Los Angeles, CA

ETD: 2026-04-15
ETA: 2026-05-05

The vessel has departed as scheduled. Freight charges have been settled.

Please keep this B/L for your records.

Regards,
GFS Billing Department
billing@gfs-logistics.com`,
  },

  // ─── Email 4: Telex Release for ship-003 (Daniels DE, currently SAILED) ───
  {
    description: 'Telex Release from Logwin for Daniels shipment (ship-003)',
    expectedShipmentId: 'ship-003',
    expectedType: 'TELEX_RELEASE',
    subject: '电放提单 / Telex Release - 6131180898 - HK→DE',
    sender: 'release@logwin.com',
    bodyText: `Dear Cobalt Knitwear,

电放提单确认 - Telex Release Confirmation

We confirm the telex release for the following shipment:

PO: 6131180898
HBL: HKHBG34521
Customer: Daniels DE

Cargo: 500 pieces (件) knitwear
Gross Weight: 3,200 KG

Vessel: MAERSK SELETAR
Voyage: 426W
Route: HK→DE (Hong Kong → Hamburg)

The original B/L has been surrendered at origin and the consignee
may collect cargo at destination without presenting the original B/L.

Freight Status: PAID IN FULL
Release Date: 2026-04-10

Please advise your customer accordingly.

Best regards,
Logwin Release Department`,
  },

  // ─── Email 5: Delay notice for ship-004 (Daniels DE #2, currently AT_WAREHOUSE) ───
  {
    description: 'Delay notice from JAS for Daniels second shipment (ship-004)',
    expectedShipmentId: 'ship-004',
    expectedType: 'DELAY_NOTICE',
    subject: 'VESSEL DELAY NOTICE - PO 22491 / 22492 - Schedule Change',
    sender: 'ops@jas-forwarding.com',
    bodyText: `Dear Cobalt Operations,

IMPORTANT: Vessel Delay / Schedule Change

We regret to inform you that the vessel originally scheduled for the
below shipment has been rolled over due to port congestion.

PO Numbers: 22491, 22492
Customer: Daniels DE
HBL: SZJAS98712
Route: SZ→DE

Cargo: 360 cartons (总共360箱)

Original vessel: EVER LUCKY / Voyage 088W
New vessel: To be confirmed (TBC)

The new schedule is being confirmed with the shipping line. We expect
an updated ETD within the next 48 hours.

We apologize for any inconvenience.

Best regards,
JAS Forwarding Operations
Shenzhen Office`,
  },

  // ─── Email 6: Booking confirmation (new shipment — should NOT match) ───
  {
    description: 'New booking request — no matching shipment in DB',
    expectedShipmentId: '',
    expectedType: 'BOOKING_REQUEST',
    subject: '订舱确认 / Booking Confirmation - NEW PO# TEST-9999',
    sender: 'bookings@gfs-logistics.com',
    bodyText: `Hi Cobalt Team,

Booking Confirmation / 订舱确认

We have received your booking request for:

PO: TEST-9999
Customer: Test Customer
Route: SZ→AU (Shenzhen → Sydney)

Estimated CRD: 2026-05-01
CFS Cut-off: 2026-05-08
ETD: 2026-05-10
ETA: 2026-05-28

Vessel: MSC ANNA
Voyage: FD612

Booking has been confirmed with the shipping line. We will send
the Shipping Order / 入仓单 once warehouse details are finalized.

Thank you,
GFS Bookings`,
  },

  // ─── Email 7: Generic / OTHER email ───
  {
    description: 'Non-shipping email — should classify as OTHER',
    expectedShipmentId: '',
    expectedType: 'OTHER',
    subject: 'Office Holiday Schedule - April 2026',
    sender: 'hr@cobalt.hk',
    bodyText: `Dear All,

Please note the following public holidays for April 2026:

- April 4 (Friday): Ching Ming Festival
- April 18 (Friday): Good Friday
- April 21 (Monday): Easter Monday

The office will be closed on these dates. Please plan your shipping
schedules accordingly.

HR Department
Cobalt Knitwear`,
  },
]
