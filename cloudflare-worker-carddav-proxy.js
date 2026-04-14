// Cloudflare Worker for CardDAV CORS Proxy
// Deploy this at: https://carddav-proxy.data4-9de.workers.dev

// Allowed origins that may use this proxy (add your production domain here)
const ALLOWED_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  // Add production domain, e.g.: 'https://yourapp.example.com'
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
  const workerToken = request.headers.get('X-Worker-Token')
  if (typeof WORKER_TOKEN !== 'undefined' && WORKER_TOKEN) {
    if (workerToken !== WORKER_TOKEN) {
      return new Response('Forbidden', {
        status: 403,
        headers: getCORSHeaders(origin)
      })
    }
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
    // Forward request to target
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers: {
        'Authorization': safeAuth,
        'Content-Type': request.headers.get('Content-Type') || 'application/xml; charset=utf-8',
        'Depth': request.headers.get('Depth') || '0',
        'User-Agent': 'CardDAV-Client/1.0',
        'Accept': '*/*'
      },
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

function isAllowedOrigin(origin) {
  if (!origin) return false
  return ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.startsWith(allowed + '/'))
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
