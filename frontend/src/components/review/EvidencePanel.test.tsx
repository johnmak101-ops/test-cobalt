import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EvidencePanel, splitOnValue } from './EvidencePanel'

const { body, attachments } = vi.hoisted(() => ({ body: vi.fn(), attachments: vi.fn() }))

vi.mock('../../hooks/use-emails', () => ({
  useEmailBody: () => body(),
  useEmailAttachments: () => attachments(),
}))

/** A real dev-DB email: the value sits mid-body, in a labelled block. */
const REAL_BODY = `r :        875480
Shipper :       ASIA LEGEND CLOTHING(CAMBODIA)CO.,LTD
Contact :
Buyer : URBAN OUTFITTERS, INC.
Load Port :     PHNOM PENH,CAMBODIA, CAMBODIA`

function renderPanel(value: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EvidencePanel emailId="db-1" value={value} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  body.mockReturnValue({
    data: {
      id: 'db-1',
      subject: 'FW: Booking Revision submitted transaction#42161911',
      sender: 'ops@forwarder.com',
      receivedAt: '2026-07-24T09:58:00.000Z',
      bodyText: REAL_BODY,
      bodyHtml: null,
    },
    isLoading: false,
    isError: false,
  })
  attachments.mockReturnValue({ data: { attachments: [] }, isLoading: false })
})

/**
 * Highlighting needs no stored offsets — 58 of 86 candidate values (67%) appear VERBATIM in their
 * source email's body, so a literal search finds them.
 */
describe('splitOnValue', () => {
  it('splits around every occurrence, marking the hits', () => {
    const parts = splitOnValue('a HIT b HIT c', 'hit')
    expect(parts.map((p) => p.text)).toEqual(['a ', 'HIT', ' b ', 'HIT', ' c'])
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['HIT', 'HIT'])
  })

  it('is case-insensitive and keeps the body’s own casing', () => {
    expect(splitOnValue('Buyer : URBAN OUTFITTERS, INC.', 'urban outfitters, inc.').some((p) => p.hit)).toBe(true)
  })

  it('treats the value as literal text, never a pattern', () => {
    // A regex metacharacter must not blow up or match wildly.
    expect(splitOnValue('a.b', 'a.b').filter((p) => p.hit)).toHaveLength(1)
    expect(splitOnValue('axb', 'a.b').filter((p) => p.hit)).toHaveLength(0)
  })

  it('no value / no match → the body comes back whole', () => {
    expect(splitOnValue('abc', '')).toEqual([{ text: 'abc', hit: false }])
    expect(splitOnValue('abc', 'zzz')).toEqual([{ text: 'abc', hit: false }])
  })
})

describe('EvidencePanel', () => {
  it('shows the email and highlights the value in it', () => {
    renderPanel('URBAN OUTFITTERS, INC.')
    expect(screen.getByTestId('evidence-panel')).toHaveTextContent(/Booking Revision/)
    const marks = within(screen.getByTestId('evidence-body')).getAllByText('URBAN OUTFITTERS, INC.')
    expect(marks).toHaveLength(1)
    expect(marks[0]!.tagName).toBe('MARK')
    expect(screen.getByTestId('evidence-tab-body')).toHaveTextContent('1 hit')
  })

  /**
   * The 33% that came off an attachment. Showing a body with no match in it and letting the operator
   * hunt is worse than saying where it actually came from.
   */
  it('value not in the body but files rode along → names the files instead', () => {
    attachments.mockReturnValue({
      data: {
        attachments: [
          { id: 'a1', emailId: 'db-1', filename: '2026 7 30 JS客 报关单.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 5652692, createdAt: '' },
          { id: 'a2', emailId: 'db-1', filename: 'ITClub Bill Of Lading - S02161043.PDF', mimeType: 'application/pdf', sizeBytes: 1989685, createdAt: '' },
        ],
      },
      isLoading: false,
    })
    renderPanel('8203')
    expect(screen.getByTestId('evidence-from-file')).toHaveTextContent(/is not in the email body/i)
    // and it opens on the files, not on a body with nothing in it
    const files = screen.getByTestId('evidence-files')
    expect(within(files).getByText(/报关单\.xlsx/)).toBeInTheDocument()
    expect(within(files).getByText('XLSX')).toBeInTheDocument()
    expect(within(files).getByText('PDF')).toBeInTheDocument()
    expect(within(files).getByText('5.4 MB')).toBeInTheDocument()
  })

  it('no attachments and no hit → no false promise of a file', () => {
    renderPanel('8203')
    expect(screen.queryByTestId('evidence-from-file')).toBeNull()
    expect(screen.queryByTestId('evidence-tab-files')).toBeNull()
  })

  it('a body that was never stored says so rather than showing nothing', () => {
    body.mockReturnValue({ data: { ...body().data, bodyText: null }, isLoading: false, isError: false })
    renderPanel('anything')
    expect(screen.getByTestId('evidence-panel')).toHaveTextContent(/not in the store/i)
  })

  it('closes', async () => {
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EvidencePanel emailId="db-1" value="x" onClose={onClose} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /close evidence/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
