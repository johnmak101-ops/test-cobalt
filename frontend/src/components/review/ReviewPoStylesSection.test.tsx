import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  proposedStyleForPo,
} from './ReviewPoStylesSection'
import type { LinkedPO } from '../../hooks/use-shipments'

const createMutate = vi.fn()
const updateMutateAsync = vi.fn()
const unlinkMutate = vi.fn()
const linkMutate = vi.fn()
const toastMock = vi.fn()
toastMock.error = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useCreatePurchaseOrder: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePurchaseOrder: () => ({
    mutate: vi.fn(),
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
  useUnlinkShipmentFromPO: () => ({ mutate: unlinkMutate, isPending: false }),
  useLinkShipmentToPO: () => ({ mutate: linkMutate, isPending: false }),
}))

vi.mock('../ui/Toast', () => ({
  toast: Object.assign((msg: string) => toastMock(msg), {
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
      customerId="c1"
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateMutateAsync.mockResolvedValue({})
})

describe('proposedStyleForPo', () => {
  it('extracts kept style', () => {
    expect(
      proposedStyleForPo('6495962', [
        'PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)',
      ]),
    ).toBe('NEW-STYLE')
  })
})

describe('ReviewPoStylesSection — page-level Edit', () => {
  it('view: values only, no section Edit button', () => {
    renderSection()
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.queryByTestId('review-po-crud-edit')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('card Edit: all rows become inputs at once', () => {
    renderSection({
      editing: true,
      linkedPOs: [
        po({ id: 'po1', poNumber: 'A', itemStyleNo: '1' }),
        po({ id: 'po2', poNumber: 'B', itemStyleNo: '2' }),
      ],
    })
    expect(screen.getAllByRole('textbox', { name: /po number/i })).toHaveLength(2)
    expect(screen.getAllByRole('textbox', { name: /style for po/i })).toHaveLength(2)
    expect(screen.getByTestId('review-po-add')).toBeInTheDocument()
  })

  it('Done editing flushes dirty PO drafts', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection({ editing: true })
    await user.clear(screen.getByRole('textbox', { name: /po number/i }))
    await user.type(screen.getByRole('textbox', { name: /po number/i }), '99999')
    await user.clear(screen.getByRole('textbox', { name: /style for po/i }))
    await user.type(screen.getByRole('textbox', { name: /style for po/i }), 'STY')

    rerender(
      <ReviewPoStylesSection
        shipmentId="ship-1"
        linkedPOs={[po()]}
        editing={false}
        customerId="c1"
      />,
    )

    await vi.waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'po1', poNumber: '99999', itemStyleNo: 'STY' }),
      )
    })
  })

  it('Add PO while editing', async () => {
    const user = userEvent.setup()
    createMutate.mockImplementation((_b: unknown, o: { onSuccess?: (v: unknown) => void }) => {
      o.onSuccess?.({ id: 'po-new' })
    })
    linkMutate.mockImplementation((_b: unknown, o: { onSuccess?: () => void }) => {
      o.onSuccess?.()
    })
    renderSection({ editing: true })
    await user.click(screen.getByTestId('review-po-add'))
    const add = screen.getByTestId('review-po-add-row')
    await user.type(within(add).getByLabelText(/new po number/i), '888')
    await user.type(within(add).getByLabelText(/new item/i), 'S8')
    await user.click(within(add).getByTitle('Save'))
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ poNumber: '888', itemStyleNo: 'S8' }),
      expect.anything(),
    )
  })

  it('unlink while editing', async () => {
    const user = userEvent.setup()
    renderSection({ editing: true })
    await user.click(screen.getByTitle('Remove from this shipment'))
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(unlinkMutate).toHaveBeenCalledWith(
      { poId: 'po1', linkId: 'l1' },
      expect.anything(),
    )
  })

  it('readOnly ignores editing', () => {
    renderSection({ editing: true, readOnly: true })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
