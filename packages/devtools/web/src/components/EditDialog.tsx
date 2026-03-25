import { useState, useEffect, useRef } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

export interface EditField {
  key: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'password' | 'select'
  value: string | number
  placeholder?: string
  options?: string[]
  min?: number
  max?: number
  step?: number
}

interface EditDialogProps {
  open: boolean
  title: string
  fields: EditField[]
  onSave: (values: Record<string, string | number>) => Promise<void>
  onClose: () => void
}

/** 通用编辑弹窗 */
export function EditDialog({ open, title, fields, onSave, onClose }: EditDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Record<string, string | number>>({})
  const [saving, setSaving] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)

  /* 打开时初始化 draft */
  useEffect(() => {
    if (open) {
      const initial: Record<string, string | number> = {}
      for (const f of fields) initial[f.key] = f.value
      setDraft(initial)
    }
  }, [open, fields])

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const updateField = (key: string, value: string | number) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pop-enter"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-[11px] font-semibold text-text-muted tracking-wide block mb-1.5">
                {f.label}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  value={String(draft[f.key] ?? '')}
                  onChange={(e) => updateField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full h-32 px-3 py-2 text-xs font-mono bg-surface border border-border rounded-lg focus:border-primary focus:outline-none resize-y leading-relaxed transition-colors"
                />
              ) : f.type === 'select' ? (
                <select
                  value={String(draft[f.key] ?? '')}
                  onChange={(e) => updateField(f.key, e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-surface border border-border rounded-lg focus:border-primary focus:outline-none transition-colors"
                >
                  {f.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => updateField(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                  placeholder={f.placeholder}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  className="w-full h-9 px-3 text-xs font-mono bg-surface border border-border rounded-lg focus:border-primary focus:outline-none transition-colors"
                  onKeyDown={(e) => { if (e.key === 'Enter' && fields.length === 1) handleSave() }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text rounded-lg hover:bg-muted transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
