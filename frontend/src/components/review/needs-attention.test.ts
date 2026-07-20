import { describe, it, expect } from 'vitest'
import {
  buildNeedsAttention,
  buildNeedsAttentionGroups,
  GROUP_TITLE,
  looksLikeCountryToken,
  countryOnlyPortMissText,
  weakIdentityText,
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

  it('uses short multi-match copy (no 拼櫃 parenthetical)', () => {
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
    expect(items[0]!.text).not.toMatch(/拼柜|拼櫃/)
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

  it('drops Port VIETNAM / HCMC flags when pod already LOCODE-linked', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: true, pod: true },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "VIETNAM" as a port UN/LOCODE. Add or alias the port in ShipTrack port masters (UN/LOCODE), then rematch.',
        },
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "Ho Chi Minh City" as a port UN/LOCODE. Add or alias the port in ShipTrack port masters (UN/LOCODE), then rematch.',
        },
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "Maersk (China) Shipping Co., Ltd." in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
        },
      ],
      reviewReasons: ['Ho Chi Minh City not in master data; raw value kept'],
    })
    expect(items.every((i) => !/VIETNAM|Ho Chi Minh|UN\/LOCODE|port master/i.test(i.text))).toBe(true)
    expect(items.some((i) => /Maersk/i.test(i.text))).toBe(true)
  })

  it('keeps port miss when neither port is LOCODE-linked', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message: 'Cannot match "Ho Chi Minh City" as a port UN/LOCODE. Add alias, then rematch.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Ho Chi Minh/i.test(i.text))).toBe(true)
  })

  it('PARTY_OPS riskFlags keep party type + name (not blank Party not linked)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "Maersk (China) Shipping Co., Ltd." in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
        },
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message: 'No vendor code in subject or body; factory not identified.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Party not linked to master — left unlinked/.test(i.text))).toBe(false)
    expect(
      items.some(
        (i) =>
          /Maersk \(China\) Shipping Co\., Ltd\./i.test(i.text) &&
          /not found in Mesh Database/i.test(i.text) &&
          /advise add in Mesh/i.test(i.text),
      ),
    ).toBe(true)
    expect(items.some((i) => /Vendor|factory/i.test(i.text))).toBe(true)
  })

  it('Mesh miss copy names the party and advises add in Mesh', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: [
        'Cannot match "DP WORLD CHINA CO., LTD. GUANGZHOU BRANCH" in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toBe(
      '"DP WORLD CHINA CO., LTD. GUANGZHOU BRANCH" not found in Mesh Database — advise add in Mesh.',
    )
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

  it('keeps mode change but suppresses brand conflict (ops do not re-verify brand)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: [
        'mode change SEA → AIR',
        'PO 2605358: brand conflict KOHLS vs SONOMA (kept KOHLS)',
        'PO S13789032: brand conflict Primark vs PRMT (kept PRMT) — verify',
      ],
    })
    expect(items.some((i) => /Transport mode changed \(SEA → AIR\)/.test(i.text))).toBe(true)
    expect(items.some((i) => /brand differs|brand conflict|please verify.*brand|brand.*please verify/i.test(i.text))).toBe(
      false,
    )
  })

  it('suppresses raw-name-used notes that only restate Master miss', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message: 'Vendor name from image but no master code; raw name used',
        },
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "YAQI" in the vendor list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
        },
      ],
      reviewReasons: [
        'Vendor name not in master data; raw name used.',
        'South Ocean not in master data; raw name emitted',
        'Cannot match "South Ocean" in the vendor list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
      ],
    })
    expect(items.some((i) => /raw name used|raw name emitted|no master code/i.test(i.text))).toBe(
      false,
    )
    expect(items.some((i) => i.groupId === 'other' && /vendor|raw name/i.test(i.text))).toBe(false)
    expect(items.some((i) => i.groupId === 'master_miss')).toBe(true)
    // Collapsed master-miss keeps names in details (or text when single party)
    const master = items.filter((i) => i.groupId === 'master_miss')
    const namesBlob = master
      .flatMap((i) => [i.text, ...(i.details ?? []), ...(i.evidence ?? [])])
      .join(' | ')
    expect(namesBlob).toMatch(/YAQI|South Ocean/i)
  })

  it('hides truncated multi-FCR extraction notes', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'EXTRACTION_INCOMPLETE',
          severity: 'high',
          message:
            'Extraction is incomplete or pending (e.g. scanned attachment not fully read) — key fields may be missing.',
        },
      ],
      reviewReasons: [
        'Two FCR numbers listed (FCR001250330, FCR001256791) but no p',
        'Extraction notes: Two FCR numbers listed (FCR001250330, FCR001256791) but no p.',
      ],
    })
    expect(items.some((i) => /FCR001250330|numbers listed|but no p/i.test(i.text))).toBe(false)
    // Real incomplete-extract flag still surfaces
    expect(items.some((i) => /Parse incomplete — key information may be missing/i.test(i.text))).toBe(
      true,
    )
  })

  it('hides gross_weight / measurement not-summed merge notes', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'MERGE_ADJUSTMENT',
          severity: 'low',
          message: 'gross_weight: stated for 0/5 POs — not summed (leg keeps the single value)',
        },
        {
          code: 'MERGE_ADJUSTMENT',
          severity: 'low',
          message: 'measurement: stated for 0/5 POs — not summed (leg keeps the single value)',
        },
        {
          code: 'MERGE_ADJUSTMENT',
          severity: 'low',
          message:
            'warehouse_end_date: binding cutoff 2026-07-15 16:00 (earliest current stated) — newest doc said 2026-07-20 12:00',
        },
      ],
      reviewReasons: [
        'Merge note: gross_weight: stated for 0/5 POs — not summed (leg keeps the single value)',
        'Merge note: measurement: stated total 100 ≠ per-PO sum 200 — verify',
      ],
    })
    expect(items.some((i) => /not summed|per-PO sum|gross_weight|measurement/i.test(i.text))).toBe(
      false,
    )
    // Binding cut-off is humanized — no DB column, no "Merge note:" prefix
    const cutoff = items.find((i) => /cut-off|cutoff/i.test(i.text))
    expect(cutoff).toBeTruthy()
    expect(cutoff!.text).toBe(
      'Cargo cut-off kept as 2026-07-15 16:00 (earliest across emails) — a newer email said 2026-07-20 12:00',
    )
    expect(cutoff!.text).not.toMatch(/warehouse_end_date|Merge note:/i)
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
    expect(
      items.some(
        (i) =>
          i.text ===
          'Linked by PO only — add booking/SO/B/L or confirm this shipment is correct',
      ),
    ).toBe(true)
    expect(
      items.some((i) =>
        i.text.includes('One booking, more than one destination — cargo may need a split'),
      ),
    ).toBe(true)
  })

  it('combines PO-only + PO reassign into one decision line', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PO_ONLY_WEAK_MATCH',
          severity: 'medium',
          message: 'Matched on PO alone',
        },
        {
          code: 'PO_REASSIGN',
          severity: 'high',
          message: 'PO belongs to a different shipment',
        },
      ],
      reviewReasons: [],
    })
    const poLines = items.filter(
      (i) =>
        i.lineId === 'w-po-only' ||
        i.lineId === 'w-po-other' ||
        i.lineId === 'w-po-combined',
    )
    expect(poLines).toHaveLength(1)
    expect(poLines[0]!.lineId).toBe('w-po-combined')
    expect(poLines[0]!.text).toBe(
      'PO-only match, and that PO is already on another shipment — confirm move, split, or wrong shipment',
    )
    expect(poLines[0]!.severity).toBe('high')
    expect(items.some((i) => /already on another job/i.test(i.text))).toBe(false)
  })

  it('PO reassign alone uses move/leave/split copy', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PO_REASSIGN',
          severity: 'high',
          message: 'PO belongs to a different shipment',
        },
      ],
      reviewReasons: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toBe(
      'This PO is already on another shipment — move it here, leave it, or split',
    )
  })

  it('combines PO-only + thin mail into one decision line', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'PO_ONLY_WEAK_MATCH',
          severity: 'medium',
          message: 'Matched on PO alone',
        },
      ],
      reviewReasons: [
        'no lifecycle email type — verify this is a real shipment',
      ],
    })
    const poOrThin = items.filter(
      (i) =>
        i.lineId === 'w-po-only' ||
        i.lineId === 'r-thin' ||
        i.lineId === 'w-po-thin',
    )
    expect(poOrThin).toHaveLength(1)
    expect(poOrThin[0]!.lineId).toBe('w-po-thin')
    expect(poOrThin[0]!.groupId).toBe('which_shipment')
    expect(poOrThin[0]!.text).toBe(
      'Thin mail linked by PO only — confirm it belongs in tracking and on this shipment',
    )
    expect(items.some((i) => i.lineId === 'r-thin')).toBe(false)
    expect(items.some((i) => /Linked by PO only — add booking/i.test(i.text))).toBe(false)
  })

  it('thin mail alone keeps Real shipment? copy', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: ['no lifecycle email type — verify this is a real shipment'],
    })
    expect(items.some((i) => i.lineId === 'r-thin')).toBe(true)
    expect(items.some((i) => i.text.includes('Thin mail, not a lifecycle booking'))).toBe(true)
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
    expect(items[0]!.text).toBe(weakIdentityText(false))
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

    // No "Customer not linked to Mesh / no resolvable code" restatement — Master miss owns that.
    expect(
      items.some((i) => /Customer not linked to Mesh|no resolvable customer code/i.test(i.text)),
    ).toBe(false)
    expect(items.filter((i) => i.lineId === 'm-customer' || i.lineId.startsWith('m-customer')).length).toBe(
      0,
    )

    // One vendor
    expect(items.filter((i) => i.lineId === 'm-vendor').length).toBe(1)

    // One consignee
    expect(items.filter((i) => i.lineId === 'm-consignee').length).toBe(1)

    // One port (prefer value-specific id)
    const ports = items.filter((i) => i.lineId === 'm-port' || i.lineId.startsWith('m-port:'))
    expect(ports.length).toBe(1)
    expect(ports[0]!.text).toMatch(/Ho Chi Minh|port/i)

    // Mesh generic + vendor + consignee + port (no customer restatement)
    expect(items.length).toBeLessThanOrEqual(5)

    const groups = buildNeedsAttentionGroups({
      conflictsCount: 1,
      riskFlags: [],
      reviewReasons: spam,
    })
    expect(groups.some((g) => g.groupId === 'master_miss')).toBe(true)
  })
})

