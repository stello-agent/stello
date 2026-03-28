import { AlertTriangle, Loader2, X } from 'lucide-react'
import { useRef } from 'react'
import { useI18n } from '@/lib/i18n'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

/** 通用确认弹窗。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const backdropRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pop-enter"
      onClick={(event) => { if (event.target === backdropRef.current && !loading) onClose() }}
    >
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md mx-4 overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className={destructive ? 'text-error' : 'text-warning'} />
            <h3 className="text-sm font-semibold text-text">{title}</h3>
          </div>
          <button onClick={onClose} disabled={loading} className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface/50">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => { void onConfirm() }}
            disabled={loading}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-error text-white hover:bg-error/90'
                : 'bg-primary text-white hover:bg-primary-dark'
            }`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
