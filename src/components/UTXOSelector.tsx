import { useMemo } from 'react'
import type { UTXO } from '../types'

export interface EnrichedUTXO extends UTXO {
  address: string
  addressIndex: number
  isChange: boolean
}

export interface AddressLabel {
  address: string
  label: string
}

interface Props {
  utxos: EnrichedUTXO[]
  selected: Set<string>
  onToggle: (utxoKey: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
  satsToBtc: (sats: number) => string
  satsToUsd: (sats: number) => string | null
  addressLabels?: AddressLabel[]
  disabled?: boolean
}

// Unique key for a UTXO
export function utxoKey(utxo: { txid: string; vout: number }): string {
  return `${utxo.txid}:${utxo.vout}`
}

export function UTXOSelector({
  utxos,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  satsToBtc,
  satsToUsd,
  addressLabels = [],
  disabled = false,
}: Props) {
  // Create a lookup map for labels
  const labelMap = useMemo(() => {
    const map = new Map<string, string>()
    addressLabels.forEach(al => {
      if (al.label) map.set(al.address, al.label)
    })
    return map
  }, [addressLabels])

  // Group UTXOs by address
  const grouped = useMemo(() => {
    const map = new Map<string, EnrichedUTXO[]>()
    utxos.forEach(utxo => {
      const existing = map.get(utxo.address) || []
      existing.push(utxo)
      map.set(utxo.address, existing)
    })
    // Sort addresses by total value (descending)
    return Array.from(map.entries()).sort((a, b) => {
      const aTotal = a[1].reduce((sum, u) => sum + u.value, 0)
      const bTotal = b[1].reduce((sum, u) => sum + u.value, 0)
      return bTotal - aTotal
    })
  }, [utxos])

  const selectedTotal = useMemo(() => {
    return utxos
      .filter(u => selected.has(utxoKey(u)))
      .reduce((sum, u) => sum + u.value, 0)
  }, [utxos, selected])

  const allSelected = selected.size === utxos.length && utxos.length > 0
  const noneSelected = selected.size === 0

  if (utxos.length === 0) {
    return (
      <div className="text-sm text-ink/50 dark:text-slate-400 text-center py-4">
        No UTXOs available
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium dark:text-slate-200">Select UTXOs to Spend</label>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
            onClick={onSelectAll}
            disabled={disabled || allSelected}
          >
            Select All
          </button>
          <span className="text-ink/30 dark:text-slate-600">|</span>
          <button
            type="button"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
            onClick={onSelectNone}
            disabled={disabled || noneSelected}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="border border-ink/10 dark:border-slate-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
        {grouped.map(([address, addressUtxos]) => {
          const addressTotal = addressUtxos.reduce((sum, u) => sum + u.value, 0)
          const addressSelectedCount = addressUtxos.filter(u => selected.has(utxoKey(u))).length
          const isChange = addressUtxos[0]?.isChange

          const addressLabel = labelMap.get(address)

          return (
            <div key={address} className="border-b border-ink/10 dark:border-slate-700 last:border-b-0">
              {/* Address header */}
              <div className="bg-mist dark:bg-slate-700 px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {addressLabel ? (
                    <span className="font-medium text-sm truncate dark:text-slate-200">{addressLabel}</span>
                  ) : (
                    <span className="mono text-xs dark:text-slate-300">
                      {address.slice(0, 8)}...{address.slice(-6)}
                    </span>
                  )}
                  {isChange && (
                    <span className="text-[10px] bg-ink/10 dark:bg-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded flex-shrink-0">change</span>
                  )}
                  {addressLabel && (
                    <span className="mono text-[10px] text-ink/40 dark:text-slate-500 flex-shrink-0">
                      {address.slice(0, 6)}...
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink/60 dark:text-slate-400 flex-shrink-0">
                  {satsToBtc(addressTotal)} BTC
                  {addressSelectedCount > 0 && (
                    <span className="ml-1 text-green-600 dark:text-green-400">
                      ({addressSelectedCount}/{addressUtxos.length} selected)
                    </span>
                  )}
                </div>
              </div>

              {/* UTXOs for this address */}
              <div className="divide-y divide-ink/5 dark:divide-slate-700">
                {addressUtxos.map(utxo => {
                  const key = utxoKey(utxo)
                  const isSelected = selected.has(key)

                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-mist/50 dark:hover:bg-slate-700/50 transition-colors ${
                        isSelected ? 'bg-green-50 dark:bg-green-900/20' : ''
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(key)}
                        disabled={disabled}
                        className="w-4 h-4 rounded border-ink/30 dark:border-slate-600 text-green-600 focus:ring-green-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="mono text-xs text-ink/60 dark:text-slate-400 truncate">
                          {utxo.txid.slice(0, 8)}...:{utxo.vout}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium dark:text-slate-200">{satsToBtc(utxo.value)} BTC</div>
                        {satsToUsd(utxo.value) && (
                          <div className="text-xs text-ink/50 dark:text-slate-400">${satsToUsd(utxo.value)}</div>
                        )}
                      </div>
                      {!utxo.confirmed && (
                        <span className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                          unconfirmed
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Selection summary */}
      <div className="bg-mist dark:bg-slate-700 rounded-lg px-3 py-2 flex items-center justify-between">
        <span className="text-sm text-ink/60 dark:text-slate-400">
          {selected.size} UTXO{selected.size !== 1 ? 's' : ''} selected
        </span>
        <span className="text-sm font-medium dark:text-slate-200">
          {satsToBtc(selectedTotal)} BTC
          {satsToUsd(selectedTotal) && (
            <span className="ml-1 text-ink/60 dark:text-slate-400">(${satsToUsd(selectedTotal)})</span>
          )}
        </span>
      </div>
    </div>
  )
}
