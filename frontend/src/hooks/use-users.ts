import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { toast } from '../components/ui/Toast'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  mustReset: boolean
  avatarInitials: string | null
  createdAt: string
}
export interface CreateUserInput { email: string; name: string; role: string; password: string }
export interface UpdateUserInput { name?: string; role?: string; active?: boolean; password?: string }

/** Extract a human message from an api.ts error (`API error <status>: <NestJS JSON body>`). */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  const m = raw.match(/API error \d+: (.*)$/s)
  const body = m ? m[1] : raw
  try {
    const parsed = JSON.parse(body)
    if (Array.isArray(parsed?.message)) return parsed.message.join('; ')
    if (typeof parsed?.message === 'string') return parsed.message
  } catch { /* not JSON */ }
  return body || fallback
}

const KEY = ['users'] as const

export function useUsers() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AdminUser[]>('/users') })
}
export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<AdminUser>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast(apiErrorMessage(e, 'Failed to create user')),
  })
}
export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserInput }) => api.patch<AdminUser>(`/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => { toast(apiErrorMessage(e, 'Failed to update user')); qc.invalidateQueries({ queryKey: KEY }) },
  })
}
export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<AdminUser>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast(apiErrorMessage(e, 'Failed to deactivate user')),
  })
}
