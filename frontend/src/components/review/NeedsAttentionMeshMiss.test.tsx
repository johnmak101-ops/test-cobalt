import { describe, it, expect } from 'vitest'
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
