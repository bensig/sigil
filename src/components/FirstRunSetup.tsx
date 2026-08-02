export function FirstRunSetup() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream dark:bg-slate-900 p-8">
      <div className="max-w-xl space-y-4 text-ink dark:text-slate-100">
        <h1 className="text-2xl font-semibold">Welcome to Sigil</h1>
        <p>No wallet configured yet. To add one:</p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>Copy the example: <code className="mono">cp -r src/configs/example src/configs/mywallet</code></li>
          <li>Edit <code className="mono">src/configs/mywallet/config.json</code> — set your network, quorum, and each cosigner&apos;s xpub, fingerprint, and BIP32 path.</li>
          <li>Restart the app (<code className="mono">npm start</code> or <code className="mono">npm run dev</code>).</li>
        </ol>
        <p className="text-sm text-ink/60 dark:text-slate-400">
          Configs are read at build time and never leave your machine. See README for the full schema.
        </p>
      </div>
    </div>
  )
}
