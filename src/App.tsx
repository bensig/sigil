import { useState, useEffect, useCallback, useMemo, DragEvent } from 'react'
import { LedgerStatus } from './components/LedgerStatus'
import { SendForm } from './components/SendForm'
import { PSBTImport } from './components/PSBTImport'
import { ReceiveAddresses } from './components/ReceiveAddresses'
import { ConfigPage } from './components/ConfigPage'
import { ThemeToggle } from './components/ThemeToggle'
import { useWallet } from './hooks/useWallet'
import { useMempool } from './hooks/useMempool'
import { useLedger } from './hooks/useLedger'
import { useAddressLabels } from './hooks/useAddressLabels'
import { useWhitelist } from './hooks/useWhitelist'
import { useTheme } from './hooks/useTheme'
import { createUnsignedPsbt, getSignerNames, parsePsbt } from './lib/psbt'
import { expectsChangeOutput, resolveChangeDestination } from './lib/change-policy'
import { getAddressesStats, getAddressStats } from './lib/mempool'
import { buildWalletConfig } from './lib/wallet-config'
import type { AppConfig } from './lib/wallet-config'
import { WalletProvider, useWalletContext } from './lib/wallet-context'
import { WalletSwitcher } from './components/WalletSwitcher'
import { FirstRunSetup } from './components/FirstRunSetup'
import { getWalletRegistry } from './lib/wallet-loader'
import type { WalletRegistryEntry } from './lib/wallet-loader'
import { matchPsbtToWallets } from './lib/psbt-wallet-match'

// Check if we're in dev mode
const isDev = import.meta.env.DEV

function App() {
  if (getWalletRegistry().length === 0) return <FirstRunSetup />

  return (
    <WalletProvider>
      {({ walletId, walletEntry }) => (
        <div style={{ '--color-accent': walletEntry.accentColor } as React.CSSProperties}>
          <AppContent key={walletId} />
        </div>
      )}
    </WalletProvider>
  )
}

