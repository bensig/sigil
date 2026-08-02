import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '../lib/wallet-config'
import { useWalletContext } from '../lib/wallet-context'

type ApiProvider = 'mempool' | 'blockstream'
type FallbackSelection = 'auto' | ApiProvider
type LedgerExportStatus = 'idle' | 'connecting' | 'done' | 'error'

function getEffectiveFallbackProvider(selection: FallbackSelection, provider: ApiProvider): ApiProvider | null {
  if (selection === 'auto') {
    return provider === 'mempool' ? 'blockstream' : null
  }
  if (selection === provider) return null
  return selection
}

function resolveFallbackProvider(selection: FallbackSelection, provider: ApiProvider): ApiProvider | undefined {
  if (selection === 'auto' || selection === provider) return undefined
  return selection
}

interface SignerConfig {
  name: string
  xpub: string
  xfp: string
  bip32Path: string
}

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
  isDev: boolean
}

export function ConfigPage({ config, onSave, isDev }: Props) {
  const { walletId, walletEntry, wallets, switchWallet } = useWalletContext()

  const initialProvider = (config.client?.provider ?? 'mempool') as ApiProvider
  const initialConfigFallbackProvider = config.client?.fallbackProvider
  const initialFallbackProvider: FallbackSelection =
    initialConfigFallbackProvider && initialConfigFallbackProvider !== initialProvider
      ? initialConfigFallbackProvider
      : 'auto'

  const [walletName, setWalletName] = useState(config.walletName)
  const [signers, setSigners] = useState<SignerConfig[]>(config.signers)
  const [provider, setProvider] = useState<ApiProvider>(initialProvider)
  const [apiBaseUrl, setApiBaseUrl] = useState(config.client?.apiBaseUrl ?? '')
  const [fallbackProvider, setFallbackProvider] = useState<FallbackSelection>(initialFallbackProvider)
  const [fallbackApiBaseUrl, setFallbackApiBaseUrl] = useState(config.client?.fallbackApiBaseUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [ledgerExport, setLedgerExport] = useState<{ status: LedgerExportStatus; error: string | null; signerIndex: number | null }>({
    status: 'idle', error: null, signerIndex: null,
  })

  useEffect(() => {
    const nextProvider = (config.client?.provider ?? 'mempool') as ApiProvider
    const nextConfigFallbackProvider = config.client?.fallbackProvider
    const nextFallbackProvider: FallbackSelection =
      nextConfigFallbackProvider && nextConfigFallbackProvider !== nextProvider
        ? nextConfigFallbackProvider
        : 'auto'

    setWalletName(config.walletName)
    setSigners(config.signers)
    setProvider(nextProvider)
    setApiBaseUrl(config.client?.apiBaseUrl ?? '')
    setFallbackProvider(nextFallbackProvider)
    setFallbackApiBaseUrl(config.client?.fallbackApiBaseUrl ?? '')
  }, [config])

  useEffect(() => {
    setFallbackProvider(current => (current === provider ? 'auto' : current))
  }, [provider])

  const exportXpubFromLedger = useCallback(async (signerIndex: number) => {
    const path = signers[signerIndex].bip32Path
    if (!path) {
      setLedgerExport({ status: 'error', error: 'Enter a derivation path first', signerIndex })
      return
    }
    setLedgerExport({ status: 'connecting', error: null, signerIndex })
    try {
      const { LedgerExportExtendedPublicKey } = await import('@caravan/wallets')
      const { Network } = await import('@caravan/bitcoin')
      const interaction = new LedgerExportExtendedPublicKey({
        bip32Path: path,
        network: Network.MAINNET,
        includeXFP: true,
      })
      const result = await interaction.run()
      if (typeof result === 'object' && result.xpub && result.rootFingerprint) {
        setSigners(prev => {
          const updated = [...prev]
          updated[signerIndex] = {
            ...updated[signerIndex],
            xpub: result.xpub,
            xfp: result.rootFingerprint,
          }
          return updated
        })
        setLedgerExport({ status: 'done', error: null, signerIndex })
      } else {
        setLedgerExport({ status: 'error', error: 'Unexpected response from Ledger', signerIndex })
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Failed to connect'
      if (msg.includes('CLA_NOT_SUPPORTED') || msg.includes('6e00')) {
        msg = 'Please open the Bitcoin app on your Ledger'
      } else if (msg.includes('No device selected')) {
        msg = 'No Ledger selected. Please try again.'
      } else if (msg.includes('locked') || msg.includes('0x5515')) {
        msg = 'Ledger is locked. Unlock it and open the Bitcoin app.'
      }
      setLedgerExport({ status: 'error', error: msg, signerIndex })
    }
  }, [signers])

  const updateSigner = (index: number, field: keyof SignerConfig, value: string) => {
    setSigners(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    const resolvedFallbackProvider = resolveFallbackProvider(fallbackProvider, provider)
    const effectiveFallbackProvider = getEffectiveFallbackProvider(fallbackProvider, provider)
    try {
      await onSave({
        ...config,
        walletName,
        client: {
          provider,
          apiBaseUrl: apiBaseUrl.trim() || undefined,
          fallbackProvider: resolvedFallbackProvider,
          fallbackApiBaseUrl: effectiveFallbackProvider ? (fallbackApiBaseUrl.trim() || undefined) : undefined,
        },
        signers,
      })
      setMessage({ type: 'success', text: import.meta.env.DEV
        ? 'Configuration saved successfully!'
        : 'Configuration saved. Restart `npm start` to apply.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const effectiveFallbackProvider = getEffectiveFallbackProvider(fallbackProvider, provider)
  const configProvider = config.client?.provider ?? 'mempool'
  const resolvedFallbackProvider = resolveFallbackProvider(fallbackProvider, provider)
  const hasChanges =
    walletName !== config.walletName ||
    provider !== configProvider ||
    apiBaseUrl.trim() !== (config.client?.apiBaseUrl ?? '') ||
    resolvedFallbackProvider !== config.client?.fallbackProvider ||
    fallbackApiBaseUrl.trim() !== (config.client?.fallbackApiBaseUrl ?? '') ||
    JSON.stringify(signers) !== JSON.stringify(config.signers)

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="font-semibold mb-4 dark:text-white">Active Wallet</h3>
        <div className="flex items-center gap-3">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: walletEntry.accentColor }}
          />
          <select
            value={walletId}
            onChange={(e) => switchWallet(e.target.value)}
            className="w-full"
          >
            {wallets.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-4 dark:text-white">Wallet Settings</h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">Wallet Name</label>
            <input
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="My Wallet"
              className="w-full"
            />
            <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">Displayed in the header</p>
          </div>

          <div className="pt-2">
            <div className="text-sm font-medium mb-2 dark:text-slate-200">Network</div>
            <div className="bg-mist dark:bg-slate-700 rounded px-3 py-2 text-sm dark:text-slate-300">
              {config.network === 'mainnet' ? 'Bitcoin Mainnet' : 'Bitcoin Testnet'}
            </div>
          </div>

          <div className="pt-2">
            <div className="text-sm font-medium mb-2 dark:text-slate-200">Quorum</div>
            <div className="bg-mist dark:bg-slate-700 rounded px-3 py-2 text-sm dark:text-slate-300">
              {config.quorum.requiredSigners} of {config.quorum.totalSigners} signatures required
            </div>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">API Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ApiProvider)}
              className="w-full"
            >
              <option value="mempool">mempool.space</option>
              <option value="blockstream">blockstream.info</option>
            </select>
            <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">
              Used for fee estimates, balances, and transaction history.
            </p>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">Custom API Base URL (optional)</label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={provider === 'mempool' ? 'https://mempool.space/api' : 'https://blockstream.info/api'}
              className="w-full mono text-xs"
            />
            <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">
              Leave blank to use the default public endpoint for the provider.
            </p>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">Backup Provider</label>
            <select
              value={fallbackProvider}
              onChange={(e) => setFallbackProvider(e.target.value as FallbackSelection)}
              className="w-full"
            >
              <option value="auto">
                {provider === 'mempool' ? 'Default (blockstream)' : 'Default (off)'}
              </option>
              <option value="mempool" disabled={provider === 'mempool'}>
                mempool.space
              </option>
              <option value="blockstream" disabled={provider === 'blockstream'}>
                blockstream.info
              </option>
            </select>
            <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">
              Used when the primary provider is rate limited or unavailable.
            </p>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium block mb-1 dark:text-slate-200">Backup API Base URL (optional)</label>
            <input
              type="text"
              value={fallbackApiBaseUrl}
              onChange={(e) => setFallbackApiBaseUrl(e.target.value)}
              placeholder={
                effectiveFallbackProvider === 'mempool'
                  ? 'https://mempool.space/api'
                  : effectiveFallbackProvider === 'blockstream'
                    ? 'https://blockstream.info/api'
                    : 'Select a backup provider to enable'
              }
              className="w-full mono text-xs"
              disabled={!effectiveFallbackProvider}
            />
            <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">
              Leave blank to use the default public endpoint for the backup provider.
            </p>
          </div>
        </div>
      </div>

      {signers.map((signer, index) => (
        <div key={index} className="card">
          <h3 className="font-semibold mb-4 dark:text-white">Signer {index + 1}</h3>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1 dark:text-slate-200">Name</label>
              <input
                type="text"
                value={signer.name}
                onChange={(e) => updateSigner(index, 'name', e.target.value)}
                placeholder="Signer name"
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1 dark:text-slate-200">BIP32 Derivation Path</label>
              <input
                type="text"
                value={signer.bip32Path}
                onChange={(e) => updateSigner(index, 'bip32Path', e.target.value)}
                placeholder="m/48'/0'/0'/2'"
                className="w-full mono"
              />
              <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">Standard multisig path: m/48'/0'/0'/2'</p>
            </div>

            <div className="pt-1">
              <button
                onClick={() => exportXpubFromLedger(index)}
                disabled={ledgerExport.status === 'connecting'}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                {ledgerExport.status === 'connecting' && ledgerExport.signerIndex === index
                  ? 'Connecting to Ledger...'
                  : 'Import from Ledger'}
              </button>
              {ledgerExport.signerIndex === index && ledgerExport.status === 'done' && (
                <span className="text-xs text-green-600 dark:text-green-400 ml-2">
                  xpub and fingerprint imported
                </span>
              )}
              {ledgerExport.signerIndex === index && ledgerExport.status === 'error' && ledgerExport.error && (
                <span className="text-xs text-red-600 dark:text-red-400 ml-2">
                  {ledgerExport.error}
                </span>
              )}
            </div>

            <div>
              <label className="text-sm font-medium block mb-1 dark:text-slate-200">Master Fingerprint (XFP)</label>
              <input
                type="text"
                value={signer.xfp}
                onChange={(e) => updateSigner(index, 'xfp', e.target.value.toLowerCase())}
                placeholder="e.g., deadbeef"
                className="w-full mono"
                maxLength={8}
              />
              <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">8 hex characters identifying the master key</p>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1 dark:text-slate-200">Extended Public Key (xpub)</label>
              <textarea
                value={signer.xpub}
                onChange={(e) => updateSigner(index, 'xpub', e.target.value.trim())}
                placeholder="xpub..."
                className="w-full mono text-xs h-20"
              />
              <p className="text-xs text-ink/50 dark:text-slate-400 mt-1">The xpub at the derivation path above</p>
            </div>
          </div>
        </div>
      ))}

      {message && (
        <div className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || !isDev}
          className="btn-primary flex-1"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {!isDev && (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded p-3">
          Configuration can only be modified in development mode (npm run dev).
          Changes are saved to src/configs/{walletId}/config.json.
        </p>
      )}
    </div>
  )
}
