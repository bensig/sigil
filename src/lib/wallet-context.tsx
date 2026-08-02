import { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react'
import type { AppConfig } from './wallet-config'
import { getWalletRegistry, loadWalletConfig } from './wallet-loader'
import type { WalletRegistryEntry } from './wallet-loader'
import { clearUtxoCache } from './mempool'

interface WalletContextValue {
  walletId: string
  walletEntry: WalletRegistryEntry
  config: AppConfig
  switchWallet: (id: string) => void
  wallets: WalletRegistryEntry[]
}

const WalletContext = createContext<WalletContextValue | null>(null)

const STORAGE_KEY = 'active-wallet-id'

function resolveInitialWalletId(wallets: WalletRegistryEntry[]): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && wallets.some(w => w.id === stored)) {
    return stored
  }
  if (stored) {
    console.warn(`Stored wallet ID "${stored}" not found in registry, falling back to first wallet`)
  }
  return wallets[0].id
}

export function WalletProvider({ children }: { children: (ctx: WalletContextValue) => React.ReactNode }) {
  const wallets = useMemo(() => getWalletRegistry(), [])
  const [walletId, setWalletId] = useState(() => wallets.length > 0 ? resolveInitialWalletId(wallets) : '')

  const walletEntry: WalletRegistryEntry | undefined = useMemo(
    () => wallets.find(w => w.id === walletId),
    [wallets, walletId]
  )

  const config: AppConfig | null = useMemo(
    () => wallets.length > 0 ? loadWalletConfig(walletId) : null,
    [walletId, wallets]
  )

  const switchWallet = useCallback((id: string) => {
    if (!wallets.some(w => w.id === id)) {
      console.warn(`Cannot switch to unknown wallet "${id}"`)
      return
    }
    clearUtxoCache()
    localStorage.setItem(STORAGE_KEY, id)
    setWalletId(id)
  }, [wallets])

  useEffect(() => {
    if (walletEntry) {
      document.title = `${walletEntry.name} Wallet`
    }
  }, [walletEntry])

  // Guard placed after all hooks to keep hook order stable. Once past this point,
  // walletEntry and config are provably non-null, so the context value below
  // builds without `!` or `as` casts.
  if (wallets.length === 0 || !walletEntry || !config) return null

  const value: WalletContextValue = { walletId, walletEntry, config, switchWallet, wallets }

  return (
    <WalletContext.Provider value={value}>
      {children(value)}
    </WalletContext.Provider>
  )
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used within WalletProvider')
  return ctx
}