describe('Mesh party collapse', () => {
  it('merges case variants of the same party into one line', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: [
        '"SOUTH OCEAN" not found in Mesh Database — advise add in Mesh.',
        '"South Ocean" not found in Mesh Database — advise add in Mesh.',
        'Cannot match "south ocean" in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
      ],
    })
    const mesh = items.filter(
      (i) => i.lineId.startsWith('m-party') || i.lineId === 'm-mesh',
    )
    expect(mesh.length).toBe(1)
    expect(mesh[0]!.text).toMatch(/South Ocean|SOUTH OCEAN|south ocean/i)
    expect(mesh[0]!.text).not.toMatch(/^\d+ parties not found/)
  })

  it('collapses many distinct Mesh misses into one expandable summary', () => {
    const names = [
      'SOUTH OCEAN',
      'BRO GROUP LOGISTICS',
      'Wiseknit',
      'BRO Group Logistics',
      'MONDIAL TRANSPORTS MARCHANDISES',
      'HUIYI',
      'BRO GROUP LOG MANAGEMENT CO LTD',
      'Bro Group Logistics',
      'WISEKNIT',
      'South Ocean',
    ]
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: names.map(
        (n) => `"${n}" not found in Mesh Database — advise add in Mesh.`,
      ),
    })
    const mesh = items.filter((i) => i.lineId.startsWith('m-party') || i.lineId === 'm-mesh')
    expect(mesh.length).toBe(1)
    expect(mesh[0]!.lineId).toBe('m-party:collapsed')
    expect(mesh[0]!.text).toMatch(/parties not found in Mesh Database/i)
    expect(mesh[0]!.text).toMatch(/advise add in Mesh/i)
    // Expandable list of unique parties (case-merged)
    expect(mesh[0]!.details?.length).toBeGreaterThanOrEqual(4)
    expect(mesh[0]!.details?.length).toBeLessThanOrEqual(6)
    expect(mesh[0]!.details!.some((n) => /south ocean/i.test(n))).toBe(true)
  })
})

