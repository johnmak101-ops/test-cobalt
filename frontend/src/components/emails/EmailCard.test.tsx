import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { EmailCard } from './EmailCard'
import type { ShippingEmail } from '../../hooks/use-emails'

vi.mock('../../lib/api', () => ({
  downloadAttachment: vi.fn(async () => undefined),
}))

vi.mock('../../hooks/use-emails', () => ({
  useEmailAttachments: () => ({
    data: {
      attachments: [
        {
          id: 'att-1',
          emailId: 'em-1',
          filename: 'BOOKING.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    },
  }),
  useMarkEmailRead: () => ({ mutate: vi.fn() }),
}))

const baseEmail: ShippingEmail = {
  id: 'em-1',
  messageId: null,
  subject: 'RE: Booking SBK0003738884 // ETD 7/10',
  sender: 'quinny.chen@lns.maersk.com',
  receivedAt: '2026-07-01T12:00:00Z',
  emailType: 'BOOKING_CONFIRMATION',
  extractedData: JSON.stringify({ so_no: 'SBK0003738884' }),
  extractionConfidence: null,
  shipmentId: 'ship-1',
  isMatched: true,
  isRead: true,
  processingStatus: 'PROCESSED',
  reviewStatus: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNotes: null,
  createdAt: '2026-07-01T12:00:00Z',
}

function renderCard(overrides: Partial<ShippingEmail> = {}) {
  return render(
    <MemoryRouter>
      <EmailCard email={{ ...baseEmail, ...overrides }} />
    </MemoryRouter>,
  )
}

function spyOnWindowOpen() {
  return vi.spyOn(window, 'open').mockReturnValue(null)
}

describe('EmailCard row click', () => {
  let openSpy: ReturnType<typeof spyOnWindowOpen>

  beforeEach(() => {
    openSpy = spyOnWindowOpen()
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('opens the email reading window when the row is clicked', async () => {
    renderCard()
    await userEvent.click(screen.getByText(baseEmail.subject))

    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url, name, features] = openSpy.mock.calls[0]
    expect(url).toBe(`/email/em-1?type=${encodeURIComponent('BOOKING_CONFIRMATION')}`)
    expect(name).toBe('email_em-1')
    expect(features).toContain('popup')
  })

  it('omits the type param value when emailType is null', async () => {
    renderCard({ emailType: null })
    await userEvent.click(screen.getByText(baseEmail.subject))

    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0][0]).toBe('/email/em-1?type=')
  })

  it('does not open the window when inner controls are clicked', async () => {
    const { downloadAttachment } = await import('../../lib/api')
    renderCard()

    await userEvent.click(screen.getByRole('link', { name: /view shipment/i }))
    // both the filename and the icon are download buttons now
    for (const el of screen.getAllByTitle('Download BOOKING.pdf')) {
      await userEvent.click(el)
    }
    // Toggle last — collapsing hides the panel (and the links above) once clicked.
    await userEvent.click(screen.getByRole('button', { name: /ai extracted/i }))

    expect(openSpy).not.toHaveBeenCalled()
    expect(downloadAttachment).toHaveBeenCalledWith('att-1', 'BOOKING.pdf')
  })
})
