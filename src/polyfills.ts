import { Buffer } from 'buffer'

// Polyfill Buffer for browser environment
// Required for bip32, bitcoinjs-lib, and other crypto libraries
declare global {
  interface Window {
    Buffer: typeof Buffer
  }
  // eslint-disable-next-line no-var
  var Buffer: typeof Buffer
}

// Set Buffer on all possible globals that libraries might access
if (typeof window !== 'undefined') {
  window.Buffer = Buffer
}
if (typeof globalThis !== 'undefined') {
  globalThis.Buffer = Buffer
}
if (typeof global !== 'undefined') {
  (global as typeof globalThis).Buffer = Buffer
}

export { Buffer }
