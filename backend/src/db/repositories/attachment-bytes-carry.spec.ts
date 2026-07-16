import { describe, it, expect } from 'vitest'
import { resolveAttachmentRawBytes } from './attachment-bytes-carry'

const prior = [
  {
    graphAttachmentId: 'ga-1',
    filename: 'BL.pdf',
    sizeBytes: 1000,
    rawBytes: Buffer.from('ORIGINAL-BYTES'),
  },
  {
    graphAttachmentId: null,
    filename: 'mime-only.pdf',
    sizeBytes: 500,
    rawBytes: Buffer.from('MIME-BYTES'),
  },
]

describe('resolveAttachmentRawBytes (#177 keep on re-POST)', () => {
  it('prefers incoming base64 over prior', () => {
    const buf = resolveAttachmentRawBytes(
      { graphAttachmentId: 'ga-1', filename: 'BL.pdf', sizeBytes: 1000, rawBytesB64: Buffer.from('NEW').toString('base64') },
      prior,
    )
    expect(buf?.toString()).toBe('NEW')
  })

  it('carries forward by graphAttachmentId when re-POST has no bytes', () => {
    const buf = resolveAttachmentRawBytes(
      { graphAttachmentId: 'ga-1', filename: 'BL.pdf', sizeBytes: 1000, rawBytesB64: null },
      prior,
    )
    expect(buf?.toString()).toBe('ORIGINAL-BYTES')
  })

  it('carries forward by filename+size when graph id null (MIME path #131/#151)', () => {
    const buf = resolveAttachmentRawBytes(
      { graphAttachmentId: null, filename: 'mime-only.pdf', sizeBytes: 500, rawBytesB64: null },
      prior,
    )
    expect(buf?.toString()).toBe('MIME-BYTES')
  })

  it('returns null for genuinely new byteless row', () => {
    const buf = resolveAttachmentRawBytes(
      { graphAttachmentId: 'new', filename: 'other.pdf', sizeBytes: 9, rawBytesB64: null },
      prior,
    )
    expect(buf).toBeNull()
  })

  it('matches filename alone when size missing on either side', () => {
    const buf = resolveAttachmentRawBytes(
      { filename: 'mime-only.pdf', rawBytesB64: null },
      prior,
    )
    expect(buf?.toString()).toBe('MIME-BYTES')
  })
})
