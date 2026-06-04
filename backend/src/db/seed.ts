import { db } from './index.js'
import {
  alertRules,
  customers,
  forwarders,
  shipments,
  shipmentMilestones,
  shippingEmails,
  alerts,
  users,
  vendors,
  purchaseOrders,
  shipmentPos,
  shipmentHistory,
} from './schema.js'

/**
 * Seed the database with default alert rules, sample customers,
 * forwarders, users, and a few example shipments for development.
 */
export async function seed() {
  console.log('Seeding database...')

  // ============================================
  // Users (PRD Personas)
  // ============================================
  const existingUsers = await db.select().from(users)
  if (existingUsers.length === 0) {
    await db.insert(users).values([
      {
        id: 'user-sunny',
        name: 'Sunny',
        email: 'sunny@cobalt.hk',
        role: 'COORDINATOR',
        avatarInitials: 'SC',
      },
      {
        id: 'user-amon',
        name: 'Amon',
        email: 'amon@cobalt.hk',
        role: 'MANAGER',
        avatarInitials: 'AM',
      },
      {
        id: 'user-amon-it',
        name: 'Amon (IT)',
        email: 'amon.it@cobalt.hk',
        role: 'ADMIN',
        avatarInitials: 'AI',
      },
    ])
    console.log('  Seeded 3 users')
  }

  // ============================================
  // Default Alert Rules (A1-A6)
  // ============================================
  const existingRules = await db.select().from(alertRules)
  if (existingRules.length === 0) {
    await db.insert(alertRules).values([
      {
        id: 'A1',
        name: 'No SO Received',
        description: 'Booking sent but no Shipping Order received from forwarder',
        state: 'BOOKED',
        triggerType: 'days_after',
        triggerReference: 'booking',
        thresholdDays: 2,
        severity: 'WARNING',
        enabled: true,
        locked: false,
      },
      {
        id: 'A2',
        name: 'Cut-off Approaching',
        description: 'CFS cut-off deadline is approaching, no Draft B/L received',
        state: 'CONFIRMED',
        triggerType: 'days_before',
        triggerReference: 'cutoff',
        thresholdDays: 1,
        severity: 'WARNING',
        enabled: true,
        locked: false,
      },
      {
        id: 'A3',
        name: 'Cut-off Passed',
        description: 'CFS cut-off has passed without Draft B/L — cargo may have missed vessel',
        state: 'CONFIRMED',
        triggerType: 'days_after',
        triggerReference: 'cutoff',
        thresholdDays: 0,
        severity: 'CRITICAL',
        enabled: true,
        locked: true,
      },
      {
        id: 'A4',
        name: 'No Final B/L',
        description: 'Draft B/L received but no Final B/L — vessel may not have departed',
        state: 'AT_WAREHOUSE',
        triggerType: 'days_after',
        triggerReference: 'draft_bl',
        thresholdDays: 5,
        severity: 'WARNING',
        enabled: true,
        locked: false,
      },
      {
        id: 'A5',
        name: 'No Telex Release',
        description: 'Final B/L received but no Telex Release — check freight payment status',
        state: 'SAILED',
        triggerType: 'days_after',
        triggerReference: 'final_bl',
        thresholdDays: 7,
        severity: 'INFO',
        enabled: true,
        locked: false,
      },
      {
        id: 'A6',
        name: 'No Delivery Confirmation',
        description: 'ETA has passed but no delivery confirmation received',
        state: 'RELEASED',
        triggerType: 'days_after',
        triggerReference: 'eta',
        thresholdDays: 3,
        severity: 'INFO',
        enabled: true,
        locked: false,
      },
    ])
    console.log('  Seeded 6 alert rules')
  }

  // ============================================
  // Sample Customers
  // ============================================
  const existingCustomers = await db.select().from(customers)
  if (existingCustomers.length === 0) {
    await db.insert(customers).values([
      { id: 'cust-001', name: 'New Lobster UK', code: 'NLOB' },
      { id: 'cust-002', name: 'SKIM US West', code: 'SKIM' },
      { id: 'cust-003', name: 'Daniels DE', code: 'DANL' },
      { id: 'cust-004', name: 'Marine Layer US', code: 'MLYR' },
      { id: 'cust-005', name: 'Fenwick UK', code: 'FENW' },
    ])
    console.log('  Seeded 5 customers')
  }

  // ============================================
  // Sample Forwarders
  // ============================================
  const existingForwarders = await db.select().from(forwarders)
  if (existingForwarders.length === 0) {
    await db.insert(forwarders).values([
      { id: 'fwd-001', name: 'Torque/Shipair' },
      { id: 'fwd-002', name: 'GFS' },
      { id: 'fwd-003', name: 'JAS Forwarding' },
      { id: 'fwd-004', name: 'DSV' },
      { id: 'fwd-005', name: 'Logwin' },
    ])
    console.log('  Seeded 5 forwarders')
  }

  // ============================================
  // Sample Shipments (matching PRD examples)
  // ============================================
  const existingShipments = await db.select().from(shipments)
  if (existingShipments.length === 0) {
    const now = new Date()
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)
    const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000)

    await db.insert(shipments).values([
      {
        id: 'ship-001',
        poNumbers: JSON.stringify(['100-100209']),
        customerId: 'cust-001',
        forwarderId: 'fwd-001',
        route: 'SZ→UK',
        status: 'CONFIRMED',
        riskLevel: 'AT_RISK',
        crd: daysAgo(5),
        cfsCutoff: daysAgo(2),
        etd: daysFromNow(15),
        eta: daysFromNow(45),
        warehouseAddress: 'Yantian CFS Terminal',
        quantityShipped: 120,
        quantityUnit: 'cartons',
      },
      {
        id: 'ship-002',
        poNumbers: JSON.stringify(['2238941']),
        customerId: 'cust-002',
        forwarderId: 'fwd-002',
        route: 'SZ→LA',
        status: 'AT_WAREHOUSE',
        riskLevel: 'ON_TRACK',
        crd: daysAgo(10),
        cfsCutoff: daysAgo(7),
        etd: daysFromNow(5),
        eta: daysFromNow(25),
        hblNumber: 'SZ2C54172564',
        vesselName: 'CMA CGM MARCO POLO',
        quantityShipped: 200,
        quantityUnit: 'cartons',
      },
      {
        id: 'ship-003',
        poNumbers: JSON.stringify(['6131180898']),
        customerId: 'cust-003',
        forwarderId: 'fwd-005',
        route: 'HK→DE',
        status: 'SAILED',
        riskLevel: 'ON_TRACK',
        crd: daysAgo(20),
        cfsCutoff: daysAgo(17),
        etd: daysAgo(3),
        eta: daysFromNow(30),
        hblNumber: 'HKHBG34521',
        vesselName: 'MAERSK SELETAR',
        voyageNumber: '426W',
        actualDeparture: daysAgo(3),
        quantityShipped: 500,
        quantityUnit: 'pieces',
      },
      {
        id: 'ship-004',
        poNumbers: JSON.stringify(['22491', '22492']),
        customerId: 'cust-003',
        forwarderId: 'fwd-003',
        route: 'SZ→DE',
        status: 'AT_WAREHOUSE',
        riskLevel: 'DELAYED',
        crd: daysAgo(15),
        cfsCutoff: daysAgo(12),
        etd: null,
        eta: null,
        hblNumber: 'SZJAS98712',
        quantityShipped: 360,
        quantityUnit: 'cartons',
      },
      {
        id: 'ship-005',
        poNumbers: JSON.stringify(['ML-2026-0045']),
        customerId: 'cust-004',
        forwarderId: 'fwd-004',
        route: 'SZ→US',
        status: 'BOOKED',
        riskLevel: 'ON_TRACK',
        crd: daysFromNow(5),
        quantityShipped: 85,
        quantityUnit: 'cartons',
      },
      {
        id: 'ship-006',
        poNumbers: JSON.stringify(['FEN-MS-118997']),
        customerId: 'cust-005',
        forwarderId: 'fwd-001',
        route: 'SZ→UK',
        status: 'RELEASED',
        riskLevel: 'ON_TRACK',
        crd: daysAgo(40),
        cfsCutoff: daysAgo(37),
        etd: daysAgo(30),
        eta: daysAgo(2),
        hblNumber: 'SZTOR77234',
        vesselName: 'EVER GIVEN',
        voyageNumber: '112E',
        actualDeparture: daysAgo(30),
        actualArrival: daysAgo(2),
        quantityShipped: 40,
        quantityUnit: 'cbm',
      },
    ])
    console.log('  Seeded 6 shipments')

    // Milestones for the shipments
    await db.insert(shipmentMilestones).values([
      // Ship-001: New Lobster UK
      { id: 'ms-001', shipmentId: 'ship-001', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(12) },
      { id: 'ms-002', shipmentId: 'ship-001', milestoneType: 'SO_RECEIVED', occurredAt: daysAgo(10) },
      // Ship-002: SKIM
      { id: 'ms-003', shipmentId: 'ship-002', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(14) },
      { id: 'ms-004', shipmentId: 'ship-002', milestoneType: 'SO_RECEIVED', occurredAt: daysAgo(12) },
      { id: 'ms-005', shipmentId: 'ship-002', milestoneType: 'DRAFT_BL_RECEIVED', occurredAt: daysAgo(5) },
      // Ship-003: Daniels sailed
      { id: 'ms-006', shipmentId: 'ship-003', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(25) },
      { id: 'ms-007', shipmentId: 'ship-003', milestoneType: 'SO_RECEIVED', occurredAt: daysAgo(22) },
      { id: 'ms-008', shipmentId: 'ship-003', milestoneType: 'DRAFT_BL_RECEIVED', occurredAt: daysAgo(15) },
      { id: 'ms-009', shipmentId: 'ship-003', milestoneType: 'FINAL_BL_RECEIVED', occurredAt: daysAgo(5) },
      // Ship-004: Daniels delayed
      { id: 'ms-010', shipmentId: 'ship-004', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(18) },
      { id: 'ms-011', shipmentId: 'ship-004', milestoneType: 'SO_RECEIVED', occurredAt: daysAgo(16) },
      { id: 'ms-012', shipmentId: 'ship-004', milestoneType: 'DRAFT_BL_RECEIVED', occurredAt: daysAgo(10) },
      // Ship-005: Marine Layer booked
      { id: 'ms-013', shipmentId: 'ship-005', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(1) },
      // Ship-006: Fenwick released
      { id: 'ms-014', shipmentId: 'ship-006', milestoneType: 'BOOKING_SENT', occurredAt: daysAgo(45) },
      { id: 'ms-015', shipmentId: 'ship-006', milestoneType: 'SO_RECEIVED', occurredAt: daysAgo(42) },
      { id: 'ms-016', shipmentId: 'ship-006', milestoneType: 'DRAFT_BL_RECEIVED', occurredAt: daysAgo(35) },
      { id: 'ms-017', shipmentId: 'ship-006', milestoneType: 'FINAL_BL_RECEIVED', occurredAt: daysAgo(32) },
      { id: 'ms-018', shipmentId: 'ship-006', milestoneType: 'TELEX_RELEASED', occurredAt: daysAgo(5) },
    ])
    console.log('  Seeded 18 milestones')

    // Sample alerts
    await db.insert(alerts).values([
      {
        id: 'alert-001',
        shipmentId: 'ship-001',
        ruleId: 'A3',
        severity: 'CRITICAL',
        message: 'Cut-off passed — cargo may have missed the vessel',
        status: 'ACTIVE',
        triggeredAt: daysAgo(2),
      },
      {
        id: 'alert-002',
        shipmentId: 'ship-004',
        ruleId: 'A4',
        severity: 'WARNING',
        message: 'No Final B/L received 10 days after Draft B/L',
        status: 'ACTIVE',
        triggeredAt: daysAgo(5),
      },
      {
        id: 'alert-003',
        shipmentId: 'ship-002',
        ruleId: 'A4',
        severity: 'WARNING',
        message: 'Awaiting departure confirmation — Draft B/L received 5 days ago',
        status: 'ACTIVE',
        triggeredAt: daysAgo(0),
      },
    ])
    console.log('  Seeded 3 alerts')
  }

  // ============================================
  // Sample Emails (pre-processed inbox data)
  // ============================================
  const existingEmails = await db.select().from(shippingEmails)
  if (existingEmails.length === 0) {
    const now = new Date()
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)

    await db.insert(shippingEmails).values([
      {
        id: 'email-001',
        messageId: '<so-ml2026-0045@dsv.com>',
        subject: 'RE: 入仓单 / Shipping Order - PO# ML-2026-0045 - SZ→US',
        sender: 'ops@dsv.com',
        receivedAt: daysAgo(1),
        bodyText: `Dear Cobalt Team,\n\nPlease find below the shipping order / 入仓单 for the following shipment:\n\nPO Number: ML-2026-0045\nCustomer: Marine Layer US\nRoute: SZ→US (Shenzhen → Los Angeles)\n\nCargo Details:\n- 85 cartons (箱) knitted garments\n- Gross Weight: 1,700 KG\n- Volume: 8.5 CBM\n\nWarehouse Details:\nAddress: Yantian International Container Terminal, Gate 3\nCFS Cut-off: 2026-04-20 17:00 (截仓时间)\n\nPlease deliver cargo to the above address before the cut-off deadline.\n\nVessel: COSCO SHIPPING ARIES\nVoyage: 038W\nETD: 2026-04-22\nETA: 2026-05-10\n\nIf you have any questions, please contact us.\n\nBest regards,\nDSV Shenzhen Operations\nops@dsv.com`,
        emailType: 'SHIPPING_ORDER',
        extractedData: JSON.stringify({
          poNumbers: ['ML-2026-0045'],
          customer: 'Marine Layer US',
          route: 'SZ→US',
          vesselName: 'COSCO SHIPPING ARIES',
          voyageNumber: '038W',
          etd: '2026-04-22',
          eta: '2026-05-10',
          cfsCutoff: '2026-04-20',
          warehouseAddress: 'Yantian International Container Terminal, Gate 3',
          quantity: 85,
          quantityUnit: 'cartons',
          quantityRaw: '85 cartons (箱)',
        }),
        extractionConfidence: 0.95,
        shipmentId: 'ship-005',
        isMatched: true,
        processingStatus: 'COMPLETED',
        reviewStatus: 'AUTO_ACCEPTED',
      },
      {
        id: 'email-002',
        messageId: '<dbl-100-100209@torque-shipair.com>',
        subject: '请核对提单 / Draft B/L - 100-100209',
        sender: 'docs@torque-shipair.com',
        receivedAt: daysAgo(2),
        bodyText: `Hi Sunny,\n\n请核对以下提单草稿 (Please verify the following Draft B/L):\n\nPO: 100-100209\nHBL Number: SZTOR88412\nCustomer: New Lobster UK\nShipper: Cobalt Knitwear Ltd.\nConsignee: New Lobster Ltd, London, UK\n\nRoute: Shenzhen → UK (SZ→UK)\nVessel: OOCL PIRAEUS\nVoyage: 215E\nCFS Cut-off: Already passed\nETD: 2026-04-25\nETA: 2026-05-25\n\nCargo Description:\n- 120 cartons knitted garments\n- Gross Weight: 2,400 KG\n- CBM: 14.2\n\nPlease check and confirm the B/L details within 24 hours.\n如有任何错误请尽快回复。\n\nThank you,\nTorque/Shipair Documentation Team`,
        emailType: 'DRAFT_BL',
        extractedData: JSON.stringify({
          poNumbers: ['100-100209'],
          customer: 'New Lobster UK',
          route: 'SZ→UK',
          hblNumber: 'SZTOR88412',
          vesselName: 'OOCL PIRAEUS',
          voyageNumber: '215E',
          etd: '2026-04-25',
          eta: '2026-05-25',
          quantity: 120,
          quantityUnit: 'cartons',
          quantityRaw: '120 cartons',
        }),
        extractionConfidence: 0.92,
        shipmentId: 'ship-001',
        isMatched: true,
        processingStatus: 'COMPLETED',
        reviewStatus: 'AUTO_ACCEPTED',
      },
      {
        id: 'email-003',
        messageId: '<fbl-sz2c54172564@gfs-logistics.com>',
        subject: '开船提单 / Final B/L Issued - HBL SZ2C54172564',
        sender: 'billing@gfs-logistics.com',
        receivedAt: daysAgo(5),
        bodyText: `Dear Cobalt,\n\n开船提单已签发。Final Bill of Lading has been issued for the below shipment:\n\nPO: 2238941\nHBL: SZ2C54172564\nCustomer: SKIM US West\n\nVessel: CMA CGM MARCO POLO\nVoyage: 142E\nPort of Loading: Yantian, Shenzhen\nPort of Discharge: Los Angeles, CA\n\nETD: 2026-04-15\nETA: 2026-05-05\n\nThe vessel has departed as scheduled. Freight charges have been settled.\n\nPlease keep this B/L for your records.\n\nRegards,\nGFS Billing Department\nbilling@gfs-logistics.com`,
        emailType: 'FINAL_BL',
        extractedData: JSON.stringify({
          poNumbers: ['2238941'],
          customer: 'SKIM US West',
          hblNumber: 'SZ2C54172564',
          vesselName: 'CMA CGM MARCO POLO',
          voyageNumber: '142E',
          etd: '2026-04-15',
          eta: '2026-05-05',
        }),
        extractionConfidence: 0.97,
        shipmentId: 'ship-002',
        isMatched: true,
        processingStatus: 'COMPLETED',
        reviewStatus: 'AUTO_ACCEPTED',
      },
      {
        id: 'email-004',
        messageId: '<telex-hkhbg34521@logwin.com>',
        subject: '电放提单 / Telex Release - 6131180898 - HK→DE',
        sender: 'release@logwin.com',
        receivedAt: daysAgo(3),
        bodyText: `Dear Cobalt Knitwear,\n\n电放提单确认 - Telex Release Confirmation\n\nWe confirm the telex release for the following shipment:\n\nPO: 6131180898\nHBL: HKHBG34521\nCustomer: Daniels DE\n\nCargo: 500 pieces (件) knitwear\nGross Weight: 3,200 KG\n\nVessel: MAERSK SELETAR\nVoyage: 426W\nRoute: HK→DE (Hong Kong → Hamburg)\n\nThe original B/L has been surrendered at origin and the consignee\nmay collect cargo at destination without presenting the original B/L.\n\nFreight Status: PAID IN FULL\nRelease Date: 2026-04-10\n\nPlease advise your customer accordingly.\n\nBest regards,\nLogwin Release Department`,
        emailType: 'TELEX_RELEASE',
        extractedData: JSON.stringify({
          poNumbers: ['6131180898'],
          customer: 'Daniels DE',
          hblNumber: 'HKHBG34521',
          vesselName: 'MAERSK SELETAR',
          voyageNumber: '426W',
          route: 'HK→DE',
          quantity: 500,
          quantityUnit: 'pieces',
          quantityRaw: '500 pieces (件)',
        }),
        extractionConfidence: 0.96,
        shipmentId: 'ship-003',
        isMatched: true,
        processingStatus: 'COMPLETED',
        reviewStatus: 'AUTO_ACCEPTED',
      },
      {
        id: 'email-005',
        messageId: '<delay-22491-22492@jas-forwarding.com>',
        subject: 'VESSEL DELAY NOTICE - PO 22491 / 22492 - Schedule Change',
        sender: 'ops@jas-forwarding.com',
        receivedAt: daysAgo(3),
        bodyText: `Dear Cobalt Operations,\n\nIMPORTANT: Vessel Delay / Schedule Change\n\nWe regret to inform you that the vessel originally scheduled for the\nbelow shipment has been rolled over due to port congestion.\n\nPO Numbers: 22491, 22492\nCustomer: Daniels DE\nHBL: SZJAS98712\nRoute: SZ→DE\n\nCargo: 360 cartons (总共360箱)\n\nOriginal vessel: EVER LUCKY / Voyage 088W\nNew vessel: To be confirmed (TBC)\n\nThe new schedule is being confirmed with the shipping line. We expect\nan updated ETD within the next 48 hours.\n\nWe apologize for any inconvenience.\n\nBest regards,\nJAS Forwarding Operations\nShenzhen Office`,
        emailType: 'DELAY_NOTICE',
        extractedData: JSON.stringify({
          poNumbers: ['22491', '22492'],
          customer: 'Daniels DE',
          hblNumber: 'SZJAS98712',
          route: 'SZ→DE',
          vesselName: 'EVER LUCKY',
          voyageNumber: '088W',
          quantity: 360,
          quantityUnit: 'cartons',
          quantityRaw: '360 cartons (总共360箱)',
        }),
        extractionConfidence: 0.88,
        shipmentId: 'ship-004',
        isMatched: true,
        processingStatus: 'COMPLETED',
        reviewStatus: 'FLAGGED',
      },
      {
        id: 'email-006',
        messageId: '<booking-test9999@gfs-logistics.com>',
        subject: '订舱确认 / Booking Confirmation - NEW PO# TEST-9999',
        sender: 'bookings@gfs-logistics.com',
        receivedAt: daysAgo(1),
        bodyText: `Hi Cobalt Team,\n\nBooking Confirmation / 订舱确认\n\nWe have received your booking request for:\n\nPO: TEST-9999\nCustomer: Test Customer\nRoute: SZ→AU (Shenzhen → Sydney)\n\nEstimated CRD: 2026-05-01\nCFS Cut-off: 2026-05-08\nETD: 2026-05-10\nETA: 2026-05-28\n\nVessel: MSC ANNA\nVoyage: FD612\n\nBooking has been confirmed with the shipping line. We will send\nthe Shipping Order / 入仓单 once warehouse details are finalized.\n\nThank you,\nGFS Bookings`,
        emailType: 'BOOKING_REQUEST',
        extractedData: JSON.stringify({
          poNumbers: ['TEST-9999'],
          customer: 'Test Customer',
          route: 'SZ→AU',
          vesselName: 'MSC ANNA',
          voyageNumber: 'FD612',
          etd: '2026-05-10',
          eta: '2026-05-28',
          cfsCutoff: '2026-05-08',
        }),
        extractionConfidence: 0.91,
        shipmentId: null,
        isMatched: false,
        processingStatus: 'COMPLETED',
        reviewStatus: 'NEEDS_REVIEW',
      },
      {
        id: 'email-007',
        messageId: '<holiday-apr2026@cobalt.hk>',
        subject: 'Office Holiday Schedule - April 2026',
        sender: 'hr@cobalt.hk',
        receivedAt: daysAgo(7),
        bodyText: `Dear All,\n\nPlease note the following public holidays for April 2026:\n\n- April 4 (Friday): Ching Ming Festival\n- April 18 (Friday): Good Friday\n- April 21 (Monday): Easter Monday\n\nThe office will be closed on these dates. Please plan your shipping\nschedules accordingly.\n\nHR Department\nCobalt Knitwear`,
        emailType: 'OTHER',
        extractedData: null,
        extractionConfidence: null,
        shipmentId: null,
        isMatched: false,
        processingStatus: 'COMPLETED',
        reviewStatus: 'AUTO_ACCEPTED',
      },
    ])
    console.log('  Seeded 7 emails')
  }

  // ============================================
  // Sample Vendors / Factories
  // ============================================
  const existingVendors = await db.select().from(vendors)
  if (existingVendors.length === 0) {
    const now = new Date()
    await db.insert(vendors).values([
      {
        id: 'vnd-001',
        name: 'Shenzhen Yida Knitting Co.',
        type: 'factory',
        location: 'Shenzhen, Guangdong',
        contactEmail: 'sales@yida-knit.cn',
        contactPhone: '+86 755 8888 1234',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'vnd-002',
        name: 'Dongguan Haowei Garments',
        type: 'factory',
        location: 'Dongguan, Guangdong',
        contactEmail: 'export@haowei.com.cn',
        contactPhone: '+86 769 2222 5678',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'vnd-003',
        name: 'Wing Tai Textiles',
        type: 'subcontractor',
        location: 'Zhuhai, Guangdong',
        contactEmail: 'ops@wingtai.hk',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'vnd-004',
        name: 'Pearl River Trading Co.',
        type: 'agent',
        location: 'Hong Kong',
        contactEmail: 'info@prtco.hk',
        contactPhone: '+852 3456 7890',
        createdAt: now,
        updatedAt: now,
      },
    ])
    console.log('  Seeded 4 vendors')
  }

  // ============================================
  // Sample Purchase Orders
  // ============================================
  const existingPOs = await db.select().from(purchaseOrders)
  if (existingPOs.length === 0) {
    const now = new Date()
    await db.insert(purchaseOrders).values([
      {
        id: 'po-001',
        poNumber: '100-100209',
        customerId: 'cust-001',
        vendorId: 'vnd-001',
        totalQuantity: 350,
        quantityUnit: 'cartons',
        notes: 'New Lobster UK — AW26 knitwear collection',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-002',
        poNumber: '2238941',
        customerId: 'cust-002',
        vendorId: 'vnd-002',
        totalQuantity: 200,
        quantityUnit: 'cartons',
        notes: 'SKIM US West — SS26 basics range',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-003',
        poNumber: '6131180898',
        customerId: 'cust-003',
        vendorId: 'vnd-001',
        totalQuantity: 500,
        quantityUnit: 'pieces',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-004',
        poNumber: '22491',
        customerId: 'cust-003',
        vendorId: 'vnd-003',
        totalQuantity: 180,
        quantityUnit: 'cartons',
        notes: 'Daniels DE — partial shipment 1 of 2',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-005',
        poNumber: '22492',
        customerId: 'cust-003',
        vendorId: 'vnd-003',
        totalQuantity: 180,
        quantityUnit: 'cartons',
        notes: 'Daniels DE — partial shipment 2 of 2',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-006',
        poNumber: 'ML-2026-0045',
        customerId: 'cust-004',
        vendorId: 'vnd-002',
        totalQuantity: 85,
        quantityUnit: 'cartons',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'po-007',
        poNumber: 'FEN-MS-118997',
        customerId: 'cust-005',
        vendorId: 'vnd-004',
        totalQuantity: 40,
        quantityUnit: 'cbm',
        createdAt: now,
        updatedAt: now,
      },
    ])
    console.log('  Seeded 7 purchase orders')

    // Link POs to shipments
    await db.insert(shipmentPos).values([
      { id: 'spo-001', shipmentId: 'ship-001', poId: 'po-001', quantity: 120, createdAt: now },
      { id: 'spo-002', shipmentId: 'ship-002', poId: 'po-002', quantity: 200, createdAt: now },
      { id: 'spo-003', shipmentId: 'ship-003', poId: 'po-003', quantity: 500, createdAt: now },
      { id: 'spo-004', shipmentId: 'ship-004', poId: 'po-004', quantity: 180, createdAt: now },
      { id: 'spo-005', shipmentId: 'ship-004', poId: 'po-005', quantity: 180, createdAt: now },
      { id: 'spo-006', shipmentId: 'ship-005', poId: 'po-006', quantity: 85, createdAt: now },
      { id: 'spo-007', shipmentId: 'ship-006', poId: 'po-007', quantity: 40, createdAt: now },
    ])
    console.log('  Seeded 7 PO-shipment links')

    // Sample history entries (to populate the timeline)
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000)
    await db.insert(shipmentHistory).values([
      {
        id: 'hist-001',
        shipmentId: 'ship-003',
        field: 'eta',
        oldValue: daysAgo(35).toISOString(),
        newValue: daysAgo(30).toISOString(),
        sourceType: 'email',
        sourceId: null,
        isDelay: false,
        notes: 'Updated from Final B/L',
        changedAt: daysAgo(5),
      },
      {
        id: 'hist-002',
        shipmentId: 'ship-004',
        field: 'vessel_name',
        oldValue: 'EVER LUCKY',
        newValue: null,
        sourceType: 'email',
        sourceId: null,
        isDelay: false,
        notes: 'Vessel rolled over — awaiting new assignment',
        changedAt: daysAgo(3),
      },
      {
        id: 'hist-003',
        shipmentId: 'ship-004',
        field: 'status',
        oldValue: 'AT_WAREHOUSE',
        newValue: 'AT_WAREHOUSE',
        sourceType: 'system',
        isDelay: true,
        notes: 'Delay detected: vessel rollover notification',
        changedAt: daysAgo(3),
      },
      {
        id: 'hist-004',
        shipmentId: 'ship-001',
        field: 'etd',
        oldValue: null,
        newValue: daysAgo(-15).toISOString(),
        sourceType: 'email',
        notes: 'ETD assigned from Draft B/L',
        changedAt: daysAgo(2),
      },
    ])
    console.log('  Seeded 4 history entries')
  }

  console.log('Seeding complete!')
}

// Run seed when executed directly (e.g. `pnpm db:seed`), not when imported
const isDirectRun = process.argv[1]?.includes('seed.ts')
if (isDirectRun) {
  seed().catch(console.error)
}
