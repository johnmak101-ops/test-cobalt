interface GateUser {
  mustReset: boolean
}

/**
 * What a protected route should render given the current auth state:
 *   loading → still restoring the session; login → not authenticated;
 *   reset → authenticated but must change the (seeded/placeholder) password first; ok → proceed.
 */
export function authGate(user: GateUser | null, loading: boolean): 'loading' | 'login' | 'reset' | 'ok' {
  if (loading) return 'loading'
  if (!user) return 'login'
  if (user.mustReset) return 'reset'
  return 'ok'
}
