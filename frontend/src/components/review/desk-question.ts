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

/** One contested row, reduced to what the headline needs to know about it. */
export type ContestedFieldSummary = {
  /** The row's display label, as the grid prints it ("Vendor Code"). */
  label: string
  /** Non-system candidates offered for it. >1 means the operator picks. */
  candidateCount: number
  /** Nothing stored yet, so "keep what is there" means leaving it blank. */
  currentEmpty: boolean
}

/**
 * The question the TABLE is asking.
 *
 * Needed because the conflict-class needs-attention lines are suppressed exactly when the grid has
 * rows ("the table owns the comparison"). That left whatever else happened to be on the leg to supply
 * the headline — so a card whose real decision was "which of these three vendors" was titled
 * "Who are these parties?" after a Mesh-miss FYI, and the FYI outranked the decision.
 *
 * Returns null when nothing is contested, and the needs-attention question leads instead.
 */
export function conflictDeskQuestion(
  fields: ContestedFieldSummary[],
): { question: DeskQuestion; detail: string } | null {
  if (fields.length === 0) return null

  if (fields.length > 1) {
    return {
      question: { question: 'Which values are correct?', affirm: 'Confirm Reviewed', reject: null },
      detail: `${fields.length} fields disagree — settle each row below.`,
    }
  }

  const f = fields[0]!
  const keepClause = f.currentEmpty ? 'or leave it blank' : 'or keep the current value'
  return {
    question: {
      question: `Which ${f.label} is correct?`,
      // changeCount > 0 replaces this with the value it would write ("Apply FEFALT"); this wording is
      // only reached when the resolution matches what is already stored.
      affirm: 'Confirm Reviewed',
      // A field fight is not answered by throwing the leg away. If the leg ALSO carries a
      // "is this freight?" line, the caller keeps that line's reject wording.
      reject: null,
    },
    detail:
      f.candidateCount > 1
        ? `${f.candidateCount} candidates from the email — pick one below, ${keepClause}.`
        : `The email proposes a different ${f.label} — apply it, ${keepClause}.`,
  }
}

/** Email-key labels, in the order an operator would try to match on them. */
const EMAIL_KEY_LABEL: { key: string; label: string; strong: boolean }[] = [
  { key: 'hbl_awb_fcr_no', label: 'B/L', strong: true },
  { key: 'booking_no', label: 'booking', strong: true },
  { key: 'mbl', label: 'MBL', strong: true },
  { key: 'container_no', label: 'container', strong: false },
  { key: 'so_no', label: 'SO', strong: false },
  { key: 'customer_po', label: 'PO', strong: false },
]

/**
 * The question the PICKER is asking, and what there is to answer it with.
 *
 * This absorbs the panel's own title. The card used to ask "Is this the right shipment?" at the top
 * and the panel "Which shipment does this email update?" four blocks lower — the same question twice,
 * with the answer nowhere near the first asking.
 *
 * The detail is the part that was missing entirely: WHAT the email gave, and whether any candidate
 * carries it. On the leg that prompted this, the email's SO matched none of the five offered, and
 * nothing on the card said so — the operator had no way to know the suggestion was a guess from vessel
 * and ETD rather than an identity match.
 */
export function candidateDeskQuestion(opts: {
  emailKey?: Record<string, string> | undefined
  candidates: Record<string, unknown>[]
  /** What the committer did (migration 0027). Changes the QUESTION, not just the wording. */
  committerAction?: string | null
}): { question: DeskQuestion; detail: string } | null {
  const { emailKey, candidates, committerAction } = opts
  if (candidates.length < 2) return null

  /**
   * The committer CREATED this leg from the email — 179 of 181 active legs. So the email is not
   * looking for a shipment to update; a shipment already exists for it, and the open question is
   * whether that was a duplicate of one already on file. Different question, different answer: "pick
   * one and link into it" versus "compare, and merge if it is the same move".
   */
  const created = committerAction === 'created_pending_dedup' || committerAction === 'created'
  const question: DeskQuestion = created
    ? {
        question: 'Is this a duplicate of a shipment we already have?',
        affirm: 'No — Keep as Separate',
        reject: null,
      }
    : {
        question: 'Which shipment does this email update?',
        affirm: 'Confirm Reviewed',
        // Rejecting is not an answer to "which one" — the leg is real, it just needs placing.
        reject: null,
      }

  if (created) {
    return {
      question,
      detail: `A new shipment was created for this email while ${candidates.length} similar ones already existed — check whether it is the same move.`,
    }
  }

  const stated = EMAIL_KEY_LABEL.filter(({ key }) => String(emailKey?.[key] ?? '').trim() !== '')
  if (stated.length === 0) {
    return {
      question,
      detail: 'The email gave no B/L, booking or container to match on — pick by what the rows below have in common with it.',
    }
  }

  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
  const matched = stated.filter(({ key }) =>
    candidates.some((c) => norm(c[key]) !== '' && norm(c[key]) === norm(emailKey?.[key])),
  )

  if (matched.length > 0) {
    const m = matched[0]!
    return {
      question,
      detail: `The email's ${m.label} ${String(emailKey?.[m.key]).trim()} appears on more than one of these — confirm which.`,
    }
  }

  // Nothing the email stated is carried by any candidate. Say so: it is the difference between a
  // suggestion grounded in identity and one guessed from a vessel name.
  const strongest = stated[0]!
  const others = stated.slice(1)
  const gave = `${strongest.label} ${String(emailKey?.[strongest.key]).trim()}`
  const alsoGave = others.length > 0 ? ` (also ${others.map((o) => o.label).join(', ')})` : ''
  return {
    question,
    detail: `The email's ${gave}${alsoGave} matches none of these — pick by what else lines up, such as vessel and ETD.`,
  }
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
