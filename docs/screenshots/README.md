# Sigil screenshots — demo wallet

Product screenshots taken against a throwaway demo wallet. **Nothing here touches
a real wallet, a real key, or a real balance.**

## What the numbers are

The balances, fee rates and BTC price are **fabricated**, served by a local mock
of the mempool.space API rather than fetched from the network. They illustrate
the UI and must never be presented as anyone's holdings.

- Wallet: `Demo 2-of-3`, mainnet, 2-of-3 P2WSH
- Signers: three freshly generated xpubs whose private keys were discarded at
  generation — the wallet is unspendable by anyone
- Total shown: 9.66672100 BTC at a fabricated $87,031/BTC
- Fee rates: 14 / 9 / 5 sat/vB

## The shots

Captured at a narrow viewport so the app's centred card fills the frame. A wide
desktop capture leaves the card occupying ~27% of the image, which renders as an
unreadable sliver once scaled to a page column — don't capture that way.

| File | Screen | Used in |
|---|---|---|
| `s-send.png` | Send tab — balance, recipient, change-address selector, fee rates | bitcoinsigil.com |
| `s-receive.png` | Receive tab — funded and unused addresses with derivation paths | README intro |
| `s-config.png` | Config tab, full | — |
| `s-config-cropped.png` | Config tab, cropped above the mock API URL row | README config schema |
| `s-send-utxo.png` | Send tab with the UTXO selector open, one UTXO selected | README |
| `r-qr.jpg` | Animated QR export — UR2, 23 parts | README air-gapped signing |
| `07-qr-seedsigner.jpg` | The uncropped QR capture `r-qr.jpg` came from | — |

`s-config.png` shows `http://localhost:8899` in "Custom API Base URL" and the
blockstream backup provider row; `s-config-cropped.png` cuts above both, and is
the one to use publicly.

`r-qr.jpg` is from an earlier wide capture and is cropped to the modal body
because its header rendered taller than the capture viewport. It's the one
remaining old-generation image — retake it at a narrow viewport when convenient.

## Reproducing

```bash
# 1. mock chain API — serves curated balances for this wallet's addresses
node demo-chain-api.js 8899

# 2. dev server
npx vite --port 5175 --strictPort

# 3. open http://localhost:5175/ in a narrow window (~620px wide)
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
   which returns empty for these addresses — one address in every pair vanishes
   from the balance. The demo config sets `fallbackApiBaseUrl` to the same mock.

## Not committed

The demo wallet config (`src/configs/demo/`, `src/configs/wallets.json`) is
deliberately untracked — committing it would put a fake wallet in every
checkout.
