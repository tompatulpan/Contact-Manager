/**
 * SimpleCardDAVBridge - Lightweight CardDAV sync library
 * 
 * Inspired by immich-carddav-bridge's simplicity
 * No HTTP server, no complex abstractions, just direct CardDAV operations
 * 
 * Uses native fetch() API - works directly in browser without dependencies
 */

class SimpleCardDAVBridge {
    constructor(config) {
        this.config = config;
        this.auth = null; // Base64 encoded auth header
        this.connected = false;
        
        // 🆕 CORS proxy configuration
        this.proxyUrl = config.proxyUrl || null;
        this.useProxy = config.useProxy !== false && this.proxyUrl !== null;
        this.fallbackToLocal = config.fallbackToLocal !== false;
        this.localServerPatterns = config.localServerPatterns || [
            'localhost', '127.0.0.1', '192.168.', '10.0.', '172.16.'
        ];
        
        if (this.useProxy) {
            console.log(`🔄 CORS proxy enabled: ${this.proxyUrl}`);
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
            // Create Basic Auth header
            const authString = btoa(`${config.username}:${config.password}`);
            this.auth = `Basic ${authString}`;
            
            // Test connection with OPTIONS request
            const testUrl = this.buildUrl(config.serverUrl);
            const response = await fetch(testUrl, {
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

        console.log(`📥 Fetching contacts from: ${addressbookUrl}`);
        
        try {
            // CardDAV REPORT query
            const reportXML = `<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
    <D:prop>
        <D:getetag/>
        <C:address-data/>
    </D:prop>
</C:addressbook-query>`;

            const fetchUrl = this.buildUrl(addressbookUrl);
            const response = await fetch(fetchUrl, {
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

        const vcardUrl = `${addressbookUrl}${uid}.vcf`;
        
        try {
            // Build headers with RFC 7232 compliant If-Match (quoted ETag)
            const headers = {
                'Authorization': this.auth,
                'Content-Type': 'text/vcard; charset=utf-8'
            };
            
            // Add If-Match header with quoted ETag (RFC 7232 requirement)
            if (etag) {
                headers['If-Match'] = `"${etag}"`;
                console.log(`📋 Using ETag for conflict detection: ${etag}`);
            }
            
            // Use PUT to create or update contact
            const pushUrl = this.buildUrl(vcardUrl);
            const response = await fetch(pushUrl, {
                method: 'PUT',
                headers,
                body: vcard
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const action = response.status === 201 ? 'created' : 'updated';
            
            // Try to get ETag from PUT response headers
            let newETag = response.headers.get('ETag');
            
            // If no ETag in PUT response (Radicale), fetch it with HEAD
            if (!newETag) {
                console.log(`⚠️ No ETag in PUT response, fetching with HEAD request...`);
                
                try {
                    const headUrl = this.buildUrl(vcardUrl);
                    const headResponse = await fetch(headUrl, {
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
     * Delete contact from CardDAV server
     * @param {string} vcardUrl - Full vCard URL
     */
    async deleteContact(vcardUrl) {
        if (!this.connected) {
            throw new Error('Not connected to CardDAV server');
        }

        try {
            // 🐛 DEBUG: Log the full DELETE request details
            console.log(`🗑️ Attempting DELETE request:`);
            console.log(`   URL: ${vcardUrl}`);
            console.log(`   Auth: ${this.auth ? 'Present' : 'Missing'}`);
            console.log(`   Connected: ${this.connected}`);
            
            // Try DELETE method first (standard CardDAV)
            const deleteUrl = this.buildUrl(vcardUrl);
            const response = await fetch(deleteUrl, {
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
            const response = await fetch(discoveryUrl, {
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
                
                addressbooks.push({
                    displayName: displayname ? displayname.textContent : 'Unnamed',
                    url: addressbookUrl,
                    description: description ? description.textContent : ''
                });
            }
        }
        
        return addressbooks;
    }
}

export default SimpleCardDAVBridge;
