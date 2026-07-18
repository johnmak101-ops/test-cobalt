import type { KeyboardEvent, MouseEvent } from 'react'

/** Props for a non-button element that should activate on click and keyboard. */
export function interactiveProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: (_e: MouseEvent) => {
      onActivate()
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  }
}
