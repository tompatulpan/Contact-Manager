# CardDAV CORS Proxy - Cloudflare Worker

A CORS proxy for **iCloud CardDAV only**. It lets the browser app talk to
`contacts.icloud.com` / `caldav.icloud.com`, which do not send CORS headers.
Other CardDAV servers (Baikal, Radicale, Nextcloud) are **not** supported by
this Worker — it rejects any non-iCloud target (SSRF protection).

Deployed at: `https://carddav-proxy.data4-9de.workers.dev`

## What it does

- Forwards `PROPFIND`, `REPORT`, `PUT`, `DELETE` etc. to iCloud
- Forwards the conditional headers `If-Match`, `If-None-Match`, `Prefer`
  so ETag-based optimistic concurrency works (a stale `If-Match` gets a
  real 412 from iCloud — see `ICLOUD_SYNC_REVIEW.md` IS-10)
- Enforces an origin allowlist (`ALLOWED_ORIGINS`)
- Enforces an iCloud-only hostname allowlist over `https:`
- Requires an `X-Worker-Token` header matching the `WORKER_TOKEN` env var

## Security model — read this

The `WORKER_TOKEN` value is **not a secret**: it is committed to this repo
and shipped in the public JS bundle (`src/config/app.config.js`). It only
filters token-less scrapers. The controls that matter are:

- SSRF allowlist (iCloud hosts only, https only)
- CORS origin allowlist (browser requests only)
- **Cloudflare rate limiting / WAF rule on the Worker route** — this is the
  only control that bounds scripted relay abuse. Configure it in the
  Cloudflare dashboard (Workers → carddav-proxy → Settings/rate limiting),
  e.g. limit requests per IP per minute.

If the token is ever leaked or abused, rotate it: generate a new value,
run `wrangler secret put WORKER_TOKEN`, deploy, and update
`APP_CONFIG.cardDAV.workerToken` in the app, then redeploy the Pages app.

## Deploy

```bash
cd cloudflare-worker
npm install            # first time only
wrangler login         # first time only

# Set the auth token (must match APP_CONFIG.cardDAV.workerToken in the app):
wrangler secret put WORKER_TOKEN

# Deploy the Worker code:
node_modules/.bin/wrangler deploy
```

**Deploy order after a token rotation:** deploy the Worker (with the new
`WORKER_TOKEN` secret) **before** deploying the Pages app that contains the
matching token, otherwise iCloud sync breaks for every user in between.

## Configuration

`wrangler.toml`:

- `ALLOWED_ORIGINS` — comma-separated origin list (source of truth;
  the Worker falls back to a built-in dev list if unset)

Removed/dead config (do not re-add): `ALLOWED_CARDDAV_SERVERS` was never
read by the Worker — the host allowlist is hardcoded in
`carddav-proxy.js` (`ALLOWED_ICLOUD_HOSTNAMES`).

## Testing

```bash
# CORS preflight
curl -X OPTIONS "https://carddav-proxy.data4-9de.workers.dev/" \
  -H "Origin: https://e2econtacts.org" \
  -H "Access-Control-Request-Method: PROPFIND" -v

# Verify conditional headers survive the hop (expect 412 from iCloud on a stale If-Match)
curl "https://carddav-proxy.data4-9de.workers.dev/?target=https%3A%2F%2Fcontacts.icloud.com%2F" \
  -X PUT \
  -H "Origin: https://e2econtacts.org" \
  -H "X-Worker-Token: <token>" \
  -H "If-Match: \"stale-etag\"" \
  -H "Content-Type: text/vcard" \
  --data "BEGIN:VCARD" -v
```

The automated check is `tests/worker/carddav-proxy.test.js` (jest).

## Troubleshooting

- **"Forbidden"** — wrong/missing `X-Worker-Token`, or `Origin` not in
  `ALLOWED_ORIGINS`.
- **"Invalid target URL" (403)** — target is not an iCloud hostname.
- **"Server misconfigured: WORKER_TOKEN not set"** — run
  `wrangler secret put WORKER_TOKEN`.
