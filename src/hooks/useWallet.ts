import { useState, useCallback, useEffect, useMemo } from 'react'
import type { WalletConfig, AddressInfo, UTXO } from '../types'
import { generateAddresses } from '../lib/addresses'
import { scanAddresses, clearUtxoCache, setApiConfig, refreshSingleAddressUtxos, fetchUtxosForAddresses } from '../lib/mempool'
import { buildWalletConfig } from '../lib/wallet-config'
import type { AppConfig } from '../lib/wallet-config'

interface WalletState {
  config: WalletConfig
  addresses: AddressInfo[]
  changeAddresses: AddressInfo[]
  utxos: Map<string, UTXO[]>
  balance: number
  nextReceiveIndex: number
  nextChangeIndex: number
  loading: boolean
  scanning: boolean
  error: string | null
}

interface CachedBalances {
  utxos: Record<string, UTXO[]>
  balance: number
  nextReceiveIndex: number
  nextChangeIndex: number
  timestamp: number
}

function getCacheKey(walletId: string) {
  return `wallet-balances-${walletId}`
}

function loadCachedBalances(walletId: string): CachedBalances | null {
  try {
    const raw = localStorage.getItem(getCacheKey(walletId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveCachedBalances(walletId: string, data: Omit<CachedBalances, 'timestamp'>) {
  try {
    localStorage.setItem(getCacheKey(walletId), JSON.stringify({ ...data, timestamp: Date.now() }))
  } catch {
    // localStorage full or unavailable
  }
}

export function useWallet(appConfig: AppConfig, walletId?: string) {
  const baseConfig = useMemo(() => buildWalletConfig(appConfig, 0), [appConfig])
  const [state, setState] = useState<WalletState>({
    config: baseConfig,
    addresses: [],
    changeAddresses: [],
    utxos: new Map(),
    balance: 0,
    nextReceiveIndex: 0,
    nextChangeIndex: 0,
    loading: true,
    scanning: false,
    error: null,
  })

  // Initialize - generate addresses on mount
  useEffect(() => {
    const init = async () => {
      try {
        const config = baseConfig
        // Check for placeholder xpubs before attempting address generation
        const missingKeys = config.extendedPublicKeys.filter(
          k => !k.xpub || !k.xpub.startsWith('xpub') || !k.xfp || k.xfp === 'REPLACE_WITH_XFP'
        )
        if (missingKeys.length > 0) {
          const names = missingKeys.map(k => k.name).join(', ')
          setState(s => ({
            ...s,
            loading: false,
            error: `Wallet not configured. Missing xpub/fingerprint for signer(s): ${names}. Go to Settings and use "Import from Ledger" to set up each signer.`,
          }))
          return
        }
        setApiConfig({
          provider: config.client.provider,
          apiBaseUrl: config.client.apiBaseUrl,
          fallbackProvider: config.client.fallbackProvider,
          fallbackApiBaseUrl: config.client.fallbackApiBaseUrl,
        })
        // Generate a pool of addresses (we'll scan them smartly)
        const addresses = await generateAddresses(config, 20, config.startingAddressIndex)
        const changeAddresses = await generateAddresses(config, 10, 0, true)

        // Restore cached balances if available
        const cached = walletId ? loadCachedBalances(walletId) : null
        if (cached) {
          const cachedUtxos = new Map<string, UTXO[]>(Object.entries(cached.utxos))
          const updatedAddresses = addresses.map(addr => {
            const utxos = cachedUtxos.get(addr.address) || []
            const balance = utxos.reduce((sum, u) => sum + u.value, 0)
            return { ...addr, balance, used: utxos.length > 0 }
          })
          const updatedChangeAddresses = changeAddresses.map(addr => {
            const utxos = cachedUtxos.get(addr.address) || []
            const balance = utxos.reduce((sum, u) => sum + u.value, 0)
            return { ...addr, balance, used: utxos.length > 0 }
          })
          setState(s => ({
            ...s,
            addresses: updatedAddresses,
            changeAddresses: updatedChangeAddresses,
            utxos: cachedUtxos,
            balance: cached.balance,
            nextReceiveIndex: cached.nextReceiveIndex,
            nextChangeIndex: cached.nextChangeIndex,
            loading: false,
          }))
        } else {
          setState(s => ({
            ...s,
            addresses,
            changeAddresses,
            loading: false,
          }))
        }
      } catch (error) {
        console.error('Failed to generate addresses:', error)
        setState(s => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to generate addresses',
        }))
      }
    }

    init()
  }, [])

  // Smart scan for balances - only checks until gap limit
  const scanBalances = useCallback(async () => {
    if (state.addresses.length === 0) return

    setState(s => ({ ...s, scanning: true, error: null }))

    try {
      // Scan receive addresses (use higher gap limit to not miss funded addresses)
      const receiveAddrs = state.addresses.map(a => a.address)
      const { usedAddresses: receiveUsed, nextUnusedIndex: nextReceive } = await scanAddresses(receiveAddrs, 10)

      // Scan change addresses
      const changeAddrs = state.changeAddresses.map(a => a.address)
      const { usedAddresses: changeUsed, nextUnusedIndex: nextChange } = await scanAddresses(changeAddrs, 10)

      // Merge UTXO maps
      const allUtxos = new Map<string, UTXO[]>()
      receiveUsed.forEach((utxos, addr) => allUtxos.set(addr, utxos))
      changeUsed.forEach((utxos, addr) => allUtxos.set(addr, utxos))

      // Update address info with balances
      const updatedAddresses = state.addresses.map(addr => {
        const utxos = allUtxos.get(addr.address) || []
        const balance = utxos.reduce((sum, u) => sum + u.value, 0)
        return { ...addr, balance, used: utxos.length > 0 }
      })

      const updatedChangeAddresses = state.changeAddresses.map(addr => {
        const utxos = allUtxos.get(addr.address) || []
        const balance = utxos.reduce((sum, u) => sum + u.value, 0)
        return { ...addr, balance, used: utxos.length > 0 }
      })

      // Calculate total balance
      let totalBalance = 0
      allUtxos.forEach(utxos => {
        totalBalance += utxos.reduce((sum, u) => sum + u.value, 0)
      })

      setState(s => ({
        ...s,
        addresses: updatedAddresses,
        changeAddresses: updatedChangeAddresses,
        utxos: allUtxos,
        balance: totalBalance,
        nextReceiveIndex: nextReceive,
        nextChangeIndex: nextChange,
        scanning: false,
      }))

      // Cache the results
      if (walletId) {
        const utxoObj: Record<string, UTXO[]> = {}
        allUtxos.forEach((v, k) => { utxoObj[k] = v })
        saveCachedBalances(walletId, {
          utxos: utxoObj,
          balance: totalBalance,
          nextReceiveIndex: nextReceive,
          nextChangeIndex: nextChange,
        })
      }
    } catch (error) {
      setState(s => ({
        ...s,
        scanning: false,
        error: error instanceof Error ? error.message : 'Failed to scan balances',
      }))
    }
  }, [state.addresses, state.changeAddresses, walletId])

  // Lightweight scan - only re-checks addresses that previously had UTXOs
  const scanKnownAddresses = useCallback(async () => {
    if (state.utxos.size === 0) return

    setState(s => ({ ...s, scanning: true, error: null }))

    try {
      const knownAddresses = Array.from(state.utxos.keys())
      const freshUtxos = await fetchUtxosForAddresses(knownAddresses)

      setState(s => {
        // Start with fresh results for known addresses
        const newUtxos = new Map<string, UTXO[]>()
        freshUtxos.forEach((utxos, addr) => newUtxos.set(addr, utxos))

        // Calculate total balance
        let totalBalance = 0
        newUtxos.forEach(utxos => {
          totalBalance += utxos.reduce((sum, u) => sum + u.value, 0)
        })

        // Update address info
        const updatedAddresses = s.addresses.map(addr => {
          const utxos = newUtxos.get(addr.address) || []
          const balance = utxos.reduce((sum, u) => sum + u.value, 0)
          return { ...addr, balance, used: utxos.length > 0 }
        })
        const updatedChangeAddresses = s.changeAddresses.map(addr => {
          const utxos = newUtxos.get(addr.address) || []
          const balance = utxos.reduce((sum, u) => sum + u.value, 0)
          return { ...addr, balance, used: utxos.length > 0 }
        })

        return {
          ...s,
          utxos: newUtxos,
          balance: totalBalance,
          addresses: updatedAddresses,
          changeAddresses: updatedChangeAddresses,
          scanning: false,
        }
      })

      // Update cache
      if (walletId) {
        const utxoObj: Record<string, UTXO[]> = {}
        freshUtxos.forEach((v, k) => { utxoObj[k] = v })
        let totalBalance = 0
        freshUtxos.forEach(utxos => {
          totalBalance += utxos.reduce((sum, u) => sum + u.value, 0)
        })
        saveCachedBalances(walletId, {
          utxos: utxoObj,
          balance: totalBalance,
          nextReceiveIndex: state.nextReceiveIndex,
          nextChangeIndex: state.nextChangeIndex,
        })
      }
    } catch (error) {
      setState(s => ({
        ...s,
        scanning: false,
        error: error instanceof Error ? error.message : 'Failed to refresh balances',
      }))
    }
  }, [state.utxos, state.addresses, state.changeAddresses, state.nextReceiveIndex, state.nextChangeIndex, walletId])

  // Force refresh (clears cache)
  const forceRefresh = useCallback(async () => {
    clearUtxoCache()
    if (walletId) {
      try { localStorage.removeItem(getCacheKey(walletId)) } catch {}
    }
    await scanBalances()
  }, [scanBalances, walletId])

  // Refresh a single address (bypasses cache, updates only that address)
  const refreshAddress = useCallback(async (address: string) => {
    const utxos = await refreshSingleAddressUtxos(address)
    const balance = utxos.reduce((sum, u) => sum + u.value, 0)

    setState(s => {
      const newUtxos = new Map(s.utxos)
      if (utxos.length > 0) {
        newUtxos.set(address, utxos)
      } else {
        newUtxos.delete(address)
      }

      // Recalculate total balance
      let totalBalance = 0
      newUtxos.forEach(addrUtxos => {
        totalBalance += addrUtxos.reduce((sum, u) => sum + u.value, 0)
      })

      // Update address info
      const updatedAddresses = s.addresses.map(a =>
        a.address === address ? { ...a, balance, used: utxos.length > 0 } : a
      )
      const updatedChangeAddresses = s.changeAddresses.map(a =>
        a.address === address ? { ...a, balance, used: utxos.length > 0 } : a
      )

      return {
        ...s,
        utxos: newUtxos,
        balance: totalBalance,
        addresses: updatedAddresses,
        changeAddresses: updatedChangeAddresses,
      }
    })

    return utxos
  }, [])

  // Get next unused receive address
  const getNextReceiveAddress = useCallback((): AddressInfo | null => {
    if (state.nextReceiveIndex < state.addresses.length) {
      return state.addresses[state.nextReceiveIndex]
    }
    return state.addresses[0] || null
  }, [state.addresses, state.nextReceiveIndex])

  // Get next unused change address
  const getNextChangeAddress = useCallback((): AddressInfo | null => {
    if (state.nextChangeIndex < state.changeAddresses.length) {
      return state.changeAddresses[state.nextChangeIndex]
    }
    return state.changeAddresses[0] || null
  }, [state.changeAddresses, state.nextChangeIndex])

  // Get all UTXOs with address info
  const getAllUtxos = useCallback(() => {
    const result: Array<UTXO & { address: string; addressIndex: number; isChange: boolean }> = []

    state.addresses.forEach((addr) => {
      const utxos = state.utxos.get(addr.address) || []
      utxos.forEach(utxo => {
        result.push({ ...utxo, address: addr.address, addressIndex: addr.index, isChange: false })
      })
    })

    state.changeAddresses.forEach((addr) => {
      const utxos = state.utxos.get(addr.address) || []
      utxos.forEach(utxo => {
        result.push({ ...utxo, address: addr.address, addressIndex: addr.index, isChange: true })
      })
    })

    return result
  }, [state.addresses, state.changeAddresses, state.utxos])

  // Get addresses with balances (for display)
  const getAddressesWithBalance = useCallback(() => {
    return state.addresses.filter(a => a.balance > 0)
  }, [state.addresses])

  return {
    ...state,
    scanBalances,
    scanKnownAddresses,
    forceRefresh,
    refreshAddress,
    getNextReceiveAddress,
    getNextChangeAddress,
    getAllUtxos,
    getAddressesWithBalance,
  }
}
