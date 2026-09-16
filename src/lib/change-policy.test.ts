import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHANGE_POLICY,
  DUST_THRESHOLD,
  expectsChangeOutput,
  pickNextUnusedIndex,
  planHistoryProbe,
  resolveChangeDestination,
} from './change-policy'

const addr = (index: number, prefix = 'chg') => ({ address: `${prefix}${index}`, index })

function stats(entries: Record<string, { txCount: number; balance: number }>) {
  return new Map(Object.entries(entries))
}

const utxo = (address: string, value: number, isChange: boolean, addressIndex = 0) =>
  ({ address, value, isChange, addressIndex })

// Holding a UTXO proves an address has transacted, and the balance scan has
// already established that. Asking the API about those addresses again is a
// wasted request — and every extra request is another chance to be rate
// limited, which is what forces the next-index search into 'unknown'.
describe('planHistoryProbe', () => {
  const addresses = [addr(0), addr(1), addr(2), addr(3)]
  const utxos = (byAddress: Record<string, number[]>) =>
    new Map(Object.entries(byAddress).map(([a, values]) => [a, values.map(value => ({ value }))]))

  it('marks addresses holding UTXOs as used without probing them', () => {
    const plan = planHistoryProbe(addresses, utxos({ chg0: [5_000], chg1: [1_000, 2_000] }))
    expect(plan.knownStats.get('chg0')).toEqual({ txCount: 1, balance: 5_000 })
    expect(plan.knownStats.get('chg1')).toEqual({ txCount: 1, balance: 3_000 })
    expect(plan.probeAddresses).not.toContain('chg0')
    expect(plan.probeAddresses).not.toContain('chg1')
  })

  it('probes from the first address with no UTXOs', () => {
    const plan = planHistoryProbe(addresses, utxos({ chg0: [5_000] }))
    expect(plan.probeAddresses).toEqual(['chg1', 'chg2', 'chg3'])
  })

  it('probes everything on a wallet whose change branch holds nothing', () => {
    const plan = planHistoryProbe(addresses, utxos({}))
    expect(plan.probeAddresses).toEqual(['chg0', 'chg1', 'chg2', 'chg3'])
  })

  it('skips funded addresses that sit after an empty one', () => {
    // chg2 is funded, so its history is already known; probing it would be a
    // request spent to learn something the UTXO scan just proved.
    const plan = planHistoryProbe(addresses, utxos({ chg0: [5_000], chg2: [7_000] }))
    expect(plan.probeAddresses).toEqual(['chg1', 'chg3'])
  })

  it('probes nothing when every address is funded', () => {
    const plan = planHistoryProbe(addresses, utxos({
      chg0: [1], chg1: [1], chg2: [1], chg3: [1],
    }))
    expect(plan.probeAddresses).toEqual([])
  })

  it('feeds the next-index search so a funded prefix is skipped without probing', () => {
    const plan = planHistoryProbe(addresses, utxos({ chg0: [5_000] }))
    // chg1 came back with no transactions; chg0 is used on UTXO evidence alone.
    plan.knownStats.set('chg1', { txCount: 0, balance: 0 })
    expect(pickNextUnusedIndex(addresses, plan.knownStats)).toEqual({ status: 'found', index: 1 })
  })
})

// An existing config has no changePolicy field. Defaulting those to 'source'
// would change behaviour under people's feet on upgrade: a plain send that
// used to get a fresh change address would start reusing an input address.
describe('DEFAULT_CHANGE_POLICY', () => {
  it("is 'new', so an unconfigured wallet keeps the safer behaviour", () => {
    expect(DEFAULT_CHANGE_POLICY).toBe('new')
  })
})

describe('pickNextUnusedIndex', () => {
  const addresses = [addr(0), addr(1), addr(2)]

  it('returns the first index on a fresh wallet', () => {
    expect(pickNextUnusedIndex(addresses, stats({}))).toEqual({ status: 'found', index: 0 })
  })

  it('skips an address that currently holds funds', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 2, balance: 50_000 },
    }))).toEqual({ status: 'found', index: 1 })
  })

  // The bug this function exists to fix: judging "unused" by UTXO presence
  // hands out an address that was used and then fully spent.
  it('skips an address that was used and fully spent', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 2, balance: 0 },
      chg1: { txCount: 4, balance: 0 },
    }))).toEqual({ status: 'found', index: 2 })
  })

  it('treats an address with no stats entry as unused', () => {
    // getAddressesStats stops scanning after the gap limit, so trailing
    // addresses are simply absent from the map.
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 1, balance: 0 },
    }))).toEqual({ status: 'found', index: 1 })
  })

  it('reports exhaustion when every address has been used', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 1, balance: 0 },
      chg1: { txCount: 1, balance: 0 },
      chg2: { txCount: 1, balance: 10 },
    }))).toEqual({ status: 'exhausted' })
  })

  it('reports exhaustion for an empty address list', () => {
    expect(pickNextUnusedIndex([], stats({}))).toEqual({ status: 'exhausted' })
  })

  // A lookup that failed is not evidence of an unused address. Treating it as
  // one reinstates exactly the reuse this function exists to prevent: a single
  // rate-limited request on index 0 would otherwise make the branch look fresh.
  describe('when history could not be determined', () => {
    it('is unknown rather than unused', () => {
      expect(pickNextUnusedIndex(addresses, stats({}), new Set(['chg0'])))
        .toEqual({ status: 'unknown' })
    })

    it('is unknown when the failure precedes an apparently free address', () => {
      expect(pickNextUnusedIndex(addresses, stats({
        chg1: { txCount: 0, balance: 0 },
      }), new Set(['chg0']))).toEqual({ status: 'unknown' })
    })

    it('ignores failures after a usable address has been found', () => {
      expect(pickNextUnusedIndex(addresses, stats({}), new Set(['chg2'])))
        .toEqual({ status: 'found', index: 0 })
    })

    it('is unknown when a used prefix is followed by a failure', () => {
      expect(pickNextUnusedIndex(addresses, stats({
        chg0: { txCount: 3, balance: 0 },
      }), new Set(['chg1']))).toEqual({ status: 'unknown' })
    })
  })
})

