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

describe('NeedsAttentionMeshMiss — names the masters, but does not ask for the decision', () => {
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

  it('lists the masters instead of claiming the company is missing', async () => {
    render(<ul><NeedsAttentionMeshMiss item={meshItem} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getAllByTestId('mesh-candidate-name')).toHaveLength(3)
    expect(screen.queryByText(/not in Mesh/)).not.toBeInTheDocument()
  })

  it('offers no control — the decision belongs to the conflict table, and asking twice is how a desk disagrees with itself', async () => {
    render(<ul><NeedsAttentionMeshMiss item={meshItem} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mesh-candidate-pick')).not.toBeInTheDocument()
  })

  it('a name with no candidates keeps the "not in Mesh" wording', async () => {
    const absent = { ...meshItem, details: ['KUEHNE NAGEL'], meshCandidates: undefined }
    render(<ul><NeedsAttentionMeshMiss item={absent} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getByText(/— not in Mesh/)).toBeInTheDocument()
  })
})
