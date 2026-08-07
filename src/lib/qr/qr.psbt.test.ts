import { describe, it, expect } from 'vitest'
import { Buffer } from 'buffer'
import { encodePsbtFrames, PsbtScanDecoder } from './index'
import { encodePsbtToUr } from './ur-psbt'
import { encodePsbtToSpecter, parseSpecterFrame } from './specter-psbt'
import { parseTextXpub, parseXpubQR } from './xpub-qr'
import type { QRFormat } from './types'
import { SMALL_PSBT_B64, LARGE_PSBT_B64 } from './__fixtures__'

/** Drive a frame source through a scan decoder until complete (or give up). */
function roundTrip(psbt: string, format: QRFormat): string {
  const source = encodePsbtFrames(psbt, format)
  const decoder = new PsbtScanDecoder()
  const maxTicks = source.count * 6 + 10
  for (let i = 0; i < maxTicks && !decoder.isComplete(); i++) {
    decoder.receive(source.frameAt(i))
  }
  expect(decoder.isComplete()).toBe(true)
  return decoder.getPsbtBase64()
}

describe('UR2 crypto-psbt round-trip', () => {
  it('round-trips a small PSBT (single/few frames)', () => {
    expect(roundTrip(SMALL_PSBT_B64, 'ur2')).toBe(SMALL_PSBT_B64)
  })

  it('round-trips a large PSBT across many fountain frames', () => {
    const source = encodePsbtToUr(LARGE_PSBT_B64, 100)
    expect(source.count).toBeGreaterThan(1)
    expect(roundTrip(LARGE_PSBT_B64, 'ur2')).toBe(LARGE_PSBT_B64)
  })

  it('emits ur:crypto-psbt frames', () => {
    const source = encodePsbtToUr(LARGE_PSBT_B64, 100)
    expect(source.frameAt(0)).toMatch(/^ur:crypto-psbt\//i)
  })

  it('exposes a frameCount >= base fragment count for the animation loop', () => {
    const source = encodePsbtToUr(LARGE_PSBT_B64, 100)
    expect(source.count).toBeGreaterThan(1)
    // UR2 cycles extra fountain frames, so the loop is longer than the base count.
    expect(source.frameCount).toBeGreaterThanOrEqual(source.count)
  })

  it('recovers from dropped frames (fountain redundancy)', () => {
    const source = encodePsbtToUr(LARGE_PSBT_B64, 100)
    const decoder = new PsbtScanDecoder()
    // Skip every 3rd frame to simulate a flaky camera.
    for (let i = 0; i < source.count * 8 && !decoder.isComplete(); i++) {
      if (i % 3 !== 0) decoder.receive(source.frameAt(i))
    }
    expect(decoder.isComplete()).toBe(true)
    expect(decoder.getPsbtBase64()).toBe(LARGE_PSBT_B64)
  })
})

describe('Specter round-trip', () => {
  it('round-trips a small PSBT', () => {
    expect(roundTrip(SMALL_PSBT_B64, 'specter')).toBe(SMALL_PSBT_B64)
  })

  it('round-trips a large PSBT across many frames', () => {
    const source = encodePsbtToSpecter(LARGE_PSBT_B64, 80)
    expect(source.count).toBeGreaterThan(1)
    expect(roundTrip(LARGE_PSBT_B64, 'specter')).toBe(LARGE_PSBT_B64)
  })

  it('emits pXofY frames', () => {
    const source = encodePsbtToSpecter(LARGE_PSBT_B64, 80)
    const parsed = parseSpecterFrame(source.frameAt(0))
    expect(parsed).not.toBeNull()
    expect(parsed!.index).toBe(1)
    expect(parsed!.total).toBe(source.count)
  })

  it('reassembles out-of-order frames', () => {
    const source = encodePsbtToSpecter(LARGE_PSBT_B64, 80)
    const decoder = new PsbtScanDecoder()
    // Feed frames in reverse order.
    for (let i = source.count - 1; i >= 0; i--) {
      decoder.receive(source.frameAt(i))
    }
    expect(decoder.isComplete()).toBe(true)
    expect(decoder.getPsbtBase64()).toBe(LARGE_PSBT_B64)
  })
})

describe('single-frame Base64', () => {
  it('round-trips via the raw base64 path', () => {
    expect(roundTrip(SMALL_PSBT_B64, 'base64')).toBe(SMALL_PSBT_B64)
  })

  it('accepts a bare pasted base64 PSBT', () => {
    const decoder = new PsbtScanDecoder()
    decoder.receive(SMALL_PSBT_B64)
    expect(decoder.isComplete()).toBe(true)
    expect(decoder.getPsbtBase64()).toBe(SMALL_PSBT_B64)
  })
})

describe('format auto-detection', () => {
  it('ignores unrelated QR text', () => {
    const decoder = new PsbtScanDecoder()
    expect(decoder.receive('https://example.com')).toBe(false)
    expect(decoder.isComplete()).toBe(false)
  })

  it('reports progress for animated UR', () => {
    const source = encodePsbtToUr(LARGE_PSBT_B64, 100)
    const decoder = new PsbtScanDecoder()
    decoder.receive(source.frameAt(0))
    const p = decoder.progress()
    expect(p.format).toBe('ur2')
    expect(p.received).toBeGreaterThanOrEqual(1)
  })
})

describe('hex PSBT input', () => {
  it('accepts a hex-encoded PSBT and emits base64', () => {
    const hex = Buffer.from(SMALL_PSBT_B64, 'base64').toString('hex')
    expect(roundTrip(hex, 'ur2')).toBe(SMALL_PSBT_B64)
    expect(roundTrip(hex, 'specter')).toBe(SMALL_PSBT_B64)
  })
})

describe('xpub QR parsing', () => {
  it('parses a bracketed key expression', () => {
    const text = "[deadbeef/48'/0'/0'/2']xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz"
    const r = parseTextXpub(text)
    expect(r).not.toBeNull()
    expect(r!.xfp).toBe('deadbeef')
    expect(r!.path).toBe("m/48'/0'/0'/2'")
    expect(r!.xpub.startsWith('xpub')).toBe(true)
  })

  it('normalizes hardened markers h to apostrophe', () => {
    const text = "[deadbeef/48h/0h/0h/2h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz"
    const r = parseTextXpub(text)
    expect(r!.path).toBe("m/48'/0'/0'/2'")
  })

  it('accepts uppercase H hardened markers in bracketed expressions', () => {
    const text = "[deadbeef/48H/0H/0H/2H]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz"
    const r = parseTextXpub(text)
    expect(r).not.toBeNull()
    expect(r!.path).toBe("m/48'/0'/0'/2'")
    expect(r!.xfp).toBe('deadbeef')
  })

  it('parses a bare xpub', () => {
    const xpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
    const r = parseTextXpub(xpub)
    expect(r).not.toBeNull()
    expect(r!.xpub).toBe(xpub)
    expect(r!.xfp).toBeUndefined()
  })

  it('parses bare SLIP-132 multisig keys (Zpub / Upub / Vpub)', () => {
    for (const prefix of ['Zpub', 'Upub', 'Vpub', 'ypub', 'zpub']) {
      const key = prefix + '6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
      const r = parseTextXpub(key)
      expect(r, `should parse ${prefix}`).not.toBeNull()
      expect(r!.xpub).toBe(key)
    }
  })

  it('returns null for non-xpub text', () => {
    expect(parseXpubQR('just some text')).toBeNull()
  })
})
