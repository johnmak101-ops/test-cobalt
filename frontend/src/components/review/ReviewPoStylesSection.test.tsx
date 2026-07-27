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
const toastError = vi.fn()
const toastMock = Object.assign(vi.fn(), { error: toastError })

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
    error: (msg: string) => toastError(msg),
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

  /**
   * `(kept X)` records what the committer's reconciler ALREADY wrote (po-enrichment.ts:
   * summarizeStyleConflict(styleConflict, enr.itemStyleNo)). When the PO carries it, offering it as
   * an AI proposal advertised a change that writes back the value already on the row — leg
   * 202601AEA6 read "Shipping (1 change)" with nothing to change.
   */
  it('does not re-propose a kept style the PO already stores', () => {
    expect(
      proposedStyleForPo(
        '6495962',
        ['PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)'],
        'NEW-STYLE',
      ),
    ).toBeNull()
  })

  it('does not propose a bare article code the stored style already carries', () => {
    // C192/FERN JUMPER already IS C192 — proposing `C192` invited overwriting the fuller value.
    expect(
      proposedStyleForPo('28631', ['PO 28631: item/style "A" vs "B" (kept C192)'], 'C192/FERN JUMPER'),
    ).toBeNull()
  })

  it('still proposes a kept style the PO does not carry', () => {
    expect(
      proposedStyleForPo('28631', ['PO 28631: item/style "A" vs "B" (kept C192)'], 'C700/OTHER'),
    ).toBe('C192')
    // and when the PO has no style at all
    expect(
      proposedStyleForPo('28631', ['PO 28631: item/style "A" vs "B" (kept C192)'], null),
    ).toBe('C192')
  })
})

describe('ReviewPoStylesSection — page-level Edit', () => {
  /** View mode lists only POs the email proposes a change for (#2026-07-27) — so the fixture needs
   *  a proposal, otherwise the row is correctly absent. Edit mode still shows every PO. */
  const PROPOSAL = ['PO 6495962: item/style "OLD" vs "NEW" (kept 999-NEW-STYLE)']

  it('view: values only, no section Edit button', () => {
    renderSection({ reviewReasons: PROPOSAL })
    expect(screen.getByText('6495962')).toBeInTheDocument()
    expect(screen.getByText('263121585')).toBeInTheDocument()
    expect(screen.queryByTestId('review-po-crud-edit')).not.toBeInTheDocument()
  })

  it('always names its own columns — PO / Item/Style header row (#358)', () => {
    renderSection({ reviewReasons: PROPOSAL })
    expect(screen.getByRole('columnheader', { name: 'PO' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Item/Style' })).toBeInTheDocument()
    // third column tracks the card's state label; default = the shared proposed wording
    expect(screen.getByTestId('po-proposed-column-header')).toHaveTextContent('From email / AI')
  })

  it('view: multi-style value is one line per style, not a comma blob', () => {
    renderSection({
      reviewReasons: PROPOSAL,
      linkedPOs: [
        po({
          itemStyleNo: 'AW26-XS-L, AW26-S-XL, AW26-M-XXL',
        }),
      ],
    })
    // Two style lists now render — the stored one and the proposal; this asserts the stored cell.
    const list = screen.getAllByTestId('style-list-display')[0]!
    expect(within(list).getByText('AW26-XS-L')).toBeInTheDocument()
    expect(within(list).getByText('AW26-S-XL')).toBeInTheDocument()
    expect(within(list).getByText('AW26-M-XXL')).toBeInTheDocument()
    expect(screen.queryByText(/AW26-XS-L, AW26-S-XL/)).not.toBeInTheDocument()
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
    // Style list editor uses one field per style (+ optional empty row UX)
    expect(screen.getAllByTestId('style-list-editor')).toHaveLength(2)
    expect(screen.getByTestId('review-po-add')).toBeInTheDocument()
  })

  it('Done editing flushes dirty PO drafts', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection({ editing: true })
    await user.clear(screen.getByRole('textbox', { name: /po number/i }))
    await user.type(screen.getByRole('textbox', { name: /po number/i }), '99999')
    const styleField = screen.getByPlaceholderText(/style \/ item no/i)
    await user.clear(styleField)
    await user.type(styleField, 'STY')

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
