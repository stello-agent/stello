import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

const PENDING_TOAST_KEY = 'stello-devtools-pending-toast'

export interface ToastItem {
  id: number
  kind: 'success' | 'error'
  message: string
  leaving?: boolean
}

interface ToastContextValue {
  showToast: (kind: ToastItem['kind'], message: string) => void
  persistToast: (kind: ToastItem['kind'], message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  persistToast: () => {},
})

/** 使用全局 toast。 */
export function useToast() {
  return useContext(ToastContext)
}

/** 提供 toast 状态与渲染。 */
export function useToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)

  const showToast = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = nextIdRef.current++
    setToasts((prev) => [...prev, { id, kind, message, leaving: false }])
    window.setTimeout(() => {
      setToasts((prev) => prev.map((toast) => toast.id === id ? { ...toast, leaving: true } : toast))
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
      }, 220)
    }, 2380)
  }, [])

  const persistToast = useCallback((kind: ToastItem['kind'], message: string) => {
    sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({ kind, message }))
  }, [])

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_TOAST_KEY)
    if (!raw) return
    sessionStorage.removeItem(PENDING_TOAST_KEY)
    try {
      const parsed = JSON.parse(raw) as { kind?: ToastItem['kind']; message?: string }
      if ((parsed.kind === 'success' || parsed.kind === 'error') && typeof parsed.message === 'string') {
        showToast(parsed.kind, parsed.message)
      }
    } catch {
      // ignore corrupted payload
    }
  }, [showToast])

  const contextValue = useMemo(() => ({ showToast, persistToast }), [showToast, persistToast])

  const viewport = (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`min-w-64 max-w-96 px-3 py-2 rounded-lg border shadow-lg backdrop-blur-sm text-xs font-medium flex items-center gap-2 ${
            toast.leaving ? 'toast-exit' : 'toast-enter'
          } ${
            toast.kind === 'success'
              ? 'bg-[#ECF9F0] border-[#B7E1C1] text-[#23633D]'
              : 'bg-[#FFF1F1] border-[#F1C3C3] text-[#9F2F2F]'
          }`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 size={14} className="shrink-0" />
            : <XCircle size={14} className="shrink-0" />
          }
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  )

  return { contextValue, viewport }
}

export { ToastContext }
