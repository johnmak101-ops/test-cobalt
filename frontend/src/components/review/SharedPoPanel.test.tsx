import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SharedPoPanel, quantityNote } from './SharedPoPanel'
import type { SharedPo, SharedPoLeg } from '../../hooks/use-shipments'

const leg = (over: Partial<SharedPoLeg> = {}): SharedPoLeg => ({
  shipmentId: 'C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4',
  idAnchorAt: '2026-05-16T03:00:00.000Z',
  bookingNo: 'FENLSO003044',
  soNo: null,
  hblAwbFcrNo: null,
  mode: 'SEA',
  etd: '2026-02-08T00:00:00.000Z',
  atd: null,
  state: 'BOOKED',
  legNo: 1,
  dismissed: false,
  provisional: false,
  legQty: 400,
  legQtyUnit: 'PCS',
  crossMode: false,
  ...over,
})

const group = (over: Partial<SharedPo> = {}): SharedPo => ({
  poNumber: '28631',
  legQty: 600,
  legQtyUnit: 'PCS',
  others: [leg()],
  anyCrossMode: false,
  ...over,
})

const row = () => screen.getByTestId('shared-po-28631')

describe('SharedPoPanel — the two shipments in one table', () => {
  it('titles itself with the PO and the count, and asks for an answer', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" onAnswer={vi.fn()} />)
    expect(row()).toHaveTextContent(/PO 28631 is on 2 shipments/i)
    expect(screen.getByTestId('shared-po-28631-status')).toHaveTextContent('needs answer')
  })

  /** The old panel led with a heading restating the card's question and a paragraph explaining what
   *  a split is. The desk books freight daily; both went. */
  it('carries no restated question and no explanation of what a split is', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" onAnswer={vi.fn()} />)
    const t = row().textContent ?? ''
    expect(t).not.toMatch(/is this the right shipment/i)
    expect(t).not.toMatch(/usually that means|sometimes it means|both are real/i)
  })

  it('names the other shipment by its Shipment ID and links to it', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" />)
    const link = screen.getByTestId('shared-po-open-C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
    // The name the leg answers to on the queue, the detail page and the focus page (#350).
    expect(link).toHaveTextContent('202605C7BD')
    expect(link).toHaveAttribute('href', '/shipments/C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
  })

  it('puts both shipments on their own row with mode, qty, uom and date', () => {
    render(
      <SharedPoPanel sharedPos={[group()]} mode="AIR" etd="2026-02-01T00:00:00.000Z" />,
    )
    const self = screen.getByTestId('shared-po-self-28631')
    // "this one" was a pointer with nothing to point at; the row IS the shipment they have open.
    expect(self).toHaveTextContent('current shipment')
    expect(self).toHaveTextContent('AIR')
    expect(self).toHaveTextContent('2026-02-01')
    const other = screen.getByTestId('shared-po-other-C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
    expect(other).toHaveTextContent('SEA')
    expect(other).toHaveTextContent('400')
    expect(other).toHaveTextContent('2026-02-08')
  })

  it("prefers this shipment's ATD once it has left", () => {
    render(
      <SharedPoPanel
        sharedPos={[group()]}
        mode="AIR"
        etd="2026-02-01T00:00:00.000Z"
        atd="2026-02-03T00:00:00.000Z"
      />,
    )
    expect(screen.getByTestId('shared-po-self-28631')).toHaveTextContent('2026-02-03')
  })

  it('prefers ATD once the other shipment has sailed', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ atd: '2026-02-11T00:00:00.000Z' })] })]}
        mode="SEA"
      />,
    )
    expect(row()).toHaveTextContent('2026-02-11')
  })

  it('marks a rejected sibling — it explains the overlap rather than competing', () => {
    render(<SharedPoPanel sharedPos={[group({ others: [leg({ dismissed: true })] })]} mode="SEA" />)
    expect(row()).toHaveTextContent(/rejected/i)
  })

  it('marks a sibling still under review', () => {
    render(
      <SharedPoPanel sharedPos={[group({ others: [leg({ provisional: true })] })]} mode="SEA" />,
    )
    expect(row()).toHaveTextContent(/in review/i)
  })

  /** A leg whose booking number is `PO # :` was parsed from a spreadsheet header. It rides the link's
   *  tooltip now instead of taking a column, but a digit-free one must still never appear. */
  it('offers a digit-free identifier to nobody', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ bookingNo: 'PO # :', soNo: 'FENLSO003062' })] })]}
        mode="SEA"
      />,
    )
    const link = screen.getByTestId('shared-po-open-C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
    // On the wrapper, never the anchor: on the anchor it displaced the link's own accessible name.
    expect(link.closest('span')).toHaveAttribute('title', 'FENLSO003062')
    expect(link).not.toHaveAttribute('title')
    expect(row()).not.toHaveTextContent('PO # :')
  })

  it('renders one block per shared PO', () => {
    render(<SharedPoPanel sharedPos={[group(), group({ poNumber: '28770' })]} mode="SEA" />)
    expect(screen.getByTestId('shared-po-28631')).toBeInTheDocument()
    expect(screen.getByTestId('shared-po-28770')).toBeInTheDocument()
  })

  it('renders nothing when no PO is shared', () => {
    const { container } = render(<SharedPoPanel sharedPos={[]} />)
    expect(container).toBeEmptyDOMElement()
    const { container: c2 } = render(<SharedPoPanel sharedPos={[group({ others: [] })]} />)
    expect(c2).toBeEmptyDOMElement()
  })
})

