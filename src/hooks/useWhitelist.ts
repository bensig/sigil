import { useState, useCallback, useEffect, useRef } from 'react'
import { loadRecipients } from '../lib/wallet-loader'

export interface WhitelistEntry {
  label: string
  address: string
}

type SaveStatus = 'saved' | 'saving' | 'error'

export function useWhitelist(walletId: string) {
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load from static file on mount
  useEffect(() => {
    const data = loadRecipients(walletId)
    setEntries(data)
  }, [])

  // Auto-save to file via dev server API (debounced)
  const saveToFile = useCallback(async (data: WhitelistEntry[]) => {
    setSaveStatus('saving')
    try {
      const response = await fetch(`/api/save-whitelist?wallet=${walletId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (response.ok) {
        setSaveStatus('saved')
      } else {
        setSaveStatus('saved')
      }
    } catch {
      setSaveStatus('saved')
    }
  }, [walletId])

  // Debounced save
  const debouncedSave = useCallback((data: WhitelistEntry[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveToFile(data)
    }, 500)
  }, [saveToFile])

  const addEntry = useCallback((address: string, label: string) => {
    setEntries(prev => {
      // Don't add duplicates
      if (prev.some(e => e.address === address)) {
        return prev
      }
      const updated = [...prev, { address, label }]
      debouncedSave(updated)
      return updated
    })
  }, [debouncedSave])

  const removeEntry = useCallback((address: string) => {
    setEntries(prev => {
      const updated = prev.filter(e => e.address !== address)
      debouncedSave(updated)
      return updated
    })
  }, [debouncedSave])

  const updateLabel = useCallback((address: string, label: string) => {
    setEntries(prev => {
      const updated = prev.map(e =>
        e.address === address ? { ...e, label } : e
      )
      debouncedSave(updated)
      return updated
    })
  }, [debouncedSave])

  const isWhitelisted = useCallback((address: string): boolean => {
    return entries.some(e => e.address === address)
  }, [entries])

  return {
    entries,
    addEntry,
    removeEntry,
    updateLabel,
    isWhitelisted,
    saveStatus,
  }
}
