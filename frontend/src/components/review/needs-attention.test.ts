import { describe, it, expect } from 'vitest'
import {
  buildNeedsAttention,
  buildNeedsAttentionGroups,
  GROUP_TITLE,
} from './needs-attention'

describe('buildNeedsAttention / groups', () => {
  it('suppresses conflict lines when conflict table is present', () => {
    const items = buildNeedsAttention({
      conflictsCount: 2,
      riskFlags: [
        {
          code: 'INTRA_EMAIL_FIELD_CONFLICT',
          severity: 'high',
          message: '3 field conflicts — values disagree (see conflict table).',
        },
        {
          code: 'AMBIGUOUS_MATCH',
          severity: 'high',
          message: 'This email matched more than one existing leg.',
        },
      ],
      reviewReasons: ['3 field conflict(s)', 'backend conflict on qty, gross_weight'],
    })
    expect(items.every((i) => i.groupId !== 'fields_disagree')).toBe(true)
    expect(items.some((i) => /more than one existing shipment/i.test(i.text))).toBe(true)
  })

  it('uses short multi-match copy (no 拼柜 parenthetical)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'AMBIGUOUS_MATCH',
          severity: 'high',
          message: 'This email matched more than one existing leg — pick which shipment it updates.',
        },
      ],
      reviewReasons: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toBe(
      'This email matches more than one existing shipment — confirm which one',
    )
    expect(items[0]!.text).not.toMatch(/拼柜/)
  })

  it('never shows broadcast total reasons', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: ['PO 2605358: total_quantity 692 looks like a broadcast total'],
    })
    expect(items).toEqual([])
  })

  it('combines multi-leg flag + reason into one line', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'AMBIGUOUS_MATCH',
          severity: 'high',
          message: 'matched more than one',
        },
      ],
      reviewReasons: ['matched multiple backend legs'],
    })
    expect(items.filter((i) => i.lineId === 'w-multi-match')).toHaveLength(1)
  })

  it('shows all groups (no hard cap of 2)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'multi' },
        { code: 'PORTAL_ECHO', severity: 'high', message: 'portal' },
        { code: 'MISSING_ATTACHMENT', severity: 'high', message: 'att' },
        {
          code: 'BACKEND_CONFLICT',
          severity: 'high',
          message: 'Email disagrees with what is already stored on Qty — needs a human call.',
        },
      ],
      reviewReasons: [
        'forwarder_name "VENA SAIL" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)',
      ],
    })
    expect(items.length).toBeGreaterThanOrEqual(4)
    const groups = buildNeedsAttentionGroups({
      conflictsCount: 0,
      riskFlags: [
        { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'multi' },
        { code: 'PORTAL_ECHO', severity: 'high', message: 'portal' },
        { code: 'MISSING_ATTACHMENT', severity: 'high', message: 'att' },
      ],
      reviewReasons: [
        'forwarder_name "VENA SAIL" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)',
      ],
    })
    expect(groups.map((g) => g.title)).toContain(GROUP_TITLE.which_shipment)
    expect(groups.map((g) => g.title)).toContain(GROUP_TITLE.real_shipment)
    expect(groups.map((g) => g.title)).toContain(GROUP_TITLE.master_miss)
    expect(groups.map((g) => g.title)).toContain(GROUP_TITLE.incomplete_data)
  })

  it('splits mode vs brand under fields disagree when no table', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: [
        'mode change SEA → AIR',
        'PO 2605358: brand conflict KOHLS vs SONOMA (kept KOHLS)',
      ],
    })
    expect(items.some((i) => /Transport mode changed \(SEA → AIR\)/.test(i.text))).toBe(true)
    expect(items.some((i) => /brand differs/.test(i.text) && /please verify/.test(i.text))).toBe(true)
  })

  it('PO-only and multi-destination copy', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PO_ONLY_WEAK_MATCH',
          severity: 'medium',
          message: 'Matched on PO alone',
        },
        {
          code: 'MULTI_DESTINATION_SUSPECT',
          severity: 'medium',
          message: 'several destinations',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => i.text === 'Linked by PO only — may be the wrong leg')).toBe(true)
    expect(
      items.some((i) =>
        i.text.includes('more than one destination — confirm before cargo is final'),
      ),
    ).toBe(true)
  })

  it('no strong ID jargon — weak identity uses booking/SO/B/L/PO', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'WEAK_IDENTITY',
          severity: 'medium',
          message: 'No strong booking/SO/B/L identity and no PO',
        },
      ],
      reviewReasons: [],
    })
    expect(items[0]!.text).toBe('No booking, SO, B/L, or PO — cannot place this email')
    expect(items[0]!.text).not.toMatch(/strong/i)
  })

  it('backend conflict short copy when no table', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'BACKEND_CONFLICT',
          severity: 'high',
          message: 'Email disagrees with what is already stored on Qty, Gross Weight — needs a human call.',
        },
      ],
      reviewReasons: [],
    })
    expect(items[0]!.text).toMatch(/Email and system differ on Qty, Gross Weight — choose which values to keep/)
  })

  it('collapses customer/vendor/port/consignee synonym spam into one line per fact', () => {
    const spam = [
      '1 field(s) received different values from different emails — see the conflict table for which fields and values',
      'No 4-char customer code in subject or body; brand/party not resolvable from email content.',
      'No vendor code in subject or body; factory not identified.',
      'Consignee not stated in email; only POD Ho Chi Minh City mentioned.',
      'Party name not in master list — add it in Cobalt Fashion Data Mesh System, then rematch (ops; not a normal review fix)',
      'Port name did not match UN/LOCODE masters — add or alias the port, then rematch',
      'No customer code in subject or body; subject has JBSL--SBK0003718107 which is a shipment ref, not a customer code',
      'No vendor code in subject or body',
      'No customer code resolvable; invoice party is FENIX FASHION LIMITED (sourcing house, not a customer master code)',
      'Ho Chi Minh City not in master data; raw value kept',
      'No 4-char customer code in subject; brand/party not resolvable from email content',
      'No customer code found in email; FENIX FASHION LIMITED is a sourcing house, not a resolvable 4-char code',
    ]
    const items = buildNeedsAttention({
      conflictsCount: 1, // conflict table owns field-conflict prose
      riskFlags: [],
      reviewReasons: spam,
    })
    const texts = items.map((i) => i.text)

    // Conflict prose suppressed when table present
    expect(texts.some((t) => /field\(s\) disagree|conflict table/i.test(t))).toBe(false)

    // One customer line, mentions FENIX if possible
    const customer = items.filter((i) => i.lineId === 'm-customer' || i.lineId.startsWith('m-customer'))
    expect(customer.length).toBe(1)
    expect(customer[0]!.text).toMatch(/Customer/i)
    expect(customer[0]!.text).toMatch(/FENIX/i)

    // One vendor
    expect(items.filter((i) => i.lineId === 'm-vendor').length).toBe(1)

    // One consignee
    expect(items.filter((i) => i.lineId === 'm-consignee').length).toBe(1)

    // One port (prefer value-specific id)
    const ports = items.filter((i) => i.lineId === 'm-port' || i.lineId.startsWith('m-port:'))
    expect(ports.length).toBe(1)
    expect(ports[0]!.text).toMatch(/Ho Chi Minh|port/i)

    // Mesh generic merges into party/port, not a 6th customer
    expect(items.length).toBeLessThanOrEqual(5)

    const groups = buildNeedsAttentionGroups({
      conflictsCount: 1,
      riskFlags: [],
      reviewReasons: spam,
    })
    expect(groups.some((g) => g.groupId === 'master_miss')).toBe(true)
  })
})
