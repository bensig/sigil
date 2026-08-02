#!/usr/bin/env node

/**
 * PSBT Inspector - Dissect and analyze PSBTs
 *
 * Usage:
 *   node tools/psbt-inspect.js <file.psbt>
 *   node tools/psbt-inspect.js <base64-string>
 *   cat file.psbt | node tools/psbt-inspect.js
 */

import fs from 'fs'
import * as bitcoin from 'bitcoinjs-lib'
import { stdin, stdout, argv, exit } from 'process'

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

const c = (color, text) => `${colors[color]}${text}${colors.reset}`

// Helper to format hex with optional truncation
function hex(buffer, maxLen = 0) {
  if (!buffer) return c('dim', 'null')
  const h = Buffer.isBuffer(buffer) ? buffer.toString('hex') : buffer
  if (maxLen && h.length > maxLen * 2) {
    return `${h.slice(0, maxLen)}...${h.slice(-maxLen)}`
  }
  return h
}

// Helper to format satoshis
function formatSats(sats) {
  const btc = (sats / 100_000_000).toFixed(8)
  return `${sats.toLocaleString()} sats (${btc} BTC)`
}

// Parse witness script to show structure
function parseWitnessScript(script) {
  if (!script) return null

  const result = { type: 'unknown', details: {} }
  const bytes = Buffer.isBuffer(script) ? script : Buffer.from(script, 'hex')

  // Check for multisig pattern: OP_M <pubkeys...> OP_N OP_CHECKMULTISIG
  if (bytes[bytes.length - 1] === 0xae) { // OP_CHECKMULTISIG
    const m = bytes[0] - 0x50 // OP_1 = 0x51, so subtract 0x50
    let offset = 1
    const pubkeys = []

    while (offset < bytes.length - 2) {
      const len = bytes[offset]
      if (len === 0x21) { // 33 bytes = compressed pubkey
        pubkeys.push(bytes.slice(offset + 1, offset + 1 + 33).toString('hex'))
        offset += 34
      } else if (len >= 0x51 && len <= 0x60) { // OP_1 through OP_16
        break
      } else {
        break
      }
    }

    const n = bytes[offset] - 0x50

    result.type = 'multisig'
    result.details = { m, n, pubkeys }
  }

  return result
}

// Parse BIP32 derivation path
function formatPath(path) {
  return path || 'unknown'
}

// Decode a DER signature
function parseSignature(sig) {
  if (!sig) return null
  const bytes = Buffer.isBuffer(sig) ? sig : Buffer.from(sig, 'hex')

  // DER format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s] [sighash]
  const result = {
    raw: bytes.toString('hex'),
    length: bytes.length,
  }

  if (bytes[0] === 0x30) {
    const totalLen = bytes[1]
    let offset = 2

    if (bytes[offset] === 0x02) {
      const rLen = bytes[offset + 1]
      result.r = bytes.slice(offset + 2, offset + 2 + rLen).toString('hex')
      offset += 2 + rLen
    }

    if (bytes[offset] === 0x02) {
      const sLen = bytes[offset + 1]
      result.s = bytes.slice(offset + 2, offset + 2 + sLen).toString('hex')
      offset += 2 + sLen
    }

    if (offset < bytes.length) {
      result.sighash = bytes[offset]
      result.sighashType = {
        0x01: 'SIGHASH_ALL',
        0x02: 'SIGHASH_NONE',
        0x03: 'SIGHASH_SINGLE',
        0x81: 'SIGHASH_ALL|ANYONECANPAY',
        0x82: 'SIGHASH_NONE|ANYONECANPAY',
        0x83: 'SIGHASH_SINGLE|ANYONECANPAY',
      }[bytes[offset]] || `UNKNOWN (0x${bytes[offset].toString(16)})`
    }
  }

  return result
}

