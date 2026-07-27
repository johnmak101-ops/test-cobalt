import { describe, it, expect } from 'vitest'
import { pickDeskQuestion } from './desk-question'
import { buildNeedsAttentionGroups, type NeedsAttentionGroup } from './needs-attention'

function groups(
  reviewReasons: string[],
  riskFlags: { code: string; severity?: string; message?: string }[] = [],
): NeedsAttentionGroup[] {
  return buildNeedsAttentionGroups({
    conflictsCount: 0,
    reviewReasons,
    riskFlags,
    desk: 'decision',
  })
}

describe('pickDeskQuestion', () => {
  it('nothing open → null (the ready state speaks instead)', () => {
    expect(pickDeskQuestion([])).toBeNull()
    expect(pickDeskQuestion([{ groupId: 'other', title: 'Other', items: [] }])).toBeNull()
  })

  it('thin mail: the question is answerable by yes OR no, and both are worded', () => {
    const pick = pickDeskQuestion(
      groups(['no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment']),
    )
    expect(pick?.question.question).toMatch(/Is this a real shipment\?|belong in tracking/i)
    expect(pick?.question.affirm).toMatch(/Track It/i)
    expect(pick?.question.reject).toMatch(/Not a Shipment/i)
  })

  it('"which shipment?" offers no Reject — the answer there is to link it, not to bin it', () => {
    const pick = pickDeskQuestion(groups([], [{ code: 'AMBIGUOUS_MATCH', severity: 'medium', message: 'two legs' }]))
    expect(pick?.question.question).toMatch(/right shipment/i)
    expect(pick?.question.reject).toBeNull()
  })

  it('a portal echo names its own rejection', () => {
    const pick = pickDeskQuestion(groups([], [{ code: 'PORTAL_ECHO', severity: 'medium', message: 'portal' }]))
    expect(pick?.question.reject).toMatch(/Portal Noise/i)
  })

  /**
   * The headline order is NOT GROUP_ORDER: "is this freight at all?" has to beat "which shipment is
   * it?", because if the answer is no then the narrower question never needed asking.
   */
  it('real_shipment outranks which_shipment for the headline', () => {
    const pick = pickDeskQuestion(
      groups(
        ['no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment'],
        [{ code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'two legs' }],
      ),
    )
    expect(pick?.question.question).not.toMatch(/right shipment/i)
    expect(pick?.primary.lineId).toMatch(/^r-/)
    // The which-shipment line is not lost — it follows under "Also".
    expect(pick?.rest.flatMap((g) => g.items.map((i) => i.lineId))).toContain('w-multi-match')
  })

  it('the loudest line in the leading group speaks, and every other line survives in rest', () => {
    const pick = pickDeskQuestion(
      groups(
        [
          '3 unresolved field conflict(s)',
          'forwarder_name "A.P. Moller - Maersk" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)',
        ],
        [{ code: 'MISSING_ATTACHMENT', severity: 'high', message: 'references an attachment' }],
      ),
    )
    const all = [pick!.primary.lineId, ...pick!.rest.flatMap((g) => g.items.map((i) => i.lineId))]
    // Nothing dropped, nothing duplicated.
    expect(new Set(all).size).toBe(all.length)
    expect(all).toContain('i-attach')
    expect(all.some((id) => id.startsWith('m-party'))).toBe(true)
  })

  it('an unmapped line keeps the old panel title and offers no Reject we cannot justify', () => {
    const pick = pickDeskQuestion([
      {
        groupId: 'other',
        title: 'Other',
        items: [
          { key: 'k', lineId: 'flag:SOME_FUTURE_CODE', severity: 'low', text: 'something new', category: 'other', groupId: 'other' },
        ],
      },
    ])
    expect(pick?.question.question).toBe('Needs Attention')
    expect(pick?.question.reject).toBeNull()
  })
})
