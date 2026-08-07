// Parse a signer's extended-public-key export QR (e.g. SeedSigner multisig xpub
// export) into { xpub, xfp, path }.
//
// Supported inputs:
//   - UR `crypto-account`  (SeedSigner multisig export default)
//   - UR `crypto-hdkey`
//   - UR `crypto-output`   (descriptor wrapping an hdkey)
//   - Plain text key expression:  [fingerprint/48h/0h/0h/2h]xpub...
//   - A bare xpub string

import {
  URRegistryDecoder,
  CryptoAccount,
  CryptoHDKey,
  CryptoOutput,
} from '@keystonehq/bc-ur-registry-btc'
import type { ScannedXpub } from './types'

/** Normalize a derivation path: ensure a leading "m/" and use "'" for hardened. */
function normalizePath(path: string): string {
  let p = path.trim().replace(/h/gi, "'")
  if (!p) return p
  if (!/^m\//i.test(p)) p = `m/${p.replace(/^\//, '')}`
  return p
}

/** Extract xpub/xfp/path from a decoded CryptoHDKey. */
function fromHDKey(hdkey: CryptoHDKey, accountXfp?: string): ScannedXpub {
  const xpub = hdkey.getBip32Key()
  const origin = hdkey.getOrigin?.()
  let xfp = accountXfp
  let path: string | undefined
  if (origin) {
    const src = origin.getSourceFingerprint?.()
    if (src && src.length) xfp = src.toString('hex')
    const p = origin.getPath?.()
    if (p) path = normalizePath(p)
  }
  return { xpub, xfp: xfp?.toLowerCase(), path }
}

/** Extract from a decoded UR registry item. Returns null if it holds no hdkey. */
function fromRegistryItem(item: unknown): ScannedXpub | null {
  if (item instanceof CryptoHDKey) {
    return fromHDKey(item)
  }
  if (item instanceof CryptoOutput) {
    const key = item.getHDKey?.()
    if (key) return fromHDKey(key)
    return null
  }
  if (item instanceof CryptoAccount) {
    const xfpBuf = item.getMasterFingerprint?.()
    const xfp = xfpBuf && xfpBuf.length ? xfpBuf.toString('hex') : undefined
    const descriptors = item.getOutputDescriptors?.() ?? []
    for (const d of descriptors) {
      const key = d.getHDKey?.()
      if (key) return fromHDKey(key, xfp)
    }
    return null
  }
  return null
}

/**
 * Parse a plain-text key expression like `[deadbeef/48'/0'/0'/2']xpub6...`
 * (optionally followed by a `/0/*` descriptor suffix), or a bare xpub.
 */
export function parseTextXpub(text: string): ScannedXpub | null {
  const t = text.trim()

  // [fingerprint/path]xpub...
  const m = /^\[([0-9a-fA-F]{8})((?:\/\d+['h]?)+)\]\s*([a-zA-Z0-9]+)/.exec(t)
  if (m) {
    return {
      xfp: m[1].toLowerCase(),
      path: normalizePath(m[2]),
      xpub: m[3],
    }
  }

  // Bare xpub / tpub / Zpub etc.
  const bare = /^([xztuvY][a-km-zA-HJ-NP-Z1-9]{100,120})$/.exec(t)
  if (bare) {
    return { xpub: bare[1] }
  }

  return null
}

/**
 * Stateful decoder for xpub-export QR scans. Handles both single-frame plain
 * text and (possibly multi-part) UR registry payloads.
 */
export class XpubScanDecoder {
  private urDecoder: URRegistryDecoder | null = null
  private textResult: ScannedXpub | null = null

  /** @returns true if the frame advanced the decode. */
  receive(text: string): boolean {
    const t = text.trim()
    if (!t) return false

    if (/^ur:/i.test(t)) {
      if (!this.urDecoder) this.urDecoder = new URRegistryDecoder()
      try {
        return this.urDecoder.receivePart(t)
      } catch {
        return false
      }
    }

    const parsed = parseTextXpub(t)
    if (parsed) {
      this.textResult = parsed
      return true
    }
    return false
  }

  isComplete(): boolean {
    if (this.textResult) return true
    if (this.urDecoder) return this.urDecoder.isComplete() && this.urDecoder.isSuccess()
    return false
  }

  progress(): number {
    if (this.textResult) return 1
    if (this.urDecoder) return this.urDecoder.estimatedPercentComplete()
    return 0
  }

  /** Get the scanned xpub info. Throws if not complete or unsupported. */
  getResult(): ScannedXpub {
    if (this.textResult) return this.textResult
    if (this.urDecoder && this.urDecoder.isComplete() && this.urDecoder.isSuccess()) {
      const item = this.urDecoder.resultRegistryType()
      const result = fromRegistryItem(item)
      if (!result) throw new Error('QR did not contain an extended public key')
      return result
    }
    throw new Error('xpub scan not complete')
  }
}

/**
 * Convenience one-shot parser for a single, self-contained xpub QR string
 * (plain text or single-frame UR). For animated UR, use XpubScanDecoder.
 */
export function parseXpubQR(text: string): ScannedXpub | null {
  const dec = new XpubScanDecoder()
  dec.receive(text)
  try {
    return dec.isComplete() ? dec.getResult() : null
  } catch {
    return null
  }
}
