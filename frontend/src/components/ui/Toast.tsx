import { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'

/**
 * Minimal fire-and-forget toast — module-level pub/sub so any handler can call toast('…')
 * without context wiring. One <Toaster /> is mounted in App; messages auto-dismiss.
 */
type ToastItem = { id: number; message: string }
let emit: ((message: string) => void) | null = null

export function toast(message: string): void {
  emit?.(message)
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    emit = (message) => {
      const id = Date.now() + Math.random()
      setItems((t) => [...t, { id, message }])
      setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 2500)
    }
    return () => {
      emit = null
    }
  }, [])

  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-700 px-4 py-2 text-sm text-text-primary shadow-xl"
        >
          <CheckCircle size={14} className="shrink-0 text-status-success" />
          {t.message}
        </div>
      ))}
    </div>
  )
}