function AppContent() {
  const { walletId, walletEntry, config, switchWallet, wallets } = useWalletContext()

  // Build signer configs from context config
  const signerConfigs = useMemo(() => {
    return config.signers.map((signer, index) => ({
      name: signer.name,
      config: buildWalletConfig(config, index),
    }))
  }, [config])

  const wallet = useWallet(config, walletId)
  const mempool = useMempool()
  const ledger = useLedger()
  const addressLabels = useAddressLabels(walletId, wallet.addresses, wallet.changeAddresses)
  const whitelist = useWhitelist(walletId)
  const { theme, setTheme, resolvedTheme } = useTheme()

  const cycleTheme = useCallback(() => {
    if (theme === 'system') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('dark')
    } else {
      setTheme('system')
    }
  }, [theme, setTheme])

  const [psbt, setPsbt] = useState<string | null>(null)
  const [psbtSigners, setPsbtSigners] = useState<{ signed: string[]; unsigned: string[] }>({ signed: [], unsigned: [] })
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | 'config'>('send')
  const [sendMode, setSendMode] = useState<'create' | 'import'>('create')
  const [hideBalance, setHideBalance] = useState(false)
  const [addressStats, setAddressStats] = useState<Map<string, { txCount: number; balance: number }>>(new Map())
  const [refreshingStats, setRefreshingStats] = useState(false)
  const [unresolvedAddresses, setUnresolvedAddresses] = useState<Set<string>>(new Set())
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [, setDragCounter] = useState(0)
  // null = imported PSBT matches the active wallet (or nothing imported);
  // array = wallets the imported PSBT actually belongs to ([] = none on this device)
  const [psbtWalletMismatch, setPsbtWalletMismatch] = useState<WalletRegistryEntry[] | null>(null)

  // Import entry point for external PSBTs: check which wallet they belong to,
  // so signing doesn't fail later with Caravan's cryptic
  // "Signing key details not included in PSBT" when the wrong wallet is active.
  const handleImportedPsbt = useCallback(async (psbtData: string) => {
    setPsbt(psbtData)
    try {
      const matches = await matchPsbtToWallets(psbtData)
      setPsbtWalletMismatch(matches.some(m => m.id === walletId) ? null : matches)
    } catch {
      setPsbtWalletMismatch(null)
    }
  }, [walletId])

  // Clear the mismatch warning whenever the PSBT is cleared
  useEffect(() => {
    if (!psbt) setPsbtWalletMismatch(null)
  }, [psbt])

  // Switching wallets remounts AppContent and drops all state, so stash the
  // PSBT in sessionStorage across the switch and restore it here.
  useEffect(() => {
    const pending = sessionStorage.getItem('pending-import-psbt')
    if (pending) {
      sessionStorage.removeItem('pending-import-psbt')
      handleImportedPsbt(pending)
      setActiveTab('send')
      setSendMode('import')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchWalletWithPsbt = useCallback((targetWalletId: string) => {
    if (psbt) sessionStorage.setItem('pending-import-psbt', psbt)
    switchWallet(targetWalletId)
  }, [psbt, switchWallet])

  // Global file drop handler for PSBT import
  const handleGlobalDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(c => c + 1)
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true)
    }
  }, [])

  const handleGlobalDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(c => {
      const next = c - 1
      if (next <= 0) setIsDraggingFile(false)
      return Math.max(0, next)
    })
  }, [])

  const handleGlobalDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleGlobalDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFile(false)
    setDragCounter(0)

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    // Try text first
    const text = await file.text()
    try {
      await parsePsbt(text.trim())
      await handleImportedPsbt(text.trim())
      setActiveTab('send')
      setSendMode('import')
      return
    } catch { /* try binary */ }

    // Try binary as base64
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const base64 = btoa(binary)
    try {
      await parsePsbt(base64)
      await handleImportedPsbt(base64)
      setActiveTab('send')
      setSendMode('import')
    } catch {
      // Not a valid PSBT
    }
  }, [handleImportedPsbt])

  // Auto-detect which signer is connected
  const connectedSigner = ledger.identifySigner(signerConfigs)

  // Refresh address stats from chain
  const refreshAddressStats = useCallback(async () => {
    if (addressLabels.addresses.length === 0) return
    setRefreshingStats(true)
    try {
      // Receive addresses: stop early at gap limit
      const receiveAddresses = addressLabels.addresses.filter(a => !a.isChange)
      const { stats: receiveStats } = await getAddressesStats(receiveAddresses.map(a => a.address), 1)

      // Change addresses: scan the whole branch, so every transacted change
      // address is surfaced regardless of gaps, and so the next unused one can
      // be identified from transaction history rather than UTXO presence.
      const changeAddresses = addressLabels.addresses.filter(a => a.isChange)
      const changeResult = changeAddresses.length > 0
        ? await getAddressesStats(changeAddresses.map(a => a.address), changeAddresses.length)
        : { stats: new Map<string, { txCount: number; balance: number }>(), unresolved: new Set<string>() }

      const combinedStats = new Map(receiveStats)
      changeResult.stats.forEach((value, key) => combinedStats.set(key, value))
      setAddressStats(combinedStats)
      // Tracked so the Receive tab can tell "no transactions" from "couldn't
      // check", and not label a used address as the next change address.
      setUnresolvedAddresses(changeResult.unresolved)
    } catch (e) {
      console.error('Failed to fetch address stats:', e)
    } finally {
      setRefreshingStats(false)
    }
  }, [addressLabels.addresses])

  // Refresh a single address: update UTXOs via wallet + update stats
  const refreshSingleAddress = useCallback(async (address: string) => {
    await wallet.refreshAddress(address)
    try {
      const stats = await getAddressStats(address)
      setAddressStats(prev => {
        const next = new Map(prev)
        next.set(address, stats)
        return next
      })
      // This address is now resolved, whatever happened on the last sweep.
      setUnresolvedAddresses(prev => {
        if (!prev.has(address)) return prev
        const next = new Set(prev)
        next.delete(address)
        return next
      })
    } catch (e) {
      console.warn(`Failed to refresh stats for ${address}:`, e)
    }
  }, [wallet])

  // Fetch address stats on load
  useEffect(() => {
    if (addressLabels.addresses.length > 0 && addressStats.size === 0 && !refreshingStats) {
      refreshAddressStats()
    }
  }, [addressLabels.addresses.length])

  // Scan balances when addresses are ready
  // Cache miss (balance=0): full scan to discover used addresses
  // Cache hit (balance>0): only refresh known used addresses
  useEffect(() => {
    if (wallet.addresses.length > 0 && !wallet.scanning) {
      if (wallet.balance === 0) {
        wallet.scanBalances()
      } else if (wallet.utxos.size > 0) {
        wallet.scanKnownAddresses()
      }
    }
  }, [wallet.addresses.length])

  // Analyze PSBT for signatures when it changes
  useEffect(() => {
    if (psbt) {
      getSignerNames(psbt, wallet.config)
        .then(setPsbtSigners)
        .catch(console.error)
    } else {
      setPsbtSigners({ signed: [], unsigned: [] })
    }
  }, [psbt, wallet.config])

  // Get all UTXOs for the selector
  const availableUtxos = useMemo(() => wallet.getAllUtxos(), [wallet])

  // Next unused change address, in the shape the change-policy helpers expect.
  // Anything from the change branch is change by definition.
  const nextChangeAddress = useMemo(() => {
    const next = wallet.getNextChangeAddress()
    return next ? { address: next.address, index: next.index, isChange: true } : null
  }, [wallet])

  // Combine address labels for SendForm
  const addressLabelsForForm = useMemo(() => {
    return addressLabels.addresses.map(a => ({
      address: a.address,
      label: a.label,
    }))
  }, [addressLabels.addresses])

  const handleCreatePsbt = useCallback(async (
    recipient: string,
    amountSats: number,
    feeSats: number,
    selectedUtxos: typeof availableUtxos,
    customChangeAddress: string | null
  ) => {
    // Use selected UTXOs if provided, otherwise use all
    const utxosToSpend = selectedUtxos.length > 0 ? selectedUtxos : wallet.getAllUtxos()
    if (utxosToSpend.length === 0) throw new Error('No UTXOs available')

    let changeAddress: string
    let changeAddressIndex: number
    let isChangeAddressActuallyChange: boolean // true if from change path, false if from receive path

    if (customChangeAddress) {
      // User specified a change address - find it in our addresses
      const receiveAddr = wallet.addresses.find(a => a.address === customChangeAddress)
      const changeAddr = wallet.changeAddresses.find(a => a.address === customChangeAddress)

      if (receiveAddr) {
        changeAddress = receiveAddr.address
        changeAddressIndex = receiveAddr.index
        isChangeAddressActuallyChange = false
      } else if (changeAddr) {
        changeAddress = changeAddr.address
        changeAddressIndex = changeAddr.index
        isChangeAddressActuallyChange = true
      } else {
        // External address - we can't create a proper PSBT for it without derivation info
        throw new Error('Change address must be a wallet address (receive or change)')
      }
    } else {
      // No explicit choice: fall back to the wallet's change policy, which
      // refuses to reuse a used address when the change branch is exhausted —
      // except where no change output is built at all.
      const nextChange = wallet.getNextChangeAddress()
      const nextChangeCandidate = nextChange
        ? { address: nextChange.address, index: nextChange.index, isChange: true }
        : null
      const totalInput = utxosToSpend.reduce((sum, u) => sum + u.value, 0)

      if (!expectsChangeOutput(totalInput, amountSats, feeSats)) {
        // Sweep, or change below dust: no change output is built, so these
        // values are never derived and no change address needs to exist.
        const unused = nextChangeCandidate ?? wallet.changeAddresses[0]
        changeAddress = unused?.address ?? ''
        changeAddressIndex = unused?.index ?? 0
        isChangeAddressActuallyChange = true
      } else {
        const destination = resolveChangeDestination({
          policy: wallet.config.changePolicy,
          spendUtxos: utxosToSpend,
          nextChange: nextChangeCandidate,
        })
        changeAddress = destination.address
        changeAddressIndex = destination.index
        isChangeAddressActuallyChange = destination.isChange
      }
    }

    const psbtBase64 = await createUnsignedPsbt({
      config: wallet.config,
      utxos: utxosToSpend,
      recipientAddress: recipient,
      amountSats,
      feeSats,
      changeAddress,
      changeAddressIndex,
      isChangeAddress: isChangeAddressActuallyChange,
    })

    setPsbt(psbtBase64)
  }, [wallet])

  const handleSign = useCallback(async () => {
    if (!psbt) throw new Error('No PSBT to sign')
    if (!connectedSigner) throw new Error('Connect your Ledger first')
    if (psbtWalletMismatch !== null) {
      throw new Error(psbtWalletMismatch.length > 0
        ? `This PSBT belongs to the ${psbtWalletMismatch.map(w => w.name).join(' / ')} wallet — switch wallets before signing`
        : 'This PSBT does not match any wallet on this device')
    }

    // Find the config for the connected signer
    const signerEntry = signerConfigs.find(s => s.name === connectedSigner)
    if (!signerEntry) throw new Error('Unknown signer')

    // Find the ledger key in the signer's config
    const ledgerKey = signerEntry.config.extendedPublicKeys.find(k => k.method === 'ledger')
    if (!ledgerKey) throw new Error(`No Ledger key found for ${connectedSigner}`)

    const keyInfo = {
      xfp: ledgerKey.xfp,
      bip32Path: ledgerKey.bip32Path,
      name: ledgerKey.name,
    }

    console.log(`Signing as ${connectedSigner} with key:`, keyInfo)
    const signedPsbt = await ledger.signPsbt(psbt, signerEntry.config, keyInfo)
    setPsbt(signedPsbt)
  }, [psbt, connectedSigner, ledger, psbtWalletMismatch])

  // Wrap ledger.connect with bip32Path from active config
  const handleLedgerConnect = useCallback(() => {
    return ledger.connect(config.signers[0].bip32Path)
  }, [ledger, config])

  // Save config handler
  const handleSaveConfig = useCallback(async (newConfig: AppConfig) => {
    const response = await fetch(`/api/save-config?wallet=${walletId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    })
    if (!response.ok) {
      throw new Error('Failed to save config')
    }
    // Reload page so the glob-cached config refreshes with the saved values
    window.location.reload()
  }, [walletId])

  return (
    <div
      className="min-h-screen bg-cream dark:bg-slate-900 relative"
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {/* File drop overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-blue-500/10 dark:bg-blue-400/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border-2 border-dashed border-blue-500 dark:border-blue-400 p-12 text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xl font-semibold dark:text-white">Drop PSBT file to import</p>
            <p className="text-sm text-ink/60 dark:text-slate-400 mt-1">.psbt or .txt</p>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-ink/10 dark:border-slate-700 bg-cream dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <WalletSwitcher
              wallets={wallets}
              activeWalletId={walletId}
              onSwitch={switchWallet}
              disabled={ledger.status === 'signing' || ledger.status === 'connecting'}
            />
          <div className="flex items-center gap-4">
            <ThemeToggle theme={theme} resolvedTheme={resolvedTheme} onToggle={cycleTheme} />
            {/* Show connected signer */}
            {connectedSigner && (
              <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 px-2 py-1 rounded">
                {connectedSigner}'s Ledger
              </span>
            )}
            <LedgerStatus
              status={ledger.status}
              error={ledger.error}
              onConnect={handleLedgerConnect}
              onDisconnect={ledger.disconnect}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {wallet.loading ? (
          <div className="card text-center py-12">
            <p className="text-ink/60 dark:text-slate-400">Loading wallet...</p>
          </div>
        ) : (
          <>
            {/* Error Banner */}
            {wallet.error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded mb-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm"><strong>Scan Error:</strong> {wallet.error}</p>
                  <button
                    onClick={wallet.forceRefresh}
                    disabled={wallet.scanning}
                    className="text-xs bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700 px-2 py-1 rounded"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Wallet Overview */}
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-ink/60 dark:text-slate-400">Wallet Balance</p>
                    <button
                      onClick={() => setHideBalance(!hideBalance)}
                      className="text-ink/40 dark:text-slate-500 hover:text-ink/60 dark:hover:text-slate-300"
                      title={hideBalance ? 'Show balance' : 'Hide balance'}
                    >
                      {hideBalance ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-3xl font-bold dark:text-white">
                    {wallet.scanning ? 'Scanning…' : hideBalance ? '••••••••' : `${mempool.satsToBtc(wallet.balance)} BTC`}
                  </p>
                  {!wallet.scanning && !hideBalance && mempool.satsToUsd(wallet.balance) && (
                    <p className="text-sm text-ink/60 dark:text-slate-400">${mempool.satsToUsd(wallet.balance)} USD</p>
                  )}
                </div>
                <button
                  onClick={wallet.forceRefresh}
                  disabled={wallet.scanning}
                  className="btn-secondary text-xs"
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* Main Tabs: Send / Receive / Config */}
            <div className="flex gap-2 mb-4">
              <button
                className={`flex-1 px-4 py-2 rounded font-medium ${activeTab === 'send' ? 'bg-[var(--color-accent)] dark:bg-slate-200 text-white dark:text-slate-900' : 'bg-mist dark:bg-slate-800 text-ink dark:text-slate-200'}`}
                onClick={() => setActiveTab('send')}
              >
                Send
              </button>
              <button
                className={`flex-1 px-4 py-2 rounded font-medium ${activeTab === 'receive' ? 'bg-[var(--color-accent)] dark:bg-slate-200 text-white dark:text-slate-900' : 'bg-mist dark:bg-slate-800 text-ink dark:text-slate-200'}`}
                onClick={() => setActiveTab('receive')}
              >
                Receive
              </button>
              <button
                className={`flex-1 px-4 py-2 rounded font-medium ${activeTab === 'config' ? 'bg-[var(--color-accent)] dark:bg-slate-200 text-white dark:text-slate-900' : 'bg-mist dark:bg-slate-800 text-ink dark:text-slate-200'}`}
                onClick={() => setActiveTab('config')}
              >
                Config
              </button>
            </div>

            {activeTab === 'send' && (
              <div>
                {psbt && psbtWalletMismatch !== null && (
                  <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3 space-y-2">
                    <div className="text-sm text-amber-800 dark:text-amber-300 font-medium">
                      {psbtWalletMismatch.length > 0
                        ? `This PSBT belongs to the ${psbtWalletMismatch.map(w => w.name).join(' / ')} wallet, not ${walletEntry.name}.`
                        : 'This PSBT does not match any wallet on this device — signing here will fail.'}
                    </div>
                    {psbtWalletMismatch.map(w => (
                      <button
                        key={w.id}
                        type="button"
                        className="btn-primary text-sm px-4 py-2"
                        onClick={() => switchWalletWithPsbt(w.id)}
                      >
                        Switch to {w.name} and continue
                      </button>
                    ))}
                  </div>
                )}
                {sendMode === 'import' && !psbt && (
                  <div className="mb-4 relative">
                    <button
                      className="absolute top-3 right-3 z-10 text-ink/40 hover:text-ink dark:text-slate-500 dark:hover:text-white"
                      onClick={() => setSendMode('create')}
                      title="Close"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <PSBTImport onPsbtLoad={handleImportedPsbt} />
                  </div>
                )}

                {sendMode === 'import' && psbt ? (
                  <SendForm
                    mode="import"
                    balance={wallet.balance}
                    availableUtxos={availableUtxos}
                    feeRates={mempool.feeRates}
                    loadingFees={mempool.loadingFees}
                    satsToBtc={mempool.satsToBtc}
                    btcToSats={mempool.btcToSats}
                    satsToUsd={mempool.satsToUsd}
                    onCreatePsbt={handleCreatePsbt}
                    onSign={handleSign}
                    onBroadcast={mempool.broadcast}
                    onClear={() => { setPsbt(null); setSendMode('create') }}
                    onPsbtChange={setPsbt}
                    psbt={psbt}
                    ledgerConnected={ledger.isConnected}
                    ledgerBusy={ledger.isBusy}
                    signerName={connectedSigner}
                    signedBy={psbtSigners.signed}
                    disabled={wallet.scanning}
                    whitelist={whitelist.entries}
                    onAddToWhitelist={whitelist.addEntry}
                    onRemoveFromWhitelist={whitelist.removeEntry}
                    onConnectLedger={handleLedgerConnect}
                    addressLabels={addressLabelsForForm}
                  />
                ) : null}

                {sendMode === 'create' && (
                  <>
                    <button
                      className="w-full px-4 py-3 mb-4 rounded font-medium bg-mist dark:bg-slate-800 text-ink dark:text-slate-200 hover:bg-ink/10 dark:hover:bg-slate-700 transition-colors"
                      onClick={() => setSendMode('import')}
                    >
                      Import PSBT
                    </button>
                    <SendForm
                      mode="create"
                      balance={wallet.balance}
                      availableUtxos={availableUtxos}
                      changePolicy={wallet.config.changePolicy}
                      nextChangeAddress={nextChangeAddress}
                      feeRates={mempool.feeRates}
                      loadingFees={mempool.loadingFees}
                      satsToBtc={mempool.satsToBtc}
                      btcToSats={mempool.btcToSats}
                      satsToUsd={mempool.satsToUsd}
                      onCreatePsbt={handleCreatePsbt}
                      onSign={handleSign}
                      onPsbtChange={setPsbt}
                      psbt={psbt}
                      ledgerConnected={ledger.isConnected}
                      ledgerBusy={ledger.isBusy}
                      signerName={connectedSigner}
                      signedBy={psbtSigners.signed}
                      disabled={wallet.scanning}
                      whitelist={whitelist.entries}
                      onAddToWhitelist={whitelist.addEntry}
                      onRemoveFromWhitelist={whitelist.removeEntry}
                      onConnectLedger={handleLedgerConnect}
                      addressLabels={addressLabelsForForm}
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'receive' && (
              <ReceiveAddresses
                addresses={addressLabels.addresses}
                addressStats={addressStats}
                unresolvedAddresses={unresolvedAddresses}
                setLabel={addressLabels.setLabel}
                satsToBtc={mempool.satsToBtc}
                satsToUsd={mempool.satsToUsd}
                saveStatus={addressLabels.saveStatus}
                onRefresh={refreshAddressStats}
                refreshing={refreshingStats}
                onRefreshAddress={refreshSingleAddress}
              />
            )}

            {activeTab === 'config' && (
              <ConfigPage
                config={config}
                onSave={handleSaveConfig}
                isDev={isDev}
              />
            )}

          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-ink/10 dark:border-slate-700 py-4 text-center text-sm text-ink/40 dark:text-slate-500">
        <a href="https://github.com/bensig" className="hover:text-ink/60 dark:hover:text-slate-300">bensig</a>'s multisig tool &middot; built on{' '}
        <a href="https://github.com/caravan-bitcoin/caravan" className="hover:text-ink/60 dark:hover:text-slate-300">caravan</a>,{' '}
        <a href="https://github.com/bitcoinjs/bitcoinjs-lib" className="hover:text-ink/60 dark:hover:text-slate-300">bitcoinjs-lib</a>,{' '}
        <a href="https://github.com/AuHau/LedgerHQ-app-btc" className="hover:text-ink/60 dark:hover:text-slate-300">ledger</a>
        <br />
        open source <a href="https://opensource.org/licenses/MIT" className="hover:text-ink/60 dark:hover:text-slate-300">MIT license</a> 2026
      </footer>
    </div>
  )
}

export default App