describe('Mesh port collapse', () => {
  it('collapses many distinct port misses into one expandable summary', () => {
    const ports = ['HONGKONG', 'HK for Japan', 'HKGHKG', 'Atianta']
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: ports.map(
        (p) => `Port "${p}" not in UN/LOCODE masters — add or alias, then rematch`,
      ),
    })
    const portLines = items.filter(
      (i) => i.lineId === 'm-port:collapsed' || i.lineId.startsWith('m-port'),
    )
    expect(portLines.length).toBe(1)
    expect(portLines[0]!.lineId).toBe('m-port:collapsed')
    expect(portLines[0]!.text).toBe(
      '4 ports not in UN/LOCODE masters — add or alias, then rematch',
    )
    expect(portLines[0]!.details).toEqual(
      expect.arrayContaining(['Atianta', 'HK for Japan', 'HKGHKG', 'HONGKONG']),
    )
    expect(portLines[0]!.details).toHaveLength(4)
  })

  it('collapses Cannot-match port prose the same way', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: [
        'Cannot match "HONGKONG" as a port',
        'Cannot match "HK for Japan" as a port',
        'Cannot match "HKGHKG" as a port',
        'Cannot match "Atianta" as a port',
      ],
    })
    const portLines = items.filter((i) => i.lineId.startsWith('m-port'))
    expect(portLines).toHaveLength(1)
    expect(portLines[0]!.lineId).toBe('m-port:collapsed')
    expect(portLines[0]!.details).toHaveLength(4)
  })

  it('keeps a single port miss as one line (no collapse chrome)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [],
      reviewReasons: ['Cannot match "Atianta" as a port'],
    })
    const ports = items.filter((i) => i.lineId.startsWith('m-port'))
    expect(ports.length).toBe(1)
    expect(ports[0]!.lineId).not.toBe('m-port:collapsed')
    expect(ports[0]!.details).toBeUndefined()
    expect(ports[0]!.text).toMatch(/Atianta/)
  })
})

