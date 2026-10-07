// Cloudflare Worker for CardDAV CORS Proxy
// Deploy this at: https://carddav-proxy.data4-9de.workers.dev

// Default allowed origins (fallback for local dev; production list comes
// from the ALLOWED_ORIGINS var in wrangler.toml, which overrides this)
const DEFAULT_ALLOWED_ORIGINS = [
  'https://e2econtacts.org',
  'https://www.e2econtacts.org',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8080',
]

// Allowed iCloud CardDAV hostnames (exact hostname match only — prevents SSRF)
const ALLOWED_ICLOUD_HOSTNAMES = [
  'contacts.icloud.com',
  'caldav.icloud.com',
]

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const origin = request.headers.get('Origin')

  // Reject requests from unknown origins (CORS enforcement)
  if (!isAllowedOrigin(origin)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCORSHeaders(origin)
    })
  }

  // Validate worker auth token (set WORKER_TOKEN in Cloudflare env vars)
  // Token is REQUIRED — if not configured, all proxied requests are rejected
  const workerToken = request.headers.get('X-Worker-Token')
  if (typeof WORKER_TOKEN === 'undefined' || !WORKER_TOKEN) {
    return new Response('Server misconfigured: WORKER_TOKEN not set', {
      status: 500,
      headers: getCORSHeaders(origin)
    })
  }
  if (workerToken !== WORKER_TOKEN) {
    return new Response('Forbidden', {
      status: 403,
      headers: getCORSHeaders(origin)
    })
  }

  // Get target URL from query parameter
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('target')

  if (!targetUrl) {
    return new Response('Missing target parameter', {
      status: 400,
      headers: getCORSHeaders(origin)
    })
  }

  // Validate target hostname is an allowed iCloud host (prevents SSRF)
  let parsedTarget
  try {
    parsedTarget = new URL(targetUrl)
  } catch {
    return new Response('Invalid target URL', {
      status: 400,
      headers: getCORSHeaders(origin)
    })
  }

  if (parsedTarget.protocol !== 'https:' || !ALLOWED_ICLOUD_HOSTNAMES.includes(parsedTarget.hostname)) {
    return new Response('Invalid target URL', {
      status: 403,
      headers: getCORSHeaders(origin)
    })
  }

  // Strip newlines from forwarded credential header to prevent header injection
  const rawAuth = request.headers.get('Authorization') || ''
  const safeAuth = rawAuth.replace(/[\r\n]/g, '')

  try {
    // Forward conditional (ETag) headers so iCloud can enforce optimistic
    // concurrency. Without If-Match, every PUT/DELETE is unconditional and
    // remote edits are silently overwritten (see ICLOUD_SYNC_REVIEW IS-10).
    const headers = {
      'Authorization': safeAuth,
      'Content-Type': request.headers.get('Content-Type') || 'application/xml; charset=utf-8',
      'Depth': request.headers.get('Depth') || '0',
      'User-Agent': 'CardDAV-Client/1.0',
      'Accept': '*/*'
    }
    for (const header of ['If-Match', 'If-None-Match', 'Prefer']) {
      const value = request.headers.get(header)
      if (value) {
        headers[header] = value.replace(/[\r\n]/g, '')
      }
    }

    // Forward request to target
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined
    })

    const response = await fetch(targetRequest)

    // Return response with CORS headers
    const responseHeaders = new Headers(response.headers)
    const corsHeaders = getCORSHeaders(origin)

    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    })
  } catch (error) {
    // Log internally; return a generic message to avoid leaking server details
    console.error('Proxy error:', error.message)
    return new Response('Proxy request failed', {
      status: 500,
      headers: getCORSHeaders(origin)
    })
  }
}

function getAllowedOrigins() {
  // Production list comes from the ALLOWED_ORIGINS var in wrangler.toml.
  // Accept a comma-separated string or an array; fall back to built-in defaults.
  if (typeof ALLOWED_ORIGINS !== 'undefined' && ALLOWED_ORIGINS) {
    return typeof ALLOWED_ORIGINS === 'string'
      ? ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : ALLOWED_ORIGINS
  }
  return DEFAULT_ALLOWED_ORIGINS
}

function isAllowedOrigin(origin) {
  if (!origin) return false
  return getAllowedOrigins().some(allowed => origin === allowed || origin.startsWith(allowed + '/'))
}

function getCORSHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, If-Match, If-None-Match, Prefer, X-Worker-Token',
    'Access-Control-Expose-Headers': 'ETag, Content-Type, DAV, Location',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  }
}
