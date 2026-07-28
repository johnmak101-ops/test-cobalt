/**
 * Shared tests for "is this string actually a company?", used by every surface that offers a party
 * name to ops as addable in Mesh.
 *
 * These live in one module on purpose. The rule used to be defined next to the review desk and
 * merely DESCRIBED next to the shipment detail page ("Twin of … — keep in step"), and the twins
 * drifted: leg 2026058AA7 listed three names under Forwarder — Master Miss on the detail page while
 * the desk counted two, because the mailbox rule below had only ever been added to the desk.
 * A second definition is a second thing to forget.
 */

/**
 * A "party" that is really a mail header rather than a company:
 *   Maersk Global Service Center (Chengdu) <noreply-gca@lns.maersk.com>
 * or a bare address.
 *
 * Master miss tells ops to "add in Mesh", and creating a master named after a no-reply mailbox would
 * pollute the very data the advice exists to fix. Seen on live leg A84B3B1A, where the desk asked ops
 * to add a Maersk service-centre mailbox to the forwarder list.
 */
export function isMailboxPartyName(raw: string | null | undefined): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(String(raw ?? ''))
}
