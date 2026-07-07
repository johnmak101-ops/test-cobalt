import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

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

const KEY = ['users'] as const

export function useUsers() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<AdminUser[]>('/users') })
}
export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<AdminUser>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserInput }) => api.patch<AdminUser>(`/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<AdminUser>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
