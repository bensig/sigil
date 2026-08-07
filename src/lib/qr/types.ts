// Shared types for the QR (air-gap) module.

/**
 * Wire formats we can emit and decode for animated / static PSBT QR codes.
 * Priority order for export is: ur2 > specter > base64 (single frame).
 */
export type QRFormat = 'ur2' | 'specter' | 'base64'

/**
 * A frame source that produces the QR text for a given animation tick.
 *
 * UR2 uses fountain codes, so it can generate an effectively unbounded stream
 * of parts (including redundancy parts beyond the base fragment count). Specter
 * and single-frame Base64 are a fixed cyclic list. `count` is the number of
 * *distinct* base frames (used for the "Part X of Y" indicator); `frameAt`
 * returns the text to render for tick `i` (0-based, cycled by the caller).
 */
export interface QRFrameSource {
  format: QRFormat
  /** Number of distinct base fragments the payload splits into (UR2 fountain sources). */
  count: number
  /**
   * Number of frames in one full animation loop, i.e. `frameAt` is periodic with
   * this period. Equals `count` for Specter/Base64; for multi-fragment UR2 it is
   * larger than `count` because extra fountain (redundancy) frames are cycled.
   */
  frameCount: number
  /** Full UR string (UR2) or the raw payload — handy for "Copy" actions. */
  singleString: string
  /** Returns the QR text to render for animation tick `i`. */
  frameAt: (i: number) => string
}

/** Progress while a multi-part scan is in flight. */
export interface ScanProgress {
  /** Detected format, once the first recognizable frame arrives. */
  format: QRFormat | null
  /** Distinct parts received so far. */
  received: number
  /** Expected total parts (best estimate; may be approximate for fountain UR). */
  expected: number | null
  /** 0..1 completion estimate. */
  ratio: number
}

/** Result of scanning a xpub / account export QR (e.g. SeedSigner multisig export). */
export interface ScannedXpub {
  xpub: string
  /** Master fingerprint (root XFP), 8 lowercase hex chars, if present. */
  xfp?: string
  /** Derivation path, e.g. "m/48'/0'/0'/2'", if present. */
  path?: string
}