/**
 * The old copy said "check the quantities" — on PO 1570988 that asked the operator to weigh 26 pieces
 * against 207 cartons, two measures that cannot be compared however long you look at them.
 */
describe('quantityNote — only arithmetic that is true', () => {
  it('adds them up when both are counted the same way', () => {
    expect(quantityNote(group())).toMatch(/1,000 PCS across both shipments/i)
  })

  it('refuses to compare pieces against cartons, and names both', () => {
    const note = quantityNote(
      group({
        legQty: 26,
        legQtyUnit: 'pieces',
        others: [leg({ legQty: 207, legQtyUnit: 'cartons' })],
      }),
    )
    expect(note).toMatch(/counted differently \(pieces and cartons\)/i)
    expect(note).not.toMatch(/233/)
  })

  it('says so when one side has no quantity at all', () => {
    expect(quantityNote(group({ others: [leg({ legQty: null })] }))).toMatch(
      /no quantity recorded/i,
    )
  })
})

/**
 * Radios alone were too narrow: what the desk reaches for first is usually to FIX the line the parser
 * read — the PO number, the quantity, the unit — and only then to say it belongs.
 */
describe('SharedPoPanel — correcting the line', () => {
  const editable = (onEdit = vi.fn()) => {
    const onAnswer = vi.fn()
    render(
      <SharedPoPanel
        sharedPos={[group({ legQty: 26, legQtyUnit: 'pieces' })]}
        mode="AIR"
        onAnswer={onAnswer}
        onEdit={onEdit}
      />,
    )
    return { onAnswer, onEdit }
  }

  it('seeds the fields from what the shipment stores', () => {
    editable()
    expect(screen.getByLabelText(/PO number on this shipment/i)).toHaveValue('28631')
    expect(screen.getByLabelText(/Quantity on this shipment/i)).toHaveValue('26')
    expect(screen.getByLabelText(/Unit on this shipment/i)).toHaveValue('pieces')
  })

  it('reports a typed PO number', async () => {
    const user = userEvent.setup()
    const { onEdit } = editable()
    await user.type(screen.getByLabelText(/PO number on this shipment/i), '9')
    expect(onEdit).toHaveBeenCalledWith('28631', { poNumber: '286319' })
  })

  it('reports a changed unit', async () => {
    const user = userEvent.setup()
    const { onEdit } = editable()
    await user.selectOptions(screen.getByLabelText(/Unit on this shipment/i), 'cartons')
    expect(onEdit).toHaveBeenCalledWith('28631', { qtyUnit: 'cartons' })
  })

  /** Opening the picker must never quietly drop what the document actually said. */
  it('keeps a stored unit that is not one of ours in the list', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ legQtyUnit: 'rolls' })]}
        mode="AIR"
        onAnswer={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    const sel = screen.getByLabelText(/Unit on this shipment/i)
    expect(within(sel).getByRole('option', { name: 'rolls' })).toBeInTheDocument()
    expect(sel).toHaveValue('rolls')
  })

  it('shows the stored values as text when nothing can be edited', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" />)
    expect(screen.queryByLabelText(/Quantity on this shipment/i)).toBeNull()
    expect(screen.getByTestId('shared-po-self-28631')).toHaveTextContent('600')
  })
})

describe('SharedPoPanel — the answers', () => {
  it('offers all three and reports the pick', async () => {
    const onAnswer = vi.fn()
    const user = userEvent.setup()
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" onAnswer={onAnswer} onEdit={vi.fn()} />)

    await user.click(within(screen.getByTestId('shared-po-answer-split-28631')).getByRole('radio'))
    expect(onAnswer).toHaveBeenCalledWith('28631', 'split')
    await user.click(within(screen.getByTestId('shared-po-answer-remove-28631')).getByRole('radio'))
    expect(onAnswer).toHaveBeenCalledWith('28631', 'remove')
    await user.click(within(screen.getByTestId('shared-po-answer-correct-28631')).getByRole('radio'))
    expect(onAnswer).toHaveBeenCalledWith('28631', 'correct')
  })

  it('preselects nothing — the panel proposes no verdict', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" onAnswer={vi.fn()} onEdit={vi.fn()} />)
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked()
  })

  it('reflects the answer the card is holding', () => {
    render(
      <SharedPoPanel
        sharedPos={[group()]}
        mode="SEA"
        onAnswer={vi.fn()}
        answers={{ '28631': 'remove' }}
      />,
    )
    expect(
      within(screen.getByTestId('shared-po-answer-remove-28631')).getByRole('radio'),
    ).toBeChecked()
  })

  /** Promising a removal the card cannot perform is the same dead end one level deeper. */
  it('hides the removal when the card cannot unlink that PO', () => {
    render(
      <SharedPoPanel
        sharedPos={[group()]}
        mode="SEA"
        onAnswer={vi.fn()}
        removable={{ '28631': false }}
      />,
    )
    expect(screen.getByTestId('shared-po-answer-split-28631')).toBeInTheDocument()
    expect(screen.queryByTestId('shared-po-answer-remove-28631')).toBeNull()
  })

  it('hides "keep with my corrections" when nothing is editable', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" onAnswer={vi.fn()} />)
    expect(screen.queryByTestId('shared-po-answer-correct-28631')).toBeNull()
  })

  it('shows the facts, no pill and no radios when nobody can answer', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" readOnly />)
    expect(screen.getByTestId('shared-po-28631-status')).toHaveTextContent('no action')
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })
})
