import { useState, useEffect } from 'react'
import { parsePsbt, scriptToTaprootAddress } from '../lib/psbt'

interface PSBTDetailsProps {
  psbtBase64: string
}

interface ParsedInput {
  index: number
  prevTxid: string
  prevVout: number
  sequence: number
  witnessUtxo?: {
    value: number
    script: string
    address?: string
  }
  witnessScript?: {
    hex: string
    type: string
    m?: number
    n?: number
    pubkeys?: string[]
  }
  bip32Derivation?: Array<{
    masterFingerprint: string
    path: string
    pubkey: string
  }>
  partialSig?: Array<{
    pubkey: string
    signature: string
    sighashType: string
    valid?: boolean
  }>
}

interface ParsedOutput {
  index: number
  value: number
  script: string
  address?: string
  isChange: boolean
  bip32Derivation?: Array<{
    masterFingerprint: string
    path: string
    pubkey: string
  }>
}

interface ParsedPSBT {
  version: number
  locktime: number
  txid: string
  inputs: ParsedInput[]
  outputs: ParsedOutput[]
  totalInput: number
  totalOutput: number
  fee: number
}

// Parse witness script to extract multisig info
function parseWitnessScript(scriptHex: string): { type: string; m?: number; n?: number; pubkeys?: string[] } {
  const bytes = Buffer.from(scriptHex, 'hex')

  // Check for multisig pattern
  if (bytes[bytes.length - 1] === 0xae) { // OP_CHECKMULTISIG
    const m = bytes[0] - 0x50
    let offset = 1
    const pubkeys: string[] = []

    while (offset < bytes.length - 2) {
      const len = bytes[offset]
      if (len === 0x21) { // 33 bytes = compressed pubkey
        pubkeys.push(bytes.slice(offset + 1, offset + 1 + 33).toString('hex'))
        offset += 34
      } else if (len >= 0x51 && len <= 0x60) {
        break
      } else {
        break
      }
    }

    const n = bytes[offset] - 0x50
    return { type: 'multisig', m, n, pubkeys }
  }

  return { type: 'unknown' }
}

// Parse DER signature to get sighash type
function parseSighashType(sigHex: string): string {
  const bytes = Buffer.from(sigHex, 'hex')
  const sighash = bytes[bytes.length - 1]

  const types: Record<number, string> = {
    0x01: 'SIGHASH_ALL',
    0x02: 'SIGHASH_NONE',
    0x03: 'SIGHASH_SINGLE',
    0x81: 'SIGHASH_ALL|ANYONECANPAY',
    0x82: 'SIGHASH_NONE|ANYONECANPAY',
    0x83: 'SIGHASH_SINGLE|ANYONECANPAY',
  }

  return types[sighash] || `UNKNOWN (0x${sighash.toString(16)})`
}

// Format satoshis
function formatSats(sats: number): string {
  const btc = (sats / 100_000_000).toFixed(8)
  return `${sats.toLocaleString()} sats (${btc} BTC)`
}

// Truncate hex string
function truncateHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2) return hex
  return `${hex.slice(0, chars)}...${hex.slice(-chars)}`
}

