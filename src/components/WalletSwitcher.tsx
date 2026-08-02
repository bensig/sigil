import { useState, useRef, useEffect } from 'react'
import type { WalletRegistryEntry } from '../lib/wallet-loader'

interface Props {
  wallets: WalletRegistryEntry[]
  activeWalletId: string
  onSwitch: (id: string) => void
  disabled?: boolean
}

export function WalletSwitcher({ wallets, activeWalletId, onSwitch, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const activeWallet = wallets.find(w => w.id === activeWalletId)!

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (wallets.length <= 1) {
    return <h1 className="text-xl font-bold dark:text-white">{activeWallet.name}</h1>
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-2 text-xl font-bold dark:text-white ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-70'}`}
        title={disabled ? 'Cannot switch wallets during Ledger operation' : 'Switch wallet'}
      >
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: activeWallet.accentColor }}
        />
        {activeWallet.name}
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 bg-white dark:bg-slate-800 border border-ink/10 dark:border-slate-600 rounded-lg shadow-lg py-1 min-w-[160px] z-50">
          {wallets.map(w => (
            <button
              key={w.id}
              onClick={() => {
                onSwitch(w.id)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-mist dark:hover:bg-slate-700 ${
                w.id === activeWalletId ? 'font-semibold' : ''
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: w.accentColor }}
              />
              <span className="dark:text-slate-200">{w.name}</span>
              {w.id === activeWalletId && (
                <svg className="w-4 h-4 ml-auto text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
