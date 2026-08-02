import type { WalletConfig, AddressInfo } from '../types'

// Type for the multisig object returned by generateMultisigFromPublicKeys
interface MultisigObject {
  address: string
  output: Buffer  // P2WSH scriptPubKey (OP_0 <sha256(witnessScript)>)
  redeem: {
    output: Buffer  // witnessScript
    pubkeys: Buffer[]
    m: number
  }
}

// Lazy-loaded caravan modules
let caravanBitcoin: typeof import('@caravan/bitcoin') | null = null

async function getCaravanBitcoin() {
  if (!caravanBitcoin) {
    caravanBitcoin = await import('@caravan/bitcoin')
  }
  return caravanBitcoin
}

/**
 * Derive a multisig address at a given index from the wallet config
 * Uses sortedmulti ordering (lexicographically sorted public keys)
 */
export async function deriveAddress(config: WalletConfig, index: number, change = false): Promise<string> {
  const { deriveChildPublicKey, generateMultisigFromPublicKeys, Network, P2WSH } = await getCaravanBitcoin()

  const network = config.network === 'mainnet' ? Network.MAINNET : Network.TESTNET
  const changePath = change ? 1 : 0

  try {
    const childPubkeys = config.extendedPublicKeys.map((key) => {
      const childPath = `${changePath}/${index}`
      if (!key.xpub) {
        throw new Error(`Missing xpub for key ${key.name}`)
      }
      return deriveChildPublicKey(key.xpub, childPath, network)
    })

    // Sort pubkeys lexicographically (required for sortedmulti compatibility)
    const sortedPubkeys = [...childPubkeys].sort()

    const multisig = generateMultisigFromPublicKeys(
      network,
      P2WSH,
      config.quorum.requiredSigners,
      ...sortedPubkeys
    ) as MultisigObject | null

    if (!multisig || !multisig.address) {
      throw new Error('Failed to generate multisig address')
    }

    return multisig.address
  } catch (error) {
    console.error('Error deriving address:', error)
    throw error
  }
}

/**
 * Get the full BIP32 path for an address at a given index
 */
export function getAddressPath(config: WalletConfig, index: number, change = false): string {
  const basePath = config.extendedPublicKeys[0].bip32Path
  const changePath = change ? 1 : 0
  return `${basePath}/${changePath}/${index}`
}

/**
 * Generate a list of addresses from the wallet config
 */
export async function generateAddresses(
  config: WalletConfig,
  count: number,
  startIndex = 0,
  change = false
): Promise<AddressInfo[]> {
  const addresses: AddressInfo[] = []

  for (let i = startIndex; i < startIndex + count; i++) {
    const address = await deriveAddress(config, i, change)
    addresses.push({
      address,
      path: getAddressPath(config, i, change),
      index: i,
      balance: 0,
      used: false,
    })
  }

  return addresses
}

/**
 * Get multisig details for PSBT construction
 * Uses sortedmulti ordering (lexicographically sorted public keys)
 */
export async function getMultisigForAddress(config: WalletConfig, index: number, change = false): Promise<MultisigObject> {
  const { deriveChildPublicKey, generateMultisigFromPublicKeys, Network, P2WSH } = await getCaravanBitcoin()

  const network = config.network === 'mainnet' ? Network.MAINNET : Network.TESTNET
  const changePath = change ? 1 : 0

  const childPubkeys = config.extendedPublicKeys.map((key) => {
    const childPath = `${changePath}/${index}`
    return deriveChildPublicKey(key.xpub, childPath, network)
  })

  // Sort pubkeys lexicographically (required for sortedmulti compatibility)
  const sortedPubkeys = [...childPubkeys].sort()

  const multisig = generateMultisigFromPublicKeys(
    network,
    P2WSH,
    config.quorum.requiredSigners,
    ...sortedPubkeys
  ) as MultisigObject | null

  if (!multisig) {
    throw new Error('Failed to generate multisig')
  }

  return multisig
}
