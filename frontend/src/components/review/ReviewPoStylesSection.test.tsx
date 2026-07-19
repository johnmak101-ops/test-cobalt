import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  proposedStyleForPo,
} from './ReviewPoStylesSection'
import type { LinkedPO } from '../../hooks/use-shipments'

const updateMutateAsync = vi.fn()
const toastMock = vi.fn()
toastMock.error = vi.fn()
toastMock.success = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useUpdatePurchaseOrder: () => ({
    mutate: vi.fn(),
    mutateAsync: updateMutateAsync,
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
    editing?: boolean
  } = {},
) {
  return render(
    <ReviewPoStylesSection
      shipmentId="ship-1"
      linkedPOs={over.linkedPOs ?? [po()]}
      reviewReasons={over.reviewReasons}
      readOnly={over.readOnly}
      editing={over.editing}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateMutateAsync.mockResolvedValue({})
})

describe('proposedStyleForPo', () => {
  it('extracts kept style from a PO-scoped item/style reason', () => {
    expect(
      proposedStyleForPo('6495962', [
        'PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)',
      ]),
    ).toBe('NEW-STYLE')
  })
})

describe('ReviewPoStylesSection', () => {
  it('renders each linked PO with current style (view mode)', () => {
    renderSection()
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows empty state when no linked POs', () => {
    renderSection({ linkedPOs: [] })
    expect(screen.getByText(/no POs on this shipment/i)).toBeInTheDocument()
  })

  it('has no Remove / Move / Use / row Edit', () => {
    renderSection({
      editing: true,
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^move/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^use$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('card Edit mode shows PO# and style inputs', () => {
    renderSection({ editing: true })
    expect(screen.getByRole('textbox', { name: /po number/i })).toHaveValue('6495962')
    expect(screen.getByRole('textbox', { name: /style for po/i })).toHaveValue('263121585')
  })

  it('Done editing (editing false) PATCHes dirty PO and style', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection({ editing: true })
    const poInput = screen.getByRole('textbox', { name: /po number/i })
    const styleInput = screen.getByRole('textbox', { name: /style for po/i })
    await user.clear(poInput)
    await user.type(poInput, '99999')
    await user.clear(styleInput)
    await user.type(styleInput, 'STYLE-X')

    rerender(
      <ReviewPoStylesSection
        shipmentId="ship-1"
        linkedPOs={[po()]}
        editing={false}
      />,
    )

    await vi.waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'po1', poNumber: '99999', itemStyleNo: 'STYLE-X' }),
      )
    })
  })

  it('readOnly ignores editing prop', () => {
    renderSection({ editing: true, readOnly: true })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows proposed style as read-only reference', () => {
    renderSection({
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    expect(screen.getByText('NEW-STYLE')).toBeInTheDocument()
  })

  it('uses the same 3-column shell as the field conflict table', () => {
    renderSection()
    const section = screen.getByTestId('review-po-styles-section')
    expect(within(section).getByRole('columnheader', { name: /^PO#$/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /current style/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /from email/i })).toBeInTheDocument()
  })
})