describe('resolveChangeDestination', () => {
  const nextChange = { address: 'chg7', index: 7, isChange: true }

  describe("policy 'source'", () => {
    it('returns the input address holding the largest total', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('rcv1', 10_000, false, 1), utxo('rcv2', 90_000, false, 2)],
        nextChange,
      })
      expect(result.address).toBe('rcv2')
      expect(result.index).toBe(2)
      expect(result.isChange).toBe(false)
    })

    it('aggregates multiple UTXOs on the same address', () => {
      // rcv1 totals 120k across two UTXOs and must win over rcv2's single 90k.
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [
          utxo('rcv1', 60_000, false, 1),
          utxo('rcv1', 60_000, false, 1),
          utxo('rcv2', 90_000, false, 2),
        ],
        nextChange,
      })
      expect(result.address).toBe('rcv1')
    })

    it('flags reuse when the winning address is on the receive branch', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('rcv1', 10_000, false, 1)],
        nextChange,
      })
      expect(result.reusesReceiveAddress).toBe(true)
    })

    it('does not flag receive-address reuse when the winner is on the change branch', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('chg3', 10_000, true, 3)],
        nextChange,
      })
      expect(result.reusesReceiveAddress).toBe(false)
      expect(result.isChange).toBe(true)
    })

    // Returning change to a change-branch input is still reuse. It leaks less
    // than reusing a deposit address, but "never handed out twice" has to mean
    // it, so it is reported separately rather than not at all.
    it('still reports reuse when returning to a used change address', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('chg3', 10_000, true, 3)],
        nextChange,
      })
      expect(result.reusesAddress).toBe(true)
    })

    it('reports reuse when returning to a receive address', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('rcv1', 10_000, false, 1)],
        nextChange,
      })
      expect(result.reusesAddress).toBe(true)
    })

    it('breaks ties deterministically by address', () => {
      const a = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('rcv1', 50_000, false, 1), utxo('rcv2', 50_000, false, 2)],
        nextChange,
      })
      const b = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('rcv2', 50_000, false, 2), utxo('rcv1', 50_000, false, 1)],
        nextChange,
      })
      expect(a.address).toBe(b.address)
    })

    it('falls back to the next change address when there are no inputs', () => {
      const result = resolveChangeDestination({ policy: 'source', spendUtxos: [], nextChange })
      expect(result.address).toBe('chg7')
      expect(result.isChange).toBe(true)
      expect(result.reusesReceiveAddress).toBe(false)
    })
  })

  describe("policy 'new'", () => {
    it('uses the next unused change address', () => {
      const result = resolveChangeDestination({
        policy: 'new',
        spendUtxos: [utxo('rcv1', 10_000, false, 1)],
        nextChange,
      })
      expect(result).toEqual({
        address: 'chg7',
        index: 7,
        isChange: true,
        reusesReceiveAddress: false,
        reusesAddress: false,
      })
    })

    it('throws when the change addresses are exhausted', () => {
      expect(() => resolveChangeDestination({
        policy: 'new',
        spendUtxos: [utxo('rcv1', 10_000, false, 1)],
        nextChange: null,
      })).toThrow(/change address/i)
    })
  })

  it("throws under 'source' too when there are no inputs and no change address", () => {
    expect(() => resolveChangeDestination({
      policy: 'source',
      spendUtxos: [],
      nextChange: null,
    })).toThrow(/change address/i)
  })
})

// A transaction that produces no change output needs no change address, so
// neither the send form nor the PSBT builder should demand one: a sweep must
// not be blocked because the change branch happens to be exhausted.
describe('expectsChangeOutput', () => {
  it('is false for an exact sweep leaving nothing over', () => {
    expect(expectsChangeOutput(100_000, 90_000, 10_000)).toBe(false)
  })

  it('is false when the remainder is dust', () => {
    expect(expectsChangeOutput(100_000, 89_800, 10_000)).toBe(false)
  })

  it('is false at exactly the dust threshold', () => {
    expect(expectsChangeOutput(100_000 + DUST_THRESHOLD, 90_000, 10_000)).toBe(false)
  })

  it('is true one satoshi above the dust threshold', () => {
    expect(expectsChangeOutput(100_000 + DUST_THRESHOLD + 1, 90_000, 10_000)).toBe(true)
  })

  it('is true for an ordinary send with real change', () => {
    expect(expectsChangeOutput(1_000_000, 90_000, 10_000)).toBe(true)
  })

  it('is false when the inputs do not cover amount plus fee', () => {
    // Insufficient funds is a separate error; there is still no change output.
    expect(expectsChangeOutput(50_000, 90_000, 10_000)).toBe(false)
  })

  it('matches the threshold the PSBT builder applies', () => {
    expect(DUST_THRESHOLD).toBe(546)
  })
})
