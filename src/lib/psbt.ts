import type { WalletConfig, UTXO } from '../types'
import { getMultisigForAddress } from './addresses'
import { getTransactionHex } from './mempool'
import { bech32m } from 'bech32'

// Lazy-loaded bitcoinjs-lib
let bitcoinjsLib: typeof import('bitcoinjs-lib') | null = null

async function getBitcoinJS() {
  if (!bitcoinjsLib) {
    bitcoinjsLib = await import('bitcoinjs-lib')
  }
  return bitcoinjsLib
}

/**
 * Check if an address is Taproot (P2TR) — starts with bc1p or tb1p
 */
function isTaprootAddress(address: string): boolean {
  return address.startsWith('bc1p') || address.startsWith('tb1p')
}

/**
 * Build a P2TR output script from a Taproot address.
 * bitcoinjs-lib v5 doesn't support Taproot, so we decode bech32m manually.
 * Output script: OP_1 (0x51) + PUSH_32 (0x20) + 32-byte witness program
 */
function taprootAddressToScript(address: string): Buffer {
  const decoded = bech32m.decode(address)
  // words[0] is the witness version (1 for taproot), rest is the program
  const program = bech32m.fromWords(decoded.words.slice(1))
  if (program.length !== 32) {
    throw new Error(`Invalid Taproot witness program length: ${program.length}`)
  }
  // OP_1 (0x51) + PUSH_32 (0x20) + 32 bytes
  return Buffer.from([0x51, 0x20, ...program])
}

/**
 * Decode a P2TR output script (OP_1 + 32-byte witness program) back to a bech32m address.
 * Returns null if the script is not a valid P2TR script.
 */
export function scriptToTaprootAddress(script: Buffer, mainnet = true): string | null {
  // P2TR script: 0x51 (OP_1) + 0x20 (PUSH 32) + 32 bytes
  if (script.length !== 34 || script[0] !== 0x51 || script[1] !== 0x20) {
    return null
  }
  const program = Array.from(script.slice(2))
  const words = [1, ...bech32m.toWords(Uint8Array.from(program))] // witness version 1
  return bech32m.encode(mainnet ? 'bc' : 'tb', words)
}

interface CreatePsbtParams {
  config: WalletConfig
  utxos: Array<UTXO & { address: string; addressIndex: number; isChange?: boolean }>
  recipientAddress: string
  amountSats: number
  feeSats: number
  changeAddress: string
  changeAddressIndex: number
  isChangeAddress?: boolean // true = change path (1), false = receive path (0)
}

/**
 * Create an unsigned PSBT for a multisig spend
 */
