import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface Props {
  /** Called with the decoded text of every QR frame the camera reads. */
  onScan: (text: string) => void
  /** Called if the camera can't be started (permission denied, no device, ...). */
  onError?: (message: string) => void
  size?: number
}

/**
 * Live camera QR scanner. Continuously decodes frames with jsQR and forwards
 * every decoded string to `onScan` — the caller is responsible for accumulating
 * multi-part (animated) payloads and de-duplicating repeats.
 *
 * Camera access is requested only while this component is mounted, i.e. only
 * after the user has explicitly opened a scan modal.
 */
export function QRScanner({ onScan, onError, size = 320 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  const [ready, setReady] = useState(false)

  // Keep latest callbacks without restarting the camera.
  useEffect(() => { onScanRef.current = onScan }, [onScan])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    let cancelled = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const tick = () => {
      const video = videoRef.current
      if (!cancelled && video && video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        const w = video.videoWidth
        const h = video.videoHeight
        if (w && h) {
          canvas.width = w
          canvas.height = h
          ctx.drawImage(video, 0, 0, w, h)
          try {
            const imageData = ctx.getImageData(0, 0, w, h)
            const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' })
            if (code && code.data) {
              onScanRef.current(code.data)
            }
          } catch {
            // Ignore transient frame read errors.
          }
        }
      }
      if (!cancelled) rafRef.current = requestAnimationFrame(tick)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current?.('Camera not available in this browser.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.setAttribute('playsinline', 'true')
          await video.play()
          setReady(true)
          rafRef.current = requestAnimationFrame(tick)
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        let msg = 'Could not access the camera.'
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          msg = 'Camera permission denied. Allow camera access and try again.'
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          msg = 'No camera found on this device.'
        } else if (name === 'NotReadableError') {
          msg = 'Camera is already in use by another application.'
        }
        onErrorRef.current?.(msg)
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  return (
    <div
      className="relative rounded-xl overflow-hidden bg-black mx-auto"
      style={{ width: size, height: size }}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
      />
      {/* Framing guide */}
      <div className="absolute inset-6 border-2 border-white/70 rounded-lg pointer-events-none" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm">
          Starting camera…
        </div>
      )}
    </div>
  )
}
