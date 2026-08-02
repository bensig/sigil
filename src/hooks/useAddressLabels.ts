import { useState, useCallback, useEffect, useRef } from 'react'
import { loadAddressLabels } from '../lib/wallet-loader'
import type { AddressInfo } from '../types'

export interface CachedAddress {
  index: number
  address: string
  path: string
  label: string
  used: boolean
  isChange?: boolean
}

type SaveStatus = 'saved' | 'saving' | 'error'

export function useAddressLabels(walletId: string, walletAddresses?: AddressInfo[], walletChangeAddresses?: AddressInfo[]) {
  const [addresses, setAddresses] = useState<CachedAddress[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasSynced = useRef(false)

  // Load from static file on mount
  useEffect(() => {
    const base = loadAddressLabels(walletId)
    setAddresses(base)
    hasSynced.current = false
  }, [walletId])

  // Auto-save to file via dev server API (debounced)
  const saveToFile = useCallback(async (data: CachedAddress[]) => {
    setSaveStatus('saving')
    try {
      const response = await fetch(`/api/save-labels?wallet=${walletId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: data }),
      })
      if (response.ok) {
        setSaveStatus('saved')
      } else {
        // In production (no dev server), silently fail
        setSaveStatus('saved')
      }
    } catch {
      // In production or if API fails, just mark as saved (data is in memory)
      setSaveStatus('saved')
    }
  }, [walletId])

  // Debounced save - waits 500ms after last change
  const debouncedSave = useCallback((data: CachedAddress[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveToFile(data)
    }, 500)
  }, [saveToFile])

  // Sync derived wallet addresses into labels when they become available
  useEffect(() => {
    if ((!walletAddresses || walletAddresses.length === 0) && (!walletChangeAddresses || walletChangeAddresses.length === 0)) return
    if (hasSynced.current) return
    hasSynced.current = true

    setAddresses(prev => {
      const existingByAddress = new Map(prev.map(a => [a.address, a]))
      const receiveAddrs: CachedAddress[] = (walletAddresses ?? []).map(wa => {
        const existing = existingByAddress.get(wa.address)
        return {
          index: wa.index,
          address: wa.address,
          path: wa.path,
          label: existing?.label ?? '',
          used: existing?.used ?? wa.used,
          isChange: false,
        }
      })
      const changeAddrs: CachedAddress[] = (walletChangeAddresses ?? []).map(wa => {
        const existing = existingByAddress.get(wa.address)
        return {
          index: wa.index,
          address: wa.address,
          path: wa.path,
          label: existing?.label ?? '',
          used: existing?.used ?? wa.used,
          isChange: true,
        }
      })
      const merged: CachedAddress[] = [...receiveAddrs, ...changeAddrs]
      if (merged.length > prev.length) {
        debouncedSave(merged)
      }
      return merged
    })
  }, [walletAddresses, walletChangeAddresses, debouncedSave])

  const setLabel = useCallback((address: string, label: string) => {
    setAddresses(prev => {
      const updated = prev.map(a =>
        a.address === address ? { ...a, label } : a
      )
      debouncedSave(updated)
      return updated
    })
  }, [debouncedSave])

  const setUsed = useCallback((address: string, used: boolean) => {
    setAddresses(prev => {
      const updated = prev.map(a =>
        a.address === address ? { ...a, used } : a
      )
      debouncedSave(updated)
      return updated
    })
  }, [debouncedSave])

  const getAddress = useCallback((address: string): CachedAddress | undefined => {
    return addresses.find(a => a.address === address)
  }, [addresses])

  return {
    addresses,
    getAddress,
    setLabel,
    setUsed,
    saveStatus,
  }
}