export async function createUnsignedPsbt(params: CreatePsbtParams): Promise<string> {
  const { Psbt, networks } = await getBitcoinJS()

  const {
    config,
    utxos,
    recipientAddress,
    amountSats,
    feeSats,
    changeAddress,
    changeAddressIndex,
    isChangeAddress = true, // Default to change path for backwards compatibility
  } = params

  const network = config.network === 'mainnet' ? networks.bitcoin : networks.testnet

  const psbt = new Psbt({ network })

  // Set transaction version to 1 (same as Caravan)
  psbt.setVersion(1)

  // Calculate total input value
  const totalInput = utxos.reduce((sum, u) => sum + u.value, 0)
  const changeAmount = totalInput - amountSats - feeSats

  if (isNaN(changeAmount) || changeAmount < 0) {
    throw new Error(isNaN(changeAmount) ? 'Invalid amount or fee (NaN)' : 'Insufficient funds')
  }

  // Load caravan for pubkey derivation
  const { deriveChildPublicKey, Network } = await import('@caravan/bitcoin')
  const networkType = config.network === 'mainnet' ? Network.MAINNET : Network.TESTNET

  console.log('=== PSBT CREATION DEBUG ===')
  console.log('Transaction amounts:', {
    totalInput,
    amountSats,
    feeSats,
    changeAmount,
    hasChange: changeAmount > 546,
  })
  console.log('Config extendedPublicKeys:', config.extendedPublicKeys.map(k => ({
    name: k.name,
    xfp: k.xfp,
    bip32Path: k.bip32Path,
    xpub: k.xpub.slice(0, 20) + '...',
  })))

  // Add inputs
  for (const utxo of utxos) {
    const isChangeInput = !!utxo.isChange
    const multisig = await getMultisigForAddress(config, utxo.addressIndex, isChangeInput)
    const txHex = await getTransactionHex(utxo.txid)

    console.log(
      `Input ${utxo.txid}:${utxo.vout} at index ${utxo.addressIndex} (${isChangeInput ? 'change' : 'receive'})`
    )
    console.log('  WitnessScript:', multisig.redeem.output.toString('hex').slice(0, 50) + '...')
    console.log('  P2WSH scriptPubKey:', multisig.output.toString('hex'))
    console.log('  Multisig pubkeys (sorted):', multisig.redeem.pubkeys.map(p => p.toString('hex').slice(0, 16) + '...'))

    // Build bip32Derivation - derive each pubkey and include its origin info
    const bip32Derivation = config.extendedPublicKeys.map(key => {
      const branch = isChangeInput ? 1 : 0
      const childPath = `${branch}/${utxo.addressIndex}`
      const derivedPubkey = deriveChildPublicKey(key.xpub, childPath, networkType)
      console.log(`  Derived pubkey for ${key.name} (${key.xfp}): ${derivedPubkey.slice(0, 16)}...`)
      // Strip m/ prefix if present - Ledger expects path without m/
      const basePath = key.bip32Path.startsWith('m/') ? key.bip32Path.slice(2) : key.bip32Path
      const fullPath = `m/${basePath}/${branch}/${utxo.addressIndex}`
      console.log(`  Full path for ${key.name}: ${fullPath}`)
      return {
        masterFingerprint: Buffer.from(key.xfp, 'hex'),
        path: fullPath,
        pubkey: Buffer.from(derivedPubkey, 'hex'),
      }
    })

    // Ledger requires nonWitnessUtxo for P2WSH to protect against fee attacks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(txHex, 'hex'),
      witnessUtxo: {
        script: multisig.output,
        value: utxo.value,
      },
      witnessScript: multisig.redeem.output,
      bip32Derivation,
    } as any)
  }

  // Add recipient output
  // bitcoinjs-lib v5 doesn't support Taproot (P2TR) addresses natively,
  // so we construct the output script manually for bc1p/tb1p addresses.
  if (isTaprootAddress(recipientAddress)) {
    psbt.addOutput({
      script: taprootAddressToScript(recipientAddress),
      value: amountSats,
    })
  } else {
    psbt.addOutput({
      address: recipientAddress,
      value: amountSats,
    })
  }

  // Add change output if significant (with bip32Derivation and witnessScript for Ledger v2)
  if (changeAmount > 546) { // Dust threshold
    // Get the multisig for the change address
    // isChangeAddress determines the derivation branch: true = 1 (change), false = 0 (receive)
    const changeMultisig = await getMultisigForAddress(config, changeAddressIndex, isChangeAddress)
    const changeBranch = isChangeAddress ? 1 : 0

    // Build bip32Derivation for change output
    const changeBip32Derivation = config.extendedPublicKeys.map(key => {
      const derivedPubkey = deriveChildPublicKey(key.xpub, `${changeBranch}/${changeAddressIndex}`, networkType)
      console.log(`  Change derived pubkey for ${key.name} (${key.xfp}): ${derivedPubkey.slice(0, 16)}...`)
      // Normalize path - strip m/ prefix if present, then add it back for consistency
      const basePath = key.bip32Path.startsWith('m/') ? key.bip32Path.slice(2) : key.bip32Path
      const fullPath = `m/${basePath}/${changeBranch}/${changeAddressIndex}`
      console.log(`  Change full path for ${key.name}: ${fullPath}`)
      return {
        masterFingerprint: Buffer.from(key.xfp, 'hex'),
        path: fullPath,
        pubkey: Buffer.from(derivedPubkey, 'hex'),
      }
    })

    console.log(`Change output at index ${changeAddressIndex}`)
    console.log('  Change bip32Derivation:', changeBip32Derivation.map(d => ({
      xfp: d.masterFingerprint.toString('hex'),
      path: d.path,
      pubkeyLen: d.pubkey.length,
    })))
    console.log('  Change witnessScript:', changeMultisig.redeem.output.toString('hex').slice(0, 50) + '...')

    // Include witnessScript for change output (Caravan includes this for Ledger v2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    psbt.addOutput({
      address: changeAddress,
      value: changeAmount,
      witnessScript: changeMultisig.redeem.output,
      bip32Derivation: changeBip32Derivation,
    } as any)
  }

  // Log final PSBT structure
  console.log('=== FINAL PSBT STRUCTURE ===')
  console.log('Inputs:', psbt.inputCount)
  console.log('Outputs:', psbt.txOutputs.length)
  for (let i = 0; i < psbt.txOutputs.length; i++) {
    const output = psbt.txOutputs[i] as { address?: string; value?: number }
    const outputData = psbt.data.outputs[i]
    console.log(`Output ${i}:`, {
      address: output.address,
      value: output.value,
      hasBip32Derivation: !!outputData.bip32Derivation,
      hasWitnessScript: !!outputData.witnessScript,
      bip32DerivationCount: outputData.bip32Derivation?.length || 0,
    })
  }

  return psbt.toBase64()
}

