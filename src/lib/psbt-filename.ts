// A PSBT file name someone can read at a glance when it lands in Downloads or a chat:
//   Vault-send-0.5btc-to-Alice-signed-1of2-2026-10-21-1239.psbt

export interface PsbtFilenameInput {
  walletName: string
  // Destination outputs (change already excluded)
  payments: Array<{ address?: string; amount: number; label?: string }>
  signed: number
  required: number
  now?: Date
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

/** 99184 -> "0.00099184", 50000000 -> "0.5" */
export function btcAmount(sats: number): string {
  return (sats / 1e8).toFixed(8).replace(/\.?0+$/, '')
}

/** bc1q2pkr9x4y…ls7g9 -> "bc1q2p-ls7g9" */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}-${address.slice(-5)}`
}

export function psbtFilename({ walletName, payments, signed, required, now = new Date() }: PsbtFilenameInput): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`

  const total = payments.reduce((sum, p) => sum + p.amount, 0)
  const main = [...payments].sort((a, b) => b.amount - a.amount)[0]
  const to = main
    ? slug(main.label || (main.address ? shortAddress(main.address) : 'unknown')) + (payments.length > 1 ? `-and-${payments.length - 1}-more` : '')
    : 'self'

  const status = signed === 0 ? 'unsigned' : signed >= required ? 'fully-signed' : `signed-${signed}of${required}`
  return `${slug(walletName) || 'wallet'}-send-${btcAmount(total)}btc-to-${to}-${status}-${stamp}.psbt`
}
