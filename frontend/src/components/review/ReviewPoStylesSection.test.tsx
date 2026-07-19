import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  proposedStyleForPo,
} from './ReviewPoStylesSection'
import type { LinkedPO } from '../../hooks/use-shipments'

const updateMutate = vi.fn()
const unlinkMutate = vi.fn()
const unlinkMutateAsync = vi.fn()
const linkMutateAsync = vi.fn()
const toastMock = vi.fn()
toastMock.error = vi.fn()
toastMock.success = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useUpdatePurchaseOrder: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
  useUnlinkShipmentFromPO: () => ({
    mutate: unlinkMutate,
    mutateAsync: unlinkMutateAsync,
    isPending: false,
  }),
  useLinkShipmentToPO: () => ({
    mutate: vi.fn(),
    mutateAsync: linkMutateAsync,
    isPending: false,
  }),
}))
// isPending stays false; busyPoId covers in-flight UI

vi.mock('../ui/Toast', () => ({
  toast: Object.assign((msg: string) => toastMock(msg), {
    success: (msg: string) => toastMock.success(msg),
    error: (msg: string) => toastMock.error(msg),
  }),
}))

vi.mock('./ShipmentSearchPicker', () => ({
  ShipmentSearchPicker: ({
    onSelect,
  }: {
    onSelect: (id: string, hit: { id: string; bookingNo: string | null }) => void
  }) => (
    <button
      type="button"
      onClick={() => onSelect('ship-9', { id: 'ship-9', bookingNo: 'BK-9' })}
    >
      pick-ship-9
    </button>
  ),
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
  unlinkMutateAsync.mockResolvedValue(undefined)
  linkMutateAsync.mockResolvedValue(undefined)
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
    expect(proposedStyleForPo('6495962', [])).toBeNull()
  })

  it('strips surrounding quotes from kept value', () => {
    expect(
      proposedStyleForPo('6495962', ['PO 6495962: item/style conflict (kept "ABC-1")']),
    ).toBe('ABC-1')
  })
})

describe('ReviewPoStylesSection', () => {
  it('renders each linked PO with current style', () => {
    renderSection({
      linkedPOs: [po({ id: 'po1', linkId: 'l1', poNumber: '6495962', itemStyleNo: '263121585' })],
    })
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.getByText(/POs & styles/i)).toBeInTheDocument()
  })

  it('shows empty state when no linked POs', () => {
    renderSection({ linkedPOs: [] })
    expect(screen.getByText(/no POs on this shipment/i)).toBeInTheDocument()
  })

  it('hides actions when readOnly', () => {
    renderSection({ readOnly: true })
    expect(screen.queryByRole('button', { name: /^take$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^move/i })).not.toBeInTheDocument()
  })

  it('uses the same table shell as the field conflict table', () => {
    renderSection()
    const section = screen.getByTestId('review-po-styles-section')
    expect(section.querySelector('table')).toBeTruthy()
    expect(within(section).getByRole('columnheader', { name: /^PO#$/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /current style/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /from email/i })).toBeInTheDocument()
    expect(within(section).getByRole('columnheader', { name: /actions/i })).toBeInTheDocument()
  })

  it('Take proposed PATCHes itemStyleNo', async () => {
    const user = userEvent.setup()
    renderSection({
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    await user.click(screen.getByRole('button', { name: /^take$/i }))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'po1', itemStyleNo: 'NEW-STYLE' }),
      expect.anything(),
    )
  })

  it('hides Take when no proposed style', () => {
    renderSection({ reviewReasons: [] })
    expect(screen.queryByRole('button', { name: /^take$/i })).not.toBeInTheDocument()
  })

  it('Edit + Save PATCHes free-text style', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const input = screen.getByRole('textbox', { name: /style/i })
    await user.clear(input)
    await user.type(input, 'STYLE-EDITED')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'po1', itemStyleNo: 'STYLE-EDITED' }),
      expect.anything(),
    )
  })

  it('Remove unlinks this shipment', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(unlinkMutate).toHaveBeenCalledWith(
      { poId: 'po1', linkId: 'l1' },
      expect.anything(),
    )
  })

  it('Remove without linkId toasts and does not call unlink', async () => {
    const user = userEvent.setup()
    renderSection({ linkedPOs: [po({ linkId: null })] })
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(unlinkMutate).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringMatching(/open full shipment/i),
    )
  })

  it('Move: unlink then link to selected shipment', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /^move/i }))
    await user.click(screen.getByRole('button', { name: /pick-ship-9/i }))
    expect(unlinkMutateAsync).toHaveBeenCalledWith({ poId: 'po1', linkId: 'l1' })
    expect(linkMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ poId: 'po1', shipmentId: 'ship-9' }),
    )
  })

  it('Move partial failure: unlink ok, link fails → clear toast', async () => {
    const user = userEvent.setup()
    unlinkMutateAsync.mockResolvedValue(undefined)
    linkMutateAsync.mockRejectedValue(new Error('link failed'))
    renderSection()
    await user.click(screen.getByRole('button', { name: /^move/i }))
    await user.click(screen.getByRole('button', { name: /pick-ship-9/i }))
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringMatching(/removed here but failed to link/i),
    )
  })

  it('renders dash when current style is empty', () => {
    renderSection({ linkedPOs: [po({ itemStyleNo: null })] })
    const row = screen.getByTestId('review-po-row-po1')
    // Current style + proposed both render —
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
