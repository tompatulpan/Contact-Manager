// Cloudflare Worker for CardDAV CORS Proxy
// Deploy this at: https://carddav-proxy.data4-9de.workers.dev

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCORSHeaders(request.headers.get('Origin'))
    })
  }

  // Get target URL from query parameter
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('target')

  if (!targetUrl) {
    return new Response('Missing target parameter', { 
      status: 400,
      headers: getCORSHeaders(request.headers.get('Origin'))
    })
  }

  // Validate target is iCloud
  if (!targetUrl.includes('contacts.icloud.com') && !targetUrl.includes('caldav.icloud.com')) {
    return new Response('Invalid target URL', { 
      status: 403,
      headers: getCORSHeaders(request.headers.get('Origin'))
    })
  }

  try {
    // Forward request to target
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers: {
        'Authorization': request.headers.get('Authorization'),
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
    const corsHeaders = getCORSHeaders(request.headers.get('Origin'))
    
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    })
  } catch (error) {
    return new Response(`Proxy error: ${error.message}`, {
      status: 500,
      headers: getCORSHeaders(request.headers.get('Origin'))
    })
  }
}

function getCORSHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, If-Match, If-None-Match, Prefer',
    'Access-Control-Expose-Headers': 'ETag, Content-Type, DAV, Location',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  }
}
