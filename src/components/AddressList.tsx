import type { AddressInfo } from '../types'

interface Props {
  addresses: AddressInfo[]
  loading: boolean
  satsToBtc: (sats: number) => string
  satsToUsd: (sats: number) => string | null
}

export function AddressList({ addresses, loading, satsToBtc, satsToUsd }: Props) {
  // Only show addresses with balance
  const usedAddresses = addresses.filter(a => a.balance > 0)

  if (loading) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-3">Funded Addresses</h3>
        <p className="text-sm text-ink/50">Scanning...</p>
      </div>
    )
  }

  if (usedAddresses.length === 0) {
    return null // Don't show section if no funded addresses
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Funded Addresses</h3>

      <div className="space-y-2">
        {usedAddresses.map((addr) => (
          <div
            key={addr.address}
            className="flex items-center justify-between py-2 border-b border-ink/5 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <a
                href={`https://mempool.space/address/${addr.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-sm text-blue-600 hover:underline"
              >
                {addr.address.slice(0, 12)}...{addr.address.slice(-8)}
              </a>
              <span className="text-xs text-ink/50 ml-2">{addr.path}</span>
            </div>

            <div className="text-right">
              <span className="font-medium">{satsToBtc(addr.balance)} BTC</span>
              {satsToUsd(addr.balance) && (
                <span className="text-xs text-ink/50 ml-1">
                  (${satsToUsd(addr.balance)})
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
