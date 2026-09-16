// Where a transaction's change output goes.
//
// 'source' returns change to the input address holding the largest total. It
// keeps funds on a small set of addresses you already track, at the cost of
// address reuse: an output paying an address that is also an input is
// unambiguously change, and anyone holding that address can see everything it
// ever held.
//
// 'new' sends change to the next unused address on the change branch.
export type ChangePolicy = 'source' | 'new'

export const DEFAULT_CHANGE_POLICY: ChangePolicy = 'source'

/** Below this, a change output costs more to spend than it is worth, so the
 *  remainder goes to the miner instead. Applied by the PSBT builder. */
export const DUST_THRESHOLD = 546

/**
 * Whether a transaction with these amounts will carry a change output at all.
 *
 * A sweep, or a send whose remainder is dust, has no change output and so needs
 * no change address — it must not be blocked when the change branch is
 * exhausted. Insufficient funds is reported separately; there is no change
 * output in that case either.
 */
export function expectsChangeOutput(totalInput: number, amountSats: number, feeSats: number): boolean {
  return totalInput - amountSats - feeSats > DUST_THRESHOLD
}

export interface ChangeAddressCandidate {
  address: string
  index: number
  isChange: boolean
}

export interface SpendableUtxo {
  address: string
  addressIndex: number
  value: number
  isChange: boolean
}

export interface ChangeDestination extends ChangeAddressCandidate {
  /** True when change lands on a receive-branch address, which may have been
   *  handed to someone else as a deposit address. */
  reusesReceiveAddress: boolean
}

/**
 * First address on a branch that has never appeared in a transaction.
 *
 * Judged by transaction count, not by current UTXOs: an address that was used
 * and then fully spent holds nothing, yet handing it out again would reuse it.
 * Addresses missing from `stats` are unused — `getAddressesStats` stops
 * scanning once it passes the gap limit, so trailing entries are simply absent.
 *
 * Returns null when every address has been used.
 */
export function pickNextUnusedIndex(
  addresses: Array<{ address: string; index: number }>,
  stats: Map<string, { txCount: number; balance: number }>
): number | null {
  for (const addr of addresses) {
    const txCount = stats.get(addr.address)?.txCount ?? 0
    if (txCount === 0) return addr.index
  }
  return null
}

/**
 * Decide where change goes for one transaction.
 *
 * Falls back to the next change address whenever there is no input to return
 * change to, and throws when the change branch is exhausted rather than
 * silently wrapping back to an address already in use.
 */
export function resolveChangeDestination({
  policy,
  spendUtxos,
  nextChange,
}: {
  policy: ChangePolicy
  spendUtxos: SpendableUtxo[]
  nextChange: ChangeAddressCandidate | null
}): ChangeDestination {
  if (policy === 'source' && spendUtxos.length > 0) {
    const totals = new Map<string, { address: string; index: number; isChange: boolean; total: number }>()

    for (const utxo of spendUtxos) {
      const existing = totals.get(utxo.address)
      if (existing) {
        existing.total += utxo.value
      } else {
        totals.set(utxo.address, {
          address: utxo.address,
          index: utxo.addressIndex,
          isChange: utxo.isChange,
          total: utxo.value,
        })
      }
    }

    // Largest total wins; ties break on the address itself so the same inputs
    // always produce the same destination regardless of UTXO ordering.
    const winner = Array.from(totals.values()).sort(
      (a, b) => b.total - a.total || a.address.localeCompare(b.address)
    )[0]

    return {
      address: winner.address,
      index: winner.index,
      isChange: winner.isChange,
      reusesReceiveAddress: !winner.isChange,
    }
  }

  if (!nextChange) {
    throw new Error(
      'No unused change address available — every change address on this wallet has been used. ' +
      'Select the UTXOs to spend and choose a change address, or widen the change address gap.'
    )
  }

  return {
    address: nextChange.address,
    index: nextChange.index,
    isChange: nextChange.isChange,
    reusesReceiveAddress: !nextChange.isChange,
  }
}
