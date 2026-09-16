import type { WalletConfig } from '../types'
import { DEFAULT_CHANGE_POLICY, type ChangePolicy } from './change-policy'

export interface AppConfig {
  walletName: string
  network: 'mainnet' | 'testnet'
  /** Where change goes. Omitted in existing configs; see DEFAULT_CHANGE_POLICY. */
  changePolicy?: ChangePolicy
  client?: {
    provider?: 'mempool' | 'blockstream'
    apiBaseUrl?: string
    fallbackProvider?: 'mempool' | 'blockstream'
    fallbackApiBaseUrl?: string
  }
  quorum: { requiredSigners: number; totalSigners: number }
  signers: Array<{ name: string; xpub: string; xfp: string; bip32Path: string }>
}

export function buildWalletConfig(config: AppConfig, signerIndex: number): WalletConfig {
  const provider = config.client?.provider ?? 'mempool'
  const apiBaseUrl = config.client?.apiBaseUrl
  const fallbackProvider = config.client?.fallbackProvider
  const fallbackApiBaseUrl = config.client?.fallbackApiBaseUrl

  return {
    name: config.walletName,
    uuid: '',
    addressType: 'P2WSH',
    network: config.network,
    client: {
      type: 'public',
      provider,
      apiBaseUrl,
      fallbackProvider,
      fallbackApiBaseUrl,
    },
    quorum: config.quorum,
    changePolicy: config.changePolicy ?? DEFAULT_CHANGE_POLICY,
    extendedPublicKeys: config.signers.map((signer, idx) => ({
      name: signer.name,
      bip32Path: signer.bip32Path,
      xpub: signer.xpub,
      xfp: signer.xfp,
      method: idx === signerIndex ? 'ledger' : 'text',
    })),
    startingAddressIndex: 0,
    ledgerPolicyHmacs: [],
  }
}
