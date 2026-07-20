/** Shadow membership: queue marked wouldBeAuto under OPENPAVE_DESK_MEMBERSHIP=shadow. */
export function isShadowEligible(cr?: { wouldBeAuto?: boolean } | null): boolean {
  return cr?.wouldBeAuto === true
}
