import { useCallback, useRef, useState } from 'react'
import { QRModal } from './QRModal'
import { QRScanner } from './QRScanner'
import { XpubScanDecoder } from '../../lib/qr/xpub-qr'
import type { ScannedXpub } from '../../lib/qr'

interface Props {
  onClose: () => void
  onScanned: (result: ScannedXpub) => void
}

/**
 * Scan a signer's extended-public-key export QR (e.g. SeedSigner multisig xpub
 * export) into the Config form. Accepts UR crypto-account / crypto-hdkey /
 * crypto-output as well as plain-text key expressions.
 */
export function ScanXpubModal({ onClose, onScanned }: Props) {
  const decoderRef = useRef(new XpubScanDecoder())
  const doneRef = useRef(false)
  const [ratio, setRatio] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleScan = useCallback(
    (text: string) => {
      if (doneRef.current) return
      const advanced = decoderRef.current.receive(text)
      if (advanced) setRatio(decoderRef.current.progress())
      if (decoderRef.current.isComplete()) {
        try {
          const result = decoderRef.current.getResult()
          doneRef.current = true
          onScanned(result)
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to decode QR')
        }
      }
    },
    [onScanned, onClose]
  )

  return (
    <QRModal title="Scan xpub from SeedSigner" onClose={onClose}>
      <div className="space-y-4">
        {error ? (
          <div className="bg-red-950/50 border border-red-800 text-red-300 rounded-lg p-4 text-sm">
            {error}
            <button
              onClick={() => { setError(null); decoderRef.current = new XpubScanDecoder() }}
              className="block mt-2 underline text-red-200"
            >
              Try again
            </button>
          </div>
        ) : (
          <QRScanner onScan={handleScan} onError={setError} />
        )}

        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent,#3b82f6)] transition-[width] duration-200"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>

        <div className="bg-amber-950/40 border border-amber-800/60 text-amber-200 rounded-lg p-3 text-xs">
          <strong>Safety:</strong> only scan a public key export. Never scan a SeedQR
          (seed backup) into Sigil or any internet-connected device.
        </div>
      </div>
    </QRModal>
  )
}
