interface Props {
  status: 'disconnected' | 'connecting' | 'connected' | 'signing' | 'error'
  error: string | null
  onConnect: () => void
  onDisconnect?: () => void
}

export function LedgerStatus({ status, error, onConnect, onDisconnect }: Props) {
  const statusColors = {
    disconnected: 'bg-gray-400',
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-green-500',
    signing: 'bg-blue-500 animate-pulse',
    error: 'bg-red-500',
  }

  const statusText = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    signing: 'Signing...',
    error: 'Error',
  }

  // Check if error suggests physical reconnection needed
  const needsReconnect = error?.includes('unplug') || error?.includes('plug it back')

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColors[status]}`} />
          <span className="text-sm font-medium dark:text-slate-200">Ledger: {statusText[status]}</span>
        </div>

        {status === 'disconnected' && (
          <button onClick={onConnect} className="btn-secondary text-xs py-1 px-3">
            Connect
          </button>
        )}

        {status === 'connected' && onDisconnect && (
          <button onClick={onDisconnect} className="btn-secondary text-xs py-1 px-3">
            Disconnect
          </button>
        )}

        {status === 'error' && !needsReconnect && (
          <button onClick={onConnect} className="btn-secondary text-xs py-1 px-3">
            Retry
          </button>
        )}
      </div>

      {status === 'error' && error && (
        <div className="text-xs text-red-600 dark:text-red-400 max-w-xs text-right">
          {error}
          {needsReconnect && (
            <button
              onClick={() => window.location.reload()}
              className="ml-2 underline hover:no-underline"
            >
              Refresh Page
            </button>
          )}
        </div>
      )}
    </div>
  )
}
