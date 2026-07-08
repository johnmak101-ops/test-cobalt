import { expect, it } from 'vitest'
import { mapGraphAttachments } from './graph.service'

it('maps Graph fileAttachments to download rows (decoding contentBytes)', () => {
  const rows = mapGraphAttachments({
    value: [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        id: 'att1',
        name: 'bl.pdf',
        contentType: 'application/pdf',
        size: 3,
        contentBytes: Buffer.from('abc').toString('base64'),
      },
    ],
  })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ graphAttachmentId: 'att1', filename: 'bl.pdf', mime: 'application/pdf', sizeBytes: 3 })
  expect(rows[0]!.body.toString()).toBe('abc')
})

it('filters out non-file attachments (e.g. itemAttachment) and rows with no contentBytes', () => {
  const rows = mapGraphAttachments({
    value: [
      { '@odata.type': '#microsoft.graph.itemAttachment', id: 'att2', name: 'forwarded.eml' },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'att3', name: 'inline.png' }, // reference attachment: no contentBytes
    ],
  })
  expect(rows).toHaveLength(0)
})

it('defaults filename/mime and returns an empty array when `value` is absent', () => {
  const rows = mapGraphAttachments({
    value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'att4', contentBytes: Buffer.from('x').toString('base64') }],
  })
  expect(rows[0]).toMatchObject({ filename: 'attachment', mime: 'application/octet-stream' })
  expect(mapGraphAttachments({})).toEqual([])
})
