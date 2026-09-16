import type { ChangePolicy } from './lib/change-policy'

export interface WalletConfig {
  name: string
  changePolicy: ChangePolicy
  uuid: string
  addressType: 'P2WSH'
  network: 'mainnet' | 'testnet'
  client: {
    type: 'public'
    provider: 'mempool' | 'blockstream'
    apiBaseUrl?: string
    fallbackProvider?: 'mempool' | 'blockstream'
    fallbackApiBaseUrl?: string
  }
  quorum: {
    requiredSigners: number
    totalSigners: number
  }
  extendedPublicKeys: ExtendedPublicKey[]
  startingAddressIndex: number
  ledgerPolicyHmacs: string[]
}

export interface ExtendedPublicKey {
  name: string
  bip32Path: string
  xpub: string
  xfp: string
  method: 'ledger' | 'text'
}

export interface UTXO {
  txid: string
  vout: number
  value: number // satoshis
  confirmed: boolean
  transactionHex?: string
}

export interface AddressInfo {
  address: string
  path: string
  index: number
  balance: number // satoshis
  used: boolean
}

export interface FeeRates {
  rapid: number   // sat/vB
  normal: number  // sat/vB
  slow: number    // sat/vB
}

export interface Transaction {
  txid: string
  timestamp: number
  confirmed: boolean
  amount: number // satoshis (positive = received, negative = sent)
  fee?: number
}

export type FeeLevel = 'rapid' | 'normal' | 'slow' | 'custom'
