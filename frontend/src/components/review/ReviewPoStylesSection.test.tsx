import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  proposedStyleForPo,
} from './ReviewPoStylesSection'
import type { LinkedPO } from '../../hooks/use-shipments'

const updateMutate = vi.fn()
const toastMock = vi.fn()
toastMock.error = vi.fn()
toastMock.success = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useUpdatePurchaseOrder: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}))

vi.mock('../ui/Toast', () => ({
  toast: Object.assign((msg: string) => toastMock(msg), {
    success: (msg: string) => toastMock.success(msg),
    error: (msg: string) => toastMock.error(msg),
  }),
}))

function po(over: Partial<LinkedPO> = {}): LinkedPO {
  return {
    id: 'po1',
    linkId: 'l1',
    poNumber: '6495962',
    quantity: null,
    totalQuantity: null,
    quantityUnit: null,
    itemStyleNo: '263121585',
    ...over,
  }
}

function renderSection(
  over: {
    linkedPOs?: LinkedPO[]
    reviewReasons?: string[]
    readOnly?: boolean
    shipmentId?: string
  } = {},
) {
  return render(
    <ReviewPoStylesSection
      shipmentId={over.shipmentId ?? 'ship-1'}
      linkedPOs={over.linkedPOs ?? [po()]}
      reviewReasons={over.reviewReasons}
      readOnly={over.readOnly}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('proposedStyleForPo', () => {
  it('extracts kept style from a PO-scoped item/style reason', () => {
    expect(
      proposedStyleForPo('6495962', [
        'PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)',
      ]),
    ).toBe('NEW-STYLE')
  })

  it('returns null when no matching reason', () => {
    expect(proposedStyleForPo('6495962', ['PO 999: brand conflict X (kept Y)'])).toBeNull()
  })
})

describe('ReviewPoStylesSection', () => {
  it('renders each linked PO with current style', () => {
    renderSection({
      linkedPOs: [po({ id: 'po1', poNumber: '6495962', itemStyleNo: '263121585' })],
    })
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.getByText(/POs & styles/i)).toBeInTheDocument()
  })

  it('shows empty state when no linked POs', () => {
    renderSection({ linkedPOs: [] })
    expect(screen.getByText(/no POs on this shipment/i)).toBeInTheDocument()
  })

  it('hides edit when readOnly', () => {
    renderSection({ readOnly: true })
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('has no Remove / Move / Use actions', () => {
    renderSection({
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^move/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^use$/i })).not.toBeInTheDocument()
  })

  it('uses the same 3-column shell as the field conflict table', () => {
    renderSection()
    const section = screen.getByTestId('review-po-styles-section')
    expect(within(section).getByRole('columnheader', { name: /^PO#$/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /current style/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /from email/i })).toBeInTheDocument()
  })

  it('Edit mode edits PO# and style, then Save patches both', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const poInput = screen.getByRole('textbox', { name: /po number/i })
    const styleInput = screen.getByRole('textbox', { name: /style for po/i })
    await user.clear(poInput)
    await user.type(poInput, '99999')
    await user.clear(styleInput)
    await user.type(styleInput, 'STYLE-X')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'po1', poNumber: '99999', itemStyleNo: 'STYLE-X' }),
      expect.anything(),
    )
  })

  it('Cancel leaves edit mode without saving', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('textbox', { name: /style for po/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('textbox', { name: /style for po/i })).not.toBeInTheDocument()
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('shows proposed style as read-only reference', () => {
    renderSection({
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    expect(screen.getByText('NEW-STYLE')).toBeInTheDocument()
  })

  it('renders dash when current style is empty', () => {
    renderSection({ linkedPOs: [po({ itemStyleNo: null })] })
    const row = screen.getByTestId('review-po-row-po1')
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