describe('weakIdentityText', () => {
  it('splits by PO presence', () => {
    expect(weakIdentityText(true)).toBe(
      'Only PO known — add booking, SO, or B/L to place this email',
    )
    expect(weakIdentityText(false)).toBe(
      'No booking, SO, B/L, or PO — cannot place this email',
    )
  })
})

describe('buildNeedsAttention WEAK_IDENTITY hasPo', () => {
  it('uses only-PO copy when hasPo true', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      hasPo: true,
      riskFlags: [
        {
          code: 'WEAK_IDENTITY',
          severity: 'medium',
          message: 'No strong booking/SO/B/L identity',
        },
      ],
      reviewReasons: [],
    })
    expect(items[0]!.lineId).toBe('r-no-id')
    expect(items[0]!.text).toBe(
      'Only PO known — add booking, SO, or B/L to place this email',
    )
    expect(items[0]!.text).not.toMatch(/or PO|cannot place/i)
  })

  it('keeps no-PO copy when hasPo false or omitted', () => {
    const flag = {
      code: 'WEAK_IDENTITY',
      severity: 'medium' as const,
      message: 'No strong booking/SO/B/L identity and no PO',
    }
    for (const opts of [{ hasPo: false }, {}]) {
      const items = buildNeedsAttention({
        conflictsCount: 0,
        ...opts,
        riskFlags: [flag],
        reviewReasons: [],
      })
      expect(items[0]!.text).toBe(
        'No booking, SO, B/L, or PO — cannot place this email',
      )
    }
  })

  it('rewrites reason-path r-no-id when hasPo', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      hasPo: true,
      riskFlags: [],
      reviewReasons: ['neither a strong identity key nor a PO'],
    })
    // If reason still maps to r-no-id, text must honor hasPo (PO known on card wins over stale reason text)
    const hit = items.find((i) => i.lineId === 'r-no-id')
    if (hit) {
      expect(hit.text).toBe(
        'Only PO known — add booking, SO, or B/L to place this email',
      )
    }
  })
})

