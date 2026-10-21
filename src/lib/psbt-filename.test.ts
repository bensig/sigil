import { describe, it, expect } from 'vitest'
import { btcAmount, psbtFilename } from './psbt-filename'

const now = new Date(2026, 9, 21, 12, 39)

describe('btcAmount', () => {
  it('drops trailing zeros', () => {
    expect(btcAmount(99184)).toBe('0.00099184')
    expect(btcAmount(50_000_000)).toBe('0.5')
    expect(btcAmount(300_000_000)).toBe('3')
  })
})

describe('psbtFilename', () => {
  it('names an unlabelled destination by a short address and shows signing progress', () => {
    expect(psbtFilename({
      walletName: 'Vault',
      payments: [{ address: 'bc1q2pkr9x4y0y9gav5dae9mhcjne4uxndvftls7g9', amount: 99184 }],
      signed: 1, required: 2, now
    })).toBe('Vault-send-0.00099184btc-to-bc1q2p-ls7g9-signed-1of2-2026-10-21-1239.psbt')
  })

  it('uses the address label and reports unsigned / fully signed', () => {
    const payments = [{ address: 'bc1qxyz', amount: 50_000_000, label: 'Alice (personal)' }]
    expect(psbtFilename({ walletName: 'Vault', payments, signed: 0, required: 2, now }))
      .toBe('Vault-send-0.5btc-to-Alice-personal-unsigned-2026-10-21-1239.psbt')
    expect(psbtFilename({ walletName: 'Vault', payments, signed: 2, required: 2, now }))
      .toBe('Vault-send-0.5btc-to-Alice-personal-fully-signed-2026-10-21-1239.psbt')
  })

  it('totals several payments and names the largest', () => {
    expect(psbtFilename({
      walletName: 'Vault',
      payments: [{ address: 'bc1qsmall00000', amount: 10_000_000, label: 'Small' }, { address: 'bc1qbig000000', amount: 90_000_000, label: 'Big' }],
      signed: 1, required: 3, now
    })).toBe('Vault-send-1btc-to-Big-and-1-more-signed-1of3-2026-10-21-1239.psbt')
  })
})
