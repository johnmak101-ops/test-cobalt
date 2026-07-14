import { expect, it, vi } from 'vitest'
import { GraphService, mapGraphAttachments } from './graph.service'

it('fetchAttachments qualifies contentBytes with the fileAttachment type cast (bare $select=contentBytes 400s on the base attachment type)', async () => {
  const urls: string[] = []
  vi.stubEnv('GRAPH_TENANT_ID', 't')
  vi.stubEnv('GRAPH_CLIENT_ID', 'c')
  vi.stubEnv('GRAPH_CLIENT_SECRET', 's')
  vi.stubEnv('GRAPH_MAILBOX', 'mbx@x.com')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    const body = url.includes('login.microsoftonline.com') ? { access_token: 'T', expires_in: 3600 } : { value: [] }
    return new Response(JSON.stringify(body), { status: 200 })
  }))
  try {
    await new GraphService().fetchAttachments('MSG-ID')
    const attUrl = urls.find((u) => u.includes('/attachments'))!
    expect(attUrl).toContain('microsoft.graph.fileAttachment/contentBytes')
    expect(attUrl).not.toContain('size,contentBytes') // the old, 400-ing bare form
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

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
