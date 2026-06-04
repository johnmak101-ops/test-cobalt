import type { EmailType } from '../types/index.js'

/**
 * Step 1: CLASSIFY — Keyword-based email classification.
 * Uses Chinese and English keywords from the PRD to determine email type.
 * This runs BEFORE the AI extraction step for speed.
 */

interface ClassificationResult {
  emailType: EmailType
  confidence: number
  matchedKeywords: string[]
}

// Chinese keywords (shipping industry terms)
const CHINESE_KEYWORDS: { pattern: RegExp; type: EmailType; label: string }[] = [
  { pattern: /入仓单/i, type: 'SHIPPING_ORDER', label: '入仓单 (SO)' },
  { pattern: /请核对提单/i, type: 'DRAFT_BL', label: '请核对提单 (Draft B/L)' },
  { pattern: /开船提单/i, type: 'FINAL_BL', label: '开船提单 (Final B/L)' },
  { pattern: /电放提单/i, type: 'TELEX_RELEASE', label: '电放提单 (Telex Release)' },
  { pattern: /电放/i, type: 'TELEX_RELEASE', label: '电放 (Telex)' },
  { pattern: /提单确认/i, type: 'DRAFT_BL', label: '提单确认 (B/L confirm)' },
  { pattern: /正本提单/i, type: 'FINAL_BL', label: '正本提单 (Original B/L)' },
  { pattern: /订舱/i, type: 'BOOKING_REQUEST', label: '订舱 (Booking)' },
  { pattern: /延误/i, type: 'DELAY_NOTICE', label: '延误 (Delay)' },
  { pattern: /推迟/i, type: 'DELAY_NOTICE', label: '推迟 (Postpone)' },
]

// English keywords
const ENGLISH_KEYWORDS: { pattern: RegExp; type: EmailType; label: string }[] = [
  // Telex release (check before generic B/L keywords)
  { pattern: /telex\s*release/i, type: 'TELEX_RELEASE', label: 'TELEX RELEASE' },
  { pattern: /\btelex\b/i, type: 'TELEX_RELEASE', label: 'TELEX' },

  // Final B/L (check before draft)
  { pattern: /final\s*b\/?l/i, type: 'FINAL_BL', label: 'FINAL B/L' },
  { pattern: /original\s*b\/?l/i, type: 'FINAL_BL', label: 'ORIGINAL B/L' },

  // Draft B/L
  { pattern: /draft\s*b\/?l/i, type: 'DRAFT_BL', label: 'DRAFT B/L' },
  { pattern: /verify.*b\/?l/i, type: 'DRAFT_BL', label: 'VERIFY B/L' },
  { pattern: /check.*b\/?l/i, type: 'DRAFT_BL', label: 'CHECK B/L' },
  { pattern: /b\/?l\s*draft/i, type: 'DRAFT_BL', label: 'B/L DRAFT' },

  // Shipping Order / SO
  { pattern: /shipping\s*order/i, type: 'SHIPPING_ORDER', label: 'SHIPPING ORDER' },
  { pattern: /\bS\.?O\.?\b(?!\s*received)/i, type: 'SHIPPING_ORDER', label: 'SO' },
  { pattern: /入仓通知/i, type: 'SHIPPING_ORDER', label: '入仓通知 (warehouse notice)' },
  { pattern: /warehouse\s*(?:notice|instruction)/i, type: 'SHIPPING_ORDER', label: 'WAREHOUSE NOTICE' },

  // Booking
  { pattern: /booking\s*(?:request|confirmation|confirm)/i, type: 'BOOKING_REQUEST', label: 'BOOKING' },
  { pattern: /\bbooking\b/i, type: 'BOOKING_REQUEST', label: 'BOOKING' },

  // Delay
  { pattern: /delay\s*notice/i, type: 'DELAY_NOTICE', label: 'DELAY NOTICE' },
  { pattern: /vessel\s*delay/i, type: 'DELAY_NOTICE', label: 'VESSEL DELAY' },
  { pattern: /schedule\s*change/i, type: 'DELAY_NOTICE', label: 'SCHEDULE CHANGE' },
  { pattern: /roll(?:ed|ing)?\s*over/i, type: 'DELAY_NOTICE', label: 'ROLLED OVER' },
]

// Subject-line-specific strong signals (higher confidence)
const SUBJECT_SIGNALS: { pattern: RegExp; type: EmailType }[] = [
  { pattern: /HBL\s*(?:NUMBER|#|NO)/i, type: 'FINAL_BL' },
  { pattern: /\bHBL\b.*\b[A-Z]{2}\d{2}[A-Z]\d+/i, type: 'FINAL_BL' },
  { pattern: /RE:.*S\.?O\.?\b/i, type: 'SHIPPING_ORDER' },
]

export function classifyEmail(subject: string, body: string): ClassificationResult {
  const text = `${subject}\n${body}`
  const matchedKeywords: string[] = []
  const typeCounts = new Map<EmailType, number>()

  // Check subject-line signals first (stronger weight)
  for (const signal of SUBJECT_SIGNALS) {
    if (signal.pattern.test(subject)) {
      typeCounts.set(signal.type, (typeCounts.get(signal.type) ?? 0) + 3)
      matchedKeywords.push(`[subject] ${signal.pattern.source}`)
    }
  }

  // Check Chinese keywords (in full text)
  for (const kw of CHINESE_KEYWORDS) {
    if (kw.pattern.test(text)) {
      typeCounts.set(kw.type, (typeCounts.get(kw.type) ?? 0) + 2)
      matchedKeywords.push(kw.label)
    }
  }

  // Check English keywords (in full text)
  for (const kw of ENGLISH_KEYWORDS) {
    if (kw.pattern.test(text)) {
      typeCounts.set(kw.type, (typeCounts.get(kw.type) ?? 0) + 1)
      matchedKeywords.push(kw.label)
    }
  }

  // No matches → OTHER
  if (typeCounts.size === 0) {
    return { emailType: 'OTHER', confidence: 0.5, matchedKeywords: [] }
  }

  // Find the type with the highest score
  let bestType: EmailType = 'OTHER'
  let bestScore = 0
  for (const [type, score] of typeCounts) {
    if (score > bestScore) {
      bestType = type
      bestScore = score
    }
  }

  // Compute confidence based on score and uniqueness
  const totalScore = Array.from(typeCounts.values()).reduce((a, b) => a + b, 0)
  const dominance = bestScore / totalScore
  const confidence = Math.min(0.95, 0.5 + dominance * 0.4 + Math.min(bestScore, 5) * 0.05)

  return {
    emailType: bestType,
    confidence: Math.round(confidence * 100) / 100,
    matchedKeywords,
  }
}
