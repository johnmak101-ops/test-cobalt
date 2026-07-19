import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './store'

describe('useUIStore — font scale (larger text for readability)', () => {
  beforeEach(() => {
    useUIStore.getState().setFontScale('normal')
  })

  it('applies the scale to the root element and persists it', () => {
    useUIStore.getState().setFontScale('large')
    expect(useUIStore.getState().fontScale).toBe('large')
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('large')
    expect(localStorage.getItem('shiptrack-font-scale')).toBe('large')
  })

  it('toggles between normal and large', () => {
    expect(useUIStore.getState().fontScale).toBe('normal')
    useUIStore.getState().toggleFontScale()
    expect(useUIStore.getState().fontScale).toBe('large')
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('large')
    useUIStore.getState().toggleFontScale()
    expect(useUIStore.getState().fontScale).toBe('normal')
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('normal')
  })
})