// Main inspection function
function inspectPsbt(psbtData) {
  let psbt
  let base64Data

  // Convert Buffer to string if it's text content (base64/hex)
  let data = psbtData
  if (Buffer.isBuffer(psbtData)) {
    // Check if it's binary PSBT (starts with 'psbt' magic: 0x70 0x73 0x62 0x74)
    if (psbtData[0] === 0x70 && psbtData[1] === 0x73 && psbtData[2] === 0x62 && psbtData[3] === 0x74) {
      // Binary PSBT
      base64Data = psbtData.toString('base64')
      try {
        psbt = bitcoin.Psbt.fromBuffer(psbtData)
      } catch (e) {
        console.error(c('red', `Failed to parse binary PSBT: ${e.message}`))
        process.exit(1)
      }
    } else {
      // Likely text content (base64 or hex), convert to string
      data = psbtData.toString('utf8').trim()
    }
  }

  // If not already parsed as binary, try text formats
  if (!psbt && typeof data === 'string') {
    try {
      // Try base64 first
      psbt = bitcoin.Psbt.fromBase64(data)
      base64Data = data
    } catch {
      try {
        // Try hex
        psbt = bitcoin.Psbt.fromHex(data)
        base64Data = Buffer.from(data, 'hex').toString('base64')
      } catch (e) {
        console.error(c('red', `Failed to parse PSBT: ${e.message}`))
        process.exit(1)
      }
    }
  }

  if (!psbt) {
    console.error(c('red', 'Failed to parse PSBT: Unknown format'))
    process.exit(1)
  }

  console.log(c('bright', '\n═══════════════════════════════════════════════════════════════'))
  console.log(c('bright', '                        PSBT INSPECTOR                          '))
  console.log(c('bright', '═══════════════════════════════════════════════════════════════\n'))

  // Global info
  console.log(c('cyan', '┌─ GLOBAL ─────────────────────────────────────────────────────┐'))
  console.log(`│ ${c('yellow', 'Version:')}        ${psbt.version}`)
  console.log(`│ ${c('yellow', 'Lock Time:')}      ${psbt.locktime}`)
  console.log(`│ ${c('yellow', 'Input Count:')}    ${psbt.inputCount}`)
  console.log(`│ ${c('yellow', 'Output Count:')}   ${psbt.txOutputs.length}`)
  console.log(`│ ${c('yellow', 'Base64 Length:')}  ${base64Data.length} chars`)
  console.log(c('cyan', '└──────────────────────────────────────────────────────────────┘\n'))

  // Transaction
  const tx = psbt.data.globalMap.unsignedTx
  if (tx) {
    const txBuf = tx.toBuffer()
    const txObj = bitcoin.Transaction.fromBuffer(txBuf)
    console.log(c('cyan', '┌─ UNSIGNED TRANSACTION ───────────────────────────────────────┐'))
    console.log(`│ ${c('yellow', 'TXID:')}       ${txObj.getId()}`)
    console.log(`│ ${c('yellow', 'Version:')}    ${txObj.version}`)
    console.log(`│ ${c('yellow', 'Lock Time:')} ${txObj.locktime}`)
    console.log(`│ ${c('yellow', 'Size:')}       ${txBuf.length} bytes`)
    console.log(c('cyan', '└──────────────────────────────────────────────────────────────┘\n'))
  }

  // Inputs
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    const txInput = psbt.txInputs[i]

    console.log(c('green', `┌─ INPUT ${i} ${'─'.repeat(55 - i.toString().length)}┐`))

    // Outpoint
    const prevTxid = Buffer.from(txInput.hash).reverse().toString('hex')
    console.log(`│ ${c('yellow', 'Previous TXID:')}  ${prevTxid}`)
    console.log(`│ ${c('yellow', 'Previous Vout:')}  ${txInput.index}`)
    console.log(`│ ${c('yellow', 'Sequence:')}       0x${txInput.sequence.toString(16)} (${txInput.sequence})`)

    // Witness UTXO
    if (input.witnessUtxo) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Witness UTXO ──')}`)
      console.log(`│ ${c('yellow', 'Value:')}          ${formatSats(input.witnessUtxo.value)}`)
      console.log(`│ ${c('yellow', 'ScriptPubKey:')}   ${input.witnessUtxo.script.toString('hex')}`)

      // Try to decode the address
      try {
        const addr = bitcoin.address.fromOutputScript(input.witnessUtxo.script, bitcoin.networks.bitcoin)
        console.log(`│ ${c('yellow', 'Address:')}        ${addr}`)
      } catch {}
    }

    // Non-witness UTXO
    if (input.nonWitnessUtxo) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Non-Witness UTXO ──')}`)
      const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo)
      console.log(`│ ${c('yellow', 'Prev TX ID:')}     ${prevTx.getId()}`)
      console.log(`│ ${c('yellow', 'Prev TX Size:')}   ${input.nonWitnessUtxo.length} bytes`)
      console.log(`│ ${c('yellow', 'Prev Outputs:')}   ${prevTx.outs.length}`)
    }

    // Witness Script
    if (input.witnessScript) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Witness Script ──')}`)
      console.log(`│ ${c('yellow', 'Hex:')}            ${hex(input.witnessScript, 32)}`)
      console.log(`│ ${c('yellow', 'Length:')}         ${input.witnessScript.length} bytes`)

      const parsed = parseWitnessScript(input.witnessScript)
      if (parsed && parsed.type === 'multisig') {
        console.log(`│ ${c('yellow', 'Type:')}           ${parsed.details.m}-of-${parsed.details.n} Multisig`)
        console.log(`│ ${c('yellow', 'Pubkeys:')}`)
        parsed.details.pubkeys.forEach((pk, j) => {
          console.log(`│   ${j}: ${pk}`)
        })
      }
    }

    // Redeem Script
    if (input.redeemScript) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Redeem Script ──')}`)
      console.log(`│ ${c('yellow', 'Hex:')}            ${hex(input.redeemScript, 32)}`)
    }

    // BIP32 Derivation
    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── BIP32 Derivation ──')}`)
      for (const deriv of input.bip32Derivation) {
        console.log(`│ ${c('yellow', 'Master FP:')}      ${deriv.masterFingerprint.toString('hex')}`)
        console.log(`│ ${c('yellow', 'Path:')}           ${deriv.path}`)
        console.log(`│ ${c('yellow', 'Pubkey:')}         ${deriv.pubkey.toString('hex')}`)
        console.log(`│`)
      }
    }

    // Partial Signatures
    if (input.partialSig && input.partialSig.length > 0) {
      console.log(`│ ${c('magenta', '── Partial Signatures ──')}`)
      for (const ps of input.partialSig) {
        const sig = parseSignature(ps.signature)
        console.log(`│ ${c('yellow', 'Pubkey:')}         ${ps.pubkey.toString('hex')}`)
        console.log(`│ ${c('yellow', 'Signature:')}      ${hex(ps.signature, 32)}`)
        console.log(`│ ${c('yellow', 'Sig Length:')}     ${ps.signature.length} bytes`)
        if (sig.sighashType) {
          console.log(`│ ${c('yellow', 'Sighash Type:')}   ${sig.sighashType}`)
        }
        if (sig.r) {
          console.log(`│ ${c('yellow', 'R:')}              ${sig.r}`)
          console.log(`│ ${c('yellow', 'S:')}              ${sig.s}`)
        }
        console.log(`│`)
      }
    }

    // Sighash type
    if (input.sighashType !== undefined) {
      console.log(`│ ${c('yellow', 'Sighash Type:')}   ${input.sighashType}`)
    }

    // Final script witness
    if (input.finalScriptWitness) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Final Script Witness ──')}`)
      console.log(`│ ${c('yellow', 'Hex:')}            ${hex(input.finalScriptWitness, 32)}`)
    }

    console.log(c('green', `└${'─'.repeat(62)}┘\n`))
  }

  // Outputs
  for (let i = 0; i < psbt.txOutputs.length; i++) {
    const output = psbt.data.outputs[i]
    const txOutput = psbt.txOutputs[i]

    console.log(c('blue', `┌─ OUTPUT ${i} ${'─'.repeat(54 - i.toString().length)}┐`))
    console.log(`│ ${c('yellow', 'Value:')}          ${formatSats(txOutput.value)}`)
    console.log(`│ ${c('yellow', 'Script:')}         ${txOutput.script.toString('hex')}`)

    // Try to decode address
    try {
      const addr = bitcoin.address.fromOutputScript(txOutput.script, bitcoin.networks.bitcoin)
      console.log(`│ ${c('yellow', 'Address:')}        ${addr}`)
    } catch {}

    // Redeem Script
    if (output.redeemScript) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Redeem Script ──')}`)
      console.log(`│ ${c('yellow', 'Hex:')}            ${hex(output.redeemScript, 32)}`)
    }

    // Witness Script
    if (output.witnessScript) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── Witness Script ──')}`)
      console.log(`│ ${c('yellow', 'Hex:')}            ${hex(output.witnessScript, 32)}`)

      const parsed = parseWitnessScript(output.witnessScript)
      if (parsed && parsed.type === 'multisig') {
        console.log(`│ ${c('yellow', 'Type:')}           ${parsed.details.m}-of-${parsed.details.n} Multisig`)
      }
    }

    // BIP32 Derivation
    if (output.bip32Derivation && output.bip32Derivation.length > 0) {
      console.log(`│`)
      console.log(`│ ${c('magenta', '── BIP32 Derivation (Change Output) ──')}`)
      for (const deriv of output.bip32Derivation) {
        console.log(`│ ${c('yellow', 'Master FP:')}      ${deriv.masterFingerprint.toString('hex')}`)
        console.log(`│ ${c('yellow', 'Path:')}           ${deriv.path}`)
        console.log(`│ ${c('yellow', 'Pubkey:')}         ${deriv.pubkey.toString('hex')}`)
        console.log(`│`)
      }
    }

    console.log(c('blue', `└${'─'.repeat(62)}┘\n`))
  }

  // Summary
  console.log(c('cyan', '┌─ SUMMARY ─────────────────────────────────────────────────────┐'))

  // Count signatures
  let totalSigs = 0
  let requiredSigs = 0
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    const sigs = input.partialSig?.length || 0
    totalSigs += sigs

    // Try to determine required sigs from witnessScript
    if (input.witnessScript) {
      const parsed = parseWitnessScript(input.witnessScript)
      if (parsed && parsed.type === 'multisig') {
        requiredSigs = Math.max(requiredSigs, parsed.details.m)
      }
    }
  }

  console.log(`│ ${c('yellow', 'Total Signatures:')}     ${totalSigs}`)
  if (requiredSigs > 0) {
    console.log(`│ ${c('yellow', 'Required Signatures:')} ${requiredSigs}`)
    const isComplete = totalSigs >= requiredSigs * psbt.inputCount
    console.log(`│ ${c('yellow', 'Status:')}              ${isComplete ? c('green', 'READY TO BROADCAST') : c('yellow', 'NEEDS MORE SIGNATURES')}`)
  }

  // Calculate total amounts
  let totalInput = 0
  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    if (input.witnessUtxo) {
      totalInput += input.witnessUtxo.value
    }
  }

  let totalOutput = 0
  for (const out of psbt.txOutputs) {
    totalOutput += out.value
  }

  const fee = totalInput - totalOutput

  if (totalInput > 0) {
    console.log(`│`)
    console.log(`│ ${c('yellow', 'Total Input:')}   ${formatSats(totalInput)}`)
    console.log(`│ ${c('yellow', 'Total Output:')}  ${formatSats(totalOutput)}`)
    console.log(`│ ${c('yellow', 'Fee:')}           ${formatSats(fee)}`)
    console.log(`│ ${c('yellow', 'Fee Rate:')}      ~${(fee / 150).toFixed(1)} sat/vB (estimated)`)
  }

  console.log(c('cyan', '└──────────────────────────────────────────────────────────────┘\n'))

  // Validation
  console.log(c('cyan', '┌─ VALIDATION ──────────────────────────────────────────────────┐'))

  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i]
    if (input.partialSig) {
      for (const ps of input.partialSig) {
        try {
          const valid = psbt.validateSignaturesOfInput(i, ps.pubkey)
          const pubkeyShort = ps.pubkey.toString('hex').slice(0, 16)
          console.log(`│ Input ${i}, ${pubkeyShort}...: ${valid ? c('green', 'VALID') : c('red', 'INVALID')}`)
        } catch (e) {
          const pubkeyShort = ps.pubkey.toString('hex').slice(0, 16)
          console.log(`│ Input ${i}, ${pubkeyShort}...: ${c('red', `ERROR: ${e.message}`)}`)
        }
      }
    }
  }

  console.log(c('cyan', '└──────────────────────────────────────────────────────────────┘\n'))
}

// Main
async function main() {
  let input

  if (argv[2]) {
    // Argument provided - could be file path or base64 string
    const arg = argv[2]

    if (fs.existsSync(arg)) {
      // It's a file
      input = fs.readFileSync(arg)
    } else {
      // Assume it's a base64 string
      input = arg
    }
  } else {
    // Read from stdin
    const chunks = []
    stdin.setEncoding('utf8')
    for await (const chunk of stdin) {
      chunks.push(chunk)
    }
    input = chunks.join('').trim()
  }

  if (!input || input.length === 0) {
    console.log('Usage:')
    console.log('  node tools/psbt-inspect.js <file.psbt>')
    console.log('  node tools/psbt-inspect.js <base64-string>')
    console.log('  cat file.psbt | node tools/psbt-inspect.js')
    exit(1)
  }

  inspectPsbt(input)
}

main().catch(e => {
  console.error(c('red', `Error: ${e.message}`))
  exit(1)
})