/**
 * Parse a PSBT from base64 or hex
 */
export async function parsePsbt(psbtData: string): Promise<import('bitcoinjs-lib').Psbt> {
  const { Psbt } = await getBitcoinJS()
  try {
    // Try base64 first
    return Psbt.fromBase64(psbtData)
  } catch {
    try {
      // Try hex
      return Psbt.fromHex(psbtData)
    } catch {
      throw new Error('Invalid PSBT format')
    }
  }
}

type PsbtType = import('bitcoinjs-lib').Psbt

/**
 * Get signature count from PSBT
 */
export function getSignatureCount(psbt: PsbtType): number {
  let maxSigs = 0

  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    const sigs = input.partialSig?.length || 0
    maxSigs = Math.max(maxSigs, sigs)
  }

  return maxSigs
}

/**
 * Check if PSBT has reached the wallet's signing quorum
 */
export function isFullySigned(psbt: PsbtType, requiredSigners: number): boolean {
  return getSignatureCount(psbt) >= requiredSigners
}

/**
 * Finalize and extract transaction hex
 * For P2WSH multisig, signatures must be ordered to match pubkey order in witnessScript
 */
export function finalizePsbt(psbt: PsbtType): string {
  console.log('=== FINALIZING PSBT ===')

  // For each input, ensure signatures are in correct order before finalizing
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    console.log(`Input ${i}:`)
    console.log(`  partialSig count: ${input.partialSig?.length || 0}`)

    if (input.partialSig && input.partialSig.length > 1 && input.witnessScript) {
      // Extract pubkey order from witness script
      // P2WSH multisig script: OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG
      const witnessScript = input.witnessScript
      const scriptPubkeys: Buffer[] = []

      // Parse the witness script to extract pubkeys in order
      let offset = 1 // Skip OP_M
      while (offset < witnessScript.length - 2) { // -2 for OP_N and OP_CHECKMULTISIG
        const len = witnessScript[offset]
        if (len === 0x21) { // 33 bytes = compressed pubkey
          const pubkey = witnessScript.slice(offset + 1, offset + 1 + 33)
          scriptPubkeys.push(pubkey)
          offset += 1 + 33
        } else if (len >= 0x51 && len <= 0x60) { // OP_1 through OP_16
          break // We've hit OP_N
        } else {
          break // Unknown format
        }
      }

      console.log(`  WitnessScript pubkey order:`)
      scriptPubkeys.forEach((pk, idx) => {
        console.log(`    ${idx}: ${pk.toString('hex')}`)
      })

      console.log(`  PartialSig pubkeys:`)
      input.partialSig.forEach((ps, idx) => {
        console.log(`    ${idx}: ${ps.pubkey.toString('hex')}`)
      })

      // Sort partialSig to match witnessScript pubkey order
      const sortedPartialSig = [...input.partialSig].sort((a, b) => {
        const aIndex = scriptPubkeys.findIndex(pk => pk.equals(a.pubkey))
        const bIndex = scriptPubkeys.findIndex(pk => pk.equals(b.pubkey))
        return aIndex - bIndex
      })

      console.log(`  Sorted PartialSig pubkeys:`)
      sortedPartialSig.forEach((ps, idx) => {
        console.log(`    ${idx}: ${ps.pubkey.toString('hex')}`)
      })

      // Update the input with sorted signatures
      input.partialSig = sortedPartialSig
    }
  }

  psbt.finalizeAllInputs()
  const txHex = psbt.extractTransaction().toHex()
  console.log('Finalized tx hex (first 100 chars):', txHex.slice(0, 100))
  return txHex
}

