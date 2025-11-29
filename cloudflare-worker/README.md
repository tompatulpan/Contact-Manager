# CardDAV CORS Proxy - Cloudflare Worker

This Cloudflare Worker acts as a CORS proxy for CardDAV requests, enabling browser-based CardDAV clients to communicate with iCloud, Radicale, Baikal, and other CardDAV servers.

## 🚀 Quick Start

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Update Configuration

Edit `wrangler.toml` and replace `your-domain.com` with your actual domain:

```toml
ALLOWED_ORIGINS = "https://your-actual-domain.com"
```

### 4. Deploy Worker

```bash
# Development deployment
npm run deploy:dev

# Production deployment
npm run deploy:prod
```

### 5. Configure Route in Cloudflare Dashboard

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker `carddav-proxy`
3. Go to "Triggers" → "Routes"
4. Add route: `your-domain.com/api/carddav/*`
5. Select your zone (domain)

## 📋 Configuration

### Environment Variables

#### Production
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins
- `ALLOWED_CARDDAV_SERVERS`: Comma-separated list of allowed CardDAV servers

#### Development
- Same as production but includes localhost URLs

### Allowed CardDAV Servers (Default)

- ✅ iCloud: `contacts.icloud.com`, `p01-contacts.icloud.com`, etc.
- ✅ Local Radicale: `127.0.0.1`, `localhost`
- ✅ Docker containers: `radicale`, `baikal`

## 🔧 Usage

### Request Format

```
GET https://your-domain.com/api/carddav?target=<encoded-url>
```

### Example

```javascript
const proxyUrl = 'https://your-domain.com/api/carddav';
const targetUrl = 'https://contacts.icloud.com/';

const response = await fetch(`${proxyUrl}?target=${encodeURIComponent(targetUrl)}`, {
    method: 'PROPFIND',
    headers: {
        'Authorization': 'Basic ' + btoa('user@icloud.com:app-password'),
        'Content-Type': 'application/xml',
        'Depth': '1'
    },
    body: propfindXML
});
```

## 🧪 Testing

### Test CORS Headers

```bash
curl -X OPTIONS https://your-domain.com/api/carddav \
  -H "Origin: https://your-domain.com" \
  -H "Access-Control-Request-Method: PROPFIND" \
  -v
```

### Test Proxying

```bash
curl "https://your-domain.com/api/carddav?target=https%3A%2F%2Fcontacts.icloud.com%2F" \
  -X OPTIONS \
  -H "Authorization: Basic $(echo -n 'user@icloud.com:password' | base64)" \
  -v
```

## 📊 Monitoring

### View Logs

```bash
npm run tail
```

### Check Deployment

```bash
wrangler deployments list
```

## 🛡️ Security Features

- ✅ Origin validation (whitelist-based)
- ✅ CardDAV server validation (only allowed servers)
- ✅ Header filtering (forwards only essential headers)
- ✅ Automatic CORS header injection
- ✅ Error handling with safe error messages

## 🔄 Update Worker

```bash
# Update code
edit carddav-proxy.js

# Redeploy
npm run deploy:prod
```

## 💰 Pricing

Cloudflare Workers free tier includes:
- ✅ 100,000 requests/day
- ✅ 10ms CPU time per request
- ✅ Sufficient for most personal/small business use

## 📝 Notes

- Worker runs on Cloudflare's edge network (low latency)
- No server infrastructure needed
- Automatic HTTPS
- Global CDN distribution
- 99.99% uptime SLA

## 🐛 Troubleshooting

### "Forbidden: Invalid origin"
- Add your domain to `ALLOWED_ORIGINS` in `wrangler.toml`
- Redeploy worker

### "Forbidden: Target server not allowed"
- Add CardDAV server to `ALLOWED_CARDDAV_SERVERS`
- Redeploy worker

### CORS errors in browser
- Check worker route is configured correctly
- Verify Origin header matches allowed origins
- Check browser console for specific CORS error

## 📚 References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [RFC 6352 - CardDAV](https://www.rfc-editor.org/rfc/rfc6352.html)