export function PSBTDetails({ psbtBase64 }: PSBTDetailsProps) {
  const [parsed, setParsed] = useState<ParsedPSBT | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary']))

  useEffect(() => {
    async function parse() {
      try {
        const psbt = await parsePsbt(psbtBase64)
        const { Transaction, address, networks } = await import('bitcoinjs-lib')

        // Get unsigned transaction
        const txBuf = psbt.data.globalMap.unsignedTx.toBuffer()
        const tx = Transaction.fromBuffer(txBuf)

        // Parse inputs
        const inputs: ParsedInput[] = []
        for (let i = 0; i < psbt.inputCount; i++) {
          const input = psbt.data.inputs[i]
          const txIn = tx.ins[i]

          const parsedInput: ParsedInput = {
            index: i,
            prevTxid: Buffer.from(txIn.hash).reverse().toString('hex'),
            prevVout: txIn.index,
            sequence: txIn.sequence,
          }

          // Witness UTXO
          if (input.witnessUtxo) {
            parsedInput.witnessUtxo = {
              value: input.witnessUtxo.value,
              script: input.witnessUtxo.script.toString('hex'),
            }
            try {
              parsedInput.witnessUtxo.address = address.fromOutputScript(
                input.witnessUtxo.script,
                networks.bitcoin
              )
            } catch {}
          }

          // Witness Script
          if (input.witnessScript) {
            const scriptHex = input.witnessScript.toString('hex')
            parsedInput.witnessScript = {
              hex: scriptHex,
              ...parseWitnessScript(scriptHex)
            }
          }

          // BIP32 Derivation
          if (input.bip32Derivation) {
            parsedInput.bip32Derivation = input.bip32Derivation.map(d => ({
              masterFingerprint: d.masterFingerprint.toString('hex'),
              path: d.path,
              pubkey: d.pubkey.toString('hex'),
            }))
          }

          // Partial Signatures
          if (input.partialSig) {
            parsedInput.partialSig = input.partialSig.map(ps => {
              const sigHex = ps.signature.toString('hex')
              let valid: boolean | undefined
              try {
                valid = psbt.validateSignaturesOfInput(i, ps.pubkey)
              } catch {
                valid = false
              }
              return {
                pubkey: ps.pubkey.toString('hex'),
                signature: sigHex,
                sighashType: parseSighashType(sigHex),
                valid,
              }
            })
          }

          inputs.push(parsedInput)
        }

        // Parse outputs
        const outputs: ParsedOutput[] = []
        for (let i = 0; i < tx.outs.length; i++) {
          const output = psbt.data.outputs[i]
          const txOut = tx.outs[i]

          const parsedOutput: ParsedOutput = {
            index: i,
            value: txOut.value,
            script: txOut.script.toString('hex'),
            isChange: !!output.bip32Derivation,
          }

          try {
            parsedOutput.address = address.fromOutputScript(txOut.script, networks.bitcoin)
          } catch {
            // bitcoinjs-lib v5 doesn't support P2TR — decode manually
            const taprootAddr = scriptToTaprootAddress(txOut.script)
            if (taprootAddr) parsedOutput.address = taprootAddr
          }

          if (output.bip32Derivation) {
            parsedOutput.bip32Derivation = output.bip32Derivation.map(d => ({
              masterFingerprint: d.masterFingerprint.toString('hex'),
              path: d.path,
              pubkey: d.pubkey.toString('hex'),
            }))
          }

          outputs.push(parsedOutput)
        }

        // Calculate totals
        const totalInput = inputs.reduce((sum, inp) => sum + (inp.witnessUtxo?.value || 0), 0)
        const totalOutput = outputs.reduce((sum, out) => sum + out.value, 0)

        setParsed({
          version: psbt.version,
          locktime: psbt.locktime,
          txid: tx.getId(),
          inputs,
          outputs,
          totalInput,
          totalOutput,
          fee: totalInput - totalOutput,
        })
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to parse PSBT')
        setParsed(null)
      }
    }

    parse()
  }, [psbtBase64])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  if (error) {
    return <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>
  }

  if (!parsed) {
    return <div className="text-ink/50 dark:text-slate-400 dark:text-slate-400 text-sm">Loading...</div>
  }

  return (
    <div className="space-y-2 text-sm dark:text-slate-200">
      {/* Summary Section */}
      <div className="border border-ink/10 dark:border-slate-700 rounded overflow-hidden">
        <button
          onClick={() => toggleSection('summary')}
          className="w-full flex items-center justify-between p-3 bg-ink/5 dark:bg-slate-700 hover:bg-ink/10 dark:hover:bg-slate-600 transition-colors"
        >
          <span className="font-medium dark:text-slate-200">Summary</span>
          <span className="text-ink/40 dark:text-slate-500">{expandedSections.has('summary') ? '−' : '+'}</span>
        </button>
        {expandedSections.has('summary') && (
          <div className="p-3 space-y-2 bg-white dark:bg-slate-800">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-ink/50 dark:text-slate-400">TXID:</span>
                <div className="mono truncate" title={parsed.txid}>{truncateHex(parsed.txid, 12)}</div>
              </div>
              <div>
                <span className="text-ink/50 dark:text-slate-400">Version:</span>
                <div>{parsed.version}</div>
              </div>
              <div>
                <span className="text-ink/50 dark:text-slate-400">Lock Time:</span>
                <div>{parsed.locktime}</div>
              </div>
              <div>
                <span className="text-ink/50 dark:text-slate-400">Inputs/Outputs:</span>
                <div>{parsed.inputs.length} / {parsed.outputs.length}</div>
              </div>
            </div>
            <div className="border-t border-ink/10 dark:border-slate-700 pt-2 mt-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-ink/50 dark:text-slate-400">Total In:</span>
                <span className="mono">{formatSats(parsed.totalInput)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50 dark:text-slate-400">Total Out:</span>
                <span className="mono">{formatSats(parsed.totalOutput)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-ink/50 dark:text-slate-400">Fee:</span>
                <span className="mono">{formatSats(parsed.fee)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inputs Section */}
      {parsed.inputs.map((input, i) => (
        <div key={i} className="border border-ink/10 dark:border-slate-700 rounded overflow-hidden">
          <button
            onClick={() => toggleSection(`input-${i}`)}
            className="w-full flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
          >
            <span className="font-medium dark:text-slate-200">Input {i}</span>
            <div className="flex items-center gap-2">
              {input.witnessUtxo && (
                <span className="text-xs text-green-700 dark:text-green-400">{formatSats(input.witnessUtxo.value)}</span>
              )}
              <span className="text-ink/40 dark:text-slate-500">{expandedSections.has(`input-${i}`) ? '−' : '+'}</span>
            </div>
          </button>
          {expandedSections.has(`input-${i}`) && (
            <div className="p-3 space-y-3 bg-white dark:bg-slate-800 text-xs">
              {/* Outpoint */}
              <div>
                <div className="text-ink/50 dark:text-slate-400 mb-1">Outpoint</div>
                <div className="mono bg-ink/5 dark:bg-slate-700 p-2 rounded">
                  <div className="truncate" title={input.prevTxid}>{input.prevTxid}:{input.prevVout}</div>
                </div>
              </div>

              {/* Witness UTXO */}
              {input.witnessUtxo && (
                <div>
                  <div className="text-ink/50 dark:text-slate-400 mb-1">Witness UTXO</div>
                  <div className="bg-ink/5 dark:bg-slate-700 p-2 rounded space-y-1">
                    <div><span className="text-ink/50 dark:text-slate-400">Value:</span> {formatSats(input.witnessUtxo.value)}</div>
                    {input.witnessUtxo.address && (
                      <div className="mono truncate"><span className="text-ink/50 dark:text-slate-400">Address:</span> {input.witnessUtxo.address}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Witness Script */}
              {input.witnessScript && (
                <div>
                  <div className="text-ink/50 dark:text-slate-400 mb-1">Witness Script</div>
                  <div className="bg-ink/5 dark:bg-slate-700 p-2 rounded space-y-1">
                    {input.witnessScript.type === 'multisig' && (
                      <div className="font-medium text-blue-700 dark:text-blue-400">
                        {input.witnessScript.m}-of-{input.witnessScript.n} Multisig
                      </div>
                    )}
                    {input.witnessScript.pubkeys?.map((pk, j) => (
                      <div key={j} className="mono text-xs truncate dark:text-slate-300" title={pk}>
                        <span className="text-ink/40 dark:text-slate-500">{j}:</span> {pk}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BIP32 Derivation */}
              {input.bip32Derivation && (
                <div>
                  <div className="text-ink/50 dark:text-slate-400 mb-1">BIP32 Derivation</div>
                  <div className="space-y-2">
                    {input.bip32Derivation.map((d, j) => (
                      <div key={j} className="bg-ink/5 p-2 rounded">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs font-medium">
                            {d.masterFingerprint}
                          </span>
                          <span className="mono text-ink/70 dark:text-slate-300">{d.path}</span>
                        </div>
                        <div className="mono text-xs truncate text-ink/50 dark:text-slate-400" title={d.pubkey}>{d.pubkey}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Partial Signatures */}
              {input.partialSig && input.partialSig.length > 0 && (
                <div>
                  <div className="text-ink/50 dark:text-slate-400 mb-1">Signatures</div>
                  <div className="space-y-2">
                    {input.partialSig.map((sig, j) => (
                      <div key={j} className="bg-ink/5 dark:bg-slate-700 p-2 rounded">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            sig.valid ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
                          }`}>
                            {sig.valid ? 'VALID' : 'INVALID'}
                          </span>
                          <span className="text-ink/50 dark:text-slate-400">{sig.sighashType}</span>
                        </div>
                        <div className="mono text-xs truncate text-ink/50 dark:text-slate-400" title={sig.pubkey}>
                          Pubkey: {sig.pubkey}
                        </div>
                        <div className="mono text-xs truncate text-ink/50 dark:text-slate-400" title={sig.signature}>
                          Sig: {truncateHex(sig.signature, 16)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Outputs Section */}
      {parsed.outputs.map((output, i) => (
        <div key={i} className="border border-ink/10 dark:border-slate-700 rounded overflow-hidden">
          <button
            onClick={() => toggleSection(`output-${i}`)}
            className="w-full flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium dark:text-slate-200">Output {i}</span>
              {output.isChange && (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded">change</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-700 dark:text-blue-400">{formatSats(output.value)}</span>
              <span className="text-ink/40 dark:text-slate-500">{expandedSections.has(`output-${i}`) ? '−' : '+'}</span>
            </div>
          </button>
          {expandedSections.has(`output-${i}`) && (
            <div className="p-3 space-y-2 bg-white dark:bg-slate-800 text-xs">
              <div>
                <span className="text-ink/50 dark:text-slate-400">Value:</span>
                <span className="ml-2 mono">{formatSats(output.value)}</span>
              </div>
              {output.address && (
                <div>
                  <span className="text-ink/50 dark:text-slate-400">Address:</span>
                  <div className="mono bg-ink/5 dark:bg-slate-700 p-2 rounded mt-1 truncate" title={output.address}>
                    {output.address}
                  </div>
                </div>
              )}
              {output.bip32Derivation && (
                <div>
                  <div className="text-ink/50 dark:text-slate-400 mb-1">BIP32 Derivation (Change)</div>
                  <div className="space-y-1">
                    {output.bip32Derivation.map((d, j) => (
                      <div key={j} className="bg-ink/5 dark:bg-slate-700 p-2 rounded">
                        <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs font-medium">
                          {d.masterFingerprint}
                        </span>
                        <span className="mono text-ink/70 dark:text-slate-300 ml-2">{d.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