/**
 * Combine two PSBTs (merge signatures)
 */
export function combinePsbts(psbt1: PsbtType, psbt2: PsbtType): PsbtType {
  return psbt1.combine(psbt2)
}

/**
 * Estimate transaction size for fee calculation
 * For P2WSH 2-of-2 multisig
 */
export function estimateTxSize(inputCount: number, outputCount: number): number {
  // P2WSH 2-of-2 witness: ~218 vbytes per input
  // Output: ~43 vbytes for P2WSH, ~31 for P2WPKH
  // Overhead: ~10.5 vbytes
  const witnessInputSize = 218
  const outputSize = 43
  const overhead = 11

  return overhead + (inputCount * witnessInputSize) + (outputCount * outputSize)
}

/**
 * Analyze a PSBT to determine which signers have signed
 * Returns the public keys (hex) that have provided signatures
 */
export function getSignerPubkeys(psbt: PsbtType): Set<string> {
  const signerPubkeys = new Set<string>()

  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    if (input.partialSig) {
      for (const sig of input.partialSig) {
        signerPubkeys.add(sig.pubkey.toString('hex'))
      }
    }
  }

  return signerPubkeys
}

/**
 * Check which signers (by name) have signed the PSBT
 * Matches partial signature pubkeys against the config's derived pubkeys
 */
export async function getSignerNames(
  psbtBase64: string,
  config: WalletConfig
): Promise<{ signed: string[]; unsigned: string[] }> {
  const psbt = await parsePsbt(psbtBase64)
  const signerPubkeys = getSignerPubkeys(psbt)

  if (signerPubkeys.size === 0) {
    return {
      signed: [],
      unsigned: config.extendedPublicKeys.map(k => k.name),
    }
  }

  const { deriveChildPublicKey, Network } = await import('@caravan/bitcoin')
  const network = config.network === 'mainnet' ? Network.MAINNET : Network.TESTNET

  const signed: string[] = []
  const unsigned: string[] = []

  // For each key in the config, check if any of its derived pubkeys signed
  for (const key of config.extendedPublicKeys) {
    let hasSigned = false

    // Check against derived pubkeys at various indices
    // We check the first input's bip32Derivation to find the actual path used
    const input = psbt.data.inputs[0]
    if (input.bip32Derivation) {
      for (const deriv of input.bip32Derivation) {
        const derivPubkeyHex = deriv.pubkey.toString('hex')
        if (signerPubkeys.has(derivPubkeyHex)) {
          // This pubkey signed - check if it belongs to this key
          // Match by checking the master fingerprint in the path
          const pathXfp = deriv.masterFingerprint.toString('hex')
          if (pathXfp.toLowerCase() === key.xfp.toLowerCase()) {
            hasSigned = true
            break
          }
        }
      }
    }

    // Fallback: try to derive and match pubkeys directly
    if (!hasSigned) {
      // Try first few indices
      for (let idx = 0; idx < 5; idx++) {
        try {
          const derivedPubkey = deriveChildPublicKey(key.xpub, `0/${idx}`, network)
          if (signerPubkeys.has(derivedPubkey)) {
            hasSigned = true
            break
          }
        } catch {
          // Ignore derivation errors
        }
      }
    }

    if (hasSigned) {
      signed.push(key.name)
    } else {
      unsigned.push(key.name)
    }
  }

  return { signed, unsigned }
}
