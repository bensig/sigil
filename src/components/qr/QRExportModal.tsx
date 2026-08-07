import { useMemo, useState } from 'react'
import { QRModal } from './QRModal'
import { AnimatedQRDisplay } from './AnimatedQRDisplay'
import { encodePsbtFrames, DENSITY_PRESETS, type QRFormat, type DensityLevel } from '../../lib/qr'

interface Props {
  psbt: string
  onClose: () => void
}

const FORMATS: { value: QRFormat; label: string; hint: string }[] = [
  { value: 'ur2', label: 'UR2 (crypto-psbt)', hint: 'Recommended — best reliability' },
  { value: 'specter', label: 'Specter', hint: 'Legacy animated Base64' },
  { value: 'base64', label: 'Base64 (single frame)', hint: 'Tiny PSBTs only' },
]

/**
 * Full export UI: shows the PSBT as an animated QR code for an air-gapped signer
 * (e.g. SeedSigner) to scan, with format, density, and speed controls.
 */
export function QRExportModal({ psbt, onClose }: Props) {
  const [format, setFormat] = useState<QRFormat>('ur2')
  const [density, setDensity] = useState<DensityLevel>('medium')
  const [speedMs, setSpeedMs] = useState(200)
  const [paused, setPaused] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const source = useMemo(() => {
    try {
      return encodePsbtFrames(psbt, format, density)
    } catch {
      return null
    }
  }, [psbt, format, density])

  const copyPsbt = async () => {
    try {
      await navigator.clipboard.writeText(psbt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 2500)
    }
  }

  return (
    <QRModal title="Scan with SeedSigner" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Point your air-gapped signer's camera at this code. It animates through all
          parts and loops automatically.
        </p>

        {source ? (
          <AnimatedQRDisplay source={source} speedMs={speedMs} paused={paused} />
        ) : (
          <div className="bg-white rounded-xl p-6 text-slate-800 text-sm text-center">
            Unable to encode this PSBT in the selected format.
          </div>
        )}

        {/* Format selector */}
        <div>
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Format</label>
          <div className="grid grid-cols-1 gap-1.5 mt-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                  format === f.value
                    ? 'border-[var(--color-accent,#3b82f6)] bg-slate-800'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                <span className="font-medium">{f.label}</span>
                <span className="text-slate-400 ml-2 text-xs">{f.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Density + speed controls (not applicable to single-frame Base64) */}
        {format !== 'base64' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Density</label>
              <select
                value={density}
                onChange={(e) => setDensity(e.target.value as DensityLevel)}
                className="w-full mt-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100"
              >
                {(Object.keys(DENSITY_PRESETS) as DensityLevel[]).map((d) => (
                  <option key={d} value={d}>{DENSITY_PRESETS[d].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Speed: {speedMs}ms
              </label>
              <input
                type="range"
                min={80}
                max={600}
                step={20}
                value={speedMs}
                onChange={(e) => setSpeedMs(Number(e.target.value))}
                className="w-full mt-3 accent-[var(--color-accent,#3b82f6)]"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {source && source.count > 1 && (
            <button
              onClick={() => setPaused((p) => !p)}
              className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-600 text-sm"
            >
              {paused ? 'Play' : 'Pause'}
            </button>
          )}
          <button
            onClick={copyPsbt}
            className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-600 text-sm"
          >
            {copied ? 'Copied!' : copyError ? 'Copy failed' : 'Copy PSBT'}
          </button>
        </div>
      </div>
    </QRModal>
  )
}
