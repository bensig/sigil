import type { Transaction } from '../types'

interface Props {
  transactions: Transaction[]
  loading: boolean
  satsToBtc: (sats: number) => string
}

export function TransactionHistory({ transactions, loading, satsToBtc }: Props) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">History</h3>

      {loading && (
        <p className="text-sm text-ink/50">Loading transactions...</p>
      )}

      {!loading && transactions.length === 0 && (
        <p className="text-sm text-ink/50">No transactions yet</p>
      )}

      <div className="space-y-2 max-h-64 overflow-auto">
        {transactions.slice(0, 20).map((tx) => (
          <div
            key={tx.txid}
            className="flex items-center justify-between py-2 border-b border-ink/5 last:border-0"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink/60">{formatDate(tx.timestamp)}</span>
                <span className="text-sm font-medium">
                  {tx.amount > 0 ? 'Received' : 'Sent'}
                </span>
                {tx.confirmed ? (
                  <span className="text-green-600 text-xs">confirmed</span>
                ) : (
                  <span className="text-yellow-600 text-xs">pending</span>
                )}
              </div>
              <a
                href={`https://mempool.space/tx/${tx.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-xs text-ink/40 hover:text-ink"
              >
                {tx.txid.slice(0, 16)}...
              </a>
            </div>

            <div className={`font-medium ${tx.amount > 0 ? 'text-green-600' : 'text-ink'}`}>
              {tx.amount > 0 ? '+' : ''}{satsToBtc(tx.amount)} BTC
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
