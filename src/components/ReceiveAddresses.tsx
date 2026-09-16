import { useState } from 'react'
import type { CachedAddress } from '../hooks/useAddressLabels'
import { pickNextUnusedIndex } from '../lib/change-policy'

interface Props {
  addresses: CachedAddress[]
  addressStats: Map<string, { txCount: number; balance: number }>
  /** Addresses whose history could not be fetched, so "no transactions" can't
   *  be inferred from a missing stats entry. */
  unresolvedAddresses?: ReadonlySet<string>
  setLabel: (address: string, label: string) => void
  satsToBtc: (sats: number) => string
  satsToUsd: (sats: number) => string | null
  saveStatus: 'saved' | 'saving' | 'error'
  onRefresh: () => void
  refreshing: boolean
  onRefreshAddress?: (address: string) => Promise<void>
}

export function ReceiveAddresses({
  addresses,
  addressStats,
  unresolvedAddresses,
  setLabel,
  satsToBtc,
  satsToUsd,
  saveStatus,
  onRefresh,
  refreshing,
  onRefreshAddress,
}: Props) {
  const [editingAddress, setEditingAddress] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [refreshingAddress, setRefreshingAddress] = useState<string | null>(null)

  const handleRefreshAddress = async (address: string) => {
    if (!onRefreshAddress || refreshingAddress) return
    setRefreshingAddress(address)
    try {
      await onRefreshAddress(address)
    } finally {
      setRefreshingAddress(null)
    }
  }

  const copyToClipboard = async (address: string) => {
    await navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(null), 2000)
  }

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 5)}...${address.slice(-5)}`
  }

  const handleStartEdit = (address: string, currentLabel: string) => {
    setEditValue(currentLabel)
    setEditingAddress(address)
  }

  const handleSaveEdit = (address: string) => {
    setLabel(address, editValue)
    setEditingAddress(null)
    setEditValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent, address: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(address)
    } else if (e.key === 'Escape') {
      setEditingAddress(null)
      setEditValue('')
    }
  }

  const openMempool = (address: string) => {
    window.open(`https://mempool.space/address/${address}`, '_blank')
  }

  const receiveAddresses = addresses.filter(a => !a.isChange)
  const allChangeAddresses = addresses.filter(a => a.isChange).sort((a, b) => a.index - b.index)
  // Where change from the next send lands, when the wallet is set to use a
  // fresh address. Showing it here means the destination is never a surprise
  // discovered only after the transaction has gone out.
  // Only claim to know the next one when the history actually came back; a
  // failed lookup must not decorate a used address as the next change address.
  const nextUnused = pickNextUnusedIndex(allChangeAddresses, addressStats, unresolvedAddresses)
  const nextChangeIndex = nextUnused.status === 'found' ? nextUnused.index : null
  const changeAddresses = allChangeAddresses.filter(a => {
    const txCount = addressStats.get(a.address)?.txCount || 0
    return txCount > 0 || a.index === nextChangeIndex
  })

  const renderAddressRow = (addr: CachedAddress) => {
    const stats = addressStats.get(addr.address)
    const balance = stats?.balance || 0
    const txCount = stats?.txCount || 0
    const hasBalance = balance > 0
    const isUsed = txCount > 0
    const isChange = !!addr.isChange

    return (
      <div
        key={addr.address}
        className={`p-3 rounded border relative ${
          isChange
            ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/15'
            : hasBalance
              ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
              : isUsed
                ? 'border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-800'
                : 'border-ink/10 bg-white dark:border-slate-700 dark:bg-slate-800'
        }`}
      >
        {isChange && (
          <span className={`absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
            !isUsed && nextChangeIndex !== null && addr.index === nextChangeIndex
              ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
              : 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
          }`}>
            {!isUsed && nextChangeIndex !== null && addr.index === nextChangeIndex ? 'Next change' : 'Change'}
          </span>
        )}
        {/* Address row */}
        <div className={`flex items-start justify-between gap-2 ${isChange ? 'pr-14' : ''}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => openMempool(addr.address)}
                className="mono text-sm hover:underline text-left text-ink dark:text-slate-200"
                title="Open in Mempool.space"
              >
                {truncateAddress(addr.address)}
              </button>
              <button
                onClick={() => copyToClipboard(addr.address)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                  copiedAddress === addr.address
                    ? 'bg-green-100 text-green-700'
                    : 'bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink/70'
                }`}
                title="Copy address"
              >
                {copiedAddress === addr.address ? '✓' : 'copy'}
              </button>
              {onRefreshAddress && (
                <button
                  onClick={() => handleRefreshAddress(addr.address)}
                  disabled={refreshingAddress === addr.address}
                  className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                    refreshingAddress === addr.address
                      ? 'bg-ink/5 text-ink/30 cursor-not-allowed'
                      : 'bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink/70'
                  }`}
                  title="Refresh this address"
                >
                  {refreshingAddress === addr.address ? '...' : 'refresh'}
                </button>
              )}
            </div>
            <div className="text-xs text-ink/40 dark:text-slate-500 mt-0.5">
              #{addr.index} &middot; {addr.path}
            </div>
          </div>

          {/* Tx count and Balance */}
          <div className="flex items-center gap-2">
            {isUsed && (
              <span className="text-xs bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded">
                {txCount} tx{txCount !== 1 ? 's' : ''}
              </span>
            )}
            {hasBalance && (
              <div className="text-right text-sm">
                <div className={`font-medium ${isChange ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                  {satsToBtc(balance)} BTC
                </div>
                {satsToUsd(balance) && (
                  <div className="text-xs text-ink/50 dark:text-slate-400">${satsToUsd(balance)}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Label row */}
        <div className="mt-2 flex items-center gap-2">
          {editingAddress === addr.address ? (
            <>
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, addr.address)}
                placeholder="Add label..."
                className="flex-1 text-sm border border-ink/20 rounded px-2 py-1"
                autoFocus
              />
              <button
                onClick={() => handleSaveEdit(addr.address)}
                className="text-xs text-green-600 hover:text-green-800 px-2 py-1"
              >
                Save
              </button>
              <button
                onClick={() => { setEditingAddress(null); setEditValue('') }}
                className="text-xs text-ink/50 hover:text-ink px-2 py-1"
              >
                Cancel
              </button>
            </>
          ) : addr.label ? (
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-ink dark:text-slate-200">{addr.label}</span>
              <button
                onClick={() => handleStartEdit(addr.address, addr.label)}
                className="text-xs text-ink/40 hover:text-ink dark:text-slate-500 dark:hover:text-slate-300"
                title="Edit label"
              >
                edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleStartEdit(addr.address, '')}
              className="text-sm text-ink/40 hover:text-ink/60 dark:text-slate-500 dark:hover:text-slate-400"
            >
              + Add label
            </button>
          )}

        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold dark:text-white">Receive Addresses</h3>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              refreshing
                ? 'bg-ink/5 text-ink/30 cursor-not-allowed'
                : 'bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink/70'
            }`}
            title="Check addresses on chain"
          >
            {refreshing ? 'checking...' : 'refresh'}
          </button>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${
          saveStatus === 'saving' ? 'bg-amber-100 text-amber-700' :
          saveStatus === 'error' ? 'bg-red-100 text-red-700' :
          'bg-green-100 text-green-700'
        }`}>
          {saveStatus === 'saving' ? 'Saving...' :
           saveStatus === 'error' ? 'Save failed' :
           'Auto-saved'}
        </span>
      </div>

      <div className="space-y-2">
        {receiveAddresses.map(renderAddressRow)}

        {changeAddresses.length > 0 && (
          <>
            <div className="pt-4 pb-1 flex items-center gap-2">
              <div className="h-px flex-1 bg-ink/10 dark:bg-slate-700" />
              <span className="text-xs font-medium text-ink/50 dark:text-slate-400 uppercase tracking-wider">
                Change Addresses
              </span>
              <div className="h-px flex-1 bg-ink/10 dark:bg-slate-700" />
            </div>
            {changeAddresses.map(renderAddressRow)}
          </>
        )}
      </div>

      <p className="text-xs text-ink/40 dark:text-slate-500 mt-4">
        Changes auto-save to src/data/address-labels.json during dev.
      </p>
    </div>
  )
}
