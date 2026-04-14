/**
 * SimpleCardDAVBridge - Lightweight CardDAV sync library
 * 
 * Supports two backends:
 * 1. Native fetch() - Lightweight, no dependencies (default)
 * 2. tsdav - Full-featured, better iCloud support (optional)
 * 
 * Automatically selects best backend based on server type
 */

class SimpleCardDAVBridge {
    constructor(config) {
        this.config = config;
        this.auth = null; // Base64 encoded auth header
        this.connected = false;
        
        // Backend selection
        this.useTsdav = config.useTsdav || false;  // Set true for iCloud
        this.tsdavClient = null;
        
        // 🆕 CORS proxy configuration
        this.proxyUrl = config.proxyUrl || null;
        this.proxyToken = config.proxyToken || null; // X-Worker-Token for Cloudflare Worker auth
        this.useProxy = config.useProxy !== false && this.proxyUrl !== null;
        this.fallbackToLocal = config.fallbackToLocal !== false;
        this.localServerPatterns = config.localServerPatterns || [
            'localhost', '127.0.0.1', '192.168.', '10.0.', '172.16.'
        ];
        
        // Auto-detect iCloud and enable tsdav
        if (config.serverUrl && config.serverUrl.includes('icloud.com')) {
            this.useTsdav = true;
            console.log('🍎 iCloud detected - using tsdav backend');
        }
        
        if (this.useProxy) {
            console.log(`🔄 CORS proxy enabled: ${this.proxyUrl}`);
        }
        
        if (this.useTsdav) {
            console.log('📦 Using tsdav backend for enhanced compatibility');
        }
    }

