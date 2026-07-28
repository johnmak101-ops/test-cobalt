import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const item = {
    key: 'k',
    lineId: 'm-party:collapsed',
    severity: 'medium' as const,
    text: '1 party is not linked to Mesh — each already exists there. Expand to pick.',
    category: 'master_miss' as const,
    groupId: 'master_miss' as const,
    details: ['LOGWIN'],
    meshCandidates: { LOGWIN },
  }

  it('offers each master as a pick, instead of saying the company is missing', async () => {
    render(<ul><NeedsAttentionMeshMiss item={item} onPick={vi.fn()} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getAllByTestId('mesh-candidate-pick')).toHaveLength(3)
    expect(screen.queryByText(/not in Mesh/)).not.toBeInTheDocument()
  })

  it('passes the raw name AND the chosen master up, so the page knows what to write', async () => {
    const onPick = vi.fn()
    render(<ul><NeedsAttentionMeshMiss item={item} onPick={onPick} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    await userEvent.click(screen.getByRole('button', { name: 'LOGWIN AIR+OCEAN' }))
    expect(onPick).toHaveBeenCalledWith('LOGWIN', 'LOGWIN AIR+OCEAN')
  })

  it('without a write path the candidates still show — read-only surfaces list, not act', async () => {
    render(<ul><NeedsAttentionMeshMiss item={item} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getAllByTestId('mesh-candidate-name')).toHaveLength(3)
    expect(screen.queryByTestId('mesh-candidate-pick')).not.toBeInTheDocument()
  })

  it('a name with no candidates keeps the "not in Mesh" wording', async () => {
    const absent = { ...item, details: ['KUEHNE NAGEL'], meshCandidates: undefined }
    render(<ul><NeedsAttentionMeshMiss item={absent} /></ul>)
    await userEvent.click(screen.getByTestId('mesh-party-expand'))
    expect(screen.getByText(/— not in Mesh/)).toBeInTheDocument()
  })
})
