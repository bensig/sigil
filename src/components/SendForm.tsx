import { useState, useMemo, useEffect, useCallback } from 'react'
import { Buffer } from 'buffer'
import { FeeSelector } from './FeeSelector'
import { PSBTDetails } from './PSBTDetails'
import { QRExportModal } from './qr/QRExportModal'
import { QRScanModal } from './qr/QRScanModal'
import { UTXOSelector, utxoKey, type EnrichedUTXO, type AddressLabel } from './UTXOSelector'
import type { FeeRates, FeeLevel } from '../types'
import { estimateTxSize, scriptToTaprootAddress } from '../lib/psbt'
import { parsePsbt as parsePsbtHelper } from '../lib/psbt'
import { useWalletContext } from '../lib/wallet-context'
import { DEFAULT_CHANGE_POLICY, expectsChangeOutput, resolveChangeDestination, type ChangePolicy } from '../lib/change-policy'

type ChangeAddressOption = 'auto' | 'new' | 'manual' | string // string = specific address

interface Props {
  mode?: 'create' | 'import'
  balance: number
  availableUtxos: EnrichedUTXO[]
  /** Wallet-level default for where change goes; overridable per transaction. */
  changePolicy?: ChangePolicy
  /** Next unused change address, or null when the change branch is exhausted. */
  nextChangeAddress?: { address: string; index: number; isChange: boolean } | null
  feeRates: FeeRates | null
  loadingFees: boolean
  satsToBtc: (sats: number) => string
  btcToSats: (btc: string) => number
  satsToUsd: (sats: number) => string | null
  onCreatePsbt: (recipient: string, amountSats: number, feeSats: number, selectedUtxos: EnrichedUTXO[], changeAddress: string | null) => Promise<void>
  onSign: () => Promise<void>
  onBroadcast?: (txHex: string) => Promise<string>
  onClear?: () => void
  onPsbtChange: (psbt: string | null) => void
  psbt: string | null
  ledgerConnected: boolean
  ledgerBusy: boolean
  signerName: string | null
  signedBy: string[]
  disabled: boolean
  whitelist: { label: string; address: string }[]
  onAddToWhitelist: (address: string, label: string) => void
  onRemoveFromWhitelist: (address: string) => void
  onConnectLedger: () => Promise<unknown>
  addressLabels?: AddressLabel[]
}

