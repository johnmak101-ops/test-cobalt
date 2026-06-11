import Anthropic from '@anthropic-ai/sdk'
import type { EmailType } from '../types/index.js'

/**
 * Step 2: EXTRACT — AI-powered data extraction using Claude.
 * Sends the email content with a structured prompt to Claude
 * and parses the returned JSON.
 */

export interface ExtractedData {
  po_numbers: string[]
  customer: string | null
  forwarder: string | null
  route: string | null
  crd: string | null
  cfs_cutoff: string | null
  hbl_number: string | null
  vessel: string | null
  voyage_number: string | null
  etd: string | null
  eta: string | null
  warehouse_address: string | null
  // Quantity extraction (partial shipment tracking)
  quantity: number | null
  quantity_unit: 'cartons' | 'pieces' | 'cbm' | null
  quantity_raw: string | null  // Original text for verification
  // New order detail fields
  booking_no: string | null
  so_number: string | null
  item_style_no: string | null
  consignee_name: string | null
  consignee_address: string | null
  mbl_number: string | null
  container_no: string | null
  warehouse_start_date: string | null
  warehouse_end_date: string | null
  in_dc_date: string | null
}

export interface ExtractionResult {
  data: ExtractedData
  confidence: number
  rawResponse: string
}

const SYSTEM_PROMPT = `You are a shipping logistics data extraction assistant for Cobalt Knitwear, a Hong Kong/Shenzhen-based garment manufacturer.

Your job is to extract structured shipping data from emails exchanged between Cobalt's operations team and freight forwarders (e.g., Torque/Shipair, GFS, JAS, DSV, Logwin).

These emails may be in English, Chinese, or a mix of both. They often contain shipping industry terminology including:
- PO numbers (purchase order references, various formats)
- HBL numbers (House Bill of Lading)
- MBL numbers (Master Bill of Lading)
- Booking numbers (订舱号)
- Shipping Order (SO) numbers
- Item/Style numbers (style or product references)
- Consignee names and addresses (收货人)
- Container numbers (集装箱号)
- Vessel names and voyage numbers
- Port codes and route shorthand (e.g., SZ→UK means Shenzhen to United Kingdom)
- CFS cut-off dates (Container Freight Station deadline)
- CRD (Cargo Ready Date)
- ETD/ETA (Estimated Time of Departure/Arrival)
- ATD (Actual Time of Departure)
- Warehouse start/end dates (入仓日期范围)
- In DC date (arrival at distribution center)
- B/L (Bill of Lading)
- Cargo quantities (cartons, pieces, CBM/cubic meters)

Common Chinese shipping terms:
- 入仓单 = Shipping Order / Warehouse Notice
- 提单 = Bill of Lading
- 电放 = Telex Release
- 订舱 = Booking
- 截仓 = CFS Cut-off
- 收货人 = Consignee
- 集装箱号 = Container Number
- 箱 = cartons
- 件 = pieces
- 立方米/CBM = cubic meters

IMPORTANT:
- Extract ALL PO numbers found. PO numbers can be in various formats: numeric (e.g., 2238941), alphanumeric (e.g., FEN-MS-118997), or with prefixes (e.g., 100-100209).
- Dates should be returned in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss).
- Route format should be "XX→YY" where XX and YY are port/country codes (e.g., SZ→UK, HK→DE, SZ→LA).
- For quantities, extract the total number and unit. Common patterns: "29箱", "32 cartons", "14 CARTONS", "2.016 CBM", "500 pieces".
- If a field cannot be determined from the email, use null.
- Do NOT guess or fabricate data. Only extract what is explicitly stated.`

const EXTRACTION_PROMPT = `Extract the following shipping data from this email. Return ONLY a JSON object with these exact fields:

{
  "po_numbers": [],          // Array of PO/order reference strings found
  "customer": null,          // Customer/buyer name if mentioned
  "forwarder": null,         // Freight forwarder name if mentioned
  "route": null,             // Shipping route in "XX→YY" format
  "crd": null,               // Cargo Ready Date (ISO 8601)
  "cfs_cutoff": null,        // CFS cut-off deadline (ISO 8601)
  "hbl_number": null,        // House Bill of Lading number
  "vessel": null,            // Vessel/ship name
  "voyage_number": null,     // Voyage number
  "etd": null,               // Estimated Time of Departure (ISO 8601)
  "eta": null,               // Estimated Time of Arrival (ISO 8601)
  "warehouse_address": null, // Warehouse/CFS address if mentioned
  "quantity": null,          // Total cargo quantity (number)
  "quantity_unit": null,     // Unit: "cartons", "pieces", or "cbm"
  "quantity_raw": null,      // Original quantity text from email (e.g. "120 cartons", "29箱")
  "booking_no": null,        // Booking number (订舱号)
  "so_number": null,         // Shipping Order number
  "item_style_no": null,     // Item number or Style number
  "consignee_name": null,    // Consignee name (收货人)
  "consignee_address": null, // Consignee address
  "mbl_number": null,        // Master Bill of Lading number
  "container_no": null,      // Container number (集装箱号)
  "warehouse_start_date": null, // Warehouse start date (入仓开始日期, ISO 8601)
  "warehouse_end_date": null,   // Warehouse end date (入仓截止日期, ISO 8601)
  "in_dc_date": null         // In DC / arrival at distribution center date (ISO 8601)
}

Return ONLY the JSON object, no explanations or markdown formatting.

EMAIL SUBJECT: {{SUBJECT}}

EMAIL BODY:
{{BODY}}`

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for AI extraction. ' +
        'Set it in your .env file or environment.'
      )
    }
    client = new Anthropic({ apiKey })
  }
  return client
}

