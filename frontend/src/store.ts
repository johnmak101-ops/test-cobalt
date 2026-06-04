import { create } from 'zustand'

interface AppState {
  count: number
  message: string
  increment: () => void
  decrement: () => void
  fetchMessage: () => Promise<void>
}

export const useStore = create<AppState>((set) => ({
  count: 0,
  message: '',

  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),

  fetchMessage: async () => {
    try {
      const response = await fetch('/api/hello')
      const data = await response.json()
      set({ message: data.message })
    } catch (error) {
      set({ message: 'Error fetching message' })
    }
  },
}))
