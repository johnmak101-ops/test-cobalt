import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ReviewPoStylesSection,
  alsoSeenStyleForPo,
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

describe('alsoSeenStyleForPo', () => {
  it('extracts the style the thread resolved to', () => {
    expect(
      alsoSeenStyleForPo('6495962', [
        'PO 6495962: item/style "OLD" vs "NEW" (system read: NEW-STYLE)',
      ]),
    ).toBe('NEW-STYLE')
  })

  /**
   * Legacy wording. Every leg committed before the `(kept X)` → `(system read: X)` fix still carries
   * the old phrasing in review_reasons, and those rows must keep rendering — the reason strings are
   * recomputed per commit, not backfilled, so a leg nobody re-amends keeps its old sentence forever.
   */
  it('reads the legacy (kept X) wording too', () => {
    expect(
      alsoSeenStyleForPo('6495962', [
        'PO 6495962: item/style "OLD" vs "NEW" (kept NEW-STYLE)',
      ]),
    ).toBe('NEW-STYLE')
  })

  /**
   * The named value is `enr.itemStyleNo` — the resolver's rank-one pick, computed BEFORE anything is
   * written. When the PO already carries it there is nothing to show: the column exists to surface a
   * value the row does NOT have, and printing one it does have made leg 202601AEA6 read
   * "Shipping (1 change)" with nothing to change.
   */
  it('shows nothing when the PO already stores that style', () => {
    expect(
      alsoSeenStyleForPo(
        '6495962',
        ['PO 6495962: item/style "OLD" vs "NEW" (system read: NEW-STYLE)'],
        'NEW-STYLE',
      ),
    ).toBeNull()
  })

  it('shows nothing for a bare article code the stored style already carries', () => {
    // C192/FERN JUMPER already IS C192 — showing `C192` invited overwriting the fuller value.
    expect(
      alsoSeenStyleForPo(
        '28631',
        ['PO 28631: item/style "A" vs "B" (system read: C192)'],
        'C192/FERN JUMPER',
      ),
    ).toBeNull()
  })

  it('still shows a style the PO does not carry', () => {
    expect(
      alsoSeenStyleForPo(
        '28631',
        ['PO 28631: item/style "A" vs "B" (system read: C192)'],
        'C700/OTHER',
      ),
    ).toBe('C192')
    // and when the PO has no style at all
    expect(
      alsoSeenStyleForPo('28631', ['PO 28631: item/style "A" vs "B" (system read: C192)'], null),
    ).toBe('C192')
  })
})

describe('ReviewPoStylesSection — page-level Edit', () => {
  /** View mode lists only POs the thread stated a different style for (#2026-07-27) — so the fixture
   *  needs one, otherwise the row is correctly absent. Edit mode still shows every PO. */
  const PROPOSAL = ['PO 6495962: item/style "OLD" vs "NEW" (system read: 999-NEW-STYLE)']

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
    // third column tracks the card's state label; default = the shared wording. NOT "AI Proposed":
    // openDecisions strips settled conflicts upstream, so what lands here is what the committer
    // read and declined to write.
    expect(screen.getByTestId('po-proposed-column-header')).toHaveTextContent('Other values')
  })

  /** One box per style, never a comma blob — and every stored one opens TICKED, because what the
   *  shipment holds today is the default and dropping it has to be a deliberate click. */
  it('view: one tick box per style, all kept by default', () => {
    renderSection({
      reviewReasons: PROPOSAL,
      linkedPOs: [po({ itemStyleNo: 'AW26-XS-L, AW26-S-XL, AW26-M-XXL' })],
    })
    for (const tok of ['AW26-XS-L', 'AW26-S-XL', 'AW26-M-XXL']) {
      const box = screen.getByRole('checkbox', { name: `Keep style ${tok} on PO 6495962` })
      expect(box).toBeChecked()
    }
    expect(screen.queryByText(/AW26-XS-L, AW26-S-XL/)).not.toBeInTheDocument()
  })

  it('view: the seen value gets its own box, and it opens UNTICKED', () => {
    renderSection({ reviewReasons: PROPOSAL })
    // Pre-ticking would be "AI Proposed" again — this is a value upsertPo declined to write.
    expect(
      screen.getByRole('checkbox', { name: 'Add style 999-NEW-STYLE to PO 6495962' }),
    ).not.toBeChecked()
  })

  it('ticking composes the list and states what will be written', async () => {
    const user = userEvent.setup()
    renderSection({
      reviewReasons: PROPOSAL,
      linkedPOs: [po({ itemStyleNo: 'AW26-XS-L, JUNK' })],
    })
    await user.click(screen.getByRole('checkbox', { name: 'Keep style JUNK on PO 6495962' }))
    await user.click(
      screen.getByRole('checkbox', { name: 'Add style 999-NEW-STYLE to PO 6495962' }),
    )
    expect(screen.getByTestId('po-plan-po1')).toHaveTextContent('AW26-XS-L, 999-NEW-STYLE')
  })

  it('unticking every style says CLEAR, in words, before anyone presses Apply', async () => {
    const user = userEvent.setup()
    renderSection({ reviewReasons: PROPOSAL, linkedPOs: [po({ itemStyleNo: 'ONLY-ONE' })] })
    await user.click(screen.getByRole('checkbox', { name: 'Keep style ONLY-ONE on PO 6495962' }))
    expect(screen.getByTestId('po-plan-po1')).toHaveTextContent(/CLEAR/i)
  })

  it('reports the plan up so the card can count and apply it', async () => {
    const user = userEvent.setup()
    const onPlanChange = vi.fn()
    render(
      <ReviewPoStylesSection
        shipmentId="ship-1"
        linkedPOs={[po()]}
        reviewReasons={PROPOSAL}
        customerId="c1"
        onPlanChange={onPlanChange}
      />,
    )
    // Untouched → the card must be told there is nothing to write.
    expect(onPlanChange).toHaveBeenLastCalledWith([])
    await user.click(
      screen.getByRole('checkbox', { name: 'Add style 999-NEW-STYLE to PO 6495962' }),
    )
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ poId: 'po1', itemStyleNo: '263121585, 999-NEW-STYLE', clears: false }),
    ])
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
