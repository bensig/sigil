import { useState, useRef, DragEvent } from 'react'
import { parsePsbt } from '../lib/psbt'

interface Props {
  onPsbtLoad: (psbt: string) => void
  disabled?: boolean
}

export function PSBTImport({ onPsbtLoad, disabled = false }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importText, setImportText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFileContent = async (file: File): Promise<string | null> => {
    const text = await file.text()
    try {
      await parsePsbt(text.trim())
      return text.trim()
    } catch {
      // fallback to binary base64
    }

    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    bytes.forEach(b => {
      binary += String.fromCharCode(b)
    })
    const base64 = btoa(binary)
    try {
      await parsePsbt(base64)
      return base64
    } catch {
      return null
    }
  }

  const handleFile = async (file: File) => {
    if (!file) return
    const psbtData = await processFileContent(file)
    if (psbtData) {
      onPsbtLoad(psbtData)
      setError(null)
      setImportText('')
    } else {
      setError('Invalid PSBT file')
    }
  }

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleTextImport = async () => {
    if (!importText.trim()) return
    try {
      await parsePsbt(importText.trim())
      onPsbtLoad(importText.trim())
      setImportText('')
      setError(null)
    } catch {
      setError('Invalid PSBT format')
    }
  }

  return (
    <div className={`card ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <h3 className="font-semibold mb-4 dark:text-white">Import PSBT to Sign</h3>
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-ink/20 hover:border-ink/40 dark:border-slate-600 dark:hover:border-slate-500'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".psbt,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        <div className="text-ink/60 dark:text-slate-400 mb-3">
          <svg className="w-12 h-12 mx-auto mb-3 text-ink/30 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="font-medium dark:text-slate-200">Drag & drop PSBT file here</p>
          <p className="text-sm dark:text-slate-400">or click to browse</p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose File
        </button>
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium block mb-1 dark:text-slate-200">Paste PSBT</label>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste PSBT (base64 or hex)..."
          className="w-full mono text-xs"
          rows={3}
        />
        <div className="flex justify-end mt-2">
          <button className="btn-secondary text-xs" onClick={handleTextImport}>
            Load from Text
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
    </div>
  )
}
