// Low-level PSBT string detection helpers.
//
// Leaf module (no imports from index/ur/specter) so it can be shared everywhere
// without creating an import cycle.

import { Buffer } from 'buffer'

/** Hex PSBTs start with the magic bytes "70736274ff". */
export const HEX_PSBT_RE = /^70736274ff/i

/** Base64 of the PSBT magic "70736274ff" — every base64 PSBT starts with this. */
export const BASE64_PSBT_PREFIX = 'cHNidP8'

/** True if `s` is a hex-encoded PSBT. */
export function isHexPsbt(s: string): boolean {
  return HEX_PSBT_RE.test(s.trim())
}

/** True if `s` is a raw (single-frame) Base64 or hex PSBT, not a QR fragment. */
export function isRawPsbtString(s: string): boolean {
  const t = s.trim()
  return t.startsWith(BASE64_PSBT_PREFIX) || HEX_PSBT_RE.test(t)
}

/** Convert a hex-or-base64 PSBT string to raw bytes. */
export function psbtStringToBytes(psbt: string): Buffer {
  const t = psbt.trim()
  return isHexPsbt(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64')
}

/** Normalize a hex-or-base64 PSBT string to canonical Base64. */
export function psbtStringToBase64(psbt: string): string {
  const t = psbt.trim()
  if (isHexPsbt(t)) return Buffer.from(t, 'hex').toString('base64')
  // Round-trip so downstream parsers get canonical base64.
  return Buffer.from(t, 'base64').toString('base64')
}