describe('looksLikeCountryToken', () => {
  it('detects common country names and ISO codes', () => {
    expect(looksLikeCountryToken('USA')).toBe(true)
    expect(looksLikeCountryToken('usa')).toBe(true)
    expect(looksLikeCountryToken('United States')).toBe(true)
    expect(looksLikeCountryToken('US')).toBe(true)
    expect(looksLikeCountryToken('Vietnam')).toBe(true)
    expect(looksLikeCountryToken('VIETNAM')).toBe(true)
    expect(looksLikeCountryToken('CN')).toBe(true)
    expect(looksLikeCountryToken('CHN')).toBe(true)
    expect(looksLikeCountryToken('Hong Kong')).toBe(true)
    // Geography clear; LOCODE (sea vs air) is the real choice — not "unknown place"
    expect(looksLikeCountryToken('HONG KONG, HONG KONG SAR')).toBe(true)
  })

  it('rejects cities, LOCODEs, and unknown free text', () => {
    expect(looksLikeCountryToken('Ho Chi Minh City')).toBe(false)
    expect(looksLikeCountryToken('CNYTN')).toBe(false)
    expect(looksLikeCountryToken('Yantian')).toBe(false)
    expect(looksLikeCountryToken('')).toBe(false)
    expect(looksLikeCountryToken(null)).toBe(false)
  })
})

describe('countryOnlyPortMissText', () => {
  it('names field when known', () => {
    expect(countryOnlyPortMissText('USA', 'pod')).toBe(
      'Email only named USA for POD — please verify mode of transport and port',
    )
    expect(countryOnlyPortMissText('USA', 'pol')).toBe(
      'Email only named USA for POL — please verify mode of transport and port',
    )
  })

  it('uses general mode+port ask when field unknown', () => {
    expect(countryOnlyPortMissText('USA')).toBe(
      'Email only named USA — please verify mode of transport and port',
    )
  })

  it('Hong Kong SAR is region-level, not "add to UN/LOCODE master"', () => {
    expect(countryOnlyPortMissText('HONG KONG, HONG KONG SAR')).toBe(
      'Email only named Hong Kong — please verify mode of transport and port',
    )
    expect(countryOnlyPortMissText('HONG KONG, HONG KONG SAR')).not.toMatch(
      /not in UN\/LOCODE|add or alias|HKHKG/i,
    )
  })
})

describe('buildNeedsAttention country-only port miss', () => {
  it('rewrites Cannot match "USA" as a port to country copy', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message:
            'Cannot match "USA" as a port UN/LOCODE. Add or alias the port in ShipTrack port masters (UN/LOCODE), then rematch.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Email only named USA — please verify mode of transport and port/i.test(i.text) || /Email only named USA for/i.test(i.text))).toBe(true)
    expect(items.every((i) => !/UN\/LOCODE masters|add or alias/i.test(i.text))).toBe(true)
  })

  it('HONG KONG, HONG KONG SAR is region choice not missing master', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [],
      reviewReasons: [
        'Port "HONG KONG, HONG KONG SAR" not in UN/LOCODE masters — add or alias, then rematch',
      ],
    })
    expect(
      items.some((i) =>
        /Email only named Hong Kong — please verify mode of transport and port/i.test(i.text),
      ),
    ).toBe(true)
    expect(items.every((i) => !/not in UN\/LOCODE masters|add or alias|HKHKG/i.test(i.text))).toBe(
      true,
    )
  })

  it('rewrites pod "USA" did not exact/curated-match with POD field', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [],
      reviewReasons: ['pod "USA" did not exact/curated-match a port master — left unlinked'],
    })
    const hit = items.find((i) => i.lineId === 'm-port:USA' || i.lineId.startsWith('m-port'))
    expect(hit?.text).toMatch(
      /Email only named USA for POD — please verify mode of transport and port/i,
    )
    expect(hit?.text).not.toMatch(/not in master/i)
  })

  it('keeps LOCODE miss copy for real city names', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      portsLinked: { pol: false, pod: false },
      riskFlags: [
        {
          code: 'PARTY_OPS',
          severity: 'low',
          message: 'Cannot match "Ho Chi Minh City" as a port UN/LOCODE. Add alias, then rematch.',
        },
      ],
      reviewReasons: [],
    })
    expect(items.some((i) => /Ho Chi Minh/i.test(i.text))).toBe(true)
    expect(items.some((i) => /UN\/LOCODE|not in master|add or alias|left unlinked/i.test(i.text))).toBe(
      true,
    )
  })
})
