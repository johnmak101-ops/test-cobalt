import { describe, it, expect } from 'vitest'
import { aiCommentLine, bandLabel, type CriticReviewCompact } from './critic-review'

describe('bandLabel', () => {
  it('maps bands to title-case Low/Medium/High', () => {
    expect(bandLabel('low')).toBe('Low')
    expect(bandLabel('medium')).toBe('Medium')
    expect(bandLabel('high')).toBe('High')
  })
})

describe('aiCommentLine', () => {
  it('joins band label and topConflictType with a middle dot', () => {
    const compact: CriticReviewCompact = {
      band: 'low',
      summary: 'Two HBLs',
      topConflictType: 'Two strong IDs in one email',
    }
    expect(aiCommentLine(compact)).toBe('Low · Two strong IDs in one email')
  })

  it('uses Medium/High for other bands', () => {
    expect(
      aiCommentLine({ band: 'medium', summary: 's', topConflictType: 'Needs review' }),
    ).toBe('Medium · Needs review')
    expect(
      aiCommentLine({ band: 'high', summary: 's', topConflictType: 'HBL conflict' }),
    ).toBe('High · HBL conflict')
  })
})
