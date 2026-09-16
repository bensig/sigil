import { describe, it, expect } from 'vitest'
import { DUST_THRESHOLD, expectsChangeOutput, pickNextUnusedIndex, resolveChangeDestination } from './change-policy'

const addr = (index: number, prefix = 'chg') => ({ address: `${prefix}${index}`, index })

function stats(entries: Record<string, { txCount: number; balance: number }>) {
  return new Map(Object.entries(entries))
}

const utxo = (address: string, value: number, isChange: boolean, addressIndex = 0) =>
  ({ address, value, isChange, addressIndex })

describe('pickNextUnusedIndex', () => {
  const addresses = [addr(0), addr(1), addr(2)]

  it('returns the first index on a fresh wallet', () => {
    expect(pickNextUnusedIndex(addresses, stats({}))).toBe(0)
  })

  it('skips an address that currently holds funds', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 2, balance: 50_000 },
    }))).toBe(1)
  })

  // The bug this function exists to fix: judging "unused" by UTXO presence
  // hands out an address that was used and then fully spent.
  it('skips an address that was used and fully spent', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 2, balance: 0 },
      chg1: { txCount: 4, balance: 0 },
    }))).toBe(2)
  })

  it('treats an address with no stats entry as unused', () => {
    // getAddressesStats stops scanning after the gap limit, so trailing
    // addresses are simply absent from the map.
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 1, balance: 0 },
    }))).toBe(1)
  })

  it('returns null when every address has been used', () => {
    expect(pickNextUnusedIndex(addresses, stats({
      chg0: { txCount: 1, balance: 0 },
      chg1: { txCount: 1, balance: 0 },
      chg2: { txCount: 1, balance: 10 },
    }))).toBeNull()
  })

  it('returns null for an empty address list', () => {
    expect(pickNextUnusedIndex([], stats({}))).toBeNull()
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

    it('does not flag reuse when the winning address is on the change branch', () => {
      const result = resolveChangeDestination({
        policy: 'source',
        spendUtxos: [utxo('chg3', 10_000, true, 3)],
        nextChange,
      })
      expect(result.reusesReceiveAddress).toBe(false)
      expect(result.isChange).toBe(true)
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
      expect(result).toEqual({ address: 'chg7', index: 7, isChange: true, reusesReceiveAddress: false })
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
