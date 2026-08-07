import { useEffect, ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** Optional extra controls rendered in the header row. */
  headerRight?: ReactNode
}

/**
 * Dark full-screen modal shell used by the QR export/scan UIs.
 * Closes on Escape or backdrop click. Dark background maximizes QR contrast.
 */
export function QRModal({ title, onClose, children, headerRight }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Prevent background scroll while open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 text-slate-100 rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 sticky top-0 bg-slate-900 rounded-t-2xl">
          <h3 className="font-semibold text-lg">{title}</h3>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1"
              aria-label="Close"
              title="Close (Esc)"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
