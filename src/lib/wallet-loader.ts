import type { AppConfig } from './wallet-config'
import type { WhitelistEntry } from '../hooks/useWhitelist'
import type { CachedAddress } from '../hooks/useAddressLabels'

export interface WalletRegistryEntry {
  id: string
  name: string
  accentColor: string
}

// Eagerly import all per-wallet files at build time
const registryModules = import.meta.glob('../configs/wallets.json', { eager: true }) as Record<string, { default: WalletRegistryEntry[] }>
const configModules = import.meta.glob('../configs/*/config.json', { eager: true }) as Record<string, { default: AppConfig }>
const recipientModules = import.meta.glob('../configs/*/recipients.json', { eager: true }) as Record<string, { default: WhitelistEntry[] }>
const labelModules = import.meta.glob('../data/*/address-labels.json', { eager: true }) as Record<string, { default: { addresses: CachedAddress[] } }>

function extractWalletId(globKey: string): string {
  const parts = globKey.split('/')
  return parts[parts.length - 2]
}

// Build lookup maps indexed by wallet ID
const configByWalletId = new Map<string, AppConfig>()
for (const [key, mod] of Object.entries(configModules)) {
  configByWalletId.set(extractWalletId(key), mod.default)
}

const recipientsByWalletId = new Map<string, WhitelistEntry[]>()
for (const [key, mod] of Object.entries(recipientModules)) {
  recipientsByWalletId.set(extractWalletId(key), mod.default)
}

const labelsByWalletId = new Map<string, CachedAddress[]>()
for (const [key, mod] of Object.entries(labelModules)) {
  labelsByWalletId.set(extractWalletId(key), mod.default.addresses)
}

export function getWalletRegistry(): WalletRegistryEntry[] {
  const explicit = Object.values(registryModules)[0]?.default
  if (explicit && explicit.length > 0) return explicit
  // Fallback: derive registry from discovered config dirs
  return [...configByWalletId.entries()].map(([id, config]) => ({
    id,
    name: config.walletName || id,
    accentColor: '#111111',
  }))
}

export function loadWalletConfig(walletId: string): AppConfig {
  const config = configByWalletId.get(walletId)
  if (!config) throw new Error(`Wallet config not found for "${walletId}"`)
  return config
}

export function loadRecipients(walletId: string): WhitelistEntry[] {
  return recipientsByWalletId.get(walletId) ?? []
}

export function loadAddressLabels(walletId: string): CachedAddress[] {
  return labelsByWalletId.get(walletId) ?? []
}
