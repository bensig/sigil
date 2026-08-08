# QR Code Support for SeedSigner Compatibility

**Project:** bensig/sigil · **Status:** Implemented (MVP + robustness)

Native animated-QR display and scanning so the entire round-trip
(unsigned PSBT → SeedSigner → signed PSBT) happens purely via QR codes, with no
intermediate files or extra software. The existing file import/export and Ledger
WebUSB flows are unchanged.

## What's implemented

| ID | Requirement | Status |
|----|-------------|--------|
| G1 | Display a PSBT as an animated QR sequence a SeedSigner can scan | ✅ |
| G2 | Scan a (partially) signed PSBT from a signer back into Sigil | ✅ |
| G3 | Prefer UR2 (`crypto-psbt`) | ✅ default |
| G4 | Keep file import/export and Ledger WebUSB unchanged | ✅ |
| G5 | Work offline (no network for the QR path) | ✅ |
| G6 | Specter animated Base64 segments | ✅ export + import |
| G7 | BBQR | ➖ not yet (see below) |
| G8 | Adjustable density / animation speed | ✅ |
| G9 | Fountain-style scan progress indicator | ✅ |
| G10 | Scan SeedSigner xpub export into the Config tab | ✅ |
| — | Single-frame Base64 fallback for tiny PSBTs | ✅ |

Not in scope (unchanged): seed generation/storage (Sigil stays watch-only),
USB/NFC/Bluetooth, Caravan-based PSBT construction, non-Bitcoin assets. Files
remain a fully supported air-gap method.

## Supported formats

**Export priority (Sigil → signer):** UR2 `crypto-psbt` → Specter → single-frame
Base64. **Import (signer → Sigil):** auto-detected — UR2, Specter, or a raw
Base64/hex PSBT.

| Format | Type | Encoding | Notes |
|--------|------|----------|-------|
| UR2 `crypto-psbt` | Animated / fountain | CBOR + Bytewords | Modern standard, best reliability; recovers dropped frames |
| Specter | Animated | `pXofY` + Base64 chunk | Legacy but widely supported |
| Base64 | Static | Standard Base64 PSBT | Only for tiny PSBTs |

## Libraries

- [`@ngraveio/bc-ur`](https://github.com/ngraveio/bc-ur) — UR encode/decode +
  fountain codes.
- [`@keystonehq/bc-ur-registry-btc`](https://github.com/KeystoneHQ/ur-registry) —
  `crypto-psbt`, `crypto-account`, `crypto-hdkey`, `crypto-output` helpers.
- [`qrcode`](https://github.com/soldair/node-qrcode) — QR frame rendering to canvas.
- [`jsqr`](https://github.com/cozmo/jsQR) — pure-JS camera QR decoding.

All pure JS/TS, browser-only, no network dependency.

## Modules

```
src/lib/qr/
  types.ts          # QRFormat, QRFrameSource, ScanProgress, ScannedXpub
  ur-psbt.ts        # encodePsbtToUr(), UrPsbtDecoder (UR2 crypto-psbt)
  specter-psbt.ts   # encodePsbtToSpecter(), SpecterPsbtDecoder
  xpub-qr.ts        # XpubScanDecoder / parseXpubQR (UR account/hdkey + text)
  index.ts          # encodePsbtFrames(), PsbtScanDecoder (format auto-detect),
                    #   DENSITY_PRESETS
  qr.psbt.test.ts   # round-trip + auto-detect + xpub unit tests

src/components/qr/
  QRModal.tsx           # dark modal shell (Esc / backdrop close)
  AnimatedQRDisplay.tsx # cycles frames, "Part X of Y", density/speed aware
  QRScanner.tsx         # getUserMedia + jsQR frame loop -> onScan(text)
  QRExportModal.tsx     # export UI: format + density + speed + copy
  QRScanModal.tsx       # scan a PSBT (auto-detect), progress bar
  ScanXpubModal.tsx     # scan a signer xpub export into Config
```

### Encoding (export)

`encodePsbtFrames(psbtBase64, format, density)` returns a `QRFrameSource`:

- **UR2:** wraps the PSBT bytes as a `crypto-psbt` UR and pre-generates a pool of
  fountain parts so the animation loops deterministically and the scanner can
  recover missed/out-of-order frames. Fragment size follows the density preset.
- **Specter:** splits the Base64 PSBT into `pXofY <chunk>` frames.
- **Base64:** a single frame containing the whole PSBT (only viable for small
  PSBTs; the display surfaces an error if it exceeds QR capacity).

`AnimatedQRDisplay` renders `frameAt(tick)` on a timer (default 200 ms/frame).

### Decoding (import)

`PsbtScanDecoder` auto-detects the wire format from the first recognized frame,
delegates to the matching decoder, and exposes `progress()` (received / expected
parts + ratio) and `getPsbtBase64()`. The decoded PSBT is handed to the existing
`parsePsbt` / signature-counting path unchanged.

> Implementation note: the decoded UR is unwrapped with bc-ur's own
> `ur.decodeCBOR()` rather than the registry's CBOR decoder, to avoid
> cross-package `Buffer.isBuffer` mismatches under the browser Buffer polyfill.

### xpub import (Config)

`XpubScanDecoder` accepts UR `crypto-account` / `crypto-hdkey` / `crypto-output`
(multi-part supported) and plain-text key expressions like
`[fingerprint/48'/0'/0'/2']xpub...` or a bare xpub, yielding `{ xpub, xfp, path }`
to auto-fill the signer row.

## Integration points

- **`SendForm.tsx`** (live PSBT UI): **Show QR** / **Scan QR** on the PSBT panel.
- **`PSBTImport.tsx`**: **Scan QR** alongside file/paste import.
- **`PSBTPanel.tsx`**: **Show QR** / **Scan QR** (also wired for completeness).
- **`ConfigPage.tsx`**: **Scan from SeedSigner** on each signer row.

## Security

- Camera access is requested only when the user opens a scan dialog.
- No seeds/keys ever enter Sigil — only PSBTs and xpubs. The trust model is
  unchanged (watch-only).
- Scanned content is untrusted input, fully validated by the existing
  `parsePsbt` path.
- The scan-xpub dialog warns users never to scan a SeedQR (seed backup).

## Testing

Automated (`src/lib/qr/qr.psbt.test.ts`, run with `npm test`):

- UR2 and Specter encode→scan round-trips (small single-frame and large
  multi-frame PSBTs).
- Fountain recovery: UR2 completes even when every 3rd frame is dropped.
- Specter reassembles out-of-order frames.
- Single-frame / pasted Base64, and hex-PSBT input.
- Format auto-detection and progress reporting.
- xpub key-expression parsing (bracketed, hardened-marker normalization, bare
  xpub, non-xpub rejection).

Camera interaction and interop with a physical SeedSigner remain manual/E2E:
create a multisig PSBT → Show QR → sign on device → Scan QR back → verify
signature status; repeat for mixed Ledger + SeedSigner quorums; confirm the
existing file and Ledger flows still work.

## Not yet done / future

- **BBQR** encoding (G7) — the format layer is structured so a `bbqr-psbt.ts`
  module can slot into `encodePsbtFrames` / `PsbtScanDecoder` alongside the
  others.
- Export of wallet/output descriptors as UR for other coordinators.
- Remembering the last-used export format/density.
