import { describe, expect, it } from 'vitest'
import { emailSrcDoc, highlightPlainTextToHtml, plainTextBodyHtml } from './EmailContent'

describe('Hybrid-C E3 email highlight', () => {
  it('highlightPlainTextToHtml marks token and escapes HTML', () => {
    const html = highlightPlainTextToHtml('Booking BK14568 is ready <script>', 'BK14568')
    expect(html).toContain('data-hybrid-hl')
    expect(html).toContain('BK14568')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('emailSrcDoc injects mark style for token outside tags', () => {
    const doc = emailSrcDoc('<p>SO SO1 and more</p>', 'SO1')
    expect(doc).toContain('data-hybrid-hl')
    expect(doc).toContain('SO1')
  })
})

describe('plainTextBodyHtml — linkified plain-text body (MIME-only emails)', () => {
  it('turns http(s) URLs into safe anchors and escapes everything else', () => {
    const html = plainTextBodyHtml('see https://urldefense.com/v3/__x?a=1&b=2 now <script>', null)
    expect(html).toContain(
      '<a href="https://urldefense.com/v3/__x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">',
    )
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('links www. URLs with an https href and keeps trailing punctuation as text', () => {
    const html = plainTextBodyHtml('visit www.myTCIgroup.com.', null)
    expect(html).toContain('href="https://www.myTCIgroup.com"')
    expect(html).toContain('</a>.')
  })

  it('still marks the highlight token outside links', () => {
    const html = plainTextBodyHtml('BK1 at https://x.test then BK1 again', 'BK1')
    expect((html.match(/data-hybrid-hl/g) ?? []).length).toBe(2)
    expect(html).toContain('<a href="https://x.test"')
  })
})
