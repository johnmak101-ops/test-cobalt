/**
 * The QUESTION a queued leg is actually asking — and the words that answer it.
 *
 * Needs Attention used to render as a diagnosis list under two levels of heading
 * (`Needs Attention` → `Real Shipment?` → one bullet), with a generic `Confirm Reviewed` underneath.
 * Every line told the operator what was WRONG; none of them said what to DO, and no button was worded
 * as an answer to any particular line. On a leg whose only note was "thin mail, not a lifecycle
 * booking", the answer "no, this isn't freight" had no button at all.
 *
 * So: promote the open question to the headline, and word the verdict buttons as its answers.
 */
import { GROUP_ORDER, type NeedsAttentionGroup, type NeedsAttentionGroupId, type NeedsAttentionItem } from './needs-attention'

export type DeskQuestion = {
  /** Headline. Replaces BOTH the panel title and the group title above the leading line. */
  question: string
  /**
   * The affirmative verdict's wording. Used only when there is nothing to apply — once the agent
   * proposes field changes the primary button keeps naming the apply (`Approve`), because what it
   * commits then matters more than which question it settles.
   */
  affirm: string
  /**
   * Reject wording, or null when "no" is not an answer to THIS question. "Which shipment is this?"
   * is not answered by throwing the leg away — it is answered by linking it — so offering Reject
   * there would invite the wrong click.
   */
  reject: string | null
}

/**
 * Which open question leads the card.
 *
 * Deliberately NOT `GROUP_ORDER`: that one lays groups out top-to-bottom and puts "which shipment?"
 * first, which is right for a LIST. As a headline it is wrong — "is this freight at all?" has to win,
 * because if the answer is no then which shipment it belongs to stops mattering, and leading with the
 * narrower question sends the operator hunting for a match that should never be made.
 */
const QUESTION_PRIORITY: NeedsAttentionGroupId[] = [
  'real_shipment',
  'which_shipment',
  'fields_disagree',
  'master_miss',
  'incomplete_data',
  'other',
]

/** Per-line wording, for lines whose question is sharper than their group's. */
const QUESTION_BY_LINE: Record<string, DeskQuestion> = {
  'r-thin': {
    question: 'Is this a real shipment?',
    affirm: 'Yes — Track It',
    reject: 'Not a Shipment',
  },
  'r-portal': {
    question: 'Is this real freight, or just a portal notice?',
    affirm: 'Yes — Track It',
    reject: 'Portal Noise — Reject',
  },
  'r-no-id': {
    question: 'Which shipment does this email belong to?',
    affirm: 'Confirm Reviewed',
    // A leg nobody can place may genuinely not be freight — unlike the other which-shipment lines,
    // where a real shipment exists and the job is to find it.
    reject: 'Not a Shipment',
  },
  // PO-only AND thin: two questions, and the outer one (does this belong here at all?) leads.
  'w-po-thin': {
    question: 'Does this belong in tracking, and on this shipment?',
    affirm: 'Yes — Track It',
    reject: 'Not a Shipment',
  },
  'i-attach': {
    question: 'Is the cargo complete?',
    affirm: 'Confirm Reviewed',
    reject: null,
  },
  'o-cancel': {
    question: 'This booking was cancelled — keep tracking it?',
    affirm: 'Keep Tracking',
    reject: 'Not a Shipment',
  },
}

/** Group-level fallback, so a line with no entry above still gets a real question. */
const QUESTION_BY_GROUP: Record<NeedsAttentionGroupId, DeskQuestion> = {
  real_shipment: {
    question: 'Is this a real shipment?',
    affirm: 'Yes — Track It',
    reject: 'Not a Shipment',
  },
  which_shipment: {
    question: 'Is this the right shipment?',
    affirm: 'Confirm Reviewed',
    reject: null,
  },
  fields_disagree: {
    question: 'Which values are correct?',
    affirm: 'Approve',
    reject: null,
  },
  master_miss: {
    question: 'Who are these parties?',
    affirm: 'Confirm Reviewed',
    reject: null,
  },
  incomplete_data: {
    question: 'Does the extracted data look right?',
    affirm: 'Confirm Reviewed',
    reject: null,
  },
  // Unmapped / future queue codes: keep the old panel title as the headline rather than inventing a
  // question we cannot stand behind, and offer no Reject for something we do not understand.
  other: {
    question: 'Needs Attention',
    affirm: 'Confirm Reviewed',
    reject: null,
  },
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

export type DeskQuestionPick = {
  question: DeskQuestion
  /** The line the headline speaks for — rendered as the headline's own subtext, not as a bullet. */
  primary: NeedsAttentionItem
  /** Everything else, still grouped and in GROUP_ORDER. Empty when the leg asks exactly one thing. */
  rest: NeedsAttentionGroup[]
};

/**
 * Pick the leading question. Returns null when there is nothing to ask (no groups) — the caller then
 * renders no panel at all, which is what the ready state is for.
 */
export function pickDeskQuestion(groups: NeedsAttentionGroup[]): DeskQuestionPick | null {
  const withItems = groups.filter((g) => g.items.length > 0)
  if (withItems.length === 0) return null

  const leadGroup = [...withItems].sort(
    (a, b) => QUESTION_PRIORITY.indexOf(a.groupId) - QUESTION_PRIORITY.indexOf(b.groupId),
  )[0]!
  // Within the leading group the loudest line speaks. Stable for ties: the first as classified, so the
  // headline does not shuffle between renders of the same leg.
  const primary = [...leadGroup.items].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  )[0]!

  const question = QUESTION_BY_LINE[primary.lineId] ?? QUESTION_BY_GROUP[leadGroup.groupId]

  const rest = GROUP_ORDER.map((groupId) => {
    const g = withItems.find((x) => x.groupId === groupId)
    if (!g) return null
    const items = g.items.filter((i) => i.key !== primary.key)
    return items.length > 0 ? { ...g, items } : null
  }).filter((g): g is NeedsAttentionGroup => g != null)

  return { question, primary, rest }
}
