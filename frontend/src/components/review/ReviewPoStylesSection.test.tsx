import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  proposedStyleForPo,
} from './ReviewPoStylesSection'
import type { LinkedPO } from '../../hooks/use-shipments'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const unlinkMutate = vi.fn()
const linkMutate = vi.fn()
const toastMock = vi.fn()
toastMock.error = vi.fn()
toastMock.success = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useCreatePurchaseOrder: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePurchaseOrder: () => ({ mutate: updateMutate, isPending: false }),
  useUnlinkShipmentFromPO: () => ({ mutate: unlinkMutate, isPending: false }),
  useLinkShipmentToPO: () => ({ mutate: linkMutate, isPending: false }),
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
    customerId?: string | null
  } = {},
) {
  return render(
    <ReviewPoStylesSection
      shipmentId="ship-1"
      linkedPOs={over.linkedPOs ?? [po()]}
      reviewReasons={over.reviewReasons}
      readOnly={over.readOnly}
      customerId={over.customerId ?? 'c1'}
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
})

describe('ReviewPoStylesSection — detail-like CRUD', () => {
  it('view mode: PO + style, no action icons until Edit', () => {
    renderSection()
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.getByTestId('review-po-crud-edit')).toBeInTheDocument()
    expect(screen.queryByTitle('Edit PO')).not.toBeInTheDocument()
  })

  it('hides CRUD when readOnly', () => {
    renderSection({ readOnly: true })
    expect(screen.queryByTestId('review-po-crud-edit')).not.toBeInTheDocument()
  })

  it('Edit enters CRUD mode with pencil and unlink icons', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('review-po-crud-edit'))
    expect(screen.getByTestId('review-po-crud-done')).toBeInTheDocument()
    expect(screen.getByTestId('review-po-add')).toBeInTheDocument()
    expect(screen.getByTitle('Edit PO')).toBeInTheDocument()
    expect(screen.getByTitle('Remove from this shipment')).toBeInTheDocument()
  })

  it('pencil opens inline edit; Save patches PO# and style', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('review-po-crud-edit'))
    await user.click(screen.getByTitle('Edit PO'))
    const row = screen.getByTestId('review-po-edit-po1')
    const poInput = within(row).getByRole('textbox', { name: /po number/i })
    const styleInput = within(row).getByRole('textbox', { name: /style for po/i })
    await user.clear(poInput)
    await user.type(poInput, '99999')
    await user.clear(styleInput)
    await user.type(styleInput, 'STYLE-X')
    await user.click(within(row).getByTitle('Save'))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'po1', poNumber: '99999', itemStyleNo: 'STYLE-X' }),
      expect.anything(),
    )
  })

  it('Add PO creates and links', async () => {
    const user = userEvent.setup()
    createMutate.mockImplementation((_body: unknown, opts: { onSuccess?: (v: unknown) => void }) => {
      opts.onSuccess?.({ id: 'po-new' })
    })
    linkMutate.mockImplementation((_body: unknown, opts: { onSuccess?: () => void }) => {
      opts.onSuccess?.()
    })
    renderSection()
    await user.click(screen.getByTestId('review-po-crud-edit'))
    await user.click(screen.getByTestId('review-po-add'))
    const addRow = screen.getByTestId('review-po-add-row')
    await user.type(within(addRow).getByPlaceholderText('PO number'), '88888')
    await user.type(within(addRow).getByPlaceholderText('Item / style'), 'STY-8')
    await user.click(within(addRow).getByTitle('Save'))
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ poNumber: '88888', itemStyleNo: 'STY-8', customerId: 'c1' }),
      expect.anything(),
    )
    expect(linkMutate).toHaveBeenCalledWith(
      expect.objectContaining({ poId: 'po-new', shipmentId: 'ship-1' }),
      expect.anything(),
    )
  })

  it('unlink confirms then unlinks', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('review-po-crud-edit'))
    await user.click(screen.getByTitle('Remove from this shipment'))
    expect(screen.getByTestId('review-po-unlink-confirm-po1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(unlinkMutate).toHaveBeenCalledWith(
      { poId: 'po1', linkId: 'l1' },
      expect.anything(),
    )
  })

  it('shows proposed style as read-only reference', () => {
    renderSection({
      reviewReasons: ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
    })
    expect(screen.getByText('NEW-STYLE')).toBeInTheDocument()
  })
})
