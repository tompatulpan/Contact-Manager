/**
 * CardDAV CORS Proxy - Cloudflare Worker
 * 
 * Forwards CardDAV requests to iCloud, Radicale, Baikal, etc.
 * Handles CORS headers to allow browser-based CardDAV clients
 * 
 * Deploy: wrangler deploy
 * Route: your-domain.com/api/carddav/* → this worker
 */

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return this.handleCORS(request);
        }

        try {
            // Validate origin
            const origin = request.headers.get('Origin');
            // TODO: Re-enable origin check after fixing origin configuration
            // Temporarily disabled to debug iCloud 403 errors
            if (false && !this.isAllowedOrigin(origin, env)) {
                return new Response('Forbidden: Invalid origin', { 
                    status: 403,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }

            // Extract target CardDAV server URL from request
            const url = new URL(request.url);
            const targetUrl = url.searchParams.get('target');

            if (!targetUrl) {
                return new Response('Bad Request: Missing target URL parameter', { 
                    status: 400,
                    headers: this.getCORSHeaders(origin)
                });
            }

            // Validate target is an allowed CardDAV server
            const isAllowedServer = this.isAllowedCardDAVServer(targetUrl, env);
            console.log(`🔍 Server validation - Target: ${targetUrl}, Allowed: ${isAllowedServer}`);
            
            if (!isAllowedServer) {
                console.error(`❌ Server not allowed: ${targetUrl}`);
                return new Response('Forbidden: Target server not allowed', { 
                    status: 403,
                    headers: this.getCORSHeaders(origin)
                });
            }

            console.log(`🔄 Proxying ${request.method} request to: ${targetUrl}`);

            // 🍎 iCloud workaround: Convert HEAD to GET (iCloud doesn't support HEAD)
            // We'll fetch with GET but only return headers to the client
            const isHeadRequest = request.method.toUpperCase() === 'HEAD';
            const actualMethod = isHeadRequest ? 'GET' : request.method;
            
            if (isHeadRequest) {
                console.log(`🔄 Converting HEAD → GET for iCloud compatibility`);
            }

            // Forward request to CardDAV server
            // For HEAD→GET conversion, don't include body (GET doesn't have body)
            const cardDAVResponse = await fetch(targetUrl, {
                method: actualMethod,
                headers: this.forwardHeaders(request.headers),
                body: (this.shouldIncludeBody(actualMethod) && !isHeadRequest)
                    ? await request.text() 
                    : null
            });

            console.log(`✅ CardDAV server responded: ${cardDAVResponse.status} ${cardDAVResponse.statusText}`);
            
            // Read response body and headers for logging (non-OK responses)
            if (!cardDAVResponse.ok) {
                const responseBodyClone = cardDAVResponse.clone();
                const responseText = await responseBodyClone.text();
                console.error(`📋 iCloud error response (${cardDAVResponse.status}):`, responseText.substring(0, 500));
                
                // Log all response headers from iCloud
                console.error(`📋 iCloud response headers:`);
                cardDAVResponse.headers.forEach((value, key) => {
                    console.error(`   ${key}: ${value}`);
                });
            }

            // Create response with CORS headers
            const responseHeaders = this.addCORSHeaders(
                cardDAVResponse.headers, 
                origin
            );

            // For HEAD requests, return only headers (no body)
            return new Response(
                isHeadRequest ? null : cardDAVResponse.body, 
                {
                    status: cardDAVResponse.status,
                    statusText: cardDAVResponse.statusText,
                    headers: responseHeaders
                }
            );

        } catch (error) {
            console.error(`❌ Proxy error:`, error.message);
            
            return new Response(`Proxy error: ${error.message}`, { 
                status: 500,
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*'
                }
            });
        }
    },

    /**
     * Handle CORS preflight (OPTIONS) requests
     */
    handleCORS(request) {
        const origin = request.headers.get('Origin');
        
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': origin || '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, If-Match, If-None-Match, Prefer',
                'Access-Control-Expose-Headers': 'ETag, Content-Type, DAV, Location',
                'Access-Control-Max-Age': '86400',
                'Access-Control-Allow-Credentials': 'true'
            }
        });
    },

    /**
     * Check if origin is allowed
     */
    isAllowedOrigin(origin, env) {
        if (!origin) return false;

        // Get allowed origins from environment variable or use defaults
        const allowedOrigins = env?.ALLOWED_ORIGINS?.split(',') || [
            'http://localhost:8080',
            'http://localhost:3000',
            'http://127.0.0.1:8080',
            'https://your-domain.com'  // Replace with your production domain
        ];

        return allowedOrigins.some(allowed => 
            origin === allowed || origin.endsWith(allowed.replace(/^https?:\/\//, ''))
        );
    },

    /**
     * Check if CardDAV server is allowed
     */
    isAllowedCardDAVServer(targetUrl, env) {
        // Get allowed servers from environment variable or use defaults
        const allowedServers = env?.ALLOWED_CARDDAV_SERVERS?.split(',') || [
            'icloud.com',        // Allows all *.icloud.com subdomains
            '127.0.0.1',         // Local Radicale
            'localhost',         // Local Radicale
            'radicale',          // Docker Radicale
            'baikal'             // Docker Baikal
        ];

        try {
            const url = new URL(targetUrl);
            const hostname = url.hostname;

            return allowedServers.some(allowed => {
                // Exact match
                if (hostname === allowed) return true;
                
                // Subdomain match (e.g., p68-contacts.icloud.com matches icloud.com)
                if (hostname.endsWith(`.${allowed}`)) return true;
                
                return false;
            });
        } catch {
            return false;
        }
    },

    /**
     * Forward essential headers to CardDAV server
     */
    forwardHeaders(requestHeaders) {
        const headers = new Headers();

        // Headers to forward (case-insensitive)
        const headersToForward = [
            'authorization',
            'content-type',
            'content-length',
            'depth',
            'if-match',
            'if-none-match',
            'prefer',
            'user-agent'
        ];

        for (const header of headersToForward) {
            const value = requestHeaders.get(header);
            if (value) {
                headers.set(header, value);
            }
        }

        return headers;
    },

    /**
     * Add CORS headers to response
     */
    addCORSHeaders(responseHeaders, origin) {
        const headers = new Headers(responseHeaders);

        headers.set('Access-Control-Allow-Origin', origin || '*');
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, REPORT');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Depth, If-Match, If-None-Match, Prefer');
        headers.set('Access-Control-Expose-Headers', 'ETag, Content-Type, DAV, Location');
        headers.set('Access-Control-Allow-Credentials', 'true');

        return headers;
    },

    /**
     * Get basic CORS headers
     */
    getCORSHeaders(origin) {
        return {
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, If-Match, If-None-Match',
            'Access-Control-Expose-Headers': 'ETag, Content-Type, DAV',
            'Content-Type': 'text/plain'
        };
    },

    /**
     * Check if HTTP method should include body
     */
    shouldIncludeBody(method) {
        const methodsWithBody = ['POST', 'PUT', 'PATCH', 'PROPFIND', 'REPORT', 'PROPPATCH'];
        return methodsWithBody.includes(method.toUpperCase());
    }
};