export function SendForm({
  mode = 'create',
  balance,
  availableUtxos,
  changePolicy = DEFAULT_CHANGE_POLICY,
  nextChangeAddress = null,
  feeRates,
  loadingFees,
  satsToBtc,
  btcToSats,
  satsToUsd,
  onCreatePsbt,
  onSign,
  onBroadcast,
  onClear,
  onPsbtChange,
  psbt,
  ledgerConnected,
  ledgerBusy,
  signerName,
  signedBy,
  disabled,
  whitelist,
  onAddToWhitelist,
  onRemoveFromWhitelist,
  onConnectLedger,
  addressLabels = [],
}: Props) {
  const { config: walletConfig } = useWalletContext()
  const requiredSigners = walletConfig.quorum.requiredSigners
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('normal')
  const [customFeeRate, setCustomFeeRate] = useState<number>(0)

  // Seed the custom rate with the current "normal" rate the first time fees load,
  // so the field has a sensible starting point if the user picks Custom.
  useEffect(() => {
    if (feeRates && customFeeRate === 0) {
      setCustomFeeRate(feeRates.normal)
    }
  }, [feeRates, customFeeRate])
  const [selectedUtxoKeys, setSelectedUtxoKeys] = useState<Set<string>>(new Set())
  const [showUtxoSelector, setShowUtxoSelector] = useState(false)
  const [changeAddressOption, setChangeAddressOption] = useState<ChangeAddressOption>('auto')
  const [manualChangeAddress, setManualChangeAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'generated' | 'signed'>('idle')
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastDetails, setLastDetails] = useState<{
    recipient: string
    amountSats: number
    feeSats: number
    feeRate: number
  } | null>(null)
  const [psbtInfo, setPsbtInfo] = useState<{
    inputs: Array<{ txid: string; vout: number; amount: number }>
    outputs: Array<{ address?: string; amount: number }>
    totalInput: number
    totalOutput: number
  } | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [broadcastedTxid, setBroadcastedTxid] = useState<string | null>(null)
  const [showPsbtDetails, setShowPsbtDetails] = useState(false)
  const [showQRExport, setShowQRExport] = useState(false)
  const [showQRScan, setShowQRScan] = useState(false)

  const amountSats = useMemo(() => {
    try {
      return btcToSats(amount)
    } catch {
      return 0
    }
  }, [amount, btcToSats])

  // Get selected UTXOs
  const selectedUtxos = useMemo(() => {
    return availableUtxos.filter(u => selectedUtxoKeys.has(utxoKey(u)))
  }, [availableUtxos, selectedUtxoKeys])

  // Selected balance
  const selectedBalance = useMemo(() => {
    return selectedUtxos.reduce((sum, u) => sum + u.value, 0)
  }, [selectedUtxos])

  // Use selected balance if UTXOs are selected, otherwise use total balance
  const effectiveBalance = selectedUtxoKeys.size > 0 ? selectedBalance : balance

  // What this send actually spends. With nothing selected the PSBT spends every
  // wallet UTXO, so change resolution has to reason about that same set.
  const spendUtxos = useMemo(
    () => (selectedUtxoKeys.size > 0 ? selectedUtxos : availableUtxos),
    [selectedUtxoKeys.size, selectedUtxos, availableUtxos]
  )

  const effectiveFeeRate = useMemo(() => {
    if (feeLevel === 'custom') return customFeeRate
    if (!feeRates) return 0
    return feeRates[feeLevel]
  }, [feeRates, feeLevel, customFeeRate])

  const estimatedFee = useMemo(() => {
    if (effectiveFeeRate <= 0) return 0
    // Use number of selected UTXOs for input count, or 1 if none selected
    const inputCount = selectedUtxoKeys.size > 0 ? selectedUtxoKeys.size : 1
    const vsize = estimateTxSize(inputCount, 2)
    return Math.ceil(vsize * effectiveFeeRate)
  }, [effectiveFeeRate, selectedUtxoKeys.size])

  // Create a lookup map for address labels
  const labelMap = useMemo(() => {
    const map = new Map<string, string>()
    addressLabels.forEach(al => {
      if (al.label) map.set(al.address, al.label)
    })
    return map
  }, [addressLabels])

  // Create a lookup map from txid:vout to address (for showing labels on PSBT inputs)
  const utxoToAddressMap = useMemo(() => {
    const map = new Map<string, string>()
    availableUtxos.forEach(u => {
      map.set(`${u.txid}:${u.vout}`, u.address)
    })
    return map
  }, [availableUtxos])

  // UTXO selection handlers
  const handleToggleUtxo = useCallback((key: string) => {
    setSelectedUtxoKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleSelectAllUtxos = useCallback(() => {
    setSelectedUtxoKeys(new Set(availableUtxos.map(u => utxoKey(u))))
  }, [availableUtxos])

  const handleSelectNoUtxos = useCallback(() => {
    setSelectedUtxoKeys(new Set())
  }, [])

  // Get unique source addresses from selected UTXOs (for change address options)
  const sourceAddresses = useMemo(() => {
    const addressMap = new Map<string, { address: string; total: number; label?: string; isChange: boolean }>()

    spendUtxos.forEach(utxo => {
      const existing = addressMap.get(utxo.address)
      const label = addressLabels.find(al => al.address === utxo.address)?.label
      if (existing) {
        existing.total += utxo.value
      } else {
        addressMap.set(utxo.address, {
          address: utxo.address,
          total: utxo.value,
          label,
          isChange: utxo.isChange,
        })
      }
    })

    // Sort by total value descending
    return Array.from(addressMap.values()).sort((a, b) => b.total - a.total)
  }, [spendUtxos, addressLabels])

  // Where the wallet's policy would send change for this set of inputs. Null
  // when the policy needs a fresh change address and none is left.
  const policyChange = useMemo(() => {
    try {
      return resolveChangeDestination({
        policy: changePolicy,
        spendUtxos,
        nextChange: nextChangeAddress,
      })
    } catch {
      return null
    }
  }, [changePolicy, spendUtxos, nextChangeAddress])

  // Resolve the actual change address based on selection
  const resolvedChangeAddress = useMemo((): string | null => {
    if (changeAddressOption === 'new') {
      return nextChangeAddress?.address ?? null
    }
    if (changeAddressOption === 'manual') {
      return manualChangeAddress.trim() || null
    }
    if (changeAddressOption === 'auto') {
      return policyChange?.address ?? null
    }
    // Specific address selected
    return changeAddressOption
  }, [changeAddressOption, manualChangeAddress, policyChange, nextChangeAddress])

  // Change returning to a receive-branch address reuses an address that may
  // have been handed out for deposits, exposing this wallet's history to
  // whoever holds it. Worth surfacing before the PSBT is built.
  const changeReusesReceiveAddress =
    changeAddressOption === 'auto'
      ? !!policyChange?.reusesReceiveAddress
      : changeAddressOption !== 'new' && changeAddressOption !== 'manual' &&
        sourceAddresses.some(sa => sa.address === changeAddressOption && !sa.isChange)

  // Returning change to a change-branch input is milder — no one else holds
  // that address — but it is still handing the same address out twice.
  const changeReusesChangeAddress =
    !changeReusesReceiveAddress &&
    (changeAddressOption === 'auto'
      ? !!policyChange?.reusesAddress
      : changeAddressOption !== 'new' && changeAddressOption !== 'manual' &&
        sourceAddresses.some(sa => sa.address === changeAddressOption && sa.isChange))

  const normalizedRecipient = recipient.trim()

  const shorten = (value: string, head: number, tail: number) => {
    if (!value) return ''
    if (value.length <= head + tail) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }

  const needsRegeneration = useMemo(() => {
    if (stage === 'idle' || !lastDetails) return false
    return (
      lastDetails.recipient !== normalizedRecipient ||
      lastDetails.amountSats !== amountSats ||
      lastDetails.feeSats !== estimatedFee
    )
  }, [stage, lastDetails, normalizedRecipient, amountSats, estimatedFee])

  const summaryRecipient = lastDetails?.recipient || psbtInfo?.outputs?.[0]?.address || ''
  const summaryAmount = lastDetails?.amountSats ?? psbtInfo?.outputs?.[0]?.amount ?? 0
  const summaryLine = summaryRecipient
    ? `Sending ${satsToBtc(summaryAmount)} BTC${satsToUsd(summaryAmount) ? ` (${satsToUsd(summaryAmount)} USD)` : ''} to ${shorten(summaryRecipient, 5, 5)}`
    : null
  useEffect(() => {
    if (!psbt) {
      setStage('idle')
      setLastDetails(null)
      setPsbtInfo(null)
      setShowPsbtDetails(false)
      return
    }

    ;(async () => {
      try {
        const parsed = await parsePsbtHelper(psbt)
        const inputsInfo: Array<{ txid: string; vout: number; amount: number }> = []
        let totalInput = 0
        parsed.data.inputs.forEach((input, index) => {
          const txInput = parsed.txInputs[index] as { hash: Buffer; index: number }
          const txid = Buffer.from(txInput.hash).reverse().toString('hex')
          const amount = input.witnessUtxo?.value || 0
          totalInput += amount
          inputsInfo.push({ txid, vout: txInput.index, amount })
        })
        const outputsInfo = parsed.txOutputs.map(output => {
          const out = output as { address?: string; value: number; script: Buffer }
          let addr = out.address
          if (!addr && out.script) {
            addr = scriptToTaprootAddress(out.script) || undefined
          }
          return {
            address: addr,
            amount: out.value,
          }
        })
        const totalOutput = outputsInfo.reduce((sum, output) => sum + output.amount, 0)
        setPsbtInfo({ inputs: inputsInfo, outputs: outputsInfo, totalInput, totalOutput })
      } catch {
        setPsbtInfo(null)
      }
    })()
  }, [psbt])

  const [isMaxMode, setIsMaxMode] = useState(false)

  const setMax = () => {
    const maxAmount = effectiveBalance - estimatedFee
    if (maxAmount > 0) {
      setAmount(satsToBtc(maxAmount))
      setIsMaxMode(true)
    }
  }

  // Auto-update amount when fee changes and user has selected max
  useEffect(() => {
    if (isMaxMode && estimatedFee > 0) {
      const maxAmount = effectiveBalance - estimatedFee
      if (maxAmount > 0) {
        setAmount(satsToBtc(maxAmount))
      }
    }
  }, [estimatedFee, isMaxMode, effectiveBalance, satsToBtc])

  const validateInputs = () => {
    if (!normalizedRecipient) {
      setError('Please enter a recipient address')
      return false
    }

    if (!amountSats || amountSats <= 0 || isNaN(amountSats)) {
      setError('Please enter a valid amount')
      return false
    }

    // Only a transaction that actually produces change needs somewhere to put
    // it: a sweep must not be blocked by an exhausted change branch.
    if (!resolvedChangeAddress && expectsChangeOutput(effectiveBalance, amountSats, estimatedFee)) {
      setError(changeAddressOption === 'manual'
        ? 'Enter a change address, or choose one from the list'
        : 'No unused change address available — every change address on this wallet has been used. Choose a change address explicitly.')
      return false
    }

    // If UTXOs are selected, validate against selected balance
    const balanceToCheck = selectedUtxoKeys.size > 0 ? selectedBalance : balance
    if (amountSats + estimatedFee > balanceToCheck) {
      setError(selectedUtxoKeys.size > 0
        ? 'Insufficient funds in selected UTXOs'
        : 'Insufficient funds')
      return false
    }

    return true
  }

  const handleGenerate = async () => {
    if (!validateInputs()) return
    setError(null)
    setInfo(null)
    setProcessing(true)
    try {
      // Pass selected UTXOs, or empty array to use auto-selection
      const utxosToSpend = selectedUtxoKeys.size > 0 ? selectedUtxos : []
      // The resolved destination applies whether or not UTXOs were selected, so
      // both paths honour the same policy instead of diverging.
      const changeAddr = resolvedChangeAddress
      await onCreatePsbt(normalizedRecipient, amountSats, estimatedFee, utxosToSpend, changeAddr)
      setStage('generated')
      setLastDetails({
        recipient: normalizedRecipient,
        amountSats,
        feeSats: estimatedFee,
        feeRate: effectiveFeeRate,
      })
      setInfo('PSBT created. Connect your Ledger to sign when ready.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PSBT')
    } finally {
      setProcessing(false)
    }
  }

  const handleSign = async () => {
    if (!psbt) {
      setError('No PSBT available to sign')
      return
    }
    if (!ledgerConnected) {
      setError('Connect your Ledger device before signing')
      return
    }
    setError(null)
    setInfo(null)
    setProcessing(true)
    try {
      await onSign()
      setStage('signed')
      const signerLabel = signerName ? ` as ${signerName}` : ''
      setInfo(`PSBT signed${signerLabel}. Save it and share with the next signer.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed')
    } finally {
      setProcessing(false)
    }
  }

  const handleSave = async () => {
    if (!psbt) {
      setError('No PSBT to save')
      return
    }
    setError(null)
    setInfo(null)
    setSaving(true)
    try {
      const now = new Date()
      const pad = (n: number) => n.toString().padStart(2, '0')
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const filenameRecipient = lastDetails?.recipient || psbtInfo?.outputs?.[0]?.address || 'psbt'
      const amountForName = lastDetails?.amountSats ?? psbtInfo?.outputs?.[0]?.amount ?? 0
      const amountBtc = amountForName ? satsToBtc(amountForName) : 'amount'
      const sanitizedAmount = amountBtc.replace(/\./g, '_')
      const shortAddress = filenameRecipient.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'address'
      const filename = `${shortAddress}-${sanitizedAmount}btc-${timestamp}.psbt`
      const blob = new Blob([psbt], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
      setInfo(`Saved ${filename}`)
      onPsbtChange(null)
      onClear?.()
      setStage('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save PSBT')
    } finally {
      setSaving(false)
    }
  }

  const handleBroadcast = async () => {
    if (!psbt || !onBroadcast) return
    setError(null)
    setInfo(null)
    setProcessing(true)
    try {
      const parsed = await parsePsbtHelper(psbt)
      const txHex = parsed.finalizeAllInputs().extractTransaction().toHex()
      const txid = await onBroadcast(txHex)
      setBroadcastedTxid(txid)
      setInfo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed')
    } finally {
      setProcessing(false)
    }
  }

  const handlePrimaryAction = async (e: React.FormEvent) => {
    e.preventDefault()
    // If we need to connect ledger, do that first
    if (needsLedgerConnect) {
      await onConnectLedger()
      return
    }
    if (stage === 'generated' && !needsRegeneration) {
      await handleSign()
      return
    }
    if (stage === 'signed' && !needsRegeneration) {
      await handleSave()
      return
    }
    await handleGenerate()
  }

  const handleCopy = async () => {
    if (!psbt) return
    await navigator.clipboard.writeText(psbt)
    setInfo('PSBT copied to clipboard')
  }

  const matchConfigSignerName = (name: string): string | null => {
    const lower = name.toLowerCase()
    const match = walletConfig.signers.find(signer => {
      const signerLower = signer.name.toLowerCase()
      return signerLower.startsWith(lower) || lower.startsWith(signerLower)
    })
    return match ? match.name : null
  }

  const formatSignerNames = useCallback((names: string[]) => {
    return names.map(name => matchConfigSignerName(name) ?? name)
  }, [walletConfig.signers])

  const normalizeSigner = (name?: string | null) => {
    if (!name) return ''
    const lower = name.toLowerCase()
    return matchConfigSignerName(lower)?.toLowerCase() ?? lower
  }

  const friendlySignerName = (name?: string | null) => {
    if (!name) return ''
    return formatSignerNames([name])[0]
  }

  const fullySigned = signedBy.length >= requiredSigners
  const currentSignerHasSigned = signerName
    ? signedBy.some(name => normalizeSigner(name) === normalizeSigner(signerName))
    : false

  const importLabel = () => {
    if (!ledgerConnected) return 'Connect Ledger to Sign'
    if (!signerName) return 'Unknown Ledger'
    if (fullySigned) return `Signed by ${requiredSigners}/${requiredSigners}`
    if (currentSignerHasSigned) return `Already signed by ${friendlySignerName(signerName)}`
    return `Sign as ${friendlySignerName(signerName)}`
  }

  const primaryLabel = (() => {
    if (mode === 'import') {
      return importLabel()
    }
    if (stage === 'generated' && !needsRegeneration) {
      return ledgerConnected ? 'Sign with Ledger' : 'Connect Ledger to Sign'
    }
    if (stage === 'signed' && !needsRegeneration) {
      return 'Save PSBT'
    }
    return 'Generate PSBT'
  })()

  // Check if we're in "connect ledger" mode
  const needsLedgerConnect = (() => {
    if (mode === 'import') {
      return psbt && !ledgerConnected && !ledgerBusy
    }
    if (stage === 'generated' && !needsRegeneration) {
      return !ledgerConnected && !ledgerBusy
    }
    return false
  })()

  const primaryDisabled = (() => {
    // Allow clicking to connect ledger
    if (needsLedgerConnect) return false
    if (mode === 'import') {
      if (!psbt || !ledgerConnected || ledgerBusy || processing || saving) return true
      if (!signerName) return true
      return currentSignerHasSigned || fullySigned
    }
    if (disabled || processing || saving || !feeRates) return true
    if (stage === 'generated' && !needsRegeneration) {
      return !ledgerConnected || ledgerBusy
    }
    if (stage === 'signed' && !needsRegeneration) {
      return false
    }
    return false
  })()

  const regenAvailable = stage !== 'idle'
  const showWhitelist = Array.isArray(whitelist) && whitelist.length > 0

  const filteredRecipients = useMemo(() => {
    if (!normalizedRecipient) return whitelist
    return whitelist.filter(entry =>
      entry.address.toLowerCase().includes(normalizedRecipient.toLowerCase()) ||
      entry.label.toLowerCase().includes(normalizedRecipient.toLowerCase())
    )
  }, [whitelist, normalizedRecipient])

  return (
    <div className="card">
      {mode === 'create' && (
        <form onSubmit={handlePrimaryAction} className="space-y-4">
          <div className="relative">
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">To</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="bc1q..."
              className="mono"
              disabled={disabled}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
            {showWhitelist && showSuggestions && filteredRecipients.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-ink/10 dark:border-slate-600 rounded shadow max-h-48 overflow-auto">
                {filteredRecipients.map(entry => (
                  <div
                    key={entry.address}
                    className="flex items-center justify-between px-3 py-2 text-sm hover:bg-mist dark:hover:bg-slate-700 group"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setRecipient(entry.address)
                        setShowSuggestions(false)
                      }}
                      disabled={disabled}
                    >
                      <div className="font-medium dark:text-slate-200">{entry.label}</div>
                      <div className="mono text-xs text-ink/60 dark:text-slate-400">{entry.address.slice(0, 12)}...{entry.address.slice(-8)}</div>
                    </button>
                    <button
                      type="button"
                      className="text-xs text-ink/30 hover:text-red-600 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => onRemoveFromWhitelist(entry.address)}
                      title="Remove from whitelist"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Add to whitelist button - shows when recipient is valid and not already in whitelist */}
            {normalizedRecipient &&
             normalizedRecipient.length > 20 &&
             !whitelist.some(e => e.address === normalizedRecipient) && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                onClick={() => {
                  const label = prompt('Label for this address:')
                  if (label) {
                    onAddToWhitelist(normalizedRecipient, label)
                  }
                }}
              >
                + Add to whitelist
              </button>
            )}
          </div>

          <div>
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">Amount (BTC)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setIsMaxMode(false) }}
                placeholder="0.00000000"
                className="mono flex-1"
                disabled={disabled}
              />
              <button
                type="button"
                onClick={setMax}
                className="btn-secondary text-xs"
                disabled={disabled}
              >
                MAX
              </button>
            </div>
            <div className="text-xs text-ink/50 dark:text-slate-400 mt-1 flex justify-between">
              <span>
                Available: {satsToBtc(effectiveBalance)} BTC
                {satsToUsd(effectiveBalance) && <span className="ml-1">(${satsToUsd(effectiveBalance)})</span>}
                {selectedUtxoKeys.size > 0 && (
                  <span className="ml-1 text-green-600 dark:text-green-400">({selectedUtxoKeys.size} UTXO{selectedUtxoKeys.size !== 1 ? 's' : ''} selected)</span>
                )}
              </span>
              {amountSats > 0 && satsToUsd(amountSats) && (
                <span className="font-medium text-ink dark:text-slate-200">${satsToUsd(amountSats)} USD</span>
              )}
            </div>
          </div>

          {/* UTXO Selector */}
          <div>
            <button
              type="button"
              className={`text-sm flex items-center gap-1 ${showUtxoSelector ? 'text-ink dark:text-slate-200 font-medium' : 'text-ink/60 dark:text-slate-400 hover:text-ink dark:hover:text-slate-200'}`}
              onClick={() => setShowUtxoSelector(!showUtxoSelector)}
              disabled={disabled}
            >
              <svg
                className={`w-4 h-4 transition-transform ${showUtxoSelector ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Choose specific UTXOs
              {selectedUtxoKeys.size > 0 && (
                <span className="bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-xs px-1.5 py-0.5 rounded ml-1">
                  {selectedUtxoKeys.size}
                </span>
              )}
            </button>

            {showUtxoSelector && (
              <div className="mt-3">
                <UTXOSelector
                  utxos={availableUtxos}
                  selected={selectedUtxoKeys}
                  onToggle={handleToggleUtxo}
                  onSelectAll={handleSelectAllUtxos}
                  onSelectNone={handleSelectNoUtxos}
                  satsToBtc={satsToBtc}
                  satsToUsd={satsToUsd}
                  addressLabels={addressLabels}
                  disabled={disabled}
                />
              </div>
            )}
          </div>

          {/* Change Address Selector - the destination applies to every send,
              selected UTXOs or not, so it is always visible */}
          {spendUtxos.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium block">Change Address</label>
              <select
                value={changeAddressOption}
                onChange={(e) => setChangeAddressOption(e.target.value as ChangeAddressOption)}
                className="w-full rounded border border-ink/20 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-200"
                disabled={disabled}
              >
                <option value="auto">
                  {policyChange
                    ? `Wallet default: ${policyChange.address.slice(0, 8)}...${policyChange.address.slice(-6)}${policyChange.isChange ? ' (fresh change address)' : ' (largest source)'}`
                    : 'Wallet default'}
                </option>
                {sourceAddresses.map(sa => (
                  <option key={sa.address} value={sa.address}>
                    {sa.label || `${sa.address.slice(0, 8)}...${sa.address.slice(-6)}`}
                    {sa.isChange ? ' (change)' : ''} — {satsToBtc(sa.total)} BTC
                  </option>
                ))}
                <option value="new">New change address</option>
                <option value="manual">Enter address manually...</option>
              </select>

              {changeAddressOption === 'manual' && (
                <input
                  type="text"
                  value={manualChangeAddress}
                  onChange={(e) => setManualChangeAddress(e.target.value)}
                  placeholder="bc1q..."
                  className="w-full rounded border border-ink/20 dark:border-slate-600 px-3 py-2 mono text-sm dark:bg-slate-800 dark:text-slate-200"
                  disabled={disabled}
                />
              )}

              {resolvedChangeAddress && changeAddressOption !== 'manual' && (
                <div className="text-xs text-ink/50 dark:text-slate-400 mono">
                  {resolvedChangeAddress.slice(0, 12)}...{resolvedChangeAddress.slice(-8)}
                </div>
              )}

              {changeReusesChangeAddress && (
                <div className="text-xs text-ink/60 dark:text-slate-400 bg-mist dark:bg-slate-800 border border-ink/10 dark:border-slate-700 rounded p-2 space-y-2">
                  <div>
                    Change returns to a change address this transaction already spends, so that
                    address is used twice.
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setChangeAddressOption('new')}
                    disabled={disabled || !nextChangeAddress}
                  >
                    Use a fresh change address
                  </button>
                </div>
              )}

              {changeReusesReceiveAddress && (
                <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded p-2 space-y-2">
                  <div>
                    Change returns to a receive address. If you have given this address to anyone as
                    a deposit address, they can see every payment it has ever held.
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setChangeAddressOption('new')}
                    disabled={disabled || !nextChangeAddress}
                  >
                    Use a fresh change address
                  </button>
                </div>
              )}
            </div>
          )}

          <FeeSelector
            feeRates={feeRates}
            selected={feeLevel}
            onSelect={setFeeLevel}
            customRate={customFeeRate}
            onCustomRateChange={setCustomFeeRate}
            loading={loadingFees}
          />

          <div className="pt-2 border-t border-ink/10 dark:border-slate-700">
            <div className="flex justify-between text-sm">
              <span className="text-ink/60 dark:text-slate-400">Estimated Fee</span>
              <span className="dark:text-slate-200">{satsToBtc(estimatedFee)} BTC ({estimatedFee.toLocaleString()} sats)</span>
            </div>
          </div>

          {error && (
            <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}

          {info && !error && (
            <div className="text-green-600 dark:text-green-400 text-sm">{info}</div>
          )}

          {needsRegeneration && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded p-2">
              Changes detected since the last PSBT was created. Regenerate before signing or saving.
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full py-4 text-base"
            disabled={primaryDisabled}
          >
            {stage === 'generated' && !needsRegeneration && processing && ledgerConnected
              ? 'Signing...'
              : stage === 'signed' && !needsRegeneration && saving
                ? 'Saving...'
                : processing
                  ? 'Working...'
                  : primaryLabel}
          </button>
          {regenAvailable && (
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={handleGenerate}
              disabled={processing || saving || disabled}
            >
              Regenerate
            </button>
          )}
        </form>
      )}

      {psbt && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold dark:text-white">Current PSBT</p>
              <p className="text-xs text-ink/50 dark:text-slate-400">
                {stage === 'signed' ? 'Signed' : 'Unsigned'} · {signedBy.length} signer{signedBy.length === 1 ? '' : 's'} signed · {signedBy.length}/{requiredSigners} required
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <button className="btn-secondary text-xs" onClick={handleCopy}>
                Copy
              </button>
              <button className="btn-secondary text-xs" onClick={handleSave}>
                Save PSBT
              </button>
              <button className="btn-secondary text-xs" onClick={() => setShowQRExport(true)}>
                Show QR
              </button>
              <button className="btn-secondary text-xs" onClick={() => setShowQRScan(true)}>
                Scan QR
              </button>
              <button
                className={`btn-secondary text-xs ${showPsbtDetails ? 'bg-ink/10 dark:bg-slate-600' : ''}`}
                onClick={() => setShowPsbtDetails(!showPsbtDetails)}
              >
                {showPsbtDetails ? 'Hide Details' : 'Details'}
              </button>
              {mode === 'import' && (
                <button
                  className="btn-secondary text-xs"
                  onClick={() => {
                    onPsbtChange(null)
                    onClear?.()
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <textarea
            value={psbt}
            readOnly
            className="w-full h-32 mono text-sm bg-mist dark:bg-slate-700 rounded p-3 text-ink dark:text-slate-200"
          />
          {showPsbtDetails && (
            <div className="mt-4 pt-4 border-t border-ink/10 dark:border-slate-700">
              <PSBTDetails psbtBase64={psbt} />
            </div>
          )}
          <div className="space-y-3 text-sm text-ink dark:text-slate-200">
            {summaryLine && (
              <div className="bg-mist dark:bg-slate-700 rounded p-3 font-semibold">
                {summaryLine}
              </div>
            )}
            {lastDetails && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 dark:text-slate-400 font-semibold uppercase">Destination</div>
                  {labelMap.get(lastDetails.recipient) ? (
                    <>
                      <div className="font-medium text-sm">{labelMap.get(lastDetails.recipient)}</div>
                      <div className="mono text-xs text-ink/50 dark:text-slate-400 break-all">{lastDetails.recipient}</div>
                    </>
                  ) : (
                    <div className="mono text-sm break-all">{lastDetails.recipient}</div>
                  )}
                </div>
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 dark:text-slate-400 font-semibold uppercase">Amount</div>
                  <div className="font-semibold">{satsToBtc(lastDetails.amountSats)} BTC</div>
                  {satsToUsd(lastDetails.amountSats) && (
                    <div className="text-xs text-ink/60 dark:text-slate-400">${satsToUsd(lastDetails.amountSats)} USD</div>
                  )}
                </div>
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 dark:text-slate-400 font-semibold uppercase">Fee</div>
                  <div className="font-semibold">{satsToBtc(lastDetails.feeSats)} BTC ({lastDetails.feeSats.toLocaleString()} sats)</div>
                  {satsToUsd(lastDetails.feeSats) && (
                    <div className="text-xs text-ink/60 dark:text-slate-400">${satsToUsd(lastDetails.feeSats)} USD</div>
                  )}
                </div>
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 dark:text-slate-400 font-semibold uppercase">Fee Rate</div>
                  <div className="font-semibold">{lastDetails.feeRate ? `${lastDetails.feeRate.toFixed(0)} sat/vB` : '—'}</div>
                </div>
              </div>
            )}
            {psbtInfo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 font-semibold uppercase mb-1">Inputs</div>
                  <ul className="text-sm space-y-1">
                    {psbtInfo.inputs.map(input => {
                      const inputKey = `${input.txid}:${input.vout}`
                      const inputAddress = utxoToAddressMap.get(inputKey)
                      const inputLabel = inputAddress ? labelMap.get(inputAddress) : undefined
                      return (
                        <li key={inputKey}>
                          {inputLabel ? (
                            <span className="font-medium">{inputLabel}</span>
                          ) : (
                            <span className="mono">{shorten(input.txid, 4, 4)}:{input.vout}</span>
                          )}
                          <span className="text-ink/60 dark:text-slate-400"> · </span>
                          {input.amount ? `${satsToBtc(input.amount)} BTC` : 'amount unknown'}
                          {input.amount && satsToUsd(input.amount) && (
                            <span className="ml-1 text-ink/70 dark:text-slate-300">(${satsToUsd(input.amount)} USD)</span>
                          )}
                          {inputLabel && (
                            <div className="mono text-xs text-ink/40 dark:text-slate-500">{shorten(inputAddress || '', 8, 6)}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="bg-mist dark:bg-slate-700 rounded p-3">
                  <div className="text-xs text-ink/50 font-semibold uppercase mb-1">Outputs</div>
                  <ul className="text-sm space-y-1">
                    {psbtInfo.outputs.map((output, index) => {
                      const outputLabel = output.address ? labelMap.get(output.address) : undefined
                      return (
                        <li key={index}>
                          {outputLabel ? (
                            <span className="font-medium">{outputLabel}</span>
                          ) : (
                            <span className="mono">{shorten(output.address || 'unknown', 5, 5)}</span>
                          )}
                          <span className="text-ink/60 dark:text-slate-400"> · </span>
                          {satsToBtc(output.amount)} BTC
                          {satsToUsd(output.amount) && (
                            <span className="ml-1 text-ink/70 dark:text-slate-300">(${satsToUsd(output.amount)} USD)</span>
                          )}
                          {outputLabel && output.address && (
                            <div className="mono text-xs text-ink/40 dark:text-slate-500">{shorten(output.address, 8, 6)}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                {psbtInfo.totalInput > 0 && psbtInfo.totalOutput > 0 && (
                  <div className="bg-mist dark:bg-slate-700 rounded p-3">
                    <div className="text-xs text-ink/50 font-semibold uppercase mb-1">Computed fee</div>
                    <div className="font-semibold">
                      {(psbtInfo.totalInput - psbtInfo.totalOutput).toLocaleString()} sats
                      {satsToUsd(psbtInfo.totalInput - psbtInfo.totalOutput) && (
                        <span className="ml-1 text-ink/70 dark:text-slate-300">
                          (${satsToUsd(psbtInfo.totalInput - psbtInfo.totalOutput)} USD)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {mode === 'import' && (
              <div className="flex flex-col gap-2">
                {error && (
                  <div className="text-red-600 text-sm">{error}</div>
                )}
                {info && !error && (
                  <div className="text-green-600 text-sm break-all">{info}</div>
                )}
                {broadcastedTxid ? (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4 space-y-3">
                    <div className="text-green-700 dark:text-green-400 font-semibold text-sm">Transaction Broadcasted</div>
                    <div className="mono text-xs text-ink/70 dark:text-slate-300 break-all select-all">{broadcastedTxid}</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs flex-1"
                        onClick={async () => {
                          await navigator.clipboard.writeText(broadcastedTxid)
                          setInfo('Txid copied')
                        }}
                      >
                        Copy Txid
                      </button>
                      <a
                        href={`https://mempool.space/tx/${broadcastedTxid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-green-600 hover:bg-green-700 text-white rounded py-2 px-4 font-medium text-xs text-center flex-1"
                      >
                        View on Mempool
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-primary w-full"
                      onClick={needsLedgerConnect ? onConnectLedger : handleSign}
                      disabled={primaryDisabled}
                    >
                      {primaryLabel}
                    </button>
                    <button
                      type="button"
                      className={`w-full ${
                        signedBy.length >= requiredSigners && !processing && !saving
                          ? 'bg-green-600 hover:bg-green-700 text-white rounded py-2 font-medium'
                          : 'btn-secondary'
                      }`}
                      onClick={handleBroadcast}
                      disabled={!psbt || signedBy.length < requiredSigners || !onBroadcast || processing || saving}
                    >
                      Broadcast Transaction
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showQRExport && psbt && (
        <QRExportModal psbt={psbt} onClose={() => setShowQRExport(false)} />
      )}
      {showQRScan && (
        <QRScanModal
          onClose={() => setShowQRScan(false)}
          onScanned={(scanned) => { onPsbtChange(scanned); setError(null) }}
        />
      )}
    </div>
  )
}
