import { getWalletRegistry, loadWalletConfig } from './wallet-loader'
import type { WalletRegistryEntry } from './wallet-loader'
import { parsePsbt } from './psbt'

// Identify which local wallets can sign a PSBT. A wallet matches when every
// PSBT input carries a bip32 derivation whose master fingerprint equals one of
// the wallet's signer xfps AND whose path starts with that signer's bip32Path.
// This mirrors Caravan's filterRelevantBip32Derivations check, which otherwise
// fails at signing time with "Signing key details not included in PSBT" —
// e.g. when two wallets share the same Ledgers on different derivation paths
// and the wrong wallet is active during import.
export async function matchPsbtToWallets(psbtBase64: string): Promise<WalletRegistryEntry[]> {
  const parsed = await parsePsbt(psbtBase64)
  const inputs = parsed.data.inputs
  if (!inputs.length) return []

  return getWalletRegistry().filter(entry => {
    let signers: Array<{ xfp: string; path: string }>
    try {
      signers = loadWalletConfig(entry.id).signers.map(s => ({
        xfp: s.xfp.toLowerCase(),
        path: s.bip32Path,
      }))
    } catch {
      return false
    }

    return inputs.every(input =>
      (input.bip32Derivation ?? []).some(deriv => {
        const fp = deriv.masterFingerprint.toString('hex').toLowerCase()
        return signers.some(k => k.xfp === fp && deriv.path.startsWith(k.path))
      })
    )
  })
}
