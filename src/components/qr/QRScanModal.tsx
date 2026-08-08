import { useCallback, useRef, useState } from 'react'
import { QRModal } from './QRModal'
import { QRScanner } from './QRScanner'
import { PsbtScanDecoder, type ScanProgress } from '../../lib/qr'

interface Props {
  onClose: () => void
  /** Called with the reassembled PSBT (base64) once the scan is complete. */
  onScanned: (psbtBase64: string) => void
}

const EMPTY: ScanProgress = { format: null, received: 0, expected: null, ratio: 0 }

const FORMAT_LABEL: Record<string, string> = {
  ur2: 'UR2 (crypto-psbt)',
  specter: 'Specter',
  base64: 'Base64',
}

/**
 * Scan an (animated) PSBT QR from an air-gapped signer and hand the reassembled
 * PSBT back to the caller. Auto-detects UR2 / Specter / single-frame Base64.
 */
export function QRScanModal({ onClose, onScanned }: Props) {
  // Lazy init: useRef's argument is evaluated every render, so `new
  // PsbtScanDecoder()` would allocate a throwaway on each progress re-render.
  const decoderRef = useRef<PsbtScanDecoder | null>(null)
  if (!decoderRef.current) decoderRef.current = new PsbtScanDecoder()
  const doneRef = useRef(false)
  const [progress, setProgress] = useState<ScanProgress>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const handleScan = useCallback(
    (text: string) => {
      if (doneRef.current) return
      const decoder = decoderRef.current!
      const advanced = decoder.receive(text)
      if (advanced) {
        setProgress(decoder.progress())
      }
      if (decoder.isComplete()) {
        try {
          const psbt = decoder.getPsbtBase64()
          doneRef.current = true
          onScanned(psbt)
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to decode PSBT')
        }
      }
    },
    [onScanned, onClose]
  )

  const retry = useCallback(() => {
    decoderRef.current = new PsbtScanDecoder()
    doneRef.current = false
    setProgress(EMPTY)
    setError(null)
  }, [])

  const pct = progress.expected
    ? Math.round((progress.received / progress.expected) * 100)
    : Math.round(progress.ratio * 100)

  return (
    <QRModal title="Scan PSBT from Signer" onClose={onClose}>
      <div className="space-y-4">
        {error ? (
          <div className="bg-red-950/50 border border-red-800 text-red-300 rounded-lg p-4 text-sm">
            {error}
            <button onClick={retry} className="block mt-2 underline text-red-200">
              Try again
            </button>
          </div>
        ) : (
          <QRScanner onScan={handleScan} onError={setError} />
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>
              {progress.format
                ? `Reading ${FORMAT_LABEL[progress.format] ?? progress.format}…`
                : 'Point the camera at the animated QR'}
            </span>
            <span className="tabular-nums font-medium">
              {progress.expected
                ? `${progress.received} / ${progress.expected}`
                : progress.received > 0
                  ? `${progress.received} parts`
                  : ''}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent,#3b82f6)] transition-[width] duration-200"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Hold steady until all parts are captured. Missing frames are recovered
          automatically as the animation loops.
        </p>
      </div>
    </QRModal>
  )
}
