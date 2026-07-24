import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PurchaseOrdersCard } from './PurchaseOrdersCard'
import type { LinkedPO } from '../../hooks/use-shipments'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const delMutate = vi.fn()
const linkMutate = vi.fn()
const unlinkMutate = vi.fn()

vi.mock('../../hooks/use-purchase-orders', () => ({
  useCreatePurchaseOrder: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePurchaseOrder: () => ({ mutate: updateMutate, isPending: false }),
  useDeletePurchaseOrder: () => ({ mutate: delMutate, isPending: false }),
  useLinkShipmentToPO: () => ({ mutate: linkMutate, isPending: false }),
  useUnlinkShipmentFromPO: () => ({ mutate: unlinkMutate, isPending: false }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

function po(over: Partial<LinkedPO> = {}): LinkedPO {
  return {
    id: 'po1',
    linkId: 'link1',
    poNumber: '76075',
    quantity: null,
    totalQuantity: 100,
    quantityUnit: 'pieces',
    itemStyleNo: null,
    ...over,
  }
}

function renderCard(linkedPOs: LinkedPO[] = [po()], customerId: string | null = 'c1') {
  return render(
    <PurchaseOrdersCard
      shipmentId="s1"
      customerId={customerId}
      linkedPOs={linkedPOs}
      shipmentQty={null}
      shipmentQtyUnit={null}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

/** Expand the card and enter CRUD mode (Edit). */
async function enterCrudMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('pos-card-toggle'))
  await user.click(screen.getByTestId('po-crud-edit'))
}

describe('PurchaseOrdersCard — full CRUD', () => {
  it('is view-only until Edit enters CRUD mode', async () => {
    const user = userEvent.setup()
    renderCard()
    expect(screen.queryByTestId('po-add')).toBeNull()
    expect(screen.queryByTestId('po-crud-edit')).toBeNull() // hidden while collapsed
    await user.click(screen.getByTestId('pos-card-toggle'))
    expect(screen.getByTestId('po-crud-edit')).toBeInTheDocument()
    expect(screen.queryByTestId('po-add')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit PO' })).toBeNull()
    await user.click(screen.getByTestId('po-crud-edit'))
    expect(screen.getByTestId('po-add')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit PO' })).toBeInTheDocument()
    expect(screen.getByTestId('po-crud-done')).toBeInTheDocument()
  })

  it('Add PO is hidden until expanded + CRUD mode, then creates a PO with the customer attached', async () => {
    const user = userEvent.setup()
    renderCard()
    expect(screen.queryByTestId('po-add')).toBeNull() // hidden while collapsed
    await enterCrudMode(user)
    await user.click(screen.getByTestId('po-add'))
    const row = screen.getByTestId('po-add-row')
    await user.type(within(row).getByPlaceholderText('PO number'), '99999')
    await user.type(within(row).getByPlaceholderText('Style / item no. — or paste a list'), 'STYLE-9')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate.mock.calls[0][0]).toMatchObject({ poNumber: '99999', customerId: 'c1', itemStyleNo: 'STYLE-9' })
  })

  it('Edit updates the PO fields', async () => {
    const user = userEvent.setup()
    renderCard()
    await enterCrudMode(user)
    await user.click(screen.getByRole('button', { name: 'Edit PO' }))
    const row = screen.getByTestId('po-edit-po1')
    await user.type(within(row).getByPlaceholderText('Style / item no. — or paste a list'), 'STYLE-1')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ id: 'po1', poNumber: '76075', itemStyleNo: 'STYLE-1' })
  })

  it('Unlink removes the PO from this shipment (after confirm)', async () => {
    const user = userEvent.setup()
    renderCard()
    await enterCrudMode(user)
    await user.click(screen.getByRole('button', { name: 'Remove from this shipment' }))
    await user.click(screen.getByTestId('po-confirm-yes'))
    expect(unlinkMutate).toHaveBeenCalledWith({ poId: 'po1', linkId: 'link1' }, expect.anything())
    expect(delMutate).not.toHaveBeenCalled()
  })

  it('Delete removes the PO everywhere (after confirm)', async () => {
    const user = userEvent.setup()
    renderCard()
    await enterCrudMode(user)
    await user.click(screen.getByRole('button', { name: 'Delete PO everywhere' }))
    await user.click(screen.getByTestId('po-confirm-yes'))
    expect(delMutate).toHaveBeenCalledWith('po1', expect.anything())
  })

  it('hides Unlink when a PO has no shipment link id', async () => {
    const user = userEvent.setup()
    renderCard([po({ linkId: null })])
    await enterCrudMode(user)
    expect(screen.queryByRole('button', { name: 'Remove from this shipment' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete PO everywhere' })).toBeInTheDocument()
  })

  it('Done exits CRUD mode and hides row actions', async () => {
    const user = userEvent.setup()
    renderCard()
    await enterCrudMode(user)
    expect(screen.getByRole('button', { name: 'Edit PO' })).toBeInTheDocument()
    await user.click(screen.getByTestId('po-crud-done'))
    expect(screen.queryByRole('button', { name: 'Edit PO' })).toBeNull()
    expect(screen.queryByTestId('po-add')).toBeNull()
    expect(screen.getByTestId('po-crud-edit')).toBeInTheDocument()
  })
})

describe('PurchaseOrdersCard — Item/Style as a structured list (parity with the review queue)', () => {
  it('renders a multi-style value one per line, not a comma blob', async () => {
    const user = userEvent.setup()
    renderCard([po({ itemStyleNo: '56571/SS26SW022, 56572/SS26SW023' })])
    await user.click(screen.getByTestId('pos-card-toggle'))

    const display = screen.getByTestId('style-list-display')
    const items = within(display).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('56571/SS26SW022')
    expect(items[1]).toHaveTextContent('56572/SS26SW023')
  })

  it('edits each style as its own row and saves the serialized list', async () => {
    const user = userEvent.setup()
    renderCard([po({ itemStyleNo: '56571/SS26SW022, 56572/SS26SW023' })])
    await enterCrudMode(user)
    await user.click(screen.getByTitle('Edit PO'))

    const editor = screen.getByTestId('style-list-editor')
    expect(within(editor).getAllByPlaceholderText('Style / item no. — or paste a list')).toHaveLength(2)

    await user.click(within(editor).getByRole('button', { name: /add style/i }))
    await user.type(within(editor).getByLabelText('Item / Style PO 3'), '56573')
    await user.type(within(editor).getByLabelText('Item / Style style 3'), 'SS26SW024')
    await user.click(screen.getByTitle('Save'))

    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      id: 'po1',
      poNumber: '76075',
      itemStyleNo: '56571/SS26SW022, 56572/SS26SW023, 56573/SS26SW024',
    })
  })
})
