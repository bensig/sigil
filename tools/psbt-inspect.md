# PSBT Inspector

A CLI tool to dissect and analyze Partially Signed Bitcoin Transactions (PSBTs).

## Usage

```bash
# Inspect a PSBT file (binary or base64)
node tools/psbt-inspect.js /path/to/file.psbt

# Inspect a base64 PSBT string
node tools/psbt-inspect.js "cHNidP8BAF..."

# Pipe from stdin
cat file.psbt | node tools/psbt-inspect.js
```

## What It Shows

### Global Fields
- PSBT version
- Transaction lock time
- Input and output counts
- Base64 encoded length

### Unsigned Transaction
- Transaction ID (TXID)
- Version
- Lock time
- Size in bytes

### Inputs (for each input)
- **Outpoint**: Previous TXID and vout index
- **Sequence**: Sequence number (for RBF, timelocks)
- **Witness UTXO**: Value being spent, scriptPubKey, decoded address
- **Non-Witness UTXO**: Full previous transaction (for Ledger compatibility)
- **Witness Script**: Full hex, parsed as M-of-N multisig showing all pubkeys in order
- **Redeem Script**: For P2SH wrapped scripts
- **BIP32 Derivation**: Master fingerprint, derivation path, and pubkey for each signer
- **Partial Signatures**:
  - Signing pubkey
  - DER-encoded signature with parsed R and S values
  - Sighash type (SIGHASH_ALL, etc.)

### Outputs (for each output)
- Value in sats and BTC
- ScriptPubKey
- Decoded address
- Witness script (if change output)
- BIP32 derivation (indicates change output)

### Summary
- Total signatures collected
- Required signatures (from multisig script)
- Status: READY TO BROADCAST or NEEDS MORE SIGNATURES
- Total input value
- Total output value
- Fee in sats
- Estimated fee rate (sat/vB)

### Validation
- Validates each partial signature against the PSBT
- Shows VALID or INVALID for each signature

## Example Output

```
═══════════════════════════════════════════════════════════════
                        PSBT INSPECTOR
═══════════════════════════════════════════════════════════════

┌─ GLOBAL ─────────────────────────────────────────────────────┐
│ Version:        2
│ Lock Time:      930633
│ Input Count:    1
│ Output Count:   1
│ Base64 Length:  1048 chars
└──────────────────────────────────────────────────────────────┘

┌─ INPUT 0 ────────────────────────────────────────────────────┐
│ Previous TXID:  1a2b3c4d5e6f70819203a4b5c6d7e8f901234567ab...
│ Previous Vout:  1
│ Sequence:       0xfffffffd (4294967293)
│
│ ── Witness UTXO ──
│ Value:          1,375 sats (0.00001375 BTC)
│ ScriptPubKey:   0020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
│ Address:        bc1qexampleexampleexampleexampleexampleqqq...
│
│ ── Witness Script ──
│ Type:           2-of-2 Multisig
│ Pubkeys:
│   0: 02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
│   1: 03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb...
│
│ ── BIP32 Derivation ──
│ Master FP:      deadbeef
│ Path:           m/48'/0'/0'/2'/1/2
│ Pubkey:         02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
│
│ ── Partial Signatures ──
│ Pubkey:         02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
│ Sighash Type:   SIGHASH_ALL
│ R:              38b38ae54be4ddd2e922bfed1e7a1be048fb877551...
│ S:              79f57bcdd6b5fa91fe87f11a23d29cc9cee51a68af...
└──────────────────────────────────────────────────────────────┘

┌─ SUMMARY ────────────────────────────────────────────────────┐
│ Total Signatures:     1
│ Required Signatures:  2
│ Status:               NEEDS MORE SIGNATURES
│
│ Total Input:   1,375 sats (0.00001375 BTC)
│ Total Output:  1,211 sats (0.00001211 BTC)
│ Fee:           164 sats (0.00000164 BTC)
│ Fee Rate:      ~1.1 sat/vB (estimated)
└──────────────────────────────────────────────────────────────┘

┌─ VALIDATION ─────────────────────────────────────────────────┐
│ Input 0, 02aaaaaaaaaaaaaa...: VALID
└──────────────────────────────────────────────────────────────┘
```

## PSBT Structure Reference

### Key Concepts

- **PSBT Version**: Usually 0 or 2. Version 2 adds more features.
- **Master Fingerprint (XFP)**: 4-byte identifier for the master key (e.g., `deadbeef`)
- **Derivation Path**: BIP32 path like `m/48'/0'/0'/2'/0/0` where `'` means hardened
- **Witness Script**: The actual script being executed (for P2WSH multisig)
- **Partial Signature**: A signature from one of the required signers

### Multisig Script Structure

A 2-of-2 P2WSH multisig witness script:
```
OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
```

Hex breakdown:
- `52` = OP_2 (requires 2 signatures)
- `21` = 33 bytes follow (compressed pubkey)
- `02...` or `03...` = compressed pubkey (33 bytes)
- `52` = OP_2 (2 total pubkeys)
- `ae` = OP_CHECKMULTISIG

### Signature Format (DER)

```
30 [total-length]
  02 [r-length] [r-value]
  02 [s-length] [s-value]
[sighash-byte]
```

Sighash types:
- `01` = SIGHASH_ALL (most common)
- `02` = SIGHASH_NONE
- `03` = SIGHASH_SINGLE
- `81` = SIGHASH_ALL | ANYONECANPAY

## Troubleshooting

### "Signature INVALID"

If a signature shows as invalid:
1. The signature was created for a different transaction
2. The pubkey doesn't match the one that signed
3. The PSBT was modified after signing
4. Wrong sighash type was used

### Different Wallets Creating Incompatible PSBTs

Different wallets may use:
- Different key ordering (sorted vs unsorted multisig)
- Different derivation paths
- Different PSBT versions

For best compatibility, use `sortedmulti` descriptors which ensure consistent key ordering.
