# Troubleshooting

## Ledger Connection Issues

### "No compatible devices found"

1. **Close Ledger Live** - It blocks WebHID access. Check Task Manager/Activity Monitor.
2. **Use a data cable** - Some USB cables are charge-only and won't work for data.
3. **Try a different USB port** - Plug directly into the computer, not a hub.
4. **Use Chrome, Edge, or Brave** - Firefox and Safari don't support WebHID.
5. **Unlock Ledger and open Bitcoin app** before clicking connect.

### "Invalid channel" or connection lost

1. Close the browser tab
2. Unplug Ledger
3. Wait 5 seconds
4. Plug back in
5. Open a new browser tab

### Linux users

Install udev rules:
```bash
wget -q -O - https://raw.githubusercontent.com/LedgerHQ/udev-rules/master/add_udev_rules.sh | sudo bash
```

## Broadcast Issues

### Button does nothing

Check browser console (F12) for errors. Common issues:
- PSBT not fully signed (need 2/2 signatures)
- Network connectivity issues
- Mempool API rate limiting
