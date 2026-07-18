import { useEffect, useState } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'

/**
 * Minimal fire-and-forget toast — module-level pub/sub so any handler can call toast('…')
 * without context wiring. One <Toaster /> is mounted in App; messages auto-dismiss.
 *
 * `toast(msg)` / `toast.success(msg)` → green success. `toast.error(msg)` → red critical.
 */
type ToastKind = 'success' | 'error'
type ToastItem = { id: number; message: string; kind: ToastKind }
type Emit = (message: string, kind: ToastKind) => void
let emit: Emit | null = null

function show(message: string, kind: ToastKind = 'success'): void {
  emit?.(message, kind)
}

export function toast(message: string): void {
  show(message, 'success')
}
toast.success = (message: string): void => show(message, 'success')
toast.error = (message: string): void => show(message, 'error')

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    emit = (message, kind) => {
      const id = Date.now() + Math.random()
      setItems((t) => [...t, { id, message, kind }])
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
          {t.kind === 'error' ? (
            <XCircle size={14} className="shrink-0 text-status-critical" />
          ) : (
            <CheckCircle size={14} className="shrink-0 text-status-success" />
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
