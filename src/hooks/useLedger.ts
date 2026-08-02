import { useState, useCallback } from 'react'
import type { WalletConfig } from '../types'

type LedgerStatus = 'disconnected' | 'connecting' | 'connected' | 'signing' | 'error'

interface LedgerState {
  status: LedgerStatus
  error: string | null
  xfp: string | null  // Master fingerprint of connected device
}

async function closeOpenUsbDevices() {
  if (typeof navigator === 'undefined') return
  const usbNavigator = navigator as Navigator & {
    usb?: {
      getDevices?: () => Promise<Array<{ opened?: boolean; close?: () => Promise<void> }>>
    }
  }

  try {
    const devices = await usbNavigator.usb?.getDevices?.()
    if (!devices?.length) return

    await Promise.all(
      devices.map(async device => {
        if (device.opened && typeof device.close === 'function') {
          try {
            await device.close()
          } catch (closeError) {
            console.warn('Failed to close USB device', closeError)
          }
        }
      })
    )
  } catch (usbError) {
    console.warn('Failed to reset USB connections', usbError)
  }
}

export function useLedger() {
  const [state, setState] = useState<LedgerState>({
    status: 'disconnected',
    error: null,
    xfp: null,
  })

  const connect = useCallback(async (bip32Path: string) => {
    setState({ status: 'connecting', error: null, xfp: null })

    const attemptConnection = async (allowRetry: boolean): Promise<{ xfp: string | null }> => {
      try {
        // Export extended public key which includes the fingerprint
        const { LedgerExportExtendedPublicKey } = await import('@caravan/wallets')
        const { Network } = await import('@caravan/bitcoin')

        // Get the xpub at the multisig path - this includes the xfp
        const interaction = new LedgerExportExtendedPublicKey({
          bip32Path,
          network: Network.MAINNET,
          includeXFP: true,
        })

        const result = await interaction.run()

        // The result includes rootFingerprint (xfp) when includeXFP is true
        const xfp = typeof result === 'object' ? result.rootFingerprint : null
        console.log('Connected Ledger with xfp:', xfp)

        setState({
          status: 'connected',
          error: null,
          xfp,
        })

        return { xfp }
      } catch (error) {
        let message = error instanceof Error ? error.message : 'Failed to connect'
        const channelIssue = message.includes('Invalid channel') || message.includes('Cannot write to HID device')

        console.error('Ledger connection error', error)

        if (channelIssue && allowRetry) {
          await closeOpenUsbDevices()
          return attemptConnection(false)
        }

        // Provide helpful error messages
        if (message.includes('CLA_NOT_SUPPORTED') || message.includes('6e00')) {
          message = 'Please open the Bitcoin app on your Ledger device'
        } else if (channelIssue) {
          message = 'Connection lost. Close this browser tab, unplug Ledger, wait 5 seconds, plug back in, then open a new tab.'
        } else if (message.includes('denied') || message.includes('rejected')) {
          message = 'Connection was denied. Please approve the connection on your Ledger.'
        } else if (message.includes('No device selected')) {
          message = 'No Ledger device selected. Please try again and select your device.'
        } else if (message.includes('locked') || message.includes('0x5515')) {
          message = 'Ledger is locked. Please unlock it and open the Bitcoin app.'
        }

        setState({ status: 'error', error: message, xfp: null })
        throw new Error(message)
      }
    }

    return attemptConnection(true)
  }, [])

  const signPsbt = useCallback(async (
    psbtBase64: string,
    config: WalletConfig,
    keyInfo: { xfp: string; bip32Path: string; name: string }
  ): Promise<string> => {
    setState(s => ({ ...s, status: 'signing', error: null }))

    const performSigning = async () => {
      const { SignMultisigTransaction, LEDGER } = await import('@caravan/wallets')
      const { Network, P2WSH } = await import('@caravan/bitcoin')

      const network = config.network === 'mainnet' ? Network.MAINNET : Network.TESTNET

      // Build wallet config matching Caravan's MultisigWalletConfig interface
      const walletConfig = {
        name: config.name,
        addressType: P2WSH,
        network,
        quorum: {
          requiredSigners: config.quorum.requiredSigners,
          totalSigners: config.quorum.totalSigners,
        },
        extendedPublicKeys: config.extendedPublicKeys.map(k => ({
          name: k.name,
          xfp: k.xfp,
          bip32Path: k.bip32Path,
          xpub: k.xpub,
        })),
      }

      console.log('=== LEDGER SIGNING DEBUG ===')
      console.log('Connected Ledger XFP:', state.xfp)
      console.log('KeyInfo XFP:', keyInfo.xfp)
      console.log('XFP match:', state.xfp?.toLowerCase() === keyInfo.xfp.toLowerCase())
      console.log('KeyInfo:', JSON.stringify(keyInfo, null, 2))
      console.log('WalletConfig:', JSON.stringify(walletConfig, null, 2))

      // Log the expected key order after sorting (Caravan sorts by xpub)
      const sortedKeys = [...walletConfig.extendedPublicKeys].sort((a, b) =>
        a.xpub.localeCompare(b.xpub)
      )
      console.log('Keys after sorting by xpub (policy order):')
      sortedKeys.forEach((k, i) => {
        console.log(`  @${i}: ${k.name} (xfp: ${k.xfp}) - xpub starts: ${k.xpub.slice(0, 20)}...`)
      })

      console.log('Expected policy template: wsh(sortedmulti(2,@0/**,@1/**))')
      console.log('PSBT (first 200 chars):', psbtBase64.slice(0, 200))

      // Decode PSBT and log bip32Derivation details
      try {
        const { Psbt } = await import('bitcoinjs-lib')
        const psbt = Psbt.fromBase64(psbtBase64)
        console.log('PSBT inputs:', psbt.inputCount)
        for (let i = 0; i < psbt.inputCount; i++) {
          const input = psbt.data.inputs[i]
          console.log(`Input ${i} bip32Derivation:`)
          if (input.bip32Derivation) {
            for (const deriv of input.bip32Derivation) {
              console.log(`  - XFP: ${deriv.masterFingerprint.toString('hex')}, Path: ${deriv.path}, Pubkey: ${deriv.pubkey.toString('hex').slice(0, 16)}...`)
            }
          }
          console.log(`Input ${i} witnessUtxo:`, input.witnessUtxo ? 'present' : 'missing')
          console.log(`Input ${i} witnessScript:`, input.witnessScript ? 'present' : 'missing')
        }
        console.log('PSBT outputs:', psbt.txOutputs.length)
        for (let i = 0; i < psbt.txOutputs.length; i++) {
          const output = psbt.data.outputs[i]
          const txOutput = psbt.txOutputs[i]
          console.log(`Output ${i}: ${(txOutput as { value?: number }).value || 'unknown'} sats to ${txOutput.address}`)
          console.log(`  hasWitnessScript: ${!!output.witnessScript}`)
          console.log(`  hasBip32Derivation: ${!!output.bip32Derivation}`)
          if (output.bip32Derivation) {
            for (const deriv of output.bip32Derivation) {
              console.log(`  - XFP: ${deriv.masterFingerprint.toString('hex')}, Path: ${deriv.path}, Pubkey: ${deriv.pubkey.toString('hex').slice(0, 16)}...`)
            }
          }
        }
      } catch (e) {
        console.log('Could not decode PSBT:', e)
      }

      // Use Caravan SignMultisigTransaction for signing
      // Note: External PSBTs (from BlueWallet/Sparrow) may have signing issues
      // due to Caravan's PSBT v2 conversion. Use Sparrow for external PSBT signing.
      const interaction = SignMultisigTransaction({
        keystore: LEDGER,
        network,
        psbt: psbtBase64,
        keyDetails: {
          xfp: keyInfo.xfp,
          path: keyInfo.bip32Path,
        },
        returnSignatureArray: false,
        walletConfig,
      })

      console.log('Calling Caravan SignMultisigTransaction...')
      const signedPsbt = await interaction.run()
      console.log('Signing complete!')

      // Validate the signature was added correctly
      const { Psbt } = await import('bitcoinjs-lib')
      const resultPsbt = Psbt.fromBase64(signedPsbt as string)
      const input = resultPsbt.data.inputs[0]
      if (input.partialSig) {
        for (const ps of input.partialSig) {
          const pubkeyHex = ps.pubkey.toString('hex').slice(0, 16)
          try {
            const valid = resultPsbt.validateSignaturesOfInput(0, ps.pubkey)
            console.log(`Signature for ${pubkeyHex}... valid: ${valid}`)
            if (!valid) {
              console.warn('WARNING: Signature validation failed. This may be an external PSBT.')
              console.warn('Consider using Sparrow to sign external PSBTs from BlueWallet.')
            }
          } catch (e) {
            console.log(`Signature validation error for ${pubkeyHex}...:`, e)
          }
        }
      }

      return signedPsbt as string
    }

    const signWithRetry = async (allowRetry: boolean): Promise<string> => {
      try {
        return await performSigning()
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const channelIssue = message.includes('Invalid channel') || message.includes('Cannot write to HID device')

        if (channelIssue && allowRetry) {
          console.warn('Ledger signing lost channel, retrying once...')
          await closeOpenUsbDevices()
          return signWithRetry(false)
        }
        throw error
      }
    }

    try {
      const signedPsbt = await signWithRetry(true)
      setState(s => ({ ...s, status: 'connected', error: null }))
      return signedPsbt
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Failed to sign'
      console.error('Ledger signing error:', error)

      if (message.includes('CLA_NOT_SUPPORTED') || message.includes('6e00')) {
        message = 'Please open the Bitcoin app on your Ledger device'
      } else if (message.includes('denied') || message.includes('rejected') || message.includes('6985')) {
        message = 'Transaction was rejected on the Ledger device'
      } else if (message.includes('not supported') && message.includes('version')) {
        message = 'Please update your Ledger Bitcoin app to the latest version via Ledger Live'
      } else if (message.includes('Invalid channel') || message.includes('Cannot write to HID device')) {
        message = 'Connection lost during signing. Close this browser tab, unplug Ledger, wait 5 seconds, plug back in, then open a new tab.'
      }

      setState(s => ({ ...s, status: 'error', error: message }))
      throw new Error(message)
    }
  }, [state.xfp])

  const disconnect = useCallback(() => {
    setState({ status: 'disconnected', error: null, xfp: null })
    closeOpenUsbDevices().catch(err => console.warn('Failed to fully disconnect Ledger', err))
  }, [])

  // Identify which signer this Ledger belongs to based on xfp
  const identifySigner = useCallback((configs: { name: string; config: WalletConfig }[]): string | null => {
    if (!state.xfp) return null

    for (const { name, config } of configs) {
      const ledgerKey = config.extendedPublicKeys.find(k => k.method === 'ledger')
      if (ledgerKey && ledgerKey.xfp.toLowerCase() === state.xfp.toLowerCase()) {
        return name
      }
    }
    return null
  }, [state.xfp])

  return {
    ...state,
    connect,
    signPsbt,
    disconnect,
    identifySigner,
    isConnected: state.status === 'connected',
    isBusy: state.status === 'connecting' || state.status === 'signing',
  }
}
