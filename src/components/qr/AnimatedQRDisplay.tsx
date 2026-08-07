import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { QRFrameSource } from '../../lib/qr'

interface Props {
  source: QRFrameSource
  /** Milliseconds per frame for animation. */
  speedMs?: number
  /** Pixel size of the QR canvas. */
  size?: number
  paused?: boolean
}

/**
 * Renders a QRFrameSource as an animated QR code, cycling frames on a timer.
 * Single-frame sources render statically. Multi-frame sources show a part
 * indicator: an exact "Part X of Y" when the loop maps 1:1 to fragments
 * (Specter / Base64), or a "Streaming N parts" activity indicator for UR2,
 * whose fountain loop cycles more frames than there are base fragments.
 */
export function AnimatedQRDisplay({ source, speedMs = 200, size = 320, paused = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // `frameCount` is the animation loop length; `count` is the number of real
  // fragments. They match for Specter/Base64 and differ for fountain UR2.
  const loop = source.frameCount
  const multi = loop > 1
  const exact = source.count === loop

  // Advance frames on a timer (unless single-frame or paused).
  useEffect(() => {
    if (!multi || paused) return
    const id = setInterval(() => setTick((t) => t + 1), Math.max(50, speedMs))
    return () => clearInterval(id)
  }, [multi, paused, speedMs])

  // Reset the tick when the source changes so we start at part 1.
  useEffect(() => {
    setTick(0)
  }, [source])

  // Render the current frame to the canvas. The canvas stays mounted even while
  // an error is shown, so a transient encode failure can clear on the next tick.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const text = source.frameAt(tick)
    QRCode.toCanvas(
      canvas,
      text,
      { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#000000', light: '#ffffff' } },
      (err) => setError(err ? 'This transaction is too large for a single QR code. Choose UR2 or a lower density.' : null)
    )
  }, [source, tick, size])

  const pos = multi ? tick % loop : 0
  const barPct = exact ? ((pos + 1) / source.count) * 100 : ((pos + 1) / loop) * 100

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative bg-white rounded-xl p-3 flex items-center justify-center"
        style={{ minHeight: size / 2 }}
      >
        <canvas ref={canvasRef} width={size} height={size} className={error ? 'invisible' : ''} />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-800 text-sm text-center p-6">
            {error}
          </div>
        )}
      </div>
      {multi && !error && (
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span className="font-medium tabular-nums">
            {exact ? `Part ${pos + 1} of ${source.count}` : `Streaming ${source.count} parts`}
          </span>
          <div className="w-32 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent,#3b82f6)] transition-[width] duration-150"
              style={{ width: `${barPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
