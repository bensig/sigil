// Unified PSBT QR encode / decode entry point.
//
// Export: pick a format and get a QRFrameSource the AnimatedQRDisplay can render.
// Import: feed scanned frames to PsbtScanDecoder, which auto-detects UR2 /
// Specter / single-frame Base64 and reassembles the PSBT.

import type { QRFormat, QRFrameSource, ScanProgress } from './types'
import { isRawPsbtString, psbtStringToBase64 } from './detect'
import { encodePsbtToUr, UrPsbtDecoder, isUrString, isUrPsbt } from './ur-psbt'
import { encodePsbtToSpecter, SpecterPsbtDecoder, isSpecterFrame } from './specter-psbt'

export type { QRFormat, QRFrameSource, ScanProgress, ScannedXpub } from './types'
export { encodePsbtToUr } from './ur-psbt'
export { encodePsbtToSpecter } from './specter-psbt'
export { parseXpubQR } from './xpub-qr'
export { isRawPsbtString } from './detect'

/** Density presets (bytes/chars per fragment) exposed to the export UI. */
export const DENSITY_PRESETS = {
  low: { label: 'Low (easiest to scan)', ur: 90, specter: 60 },
  medium: { label: 'Medium', ur: 150, specter: 100 },
  high: { label: 'High (fewest frames)', ur: 250, specter: 180 },
} as const

export type DensityLevel = keyof typeof DENSITY_PRESETS

/**
 * Build a frame source for the given format + density.
 * For single-frame Base64, the whole PSBT is one frame (only viable for small PSBTs).
 */
export function encodePsbtFrames(
  psbt: string,
  format: QRFormat,
  density: DensityLevel = 'medium'
): QRFrameSource {
  const preset = DENSITY_PRESETS[density]
  switch (format) {
    case 'ur2':
      return encodePsbtToUr(psbt, preset.ur)
    case 'specter':
      return encodePsbtToSpecter(psbt, preset.specter)
    case 'base64': {
      const b64 = psbtStringToBase64(psbt)
      return {
        format: 'base64',
        count: 1,
        frameCount: 1,
        singleString: b64,
        frameAt: () => b64,
      }
    }
  }
}

/**
 * Format-agnostic decoder for scanning a PSBT from animated (or static) QR codes.
 * Auto-detects the wire format from the first recognized frame.
 */
export class PsbtScanDecoder {
  private mode: QRFormat | null = null
  private ur = new UrPsbtDecoder()
  private specter = new SpecterPsbtDecoder()
  private base64Result: string | null = null

  /**
   * Feed a scanned frame. Returns true if the frame advanced the decode
   * (was a valid, new part for the detected format).
   */
  receive(text: string): boolean {
    const t = text.trim()
    if (!t) return false

    if (isUrString(t)) {
      if (this.mode && this.mode !== 'ur2') return false
      if (!isUrPsbt(t)) return false // some other UR type (e.g. an xpub export)
      this.mode = 'ur2'
      return this.ur.receive(t)
    }

    if (isSpecterFrame(t)) {
      if (this.mode && this.mode !== 'specter') return false
      this.mode = 'specter'
      return this.specter.receive(t)
    }

    if (isRawPsbtString(t)) {
      if (this.mode && this.mode !== 'base64') return false
      this.mode = 'base64'
      const b64 = psbtStringToBase64(t)
      const isNew = this.base64Result !== b64
      this.base64Result = b64
      return isNew
    }

    return false
  }

  isComplete(): boolean {
    switch (this.mode) {
      case 'ur2':
        return this.ur.isComplete() && this.ur.isSuccess()
      case 'specter':
        return this.specter.isComplete()
      case 'base64':
        return this.base64Result !== null
      default:
        return false
    }
  }

  progress(): ScanProgress {
    switch (this.mode) {
      case 'ur2':
        return {
          format: 'ur2',
          received: this.ur.receivedPartCount(),
          expected: this.ur.expectedPartCount(),
          ratio: this.ur.progress(),
        }
      case 'specter':
        return {
          format: 'specter',
          received: this.specter.receivedPartCount(),
          expected: this.specter.expectedPartCount(),
          ratio: this.specter.progress(),
        }
      case 'base64':
        return { format: 'base64', received: 1, expected: 1, ratio: 1 }
      default:
        return { format: null, received: 0, expected: null, ratio: 0 }
    }
  }

  /** Get the decoded PSBT as base64. Throws if not complete. */
  getPsbtBase64(): string {
    switch (this.mode) {
      case 'ur2':
        return this.ur.getPsbtBase64()
      case 'specter':
        return this.specter.getPsbtBase64()
      case 'base64':
        if (!this.base64Result) throw new Error('No PSBT scanned')
        return this.base64Result
      default:
        throw new Error('No PSBT scanned')
    }
  }
}
