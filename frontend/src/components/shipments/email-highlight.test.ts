import { describe, expect, it } from 'vitest'
import { emailSrcDoc, highlightPlainTextToHtml } from './EmailContent'

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
