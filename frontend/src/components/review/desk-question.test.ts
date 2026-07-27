import { describe, it, expect } from 'vitest'
import { candidateDeskQuestion, conflictDeskQuestion, pickDeskQuestion, type ContestedFieldSummary } from './desk-question'
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

/**
 * The table's question. It has to outrank the needs-attention pick, because the conflict-class lines
 * are suppressed exactly when the grid owns the comparison — leaving whatever else was on the leg to
 * title a card whose real decision was in the grid.
 */
describe('conflictDeskQuestion', () => {
  it('nothing contested → null, so the needs-attention question leads', () => {
    expect(conflictDeskQuestion([])).toBeNull()
  })

  it('one contested field names THAT field and counts its candidates', () => {
    const q = conflictDeskQuestion([
      { label: 'Vendor Code', candidateCount: 3, currentEmpty: true },
    ])
    expect(q?.question.question).toBe('Which Vendor Code is correct?')
    expect(q?.detail).toMatch(/3 candidates from the email/i)
    // Nothing stored, so declining means leaving it empty — say that, not "keep the current value".
    expect(q?.detail).toMatch(/leave it blank/i)
  })

  it('a stored value changes the decline wording', () => {
    const q = conflictDeskQuestion([{ label: 'ETA', candidateCount: 1, currentEmpty: false }])
    expect(q?.detail).toMatch(/keep the current value/i)
    expect(q?.detail).not.toMatch(/candidates/i)
  })

  it('several contested fields fall back to the count', () => {
    const q = conflictDeskQuestion([
      { label: 'ETA', candidateCount: 1, currentEmpty: false },
      { label: 'HBL', candidateCount: 2, currentEmpty: true },
    ])
    expect(q?.question.question).toBe('Which values are correct?')
    expect(q?.detail).toMatch(/2 fields disagree/i)
  })

  it('never offers a reject of its own — a field fight is not answered by binning the leg', () => {
    expect(conflictDeskQuestion([{ label: 'ETA', candidateCount: 2, currentEmpty: false }])?.question.reject).toBeNull()
  })
})

/**
 * The picker's question, absorbed from the panel's own title. The detail is the part that never
 * existed: what the email gave, and whether any candidate carries it. On leg E553C0A2 the email's SO
 * matched none of the four offered, and nothing on the card said so — so the `suggested` row looked
 * like an identity match when it was a guess from vessel and ETD.
 */
describe('candidateDeskQuestion', () => {
  const four = [
    { shipmentId: '1', so_no: 'FENLSO003044' },
    { shipmentId: '2', so_no: 'FENLSO003045' },
  ]

  it('fewer than two candidates is not a choice', () => {
    expect(candidateDeskQuestion({ candidates: [] })).toBeNull()
    expect(candidateDeskQuestion({ candidates: [four[0]!] })).toBeNull()
  })

  it('says so when nothing the email stated appears on any candidate', () => {
    const q = candidateDeskQuestion({
      emailKey: { so_no: 'FENLSO003062', customer_po: 'FENLSO003062' },
      candidates: four,
    })
    expect(q?.question.question).toBe('Which shipment does this email update?')
    expect(q?.detail).toMatch(/matches none of these/i)
    expect(q?.detail).toMatch(/FENLSO003062/)
    expect(q?.detail).toMatch(/vessel and ETD/i)
  })

  it('says so when the email key is shared by several — that is a real choice', () => {
    const q = candidateDeskQuestion({
      emailKey: { hbl_awb_fcr_no: 'H1' },
      candidates: [
        { shipmentId: '1', hbl_awb_fcr_no: 'H1' },
        { shipmentId: '2', hbl_awb_fcr_no: 'H1' },
      ],
    })
    expect(q?.detail).toMatch(/appears on more than one/i)
  })

  it('says so when the email gave no key at all', () => {
    const q = candidateDeskQuestion({ candidates: four })
    expect(q?.detail).toMatch(/no B\/L, booking or container to match on/i)
  })

  it('never offers a reject — the leg is real, it just needs placing', () => {
    expect(candidateDeskQuestion({ emailKey: { so_no: 'X' }, candidates: four })?.question.reject).toBeNull()
  })
})

/**
 * The party-mismatch row is synthesised from MASTER DATA (presentation/party-mismatch-conflict.ts),
 * not from an email. "The email proposes a different Vendor Code" sent the operator hunting through
 * 17 messages for a sentence nobody wrote.
 */
describe('conflictDeskQuestion — a master-data row does not claim an email said it', () => {
  const row = (over: Partial<ContestedFieldSummary> = {}): ContestedFieldSummary => ({
    label: 'Vendor Code',
    candidateCount: 1,
    currentEmpty: false,
    ...over,
  })

  it('names master data as the source', () => {
    const out = conflictDeskQuestion([row({ fromMasterData: true })])
    expect(out?.question.question).toBe('Which Vendor Code is correct?')
    expect(out?.detail).toBe(
      "This shipment is linked to a different company in master data — apply the master's Vendor Code, or keep the current value.",
    )
    expect(out?.detail).not.toMatch(/email/i)
  })

  it('offers "leave it blank" when the leg stores nothing', () => {
    expect(conflictDeskQuestion([row({ fromMasterData: true, currentEmpty: true })])?.detail).toMatch(
      /or leave it blank\.$/,
    )
  })

  it('an email-sourced row keeps its own wording', () => {
    expect(conflictDeskQuestion([row()])?.detail).toBe(
      'The email proposes a different Vendor Code — apply it, or keep the current value.',
    )
    expect(conflictDeskQuestion([row({ candidateCount: 2 })])?.detail).toBe(
      '2 candidates from the email — pick one below, or keep the current value.',
    )
  })
})
