// Specter Desktop animated Base64 PSBT format.
//
// Each frame looks like:  `p1of3 cHNidP8B...`
// i.e. a 1-based part index, "of", the total count, a space, then a slice of the
// Base64-encoded PSBT. Reassembly concatenates the slices in index order.
//
// This is a legacy format but still widely emitted/accepted by SeedSigner, so we
// support it for both export (as a fallback) and import (auto-detected).

import { Buffer } from 'buffer'
import type { QRFrameSource } from './types'

const SPECTER_FRAME_RE = /^p(\d+)of(\d+)\s+([\s\S]+)$/i

/** Normalize a PSBT string to Base64 (Specter transports Base64). */
function toBase64(psbt: string): string {
  const trimmed = psbt.trim()
  if (/^70736274ff/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex').toString('base64')
  }
  // Validate it is parseable base64 by round-tripping.
  return Buffer.from(trimmed, 'base64').toString('base64') === trimmed
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('base64')
}

/**
 * Build a frame source that renders a PSBT as Specter animated Base64 QR.
 *
 * @param psbt         PSBT as base64 (or hex).
 * @param maxChunkLen  Max Base64 characters per frame (density control).
 */
export function encodePsbtToSpecter(psbt: string, maxChunkLen = 100): QRFrameSource {
  const b64 = toBase64(psbt)
  const total = Math.max(1, Math.ceil(b64.length / maxChunkLen))
  const frames: string[] = []
  for (let i = 0; i < total; i++) {
    const chunk = b64.slice(i * maxChunkLen, (i + 1) * maxChunkLen)
    frames.push(`p${i + 1}of${total} ${chunk}`)
  }
  return {
    format: 'specter',
    count: total,
    singleString: b64,
    frameAt: (i: number) => frames[i % frames.length],
  }
}

/** True if a scanned string is a Specter animated frame. */
export function isSpecterFrame(text: string): boolean {
  return SPECTER_FRAME_RE.test(text.trim())
}

/** Parse a single Specter frame into its parts. Returns null if it doesn't match. */
export function parseSpecterFrame(
  text: string
): { index: number; total: number; data: string } | null {
  const m = SPECTER_FRAME_RE.exec(text.trim())
  if (!m) return null
  const index = parseInt(m[1], 10)
  const total = parseInt(m[2], 10)
  if (!index || !total || index > total) return null
  return { index, total, data: m[3].trim() }
}

/** Stateful decoder that reassembles a PSBT from Specter animated frames. */
export class SpecterPsbtDecoder {
  private total: number | null = null
  private parts = new Map<number, string>()

  /** @returns true if the frame was a valid, new Specter part. */
  receive(text: string): boolean {
    const parsed = parseSpecterFrame(text)
    if (!parsed) return false
    // If the total changes mid-scan, we're looking at a different payload — reset.
    if (this.total !== null && this.total !== parsed.total) {
      this.total = parsed.total
      this.parts.clear()
    }
    this.total = parsed.total
    if (this.parts.has(parsed.index)) return false
    this.parts.set(parsed.index, parsed.data)
    return true
  }

  isComplete(): boolean {
    return this.total !== null && this.parts.size === this.total
  }

  expectedPartCount(): number | null {
    return this.total
  }

  receivedPartCount(): number {
    return this.parts.size
  }

  progress(): number {
    if (!this.total) return 0
    return this.parts.size / this.total
  }

  /** Reassemble and return the PSBT as base64. Throws if not complete. */
  getPsbtBase64(): string {
    if (!this.isComplete()) throw new Error('Specter decode not complete')
    let b64 = ''
    for (let i = 1; i <= (this.total as number); i++) {
      const part = this.parts.get(i)
      if (part === undefined) throw new Error(`Missing Specter part ${i}`)
      b64 += part
    }
    // Normalize through a Buffer round-trip so downstream parsers get clean base64.
    return Buffer.from(b64, 'base64').toString('base64')
  }
}
