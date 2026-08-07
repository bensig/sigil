// UR2 (Blockchain Commons) crypto-psbt encode / decode.
//
// This is the preferred air-gap format for SeedSigner and other modern signers.
// A PSBT is wrapped as a `crypto-psbt` UR and split into fountain-coded parts so
// the animation can loop indefinitely and the scanner can recover from missed or
// out-of-order frames.

import { Buffer } from 'buffer'
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur'
import { CryptoPSBT } from '@keystonehq/bc-ur-registry-btc'
import type { QRFrameSource } from './types'

/** Convert a base64 (or hex) PSBT string to raw bytes. */
function psbtStringToBytes(psbt: string): Buffer {
  const trimmed = psbt.trim()
  // Hex PSBTs start with the magic "70736274ff".
  if (/^70736274ff/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }
  return Buffer.from(trimmed, 'base64')
}

/**
 * Build a frame source that renders an unsigned/partial PSBT as animated UR2 QR.
 *
 * @param psbt         PSBT as base64 (or hex).
 * @param maxFragmentLength  Max bytes per fragment. Smaller => more frames but
 *                     lower-density (easier to scan) QR codes. SeedSigner scans
 *                     reliably around 100–200.
 */
export function encodePsbtToUr(psbt: string, maxFragmentLength = 150): QRFrameSource {
  const bytes = psbtStringToBytes(psbt)
  const cryptoPsbt = new CryptoPSBT(bytes)
  const ur = cryptoPsbt.toUR()

  const encoder = new UREncoder(ur, maxFragmentLength)
  const count = encoder.fragmentsLength

  // Single-fragment PSBTs don't need animation or fountain redundancy.
  if (count <= 1) {
    const only = encoder.nextPart()
    return {
      format: 'ur2',
      count: 1,
      frameCount: 1,
      singleString: only,
      frameAt: () => only,
    }
  }

  // Pre-generate a healthy pool of fountain parts (pure fragments + redundancy)
  // so frameAt() is deterministic and the display can loop smoothly.
  const poolSize = Math.max(count * 2, count + 4)
  const parts: string[] = []
  for (let i = 0; i < poolSize; i++) {
    parts.push(encoder.nextPart())
  }

  return {
    format: 'ur2',
    count,
    frameCount: parts.length,
    singleString: ur.type + ' (' + count + ' parts)',
    frameAt: (i: number) => parts[i % parts.length],
  }
}

/**
 * Stateful decoder for animated UR2 crypto-psbt scans.
 * Feed each scanned frame to `receive`; when `isComplete()` is true, call
 * `getPsbtBase64()`.
 */
export class UrPsbtDecoder {
  private decoder = new URDecoder()

  /** @returns true if the frame was a valid UR part. */
  receive(text: string): boolean {
    try {
      return this.decoder.receivePart(text)
    } catch {
      return false
    }
  }

  isComplete(): boolean {
    return this.decoder.isComplete()
  }

  isSuccess(): boolean {
    return this.decoder.isSuccess()
  }

  expectedPartCount(): number | null {
    const n = this.decoder.expectedPartCount()
    return Number.isFinite(n) && n > 0 ? n : null
  }

  receivedPartCount(): number {
    return this.decoder.receivedPartIndexes().length
  }

  /** 0..1 completion estimate. */
  progress(): number {
    return this.decoder.estimatedPercentComplete()
  }

  /** Extract the decoded PSBT as base64. Throws if not complete/valid. */
  getPsbtBase64(): string {
    if (!this.decoder.isComplete() || !this.decoder.isSuccess()) {
      throw new Error('UR decode not complete')
    }
    const ur: UR = this.decoder.resultUR()
    if (ur.type !== 'crypto-psbt') {
      throw new Error(`Unexpected UR type: ${ur.type}`)
    }
    // A crypto-psbt UR wraps the PSBT bytes as a single CBOR byte string. Use
    // bc-ur's own CBOR decoder (which shares bc-ur's Buffer instance with
    // `ur.cbor`) to avoid cross-package `Buffer.isBuffer` mismatches that can
    // occur with the registry decoder under a browser Buffer polyfill.
    const psbtBytes = ur.decodeCBOR()
    return Buffer.from(psbtBytes).toString('base64')
  }
}

/** True if a scanned string looks like a UR part. */
export function isUrString(text: string): boolean {
  return /^ur:/i.test(text.trim())
}

/** True if a scanned string is specifically a crypto-psbt UR part. */
export function isUrPsbt(text: string): boolean {
  return /^ur:crypto-psbt\//i.test(text.trim())
}
