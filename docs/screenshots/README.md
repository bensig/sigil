# Sigil screenshots — demo wallet

Product screenshots taken against a throwaway demo wallet. **Nothing here touches
a real wallet, a real key, or a real balance**, and no SYF/Xavior configuration is
present in this clone.

## What the numbers are

The balances, fee rates and BTC price are **fabricated**. They are served by a
local mock of the mempool.space API, not fetched from the network. They are
illustrative of the UI and must never be presented as the fund's holdings.

- Wallet: `Demo 2-of-3`, mainnet, 2-of-3 P2WSH
- Signers: three freshly generated xpubs (Alpha / Bravo / Charlie), private keys
  discarded at generation — the wallet is unspendable by anyone
- Total shown: 9.66672100 BTC at a fabricated $87,031/BTC
- Fee rates: 14 / 9 / 5 sat/vB

## The shots

| File | Screen |
|---|---|
| `01-send.jpg` | Send tab, empty form — balance, fee tiers, change-address selector |
| `02-receive.jpg` | Receive tab — funded and unused addresses with derivation paths |
| `03-config.jpg` | Config tab — wallet settings, quorum, change-address policy |
| `04-send-filled.jpg` | Send tab with recipient and amount entered |
| `05-psbt-created.jpg` | After Generate PSBT — "Connect your Ledger to sign" |
| `06-psbt-detail.jpg` | PSBT panel — base64, destination, amount, fee, QR actions |
| `07-qr-seedsigner.jpg` | Animated QR export for air-gapped signing — UR2, 23 parts, density and speed controls |

Two blemishes to fix before publishing:

- `03-config.jpg` shows `http://localhost:8899` in "Custom API Base URL", which
  advertises the mock. Crop that row, or retake with the field blank (which
  would send the app to the real mempool.space).
- `07-qr-seedsigner.jpg` has its "Scan with SeedSigner" modal header clipped at
  the top. The modal is taller than the capture viewport; resizing the browser
  window did not change the captured height. Retake with a screenshot tool that
  captures the full page, or crop to the QR and controls.

## Reproducing

Three pieces, in this order:

```bash
# 1. the mock chain API (serves curated balances for this wallet's addresses)
node demo-chain-api.js 8899

# 2. the dev server, from this clone
npx vite --port 5175 --strictPort

# 3. open http://localhost:5175/
```

The mock derives the demo wallet's own addresses at startup and assigns each a
fixed balance, so the same picture reproduces exactly.

Two things that are easy to get wrong, both of which produced wrong balances
while these were being made:

1. **Address derivation must pre-sort the pubkeys.** `src/lib/addresses.ts`
   sorts the derived child pubkeys before building the multisig. A mock that
   passes them in config order derives different addresses at every index where
   config order isn't already lexicographic — so it funds addresses the wallet
   does not have.
2. **Both provider legs must point at the mock.** `scanAddresses` splits work
   across two providers, sending odd-indexed addresses to the fallback. Setting
   only `apiBaseUrl` leaves the fallback pointed at the real blockstream proxy,
   which silently returns empty for these addresses — one address in every pair
   vanishes from the balance. The demo config sets `fallbackApiBaseUrl` to the
   same mock for this reason.

## Not committed

These images and the demo wallet config are deliberately untracked. Decide
explicitly before adding any of it to the repo.
