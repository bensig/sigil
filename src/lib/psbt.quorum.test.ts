import { describe, it, expect } from 'vitest'
import { isFullySigned } from './psbt'

function fakePsbt(sigCounts: number[]) {
  return {
    inputCount: sigCounts.length,
    data: {
      inputs: sigCounts.map(n => ({
        partialSig: Array.from({ length: n }, (_, i) => ({ pubkey: Buffer.alloc(33, i), signature: Buffer.alloc(72) })),
      })),
    },
  } as any
}

describe('isFullySigned quorum', () => {
  it('2-of-2: 2 sigs is fully signed', () => {
    expect(isFullySigned(fakePsbt([2]), 2)).toBe(true)
  })
  it('2-of-3: 1 sig is not fully signed', () => {
    expect(isFullySigned(fakePsbt([1]), 2)).toBe(false)
  })
  it('3-of-5: 2 sigs is not fully signed', () => {
    expect(isFullySigned(fakePsbt([2]), 3)).toBe(false)
  })
  it('3-of-5: 3 sigs is fully signed', () => {
    expect(isFullySigned(fakePsbt([3]), 3)).toBe(true)
  })
})