    /**
     * Check if URL is a local server
     * @param {string} url - URL to check
     * @returns {boolean} True if local server
     */
    isLocalServer(url) {
        if (!this.fallbackToLocal) return false;
        
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            
            return this.localServerPatterns.some(pattern => 
                hostname.includes(pattern.toLowerCase())
            );
        } catch {
            return false;
        }
    }

    /**
     * Check if URL is an iCloud server
     * @param {string} url - URL to check
     * @returns {boolean} True if iCloud server
     */
    isICloudServer(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            return hostname.includes('icloud.com');
        } catch {
            return false;
        }
    }

    /**
     * Build URL with proxy support and local server detection
     * @param {string} targetUrl - Target CardDAV URL
     * @returns {string} Proxied or direct URL
     */
    buildUrl(targetUrl) {
        // Check if this is a local server
        if (this.isLocalServer(targetUrl)) {
            console.log(`🏠 Local server detected: ${targetUrl} (bypassing proxy)`);
            return targetUrl;
        }
        
        if (!this.useProxy) {
            return targetUrl;
        }
        
        // Encode target URL as query parameter for proxy
        const encodedTarget = encodeURIComponent(targetUrl);
        return `${this.proxyUrl}?target=${encodedTarget}`;
    }

    /**
     * Fetch wrapper that injects X-Worker-Token when the request is going
     * through the Cloudflare Worker proxy, and strips newlines from the
     * Authorization header to prevent header injection.
     * @param {string} url - URL (may already be proxied via buildUrl)
     * @param {Object} options - Standard fetch options
     * @returns {Promise<Response>}
     */
    async proxyFetch(url, options = {}) {
        const headers = { ...(options.headers || {}) };

        // Strip CR/LF from Authorization to prevent header injection
        if (headers['Authorization']) {
            headers['Authorization'] = headers['Authorization'].replace(/[\r\n]/g, '');
        }

        // Inject worker auth token when routing through the proxy
        const isProxied = this.useProxy && this.proxyUrl && url.startsWith(this.proxyUrl);
        if (isProxied && this.proxyToken) {
            headers['X-Worker-Token'] = this.proxyToken;
        }

        return fetch(url, { ...options, headers });
    }

    /**
     * Connect to CardDAV server
     * @param {Object} credentials - { serverUrl, username, password }
     */
    async connect(credentials = null) {
        const config = credentials || this.config;
        
        // ✅ Store config for later use (discovery, sync, etc.)
        this.config = config;
        
        console.log(`🔌 Connecting to: ${config.serverUrl}`);
        if (this.useProxy) {
            console.log(`   Via proxy: ${this.proxyUrl}`);
        }
        
        try {
            // Use tsdav backend if enabled
            if (this.useTsdav) {
                return await this.connectWithTsdav(config);
            }
            
            // Default: Native fetch backend
            // Create Basic Auth header
            const authString = btoa(`${config.username}:${config.password}`);
            this.auth = `Basic ${authString}`;
            
            // Test connection with OPTIONS request
            const testUrl = this.buildUrl(config.serverUrl);
            const response = await this.proxyFetch(testUrl, {
                method: 'OPTIONS',
                headers: {
                    'Authorization': this.auth
                }
            });
            
            if (!response.ok && response.status !== 401) {
                throw new Error(`Server returned ${response.status}`);
            }
            
            this.connected = true;
            console.log(`✅ Connected to CardDAV server`);
            return { success: true };
            
        } catch (error) {
            console.error(`❌ Connection failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Connect using tsdav backend
     * @param {Object} config - Connection configuration
     */
    async connectWithTsdav(config) {
        try {
            // Dynamically import tsdav (only loaded when needed)
            const { createDAVClient } = await import('tsdav');
            
            this.tsdavClient = await createDAVClient({
                serverUrl: config.serverUrl,
                credentials: {
                    username: config.username,
                    password: config.password
                },
                authMethod: 'Basic',
                defaultAccountType: 'carddav'
            });
            
            this.connected = true;
            console.log(`✅ Connected via tsdav backend`);
            return { success: true };
            
        } catch (error) {
            console.error(`❌ tsdav connection failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        this.auth = null;
        this.connected = false;
        console.log(`🔌 Disconnected from CardDAV server`);
    }

    /**
     * Fetch all contacts from addressbook using REPORT method
     * @param {string} addressbookUrl - Full addressbook URL
     */
    async fetchContacts(addressbookUrl) {
        if (!this.connected) {
            throw new Error('Not connected to CardDAV server');
        }

        // Use tsdav backend if enabled
        if (this.useTsdav) {
            return await this.fetchContactsWithTsdav(addressbookUrl);
        }

        // Default: Native fetch backend
        // Ensure addressbook URL ends with / for REPORT queries
        let fetchUrl = addressbookUrl.endsWith('/') ? addressbookUrl : addressbookUrl + '/';
        
        // 🍎 iCloud requires /card/ subdirectory for REPORT queries too (not just PUT)
        if (this.isICloudServer(addressbookUrl) && !fetchUrl.includes('/card/')) {
            fetchUrl = fetchUrl + 'card/';
            console.log(`🍎 iCloud: Added /card/ subdirectory for REPORT operation`);
        }
        
        console.log(`📥 Fetching contacts from: ${fetchUrl}`);
        
        try {
            // CardDAV REPORT query
            const reportXML = `<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
    <D:prop>
        <D:getetag/>
        <C:address-data/>
    </D:prop>
</C:addressbook-query>`;

            const reportUrl = this.buildUrl(fetchUrl);
            const response = await this.proxyFetch(reportUrl, {
                method: 'REPORT',
                headers: {
                    'Authorization': this.auth,
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Depth': '1'
                },
                body: reportXML
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const xmlText = await response.text();
            console.log(`📄 XML Response length: ${xmlText.length} bytes`);
            console.log(`📄 XML Preview (first 500 chars):`, xmlText.substring(0, 500));
            
            const vcards = this.parseMultiStatusResponse(xmlText);
            
            console.log(`✅ Fetched ${vcards.length} contacts`);
            return { success: true, contacts: vcards };
            
        } catch (error) {
            console.error(`❌ Fetch failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Fetch contacts using tsdav backend
     * @param {string} addressbookUrl - Addressbook URL
     */
    async fetchContactsWithTsdav(addressbookUrl) {
        try {
            console.log(`📥 Fetching contacts via tsdav from: ${addressbookUrl}`);
            
            // Call fetchVCards directly on the client
            const vcards = await this.tsdavClient.fetchVCards({
                addressBook: {
                    url: addressbookUrl,
                    displayName: 'Contacts'
                }
            });
            
            // Transform tsdav format to SimpleCardDAVBridge format
            const contacts = vcards.map(vcard => ({
                etag: vcard.etag || '',
                href: vcard.url || '',
                vcard: vcard.data || '',
                uid: this.extractUIDFromVCard(vcard.data)
            }));
            
            console.log(`✅ Fetched ${contacts.length} contacts via tsdav`);
            return { success: true, contacts };
            
        } catch (error) {
            console.error(`❌ tsdav fetch failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract UID from vCard content
     * @param {string} vcard - vCard content
     * @returns {string|null} UID or null
     */
    extractUIDFromVCard(vcard) {
        if (!vcard) return null;
        const match = vcard.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Push contact to CardDAV server (create or update)
     * @param {string} addressbookUrl - Addressbook URL
     * @param {string} vcard - vCard content
     * @param {string} uid - Contact UID
     * @param {string|null} etag - Optional ETag for conflict detection (RFC 7232)
     */
    async pushContact(addressbookUrl, vcard, uid, etag = null) {
        if (!this.connected) {
            throw new Error('Not connected to CardDAV server');
        }

        // Use tsdav backend if enabled
        if (this.useTsdav) {
            return await this.pushContactWithTsdav(addressbookUrl, vcard, uid, etag);
        }

        // Default: Native fetch backend
        // Ensure addressbook URL ends with / before appending filename
        let baseUrl = addressbookUrl.endsWith('/') ? addressbookUrl : addressbookUrl + '/';
        
        // 🍎 iCloud requires /card/ subdirectory for individual contact operations
        // We removed /card/ during discovery to prevent 403 on REPORT operations,
        // but PUT operations require /card/ to be present
        if (this.isICloudServer(addressbookUrl) && !baseUrl.includes('/card/')) {
            baseUrl = baseUrl + 'card/';
            console.log(`🍎 iCloud: Added /card/ subdirectory for contact operation`);
        }
        
        const vcardUrl = `${baseUrl}${uid}.vcf`;
        
        try {
            // Build headers with RFC 7232 compliant If-Match (quoted ETag)
            const headers = {
                'Authorization': this.auth,
                'Content-Type': 'text/vcard; charset=utf-8'
            };
            
            // 🍎 iCloud requires additional headers for PUT operations
            if (this.isICloudServer(addressbookUrl)) {
                headers['Depth'] = '0';
                headers['Prefer'] = 'return=minimal';
                
                // For new contacts (no etag), use If-None-Match to ensure creation
                if (!etag) {
                    headers['If-None-Match'] = '*';
                    console.log(`🍎 iCloud: Using If-None-Match for new contact creation`);
                }
                console.log(`🍎 iCloud: Added required headers for PUT operation`);
            }
            
            // Add If-Match header with quoted ETag (RFC 7232 requirement)
            if (etag) {
                headers['If-Match'] = `"${etag}"`;
                console.log(`📋 Using ETag for conflict detection: ${etag}`);
            }
            
            // 🍎 iCloud-specific vCard preprocessing
            let vcardBody = vcard;
            if (this.isICloudServer(addressbookUrl)) {
                // Debug: Log original vCard
                console.log(`🔍 Original vCard (first 300 chars):`, vcardBody.substring(0, 300));
                console.log(`🔍 Original vCard length: ${vcardBody.length} bytes`);
                
                // Validate vCard has proper structure
                if (!vcardBody || !vcardBody.includes('BEGIN:VCARD') || !vcardBody.includes('END:VCARD')) {
                    console.error(`❌ Invalid vCard structure - missing BEGIN/END markers`);
                    throw new Error('null vcard or UID missing from vcard');
                }
                
                // 0. Convert vCard 4.0 to 3.0 if needed (iCloud only accepts vCard 3.0)
                if (vcardBody.includes('VERSION:4.0')) {
                    console.log(`🍎 iCloud: Converting vCard 4.0 → 3.0...`);
                    vcardBody = vcardBody.replace(/VERSION:4\.0/g, 'VERSION:3.0');
                    
                    // Convert vCard 4.0 specific syntax to 3.0:
                    // Remove VALUE=uri parameters (vCard 4.0 only)
                    vcardBody = vcardBody.replace(/;VALUE=uri/gi, '');
                    
                    // Convert tel: prefixes (vCard 4.0) to plain numbers (vCard 3.0)
                    vcardBody = vcardBody.replace(/TEL([^:]*):tel:([^\r\n]+)/g, 'TEL$1:$2');
                    
                    console.log(`✅ Converted to vCard 3.0`);
                }
                
                // 1. KEEP UID in vCard body (iCloud requires it!)
                // Previous assumption was wrong - iCloud needs UID property in vCard body
                const uidMatch = vcardBody.match(/^UID:(.*)$/m);
                if (uidMatch) {
                    console.log(`🍎 iCloud: Found UID in vCard: ${uidMatch[1]}`);
                } else {
                    console.warn(`⚠️ WARNING: No UID found in vCard body - iCloud will reject this!`);
                }
                // DO NOT STRIP UID - iCloud requires it in the vCard body!
                
                // 1.5. Fix duplicate TYPE parameters (merge into single comma-separated TYPE for vCard 3.0)
                // EMAIL;TYPE=HOME;TYPE=INTERNET: → EMAIL;TYPE=HOME,INTERNET:
                // TEL;TYPE=WORK;TYPE=VOICE: → TEL;TYPE=WORK,VOICE:
                // RFC 2426: Multiple values for same parameter should be comma-separated
                vcardBody = vcardBody.replace(/^(EMAIL|TEL|ADR|URL);TYPE=([^:;]+)(;TYPE=[^:;]+)+:/gm, (match, property) => {
                    // Extract all TYPE values using match
                    const typeMatches = match.match(/TYPE=([^:;]+)/g) || [];
                    const types = [];
                    
                    for (const typeMatch of typeMatches) {
                        const typeValue = typeMatch.replace('TYPE=', '');
                        if (!types.includes(typeValue)) {
                            types.push(typeValue);
                        }
                    }
                    
                    // Rebuild with single TYPE parameter containing comma-separated values
                    const result = `${property};TYPE=${types.join(',')}:`;
                    if (match !== result) {
                        console.log(`🔧 Fixed duplicate TYPE: ${match.trim()} → ${result.trim()}`);
                    }
                    return result;
                });
                
                // 1.6. Strip tel: URI prefixes from phone numbers (vCard 4.0 → 3.0 conversion)
                // TEL;TYPE=WORK,VOICE:tel:+1-555-1234 → TEL;TYPE=WORK,VOICE:+1-555-1234
                vcardBody = vcardBody.replace(/^(TEL[^:]*):tel:(.+)$/gm, (match, property, number) => {
                    console.log(`🔧 Stripped tel: prefix: ${match.trim()} → ${property}:${number}`);
                    return `${property}:${number}`;
                });
                
                // 1.7. Convert all TYPE values to UPPERCASE (iCloud requirement)
                // EMAIL;TYPE=work → EMAIL;TYPE=WORK
                // EMAIL;TYPE=home;TYPE=internet → EMAIL;TYPE=HOME;TYPE=INTERNET
                vcardBody = vcardBody.replace(/^(EMAIL|TEL|ADR|URL);(TYPE=[^:]+):/gm, (match, property, typeParams) => {
                    const upperTypeParams = typeParams.toUpperCase();
                    return `${property};${upperTypeParams}:`;
                });
                
                // 1.8. Add INTERNET type to all EMAIL fields (iCloud requirement)
                // EMAIL;TYPE=WORK: → EMAIL;TYPE=WORK;TYPE=INTERNET:
                vcardBody = vcardBody.replace(/^EMAIL;(TYPE=[^:]+):(?!.*INTERNET)/gm, (match, typeParams) => {
                    // Only add INTERNET if not already present
                    if (!typeParams.includes('INTERNET')) {
                        return `EMAIL;${typeParams};TYPE=INTERNET:`;
                    }
                    return match;
                });
                
                // 1.9. Ensure N property exists (REQUIRED by vCard 3.0 RFC 2426)
                // iCloud rejects vCards without N property
                if (!vcardBody.match(/^N:/m)) {
                    console.log('🔧 Adding missing N property from FN');
                    const fnMatch = vcardBody.match(/^FN:(.+)$/m);
                    if (fnMatch) {
                        const fullName = fnMatch[1].trim();
                        // Split full name into parts (simple logic: "First Last" → N:Last;First;;;)
                        const nameParts = fullName.split(/\s+/);
                        let nProperty;
                        if (nameParts.length >= 2) {
                            // Assume last part is family name, rest is given name
                            const familyName = nameParts[nameParts.length - 1];
                            const givenName = nameParts.slice(0, -1).join(' ');
                            nProperty = `N:${familyName};${givenName};;;`;
                        } else {
                            // Single name - put in family name field
                            nProperty = `N:${fullName};;;;`;
                        }
                        // Insert N property right after FN
                        vcardBody = vcardBody.replace(/^(FN:.+)$/m, `$1\r\n${nProperty}`);
                        console.log(`🔧 Generated N property: ${nProperty}`);
                    }
                }
                
                // 2. Strip PRODID (iCloud adds its own)
                vcardBody = vcardBody.replace(/^PRODID:.*(\r?\n)/gm, '');
                
                // 3. Strip REV timestamp (iCloud manages its own timestamps)
                vcardBody = vcardBody.replace(/^REV:.*(\r?\n)/gm, '');
                
                // 4. Strip CATEGORIES (iCloud rejects CATEGORIES in vCard 3.0)
                const beforeCategoriesRemoval = vcardBody;
                vcardBody = vcardBody.replace(/^CATEGORIES:.*(\r?\n)/gm, '');
                if (beforeCategoriesRemoval !== vcardBody) {
                    console.log('🔧 Removed CATEGORIES property (iCloud incompatible with vCard 3.0)');
                }
                
                // 5. Convert line endings to CRLF (\r\n) per RFC 2426
                // Replace \n with \r\n, but avoid double conversion (\r\n → \r\r\n)
                vcardBody = vcardBody.replace(/\r?\n/g, '\r\n');
                
                console.log(`🍎 iCloud: Processed vCard (first 300 chars):`, vcardBody.substring(0, 300));
                console.log(`🍎 iCloud: Processed vCard length: ${vcardBody.length} bytes`);
            }
            
            // 🍎 iCloud-specific: Use POST for new contacts, PUT for updates
            // iCloud doesn't support PUT with If-None-Match: * (returns 403)
            // Instead, use POST to addressbook collection to create new contacts
            let response;
            let finalUrl = vcardUrl;
            
            if (this.isICloudServer(addressbookUrl) && !etag) {
                // NEW CONTACT: Use POST to addressbook collection
                const collectionUrl = baseUrl; // addressbook/card/
                const postUrl = this.buildUrl(collectionUrl);
                
                // Remove If-None-Match header for POST
                const postHeaders = { ...headers };
                delete postHeaders['If-None-Match'];
                
                console.log(`🍎 iCloud: Creating new contact with POST to collection`);
                console.log(`   Collection URL: ${collectionUrl}`);
                
                response = await this.proxyFetch(postUrl, {
                    method: 'POST',
                    headers: postHeaders,
                    body: vcardBody
                });
                
                // For POST, iCloud returns Location header with the new contact URL
                if (response.status === 201) {
                    const locationHeader = response.headers.get('Location');
                    if (locationHeader) {
                        // Extract UID from Location header (last path component without .vcf)
                        finalUrl = locationHeader;
                        console.log(`✅ iCloud returned Location: ${locationHeader}`);
                    }
                }
            } else {
                // EXISTING CONTACT or NON-iCloud: Use PUT to specific contact URL
                const pushUrl = this.buildUrl(vcardUrl);
                response = await this.proxyFetch(pushUrl, {
                    method: 'PUT',
                    headers,
                    body: vcardBody
                });
            }

            if (!response.ok) {
                // Get response body for debugging 403 errors
                const responseText = await response.text();
                console.error(`❌ Request failed (${response.status}):`, response.statusText);
                console.error(`📋 Response body:`, responseText || '(empty)');
                console.error(`📋 Response body length:`, responseText.length, 'bytes');
                
                // Log response headers that might contain error details
                console.error(`📋 Response headers:`);
                response.headers.forEach((value, key) => {
                    console.error(`   ${key}: ${value}`);
                });
                
                console.error(`📋 Request URL:`, finalUrl);
                console.error(`📋 Request headers (JSON):`, JSON.stringify(headers, null, 2));
                console.error(`📋 Authorization header present:`, !!headers['Authorization']);
                console.error(`📋 Content-Type:`, headers['Content-Type']);
                console.error(`📋 vCard length:`, vcardBody.length, 'bytes');
                console.error(`📄 vCard being sent:`, vcardBody);
                throw new Error(`Server returned ${response.status}: ${responseText || response.statusText}`);
            }

            const action = response.status === 201 ? 'created' : 'updated';
            
            // Try to get ETag from PUT response headers
            let newETag = response.headers.get('ETag');
            
            // If no ETag in PUT response (Radicale), fetch it with HEAD
            if (!newETag) {
                console.log(`⚠️ No ETag in PUT response, fetching with HEAD request...`);
                
                try {
                    const headUrl = this.buildUrl(vcardUrl);
                    const headResponse = await this.proxyFetch(headUrl, {
                        method: 'HEAD',
                        headers: { 'Authorization': this.auth }
                    });
                    
                    if (headResponse.ok) {
                        newETag = headResponse.headers.get('ETag');
                        if (newETag) {
                            // Remove quotes if present
                            newETag = newETag.replace(/^"(.*)"$/, '$1');
                            console.log(`✅ Fetched ETag via HEAD: ${newETag}`);
                        }
                    }
                } catch (headError) {
                    console.warn(`⚠️ HEAD request failed, ETag unavailable:`, headError.message);
                }
            } else {
                // Remove quotes from ETag
                newETag = newETag.replace(/^"(.*)"$/, '$1');
            }
            
            console.log(`✅ ${action} contact: ${uid}`);
            
            return { 
                success: true, 
                action, 
                uid,
                etag: newETag || null  // Return ETag for storage
            };
            
        } catch (error) {
            console.error(`❌ Push failed for ${uid}:`, error.message);
            return { success: false, error: error.message, uid };
        }
    }

    /**
     * Push contact using tsdav backend
     * @param {string} addressbookUrl - Addressbook URL
     * @param {string} vcard - vCard content
     * @param {string} uid - Contact UID
     * @param {string|null} etag - Optional ETag
     */
    async pushContactWithTsdav(addressbookUrl, vcard, uid, etag = null) {
        try {
            console.log(`📤 Pushing contact via tsdav: ${uid}`);
            
            // Ensure addressbook URL ends with /
            let baseUrl = addressbookUrl.endsWith('/') ? addressbookUrl : addressbookUrl + '/';
            const vcardUrl = `${baseUrl}${uid}.vcf`;
            
            if (etag) {
                // Update existing contact using client method
                await this.tsdavClient.updateVCard({
                    vCard: {
                        url: vcardUrl,
                        data: vcard,
                        etag
                    }
                });
                console.log(`✅ Updated contact via tsdav: ${uid}`);
                return { success: true, action: 'updated', uid, etag };
            } else {
                // Create new contact using client method
                const response = await this.tsdavClient.createVCard({
                    addressBook: {
                        url: addressbookUrl
                    },
                    filename: `${uid}.vcf`,
                    vCardString: vcard
                });
                
                const newETag = response?.etag || null;
                console.log(`✅ Created contact via tsdav: ${uid}`);
                return { success: true, action: 'created', uid, etag: newETag };
            }
            
        } catch (error) {
            console.error(`❌ tsdav push failed for ${uid}:`, error.message);
            return { success: false, error: error.message, uid };
        }
    }

    /**
     * Delete contact from CardDAV server
     * @param {string} vcardUrl - Full vCard URL
     */
    async deleteContact(vcardUrl) {
        if (!this.connected) {
            throw new Error('Not connected to CardDAV server');
        }

        // Use tsdav backend if enabled
        if (this.useTsdav) {
            return await this.deleteContactWithTsdav(vcardUrl);
        }

        // Default: Native fetch backend
        try {
            // 🐛 DEBUG: Log the full DELETE request details
            console.log(`🗑️ Attempting DELETE request:`);
            console.log(`   URL: ${vcardUrl}`);
            console.log(`   Auth: ${this.auth ? 'Present' : 'Missing'}`);
            console.log(`   Connected: ${this.connected}`);
            
            // Try DELETE method first (standard CardDAV)
            const deleteUrl = this.buildUrl(vcardUrl);
            const response = await this.proxyFetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.auth
                }
            });

            console.log(`📡 DELETE response: ${response.status} ${response.statusText}`);

            // Success or already deleted (404)
            if (response.ok || response.status === 404) {
                console.log(`✅ Deleted contact: ${vcardUrl}`);
                return { success: true };
            }
            
            // If DELETE not supported (501), treat as success
            // The contact is deleted locally and will not be synced back
            if (response.status === 501) {
                console.warn(`⚠️ Server doesn't support DELETE (501) - treating as success`);
                console.warn(`   Contact deleted locally, will not be re-synced`);
                console.warn(`   This may indicate missing credentials or server misconfiguration`);
                return { success: true, fallback: true };
            }
            
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            
        } catch (error) {
            console.error(`❌ Delete failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete contact using tsdav backend
     * @param {string} vcardUrl - vCard URL
     */
    async deleteContactWithTsdav(vcardUrl) {
        try {
            console.log(`🗑️ Deleting contact via tsdav: ${vcardUrl}`);
            
            // Call deleteVCard directly on the client
            await this.tsdavClient.deleteVCard({
                vCard: {
                    url: vcardUrl
                }
            });
            
            console.log(`✅ Deleted contact via tsdav: ${vcardUrl}`);
            return { success: true };
            
        } catch (error) {
            console.error(`❌ tsdav delete failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Simple two-way sync
     * @param {string} addressbookUrl - Addressbook URL
     * @param {Array} localContacts - Local contacts to push [{uid, vcard}, ...]
     */
    async sync(addressbookUrl, localContacts = []) {
        console.log(`🔄 Starting sync for: ${addressbookUrl}`);
        
        // 1. Fetch contacts from server
        const fetchResult = await this.fetchContacts(addressbookUrl);
        if (!fetchResult.success) {
            return { success: false, error: fetchResult.error };
        }

        // 2. Push local contacts to server
        let pushedCount = 0;
        let failedCount = 0;
        const results = [];

        for (const contact of localContacts) {
            const pushResult = await this.pushContact(
                addressbookUrl,
                contact.vcard,
                contact.uid
            );
            
            if (pushResult.success) {
                pushedCount++;
            } else {
                failedCount++;
            }
            
            results.push(pushResult);
        }

        console.log(`✅ Sync complete: ${pushedCount} pushed, ${failedCount} failed`);
        
        return {
            success: true,
            contacts: fetchResult.contacts,        // ✅ Match BaikalConnector expected format
            serverContacts: fetchResult.contacts,  // Keep for backward compatibility
            pushedCount,
            failedCount,
            results
        };
    }

    /**
     * Discover addressbooks using PROPFIND
     */
    async discoverAddressbooks() {
        if (!this.connected) {
            throw new Error('Not connected to CardDAV server');
        }

        // Use tsdav backend if enabled
        if (this.useTsdav) {
            return await this.discoverAddressbooksWithTsdav();
        }

        // Default: Native fetch backend
        try {
            const propfindXML = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
    <D:prop>
        <D:displayname/>
        <D:resourcetype/>
        <C:addressbook-description/>
    </D:prop>
</D:propfind>`;

            const discoveryUrl = this.buildUrl(this.config.serverUrl);
            const response = await this.proxyFetch(discoveryUrl, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': this.auth,
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Depth': '1'
                },
                body: propfindXML
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const xmlText = await response.text();
            const addressbooks = this.parseAddressbooksResponse(xmlText);
            
            console.log(`📚 Found ${addressbooks.length} addressbooks`);
            return { success: true, addressbooks };
            
        } catch (error) {
            console.error(`❌ Discovery failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Parse CardDAV multistatus response to extract vCards
     * @param {string} xmlText - XML response from REPORT
     */
    parseMultiStatusResponse(xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        const responses = doc.getElementsByTagNameNS('DAV:', 'response');
        
        const vcards = [];
        for (const response of responses) {
            const addressData = response.getElementsByTagNameNS('urn:ietf:params:xml:ns:carddav', 'address-data')[0];
            const href = response.getElementsByTagNameNS('DAV:', 'href')[0];
            const etag = response.getElementsByTagNameNS('DAV:', 'getetag')[0];
            
            if (addressData && addressData.textContent) {
                const vCardContent = addressData.textContent.trim();
                
                // Extract UID from vCard content
                const uidMatch = vCardContent.match(/^UID:(.+)$/m);
                const uid = uidMatch ? uidMatch[1].trim() : null;
                
                vcards.push({
                    vcard: vCardContent,               // ✅ BaikalConnector expects 'vcard'
                    data: vCardContent,                // Keep for backward compatibility
                    uid: uid,                          // ✅ BaikalConnector expects 'uid'
                    href: href ? href.textContent : '', // ✅ BaikalConnector expects 'href'
                    url: href ? href.textContent : '', // Keep for backward compatibility
                    etag: etag ? etag.textContent.replace(/"/g, '') : '' // ✅ Remove quotes from ETag
                });
            }
        }
        
        return vcards;
    }

    /**
     * Parse addressbook discovery response
     * @param {string} xmlText - XML response from PROPFIND
     */
    parseAddressbooksResponse(xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        const responses = doc.getElementsByTagNameNS('DAV:', 'response');
        
        const addressbooks = [];
        for (const response of responses) {
            const resourcetype = response.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
            const isAddressbook = resourcetype && resourcetype.getElementsByTagNameNS('urn:ietf:params:xml:ns:carddav', 'addressbook').length > 0;
            
            if (isAddressbook) {
                const displayname = response.getElementsByTagNameNS('DAV:', 'displayname')[0];
                const href = response.getElementsByTagNameNS('DAV:', 'href')[0];
                const description = response.getElementsByTagNameNS('urn:ietf:params:xml:ns:carddav', 'addressbook-description')[0];
                
                // ✅ Convert relative href to absolute URL
                let addressbookUrl = href ? href.textContent : '';
                if (addressbookUrl && !addressbookUrl.startsWith('http://') && !addressbookUrl.startsWith('https://')) {
                    // Relative path - combine with server URL
                    const serverUrl = new URL(this.config.serverUrl);
                    addressbookUrl = `${serverUrl.origin}${addressbookUrl}`;
                }
                
                // 🍎 iCloud fix: Remove trailing /card/ suffix which causes 403 errors
                // iCloud returns paths like /20477266537/carddavhome/card/
                // But PUT requests should go to /20477266537/carddavhome/ without /card/
                if (addressbookUrl.endsWith('/card/')) {
                    addressbookUrl = addressbookUrl.slice(0, -6); // Remove '/card/'
                    console.log(`🍎 iCloud: Removed /card/ suffix from addressbook URL`);
                } else if (addressbookUrl.endsWith('/card')) {
                    addressbookUrl = addressbookUrl.slice(0, -5); // Remove '/card'
                    console.log(`🍎 iCloud: Removed /card suffix from addressbook URL`);
                }
                
                addressbooks.push({
                    displayName: displayname ? displayname.textContent : 'Unnamed',
                    url: addressbookUrl,
                    description: description ? description.textContent : ''
                });
            }
        }
        
        return addressbooks;
    }

    /**
     * Discover addressbooks using tsdav backend
     */
    async discoverAddressbooksWithTsdav() {
        try {
            console.log(`🔍 Discovering addressbooks via tsdav...`);
            
            // Call fetchAddressBooks directly on the client (tsdav handles account setup)
            const addressbooks = await this.tsdavClient.fetchAddressBooks();
            
            // Transform tsdav format to SimpleCardDAVBridge format
            const transformed = addressbooks.map(ab => ({
                displayName: ab.displayName || 'Unnamed',
                url: ab.url,
                description: ab.description || ''
            }));
            
            console.log(`✅ Discovered ${transformed.length} addressbooks via tsdav`);
            return transformed;
            
        } catch (error) {
            console.error(`❌ tsdav discovery failed:`, error.message);
            return [];
        }
    }
}

export default SimpleCardDAVBridge;
