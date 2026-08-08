import { useState, useRef, useEffect, DragEvent } from 'react'
import { parsePsbt, getSignatureCount, isFullySigned, finalizePsbt } from '../lib/psbt'
import { PSBTDetails } from './PSBTDetails'
import { QRExportModal } from './qr/QRExportModal'
import { QRScanModal } from './qr/QRScanModal'

interface Props {
  psbt: string | null
  onPsbtChange: (psbt: string | null) => void
  signerName: string | null  // Who is connected (auto-detected from Ledger)
  signedBy: string[]         // Names of signers who have signed
  unsignedBy: string[]       // Names of signers who haven't signed
  onSign: () => Promise<void>
  onBroadcast: (txHex: string) => Promise<string>
  ledgerConnected: boolean
  ledgerBusy: boolean
  requiredSigners: number
}

export function PSBTPanel({
  psbt,
  onPsbtChange,
  signerName,
  signedBy,
  unsignedBy,
  onSign,
  onBroadcast,
  ledgerConnected,
  ledgerBusy,
  requiredSigners,
}: Props) {
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [signatureCount, setSignatureCount] = useState(0)
  const [fullySignedPsbt, setFullySignedPsbt] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showQRExport, setShowQRExport] = useState(false)
  const [showQRScan, setShowQRScan] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Parse PSBT and update signature info when psbt changes
  useEffect(() => {
    if (!psbt) {
      setSignatureCount(0)
      setFullySignedPsbt(false)
      setShowDetails(false)
      return
    }
    parsePsbt(psbt).then(parsed => {
      setSignatureCount(getSignatureCount(parsed))
      setFullySignedPsbt(isFullySigned(parsed, requiredSigners))
    }).catch(() => {
      setSignatureCount(0)
      setFullySignedPsbt(false)
    })
  }, [psbt, requiredSigners])

  // Check if connected signer has already signed
  const connectedSignerHasSigned = signerName && signedBy.includes(signerName)

  // Process file content (handles both binary and text formats)
  const processFileContent = async (file: File): Promise<string | null> => {
    // Try reading as text first (for base64/hex encoded PSBTs)
    const text = await file.text()
    try {
      await parsePsbt(text.trim())
      return text.trim()
    } catch {
      // Not a text PSBT, try binary
    }

    // Read as binary (ArrayBuffer)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    // Convert to base64
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    try {
      await parsePsbt(base64)
      return base64
    } catch {
      return null
    }
  }

  const handleFileUpload = async (file: File) => {
    setError(null)
    const psbtData = await processFileContent(file)
    if (psbtData) {
      onPsbtChange(psbtData)
      setImporting(false)
    } else {
      setError('Invalid PSBT file')
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      await handleFileUpload(files[0])
    }
  }

  const handleImport = async () => {
    setError(null)
    try {
      await parsePsbt(importText.trim())
      onPsbtChange(importText.trim())
      setImporting(false)
      setImportText('')
    } catch {
      setError('Invalid PSBT format')
    }
  }

  const handleExport = () => {
    if (!psbt) return
    const blob = new Blob([psbt], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `psbt-${signatureCount}of2.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = async () => {
    if (!psbt) return
    await navigator.clipboard.writeText(psbt)
  }

  const handleSign = async () => {
    setError(null)
    try {
      await onSign()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed')
    }
  }

  const handleBroadcast = async () => {
    console.log('handleBroadcast called, psbt:', !!psbt)
    if (!psbt) {
      console.log('No PSBT, returning early')
      return
    }

    setBroadcasting(true)
    setError(null)
    try {
      console.log('Parsing PSBT...')
      const parsed = await parsePsbt(psbt)
      console.log('Finalizing PSBT...')
      const txHex = finalizePsbt(parsed)
      console.log('Broadcasting tx:', txHex.slice(0, 50) + '...')
      const txid = await onBroadcast(txHex)
      console.log('Broadcast success, txid:', txid)
      setBroadcastResult(txid)
      onPsbtChange(null)
    } catch (err) {
      console.error('Broadcast error:', err)
      setError(err instanceof Error ? err.message : 'Broadcast failed')
    } finally {
      setBroadcasting(false)
    }
  }

  return (
    <div
      className={`card transition-colors ${isDragging ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h3 className="font-semibold mb-4">PSBT</h3>

      {!psbt && !importing && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-ink/20 hover:border-ink/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".psbt,.txt"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <div className="text-ink/60 mb-2">
              <svg className="w-12 h-12 mx-auto mb-3 text-ink/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="font-medium">Drop PSBT file here</p>
              <p className="text-sm">or click to browse</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary"
            >
              Choose File
            </button>
          </div>

          {/* Paste / scan options */}
          <div className="text-center space-y-2">
            <button
              onClick={() => setImporting(true)}
              className="text-sm text-ink/60 hover:text-ink underline block w-full"
            >
              Or paste PSBT text
            </button>
            <button
              onClick={() => setShowQRScan(true)}
              className="text-sm text-ink/60 hover:text-ink underline block w-full"
            >
              Or scan QR from signer
            </button>
          </div>
        </div>
      )}

      {importing && (
        <div className="space-y-3">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste PSBT (base64 or hex)..."
            className="mono h-32 w-full border border-ink/20 rounded p-3 text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleImport} className="btn-primary">
              Import
            </button>
            <button onClick={() => { setImporting(false); setImportText('') }} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {psbt && (
        <div className="space-y-4">
          <div className="bg-white border border-ink/10 rounded p-3 max-h-32 overflow-auto">
            <code className="mono text-xs break-all">{psbt.slice(0, 200)}...</code>
          </div>

          {/* Signature status with signer names */}
          <div className="bg-mist rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Signatures:</span>
              <span className={`font-bold ${fullySignedPsbt ? 'text-green-600' : 'text-ink'}`}>
                {signatureCount}/2
              </span>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              {signedBy.map(name => (
                <span key={name} className="bg-green-100 text-green-800 px-2 py-0.5 rounded">
                  {name} signed
                </span>
              ))}
              {unsignedBy.map(name => (
                <span key={name} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {name} pending
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={handleCopy} className="btn-secondary text-sm">
              Copy
            </button>
            <button onClick={handleExport} className="btn-secondary text-sm">
              Export
            </button>
            <button onClick={() => setShowQRExport(true)} className="btn-secondary text-sm">
              Show QR
            </button>
            <button onClick={() => setShowQRScan(true)} className="btn-secondary text-sm">
              Scan QR
            </button>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`btn-secondary text-sm ${showDetails ? 'bg-ink/10' : ''}`}
            >
              {showDetails ? 'Hide Details' : 'Details'}
            </button>
            <button onClick={() => onPsbtChange(null)} className="btn-secondary text-sm text-red-600">
              Clear
            </button>
          </div>

          {showDetails && (
            <div className="mt-4 pt-4 border-t border-ink/10">
              <PSBTDetails psbtBase64={psbt} />
            </div>
          )}

          <div className="pt-3 border-t border-ink/10 space-y-3">
            {!fullySignedPsbt && (
              <>
                {!ledgerConnected ? (
                  <p className="text-sm text-ink/60 text-center">
                    Connect your Ledger to sign
                  </p>
                ) : connectedSignerHasSigned ? (
                  <p className="text-sm text-green-600 text-center">
                    {signerName} has already signed. Share PSBT with {unsignedBy.join(', ')} to complete.
                  </p>
                ) : (
                  <button
                    onClick={handleSign}
                    disabled={ledgerBusy}
                    className="btn-primary w-full"
                  >
                    {ledgerBusy ? 'Signing...' : `Sign as ${signerName}`}
                  </button>
                )}
              </>
            )}

            {fullySignedPsbt && (
              <button
                onClick={handleBroadcast}
                disabled={broadcasting}
                className="btn-primary w-full bg-green-600 hover:bg-green-700"
              >
                {broadcasting ? 'Broadcasting...' : 'Broadcast Transaction'}
              </button>
            )}
          </div>

          {error && (
            <div className="text-red-600 text-sm">{error}</div>
          )}

          {broadcastResult && (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <p className="text-green-700 text-sm font-medium">Transaction broadcast!</p>
              <p className="mono text-xs text-green-600 break-all">{broadcastResult}</p>
            </div>
          )}
        </div>
      )}

      {error && !psbt && (
        <div className="text-red-600 text-sm mt-3">{error}</div>
      )}

      {showQRExport && psbt && (
        <QRExportModal psbt={psbt} onClose={() => setShowQRExport(false)} />
      )}
      {showQRScan && (
        <QRScanModal
          onClose={() => setShowQRScan(false)}
          onScanned={(scanned) => { onPsbtChange(scanned); setError(null) }}
        />
      )}
    </div>
  )
}
