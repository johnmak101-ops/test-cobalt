import { create } from 'zustand'

type Theme = 'dark' | 'light'
type FontScale = 'normal' | 'large'

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  mobileNavOpen: boolean
  openMobileNav: () => void
  closeMobileNav: () => void
  toggleMobileNav: () => void
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  fontScale: FontScale
  setFontScale: (fontScale: FontScale) => void
  toggleFontScale: () => void
}

// Read persisted theme from localStorage, default to 'dark'
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem('shiptrack-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* storage blocked (private mode) — fall through */ }
  return 'dark'
}

// Apply theme to the DOM
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('shiptrack-theme', theme)
  } catch { /* storage blocked — DOM attribute still applied */ }
}

// Read persisted font scale — a larger base text for readability (users are mainly 40–60).
function getInitialFontScale(): FontScale {
  if (typeof window === 'undefined') return 'normal'
  try {
    const stored = localStorage.getItem('shiptrack-font-scale')
    if (stored === 'normal' || stored === 'large') return stored
  } catch { /* storage blocked (private mode) — fall through */ }
  return 'normal'
}

// Apply font scale to the DOM. index.css scales the root font-size RELATIVE to the browser default,
// so 'normal' still honours a user's own browser text-size preference.
function applyFontScale(fontScale: FontScale) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-font-scale', fontScale)
  try {
    localStorage.setItem('shiptrack-font-scale', fontScale)
  } catch { /* storage blocked — DOM attribute still applied */ }
}

// Apply on initial load
const initialTheme = getInitialTheme()
applyTheme(initialTheme)
const initialFontScale = getInitialFontScale()
applyFontScale(initialFontScale)

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  mobileNavOpen: false,
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
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
  fontScale: initialFontScale,
  setFontScale: (fontScale) => {
    applyFontScale(fontScale)
    set({ fontScale })
  },
  toggleFontScale: () =>
    set((s) => {
      const next = s.fontScale === 'normal' ? 'large' : 'normal'
      applyFontScale(next)
      return { fontScale: next }
    }),
}))
