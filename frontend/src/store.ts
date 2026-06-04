import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

// Read persisted theme from localStorage, default to 'dark'
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem('shiptrack-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

// Apply theme to the DOM
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('shiptrack-theme', theme)
}

// Apply on initial load
const initialTheme = getInitialTheme()
applyTheme(initialTheme)

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),
}))