const EMPTY_EXTRACTED_DATA: ExtractedData = {
  po_numbers: [],
  customer: null,
  forwarder: null,
  route: null,
  crd: null,
  cfs_cutoff: null,
  hbl_number: null,
  vessel: null,
  voyage_number: null,
  etd: null,
  eta: null,
  warehouse_address: null,
  quantity: null,
  quantity_unit: null,
  quantity_raw: null,
  booking_no: null,
  so_number: null,
  item_style_no: null,
  consignee_name: null,
  consignee_address: null,
  mbl_number: null,
  container_no: null,
  warehouse_start_date: null,
  warehouse_end_date: null,
  in_dc_date: null,
}

export async function extractEmailData(
  subject: string,
  body: string,
  _emailType: EmailType
): Promise<ExtractionResult> {
  const prompt = EXTRACTION_PROMPT
    .replace('{{SUBJECT}}', subject)
    .replace('{{BODY}}', body.slice(0, 8000)) // Limit body length for token efficiency

  try {
    const anthropic = getClient()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawResponse =
      message.content[0].type === 'text' ? message.content[0].text : ''

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = rawResponse.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonStr)

    // Validate and normalize the response
    const data: ExtractedData = {
      po_numbers: Array.isArray(parsed.po_numbers)
        ? parsed.po_numbers.map(String)
        : [],
      customer: parsed.customer ?? null,
      forwarder: parsed.forwarder ?? null,
      route: parsed.route ?? null,
      crd: parsed.crd ?? null,
      cfs_cutoff: parsed.cfs_cutoff ?? null,
      hbl_number: parsed.hbl_number ?? null,
      vessel: parsed.vessel ?? null,
      voyage_number: parsed.voyage_number ?? null,
      etd: parsed.etd ?? null,
      eta: parsed.eta ?? null,
      warehouse_address: parsed.warehouse_address ?? null,
      quantity: typeof parsed.quantity === 'number' ? parsed.quantity : null,
      quantity_unit: ['cartons', 'pieces', 'cbm'].includes(parsed.quantity_unit)
        ? parsed.quantity_unit
        : null,
      quantity_raw: parsed.quantity_raw ?? null,
      booking_no: parsed.booking_no ?? null,
      so_number: parsed.so_number ?? null,
      item_style_no: parsed.item_style_no ?? null,
      consignee_name: parsed.consignee_name ?? null,
      consignee_address: parsed.consignee_address ?? null,
      mbl_number: parsed.mbl_number ?? null,
      container_no: parsed.container_no ?? null,
      warehouse_start_date: parsed.warehouse_start_date ?? null,
      warehouse_end_date: parsed.warehouse_end_date ?? null,
      in_dc_date: parsed.in_dc_date ?? null,
    }

    // Calculate confidence based on how many fields were extracted
    const fieldsFilled = Object.entries(data).filter(([key, val]) => {
      if (key === 'po_numbers') return (val as string[]).length > 0
      if (key === 'quantity_raw') return false // Don't count raw text as a separate field
      return val !== null
    }).length

    const confidence = Math.min(0.95, 0.3 + (fieldsFilled / 22) * 0.65)

    return {
      data,
      confidence: Math.round(confidence * 100) / 100,
      rawResponse,
    }
  } catch (error) {
    console.error('Claude extraction failed:', error)

    // Return empty extraction on failure — pipeline will mark as FAILED
    return {
      data: { ...EMPTY_EXTRACTED_DATA },
      confidence: 0,
      rawResponse: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Fallback extraction using regex patterns when Claude API is unavailable.
 * Useful for development/testing without an API key.
 */
export function extractEmailDataFallback(
  subject: string,
  body: string
): ExtractedData {
  const text = `${subject}\n${body}`

  // Extract PO numbers — common patterns
  const poPatterns = [
    /\bPO\s*#?\s*:?\s*([A-Z0-9][-A-Z0-9]{2,20})/gi,
    /\b(\d{5,10})\b/g, // Plain numeric PO
    /\b([A-Z]{2,4}-[A-Z]{0,4}-?\d{3,10})\b/g, // Alphanumeric like FEN-MS-118997
    /\b(\d{3}-\d{5,8})\b/g, // Format like 100-100209
  ]
  const poNumbers = new Set<string>()
  for (const pattern of poPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const po = match[1]
      // Filter out things that look like phone numbers, dates, etc.
      if (po.length >= 4 && po.length <= 20 && !/^\d{4}-\d{2}/.test(po)) {
        poNumbers.add(po)
      }
    }
  }

  // Extract HBL number
  const hblMatch = text.match(/\bHBL\s*(?:#|NUMBER|NO\.?)?\s*:?\s*([A-Z0-9]{8,20})/i)
  const hblNumber = hblMatch ? hblMatch[1] : null

  // Extract vessel name (common pattern: "VESSEL: MAERSK SELETAR" or "V/ CMA CGM MARCO POLO")
  const vesselMatch = text.match(
    /(?:VESSEL|V\/)\s*:?\s*([A-Z][A-Z\s]{4,30}?)(?:\s*\/|\s*V\/|\n|$)/i
  )
  const vessel = vesselMatch ? vesselMatch[1].trim() : null

  // Extract voyage number
  const voyageMatch = text.match(/(?:VOY(?:AGE)?|VYG)\s*(?:#|:)?\s*([A-Z0-9]{2,10})/i)
  const voyageNumber = voyageMatch ? voyageMatch[1] : null

  // Extract route
  const routeMatch = text.match(
    /\b(SZ|HK|GZ|SH|NB|QD|XM)\s*[→\->]+\s*(UK|US|LA|DE|FR|NL|AU|JP|KR)\b/i
  )
  const route = routeMatch
    ? `${routeMatch[1].toUpperCase()}→${routeMatch[2].toUpperCase()}`
    : null

  // Extract quantity (cartons, pieces, CBM)
  let quantity: number | null = null
  let quantityUnit: 'cartons' | 'pieces' | 'cbm' | null = null
  let quantityRaw: string | null = null

  const quantityPatterns: { pattern: RegExp; unit: 'cartons' | 'pieces' | 'cbm' }[] = [
    // Chinese patterns: 29箱, 120箱
    { pattern: /(\d+(?:\.\d+)?)\s*箱/i, unit: 'cartons' },
    { pattern: /(\d+(?:\.\d+)?)\s*件/i, unit: 'pieces' },
    { pattern: /(\d+(?:\.\d+)?)\s*(?:立方米|CBM|M3)/i, unit: 'cbm' },
    // English patterns: 120 cartons, 14 CARTONS, 32 ctns
    { pattern: /(\d+(?:\.\d+)?)\s*(?:cartons?|ctns?)\b/i, unit: 'cartons' },
    { pattern: /(\d+(?:\.\d+)?)\s*(?:pieces?|pcs?)\b/i, unit: 'pieces' },
    { pattern: /(\d+(?:\.\d+)?)\s*(?:CBM|cubic\s*met(?:er|re)s?)\b/i, unit: 'cbm' },
    // "Total: 500 cartons" style
    { pattern: /total\s*:?\s*(\d+(?:\.\d+)?)\s*(?:cartons?|ctns?)/i, unit: 'cartons' },
    { pattern: /total\s*:?\s*(\d+(?:\.\d+)?)\s*(?:pieces?|pcs?)/i, unit: 'pieces' },
  ]

  for (const { pattern, unit } of quantityPatterns) {
    const qMatch = text.match(pattern)
    if (qMatch) {
      quantity = parseFloat(qMatch[1])
      quantityUnit = unit
      quantityRaw = qMatch[0]
      break
    }
  }

  return {
    po_numbers: Array.from(poNumbers),
    customer: null,
    forwarder: null,
    route,
    crd: null,
    cfs_cutoff: null,
    hbl_number: hblNumber,
    vessel,
    voyage_number: voyageNumber,
    etd: null,
    eta: null,
    warehouse_address: null,
    quantity,
    quantity_unit: quantityUnit,
    quantity_raw: quantityRaw,
    booking_no: null,
    so_number: null,
    item_style_no: null,
    consignee_name: null,
    consignee_address: null,
    mbl_number: null,
    container_no: null,
    warehouse_start_date: null,
    warehouse_end_date: null,
    in_dc_date: null,
  }
}
