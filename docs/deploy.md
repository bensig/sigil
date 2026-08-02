# Deploying Sigil

A built bundle is static files plus two API proxies. Static hosts are
**read-only** (no UI saves — labels/whitelist/config edits need `npm start`).

Remember: the bundle contains your xpubs. Public URL = public balances.
Put it behind auth (Netlify password/JWT, nginx basic auth, Tailscale, VPN).

## Required proxy rules

The app calls `/api/mempool/*` and `/api/blockstream/*`:

| Path prefix         | Upstream                     |
|---------------------|------------------------------|
| `/api/mempool/`     | `https://mempool.space/api/` |
| `/api/blockstream/` | `https://blockstream.info/api/` |

## Netlify

`netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/api/mempool/*"
  to = "https://mempool.space/api/:splat"
  status = 200

[[redirects]]
  from = "/api/blockstream/*"
  to = "https://blockstream.info/api/:splat"
  status = 200
```

## nginx

```nginx
location / {
  root /var/www/sigil/dist;
  try_files $uri /index.html;
}
location /api/mempool/ {
  proxy_pass https://mempool.space/api/;
  proxy_set_header Host mempool.space;
}
location /api/blockstream/ {
  proxy_pass https://blockstream.info/api/;
  proxy_set_header Host blockstream.info;
}
```
