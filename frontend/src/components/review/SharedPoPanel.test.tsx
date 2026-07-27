import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SharedPoPanel } from './SharedPoPanel'
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

describe('SharedPoPanel — the reference the reason line never had', () => {
  it('names the other shipment and links to it', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" />)
    expect(screen.getByTestId('shared-po-panel')).toHaveTextContent(
      /PO 28631 is also on another shipment/i,
    )
    const link = screen.getByTestId('shared-po-open-C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
    // The Shipment ID — the name this leg answers to on the queue, the detail page and the focus
    // page. Labelling it by booking number gave one leg two names on two screens (#350).
    expect(link).toHaveTextContent('202605C7BD')
    expect(link).toHaveAttribute('href', '/shipments/C7BD41C9-402B-4A3A-8783-F9BCAAFFBEA4')
    // the carrier reference stays, as secondary matching detail
    expect(screen.getByTestId('shared-po-28631')).toHaveTextContent('FENLSO003044')
  })

  it('shows both quantities, so a partial is visible', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" />)
    const row = screen.getByTestId('shared-po-28631')
    expect(row).toHaveTextContent('600 PCS') // this leg
    expect(row).toHaveTextContent('400 PCS') // the other
  })

  it('leads with the sea/air question when the modes differ — without answering it', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ anyCrossMode: true, others: [leg({ mode: 'AIR', crossMode: true })] })]}
        mode="SEA"
      />,
    )
    const panel = screen.getByTestId('shared-po-panel')
    expect(panel).toHaveTextContent(/different transport mode/i)
    expect(panel).toHaveTextContent(/this leg is SEA/i)
    expect(within(panel).getByText('AIR')).toBeInTheDocument()
    // States the fact and holds the verdict open — the two readings are named as indistinguishable,
    // never resolved into one (de-correction: the desk surfaces, the operator decides).
    expect(panel).toHaveTextContent(/look alike/i)
    expect(panel.textContent).not.toMatch(/this is a mode change|switched to air|was mis-?linked/i)
  })

  it('asks the split question when both legs move the same way', () => {
    render(<SharedPoPanel sharedPos={[group()]} mode="SEA" />)
    expect(screen.getByTestId('shared-po-panel')).toHaveTextContent(
      /split across shipments, or linked here by mistake/i,
    )
  })

  it('marks a rejected sibling — it explains the overlap rather than competing', () => {
    render(<SharedPoPanel sharedPos={[group({ others: [leg({ dismissed: true })] })]} mode="SEA" />)
    expect(screen.getByTestId('shared-po-28631')).toHaveTextContent(/rejected/i)
  })

  it('marks a sibling still under review', () => {
    render(
      <SharedPoPanel sharedPos={[group({ others: [leg({ provisional: true })] })]} mode="SEA" />,
    )
    expect(screen.getByTestId('shared-po-28631')).toHaveTextContent(/still in review/i)
  })

  it('prefers ATD once the other leg has sailed', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ atd: '2026-02-11T00:00:00.000Z' })] })]}
        mode="SEA"
      />,
    )
    expect(screen.getByTestId('shared-po-28631')).toHaveTextContent('sailed 2026-02-11')
  })

  /** A leg whose booking number is `PO # :` was parsed from a spreadsheet header — printing that as
   *  the link text asks the operator to go and look at "PO # :". */
  it('skips a digit-free booking number for the carrier reference', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ bookingNo: 'PO # :', soNo: 'FENLSO003062' })] })]}
        mode="SEA"
      />,
    )
    const row = screen.getByTestId('shared-po-28631')
    expect(row).toHaveTextContent('FENLSO003062')
    expect(row).not.toHaveTextContent('PO # :')
  })

  it('shows no carrier reference at all when every identifier is digit-free', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ bookingNo: 'PO # :', soNo: 'SO no.' })] })]}
        mode="SEA"
      />,
    )
    const row = screen.getByTestId('shared-po-28631')
    // the leg still has a name — its Shipment ID — so the panel is never reduced to a uuid
    expect(row).toHaveTextContent('202605C7BD')
    expect(row).not.toHaveTextContent('PO # :')
    expect(row).not.toHaveTextContent('SO no.')
  })

  it('falls back to SO / B/L / short id when the sibling has no booking number', () => {
    render(
      <SharedPoPanel
        sharedPos={[group({ others: [leg({ bookingNo: null, soNo: 'FENLSO003062' })] })]}
        mode="SEA"
      />,
    )
    expect(screen.getByTestId('shared-po-28631')).toHaveTextContent('FENLSO003062')
  })

  it('counts the POs when more than one is shared', () => {
    render(
      <SharedPoPanel
        sharedPos={[group(), group({ poNumber: '28770' })]}
        mode="SEA"
      />,
    )
    expect(screen.getByTestId('shared-po-panel')).toHaveTextContent(
      /2 POs on this leg are also on other shipments/i,
    )
  })

  it('renders nothing when no PO is shared', () => {
    const { container } = render(<SharedPoPanel sharedPos={[]} />)
    expect(container).toBeEmptyDOMElement()
    // a group whose siblings were all filtered out server-side must not draw an empty box either
    const { container: c2 } = render(<SharedPoPanel sharedPos={[group({ others: [] })]} />)
    expect(c2).toBeEmptyDOMElement()
  })
})
