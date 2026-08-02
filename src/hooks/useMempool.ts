import { useState, useCallback, useEffect } from 'react'
import type { FeeRates, Transaction } from '../types'
import * as mempool from '../lib/mempool'

interface MempoolState {
  feeRates: FeeRates | null
  transactions: Transaction[]
  btcPriceUsd: number | null
  loadingFees: boolean
  loadingHistory: boolean
  error: string | null
}

export function useMempool() {
  const [state, setState] = useState<MempoolState>({
    feeRates: null,
    transactions: [],
    btcPriceUsd: null,
    loadingFees: false,
    loadingHistory: false,
    error: null,
  })

  const fetchFeeRates = useCallback(async () => {
    setState(s => ({ ...s, loadingFees: true, error: null }))

    try {
      const feeRates = await mempool.getFeeRates()
      setState(s => ({ ...s, feeRates, loadingFees: false }))
    } catch (error) {
      setState(s => ({
        ...s,
        loadingFees: false,
        error: error instanceof Error ? error.message : 'Failed to fetch fee rates',
      }))
    }
  }, [])

  const fetchBtcPrice = useCallback(async () => {
    try {
      const btcPriceUsd = await mempool.getBtcPriceUsd()
      setState(s => ({ ...s, btcPriceUsd }))
    } catch {
      // Silently fail - USD price is optional
    }
  }, [])

  const fetchTransactionHistory = useCallback(async (addresses: string[]) => {
    if (addresses.length === 0) return

    setState(s => ({ ...s, loadingHistory: true, error: null }))

    try {
      const transactions = await mempool.getTransactionHistory(addresses)
      setState(s => ({ ...s, transactions, loadingHistory: false }))
    } catch (error) {
      setState(s => ({
        ...s,
        loadingHistory: false,
        error: error instanceof Error ? error.message : 'Failed to fetch history',
      }))
    }
  }, [])

  const broadcast = useCallback(async (txHex: string): Promise<string> => {
    return mempool.broadcastTransaction(txHex)
  }, [])

  // Fetch fee rates and price on mount and every 60 seconds
  useEffect(() => {
    fetchFeeRates()
    fetchBtcPrice()
    const interval = setInterval(() => {
      fetchFeeRates()
      fetchBtcPrice()
    }, 60000)
    return () => clearInterval(interval)
  }, [fetchFeeRates, fetchBtcPrice])

  // Convert sats to USD string
  const satsToUsd = useCallback((sats: number): string | null => {
    if (!state.btcPriceUsd) return null
    const btc = sats / 100_000_000
    const usd = btc * state.btcPriceUsd
    return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }, [state.btcPriceUsd])

  return {
    ...state,
    fetchFeeRates,
    fetchTransactionHistory,
    broadcast,
    satsToBtc: mempool.satsToBtc,
    btcToSats: mempool.btcToSats,
    satsToUsd,
  }
}
