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
 * Single-frame sources render statically. Shows a "Part X of Y" indicator for
 * multi-frame animations.
 */
export function AnimatedQRDisplay({ source, speedMs = 200, size = 320, paused = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Use the animation loop length (frameCount), not the base-fragment count, so
  // the indicator and progress bar stay in sync with the frame actually shown
  // (UR2 cycles extra fountain frames beyond `count`).
  const loop = source.frameCount
  const multi = loop > 1

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

  // Render the current frame to the canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const text = source.frameAt(tick)
    QRCode.toCanvas(
      canvas,
      text,
      { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#000000', light: '#ffffff' } },
      (err) => {
        if (err) {
          setError('This transaction is too large for a single QR code. Choose UR2 or a lower density.')
        } else {
          setError(null)
        }
      }
    )
  }, [source, tick, size])

  const currentPart = multi ? (tick % loop) + 1 : 1

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-white rounded-xl p-3 flex items-center justify-center" style={{ minHeight: size / 2 }}>
        {error ? (
          <div className="text-slate-800 text-sm text-center p-6 max-w-[280px]">{error}</div>
        ) : (
          <canvas ref={canvasRef} width={size} height={size} />
        )}
      </div>
      {multi && !error && (
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span className="font-medium tabular-nums">
            Part {currentPart} of {loop}
          </span>
          <div className="w-32 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent,#3b82f6)] transition-[width] duration-150"
              style={{ width: `${(currentPart / loop) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
