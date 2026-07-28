import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// PartyPicker (now the control for a master-miss pick) queries the Mesh mirror; without this it
// would hit the real backend from jsdom.
vi.mock('../../hooks/use-parties', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/use-parties')>('../../hooks/use-parties')
  return {
    ...actual,
    useParties: () => ({
      data: [
        { id: '1', code: '367', name: 'LOGWIN AIR & OCEAN HONG KONG LTD' },
        { id: '2', code: '369', name: 'LOGWIN AIR+OCEAN' },
        { id: '3', code: '366', name: 'LOGWIN AIR & OCEAN CHINA LTD.SHENZHEN BRANCH' },
      ],
    }),
  }
})
import { NeedsAttentionMeshMiss } from './NeedsAttentionMeshMiss'
import type { NeedsAttentionItem } from './needs-attention'

const item: NeedsAttentionItem = {
  key: 'm-party-collapsed',
  lineId: 'm-party:collapsed',
  severity: 'medium',
  text: '3 parties not found in Mesh Database — advise add in Mesh.',
  category: 'master_miss',
  groupId: 'master_miss',
  details: ['Bro Group Logistics', 'South Ocean', 'Wiseknit'],
}

describe('NeedsAttentionMeshMiss', () => {
  it('starts collapsed and expands to show party names', async () => {
    const user = userEvent.setup()
    render(
      <ul>
        <NeedsAttentionMeshMiss item={item} />
      </ul>,
    )
    expect(screen.getByTestId('mesh-party-collapsed')).toBeInTheDocument()
    expect(screen.getByText(/Show 3 names/i)).toBeInTheDocument()
    expect(screen.queryByTestId('mesh-party-details')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getByTestId('mesh-party-details')).toBeInTheDocument()
    expect(screen.getByText('South Ocean')).toBeInTheDocument()
    expect(screen.getByText(/Hide names/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.queryByTestId('mesh-party-details')).not.toBeInTheDocument()
  })

  it('expands multi-port UN/LOCODE miss the same way', async () => {
    const user = userEvent.setup()
    const portItem: NeedsAttentionItem = {
      key: 'm-port-collapsed',
      lineId: 'm-port:collapsed',
      severity: 'medium',
      text: '4 ports not in UN/LOCODE masters — add or alias, then rematch',
      category: 'master_miss',
      groupId: 'master_miss',
      details: ['Atianta', 'HK for Japan', 'HKGHKG', 'HONGKONG'],
    }
    render(
      <ul>
        <NeedsAttentionMeshMiss item={portItem} />
      </ul>,
    )
    expect(screen.getByTestId('mesh-port-collapsed')).toBeInTheDocument()
    expect(screen.getByText(/Show 4 ports/i)).toBeInTheDocument()
    await user.click(screen.getByTestId('mesh-port-expand'))
    expect(screen.getByTestId('mesh-port-details')).toBeInTheDocument()
    expect(screen.getByText('HONGKONG')).toBeInTheDocument()
    expect(screen.getAllByText(/not in UN\/LOCODE masters/i).length).toBeGreaterThanOrEqual(2)
  })
})

describe('NeedsAttentionMeshMiss — five LOGWINs are a choice, not a missing company', () => {
  const LOGWIN = [
    'LOGWIN AIR & OCEAN HONG KONG LTD',
    'LOGWIN AIR+OCEAN',
    'LOGWIN AIR & OCEAN CHINA LTD.SHENZHEN BRANCH',
  ]
  const meshItem = {
    key: 'k',
    lineId: 'm-party:collapsed',
    severity: 'medium' as const,
    text: '"LOGWIN" matches 3 companies in Mesh — pick the right one.',
    category: 'master_miss' as const,
    groupId: 'master_miss' as const,
    details: ['LOGWIN'],
    meshCandidates: { LOGWIN },
  }
  const pickCtx = (onPick = vi.fn()) => ({
    kindFor: () => 'forwarder' as const,
    isMasterValue: (_k: 'forwarder' | 'customer' | 'vendor', v: string) => LOGWIN.includes(v),
    onPick,
  })

  it('uses the SAME PartyPicker as Customer Code and Vendor Code — one control, one decision', async () => {
    render(<ul><NeedsAttentionMeshMiss item={meshItem} pick={pickCtx()} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    const control = screen.getByTestId('mesh-candidate-picker').querySelector('input')!
    expect(control).toHaveAttribute('role', 'combobox')
    // seeded with the raw name, so the list opens already narrowed — no searching for what we know
    expect(control).toHaveValue('LOGWIN')
  })

  it('writes the value PartyPicker hands back, tagged with the raw name it replaces', async () => {
    const onPick = vi.fn()
    render(<ul><NeedsAttentionMeshMiss item={meshItem} pick={pickCtx(onPick)} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    await userEvent.click(screen.getByTestId('mesh-candidate-picker').querySelector('input')!)
    await userEvent.click(await screen.findByText('LOGWIN AIR+OCEAN'))
    expect(onPick).toHaveBeenCalledWith('LOGWIN', 'LOGWIN AIR+OCEAN')
  })

  it('a column it cannot identify on this leg lists the masters instead of offering a dead control', async () => {
    render(<ul><NeedsAttentionMeshMiss item={meshItem} pick={{ ...pickCtx(), kindFor: () => null }} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.queryByTestId('mesh-candidate-picker')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('mesh-candidate-name')).toHaveLength(3)
  })

  it('without a write path the candidates still show — read-only surfaces list, not act', async () => {
    render(<ul><NeedsAttentionMeshMiss item={meshItem} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getAllByTestId('mesh-candidate-name')).toHaveLength(3)
    expect(screen.queryByTestId('mesh-candidate-picker')).not.toBeInTheDocument()
  })

  it('a name with no candidates keeps the "not in Mesh" wording', async () => {
    const absent = { ...meshItem, details: ['KUEHNE NAGEL'], meshCandidates: undefined }
    render(<ul><NeedsAttentionMeshMiss item={absent} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getByText(/— not in Mesh/)).toBeInTheDocument()
  })
})
