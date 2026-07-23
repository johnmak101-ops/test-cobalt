import { describe, it, expect } from 'vitest'
import { parseSender, nameFromExchangeDn } from './email-sender'

/**
 * The live case: internal Cobalt senders arrive as a 125-char X500 Distinguished Name because
 * Outlook writes the directory path instead of an SMTP address for same-tenant mail, and the .msg
 * export keeps it verbatim. Three of twelve emails on one shipment thread looked like this.
 */
const LIVE_DN =
  '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=32781597856D4BB29ACE9817AA09D704-RICKY HE'

describe('nameFromExchangeDn', () => {
  it('pulls the person out of the live DN', () => {
    expect(nameFromExchangeDn(LIVE_DN)).toBe('RICKY HE')
  })

  it('handles a tenant that uses a plain alias with no GUID prefix', () => {
    expect(nameFromExchangeDn('/O=CONTOSO/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=jsmith')).toBe('jsmith')
  })

  // 'RECIPIENTS' is a container, not a person. Returning it would label every internal sender
  // "Recipients" — worse than showing the raw DN, because it looks like a real name.
  it('refuses the RECIPIENTS container segment', () => {
    expect(nameFromExchangeDn('/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS')).toBeNull()
  })

  it('ignores anything that is not a DN', () => {
    expect(nameFromExchangeDn('alin.qiu@myTCIgroup.com.cn')).toBeNull()
    expect(nameFromExchangeDn('Ricky He <ricky@x.com>')).toBeNull()
    expect(nameFromExchangeDn('')).toBeNull()
  })
})

describe('parseSender', () => {
  it('unwraps the DN and offers no address', () => {
    // addr stays empty on purpose: a DN is not an address, and rendering it as one invites a
    // mailto link that can never deliver.
    expect(parseSender(LIVE_DN)).toEqual({ name: 'RICKY HE', addr: '' })
  })

  it('still handles the ordinary shapes', () => {
    expect(parseSender('Ricky He <ricky@x.com>')).toEqual({ name: 'Ricky He', addr: 'ricky@x.com' })
    expect(parseSender('alin.qiu@myTCIgroup.com.cn')).toEqual({
      name: 'alin.qiu@myTCIgroup.com.cn',
      addr: 'alin.qiu@myTCIgroup.com.cn',
    })
    expect(parseSender('"Qiu, Alin" <alin@x.cn>')).toEqual({ name: 'Qiu, Alin', addr: 'alin@x.cn' })
  })

  it('tolerates a null sender — several list rows carry one', () => {
    expect(parseSender(null)).toEqual({ name: 'Unknown sender', addr: '' })
    expect(parseSender(undefined)).toEqual({ name: 'Unknown sender', addr: '' })
    expect(parseSender('')).toEqual({ name: 'Unknown sender', addr: '' })
  })

  // A DN that somehow arrives wrapped in angle brackets is an address-shaped string first —
  // the existing branch wins, and that is correct: whatever is in <> is what the mail client used.
  it('prefers the angle-bracket form when both shapes are present', () => {
    expect(parseSender(`Ricky <${LIVE_DN}>`).name).toBe('Ricky')
  })
})
