import { APP_CONFIG } from '../config/app.config.js';

/**
 * iCloud CardDAV Client using Cloudflare CORS Proxy
 * 
 * Usage:
 * const client = new ICloudCardDAVClient(
 *     'your@icloud.com',
 *     'xxxx-xxxx-xxxx-xxxx'
 * );
 * await client.connect();
 * const contacts = await client.fetchContacts();
 */

export class ICloudCardDAVClient {
    constructor(username, password, proxyUrl = null) {
        this.username = username;
        this.password = password;
        this.proxyUrl = proxyUrl || APP_CONFIG.iCloud.proxyUrl;
        this.proxyToken = APP_CONFIG.iCloud.proxyToken || APP_CONFIG.cardDAV?.proxyToken || null;
        this.iCloudBase = APP_CONFIG.iCloud.baseUrl;
        
        this.principalUrl = null;
        this.addressBookUrl = null;
        this.isConnected = false;
    }

    /**
     * Build proxy URL with target parameter
     */
    buildProxyUrl(targetUrl) {
        const proxyUrl = `${this.proxyUrl}?target=${encodeURIComponent(targetUrl)}`;
        console.log(`🔗 buildProxyUrl:`, {
            input: targetUrl,
            proxyBase: this.proxyUrl,
            output: proxyUrl,
            encoded: encodeURIComponent(targetUrl)
        });
        return proxyUrl;
    }

    /**
     * Fetch wrapper that injects X-Worker-Token for all proxied requests.
     */
    async proxyFetch(url, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (this.proxyToken) {
            headers['X-Worker-Token'] = this.proxyToken;
        }
        return fetch(url, { ...options, headers });
    }

    /**
     * Create Basic Auth header
     */
    makeAuthHeader() {
        return 'Basic ' + btoa(this.username + ':' + this.password);
    }

    /**
     * Connect and discover CardDAV endpoints
     */
    async connect() {
        console.log('🔗 Connecting to iCloud CardDAV...');
        
        try {
            // Step 1: Discover principal
            this.principalUrl = await this.discoverPrincipal();
            if (!this.principalUrl) {
                throw new Error('Failed to discover principal URL');
            }
            console.log(`✅ Principal: ${this.principalUrl}`);

            // Step 2: Discover address book
            this.addressBookUrl = await this.discoverAddressBook();
            if (!this.addressBookUrl) {
                throw new Error('Failed to discover address book URL');
            }
            console.log(`✅ Address Book: ${this.addressBookUrl}`);

            this.isConnected = true;
            return { success: true, principalUrl: this.principalUrl, addressBookUrl: this.addressBookUrl };

        } catch (error) {
            console.error('❌ Connection failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Step 1: Discover principal URL
     */
    async discoverPrincipal() {
        const targetUrl = this.iCloudBase + '/';
        const proxyUrl = this.buildProxyUrl(targetUrl);

        console.log('🔍 Discover Principal Request:');
        console.log('   Target URL:', targetUrl);
        console.log('   Proxy URL:', proxyUrl);
        console.log('   Auth Header:', this.makeAuthHeader().substring(0, 20) + '...');

        const response = await this.proxyFetch(proxyUrl, {
            method: 'PROPFIND',
            headers: {
                'Authorization': this.makeAuthHeader(),
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`
        });

        console.log('📡 Response status:', response.status, response.statusText);

        if (!response.ok) {
            // Try to get response body for debugging
            const responseText = await response.text().catch(() => 'Could not read response');
            console.error('❌ Response body:', responseText.substring(0, 500));
            throw new Error(`PROPFIND failed: ${response.status}`);
        }

        const text = await response.text();
        const match = text.match(/<(?:\w+:)?current-user-principal>\s*<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
        
        return match ? match[1] : null;
    }

    /**
     * Step 2: Discover address book URL
     */
    async discoverAddressBook() {
        const targetUrl = this.iCloudBase + this.principalUrl;
        const proxyUrl = this.buildProxyUrl(targetUrl);

        const response = await this.proxyFetch(proxyUrl, {
            method: 'PROPFIND',
            headers: {
                'Authorization': this.makeAuthHeader(),
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <card:addressbook-home-set/>
  </d:prop>
</d:propfind>`
        });

        if (!response.ok) {
            throw new Error(`PROPFIND failed: ${response.status}`);
        }

        const text = await response.text();
        
        // Try multiple patterns to find address book URL (from diagnose-icloud.html)
        let addressBookUrl = null;
        
        // Pattern 1: addressbook-home-set with href (may include full URL)
        let match = text.match(/<(?:\w+:)?addressbook-home-set>\s*<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/i);
        if (match) {
            let url = match[1];
            // Extract path from full URL if present (e.g., https://p68-contacts.icloud.com:443/20477266537/carddavhome/)
            if (url.startsWith('http')) {
                try {
                    const urlObj = new URL(url);
                    addressBookUrl = urlObj.pathname; // Get just the path
                    console.log(`✅ Pattern 1 (full URL): ${url}`);
                    console.log(`   Extracted path: ${addressBookUrl}`);
                } catch (e) {
                    console.log(`⚠️ Failed to parse URL: ${url}`);
                }
            } else {
                addressBookUrl = url;
                console.log(`✅ Pattern 1 (relative path): ${addressBookUrl}`);
            }
        }
        
        // Pattern 2: href inside addressbook-home-set (any format)
        if (!addressBookUrl) {
            match = text.match(/addressbook-home-set[^>]*>[\s\S]*?<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/i);
            if (match) {
                let url = match[1];
                if (url.startsWith('http')) {
                    try {
                        const urlObj = new URL(url);
                        addressBookUrl = urlObj.pathname;
                        console.log(`✅ Pattern 2 (full URL): ${url}`);
                        console.log(`   Extracted path: ${addressBookUrl}`);
                    } catch (e) {
                        console.log(`⚠️ Failed to parse URL: ${url}`);
                    }
                } else {
                    addressBookUrl = url;
                    console.log(`✅ Pattern 2 (relative path): ${addressBookUrl}`);
                }
            }
        }
        
        // Pattern 3: Any href that looks like an addressbook path
        if (!addressBookUrl) {
            match = text.match(/<(?:\w+:)?href>([^<]*\/carddavhome\/[^<]*)<\/(?:\w+:)?href>/i);
            if (match) {
                let url = match[1];
                if (url.startsWith('http')) {
                    try {
                        const urlObj = new URL(url);
                        addressBookUrl = urlObj.pathname;
                        console.log(`✅ Pattern 3 (full URL): ${url}`);
                        console.log(`   Extracted path: ${addressBookUrl}`);
                    } catch (e) {
                        console.log(`⚠️ Failed to parse URL: ${url}`);
                    }
                } else {
                    addressBookUrl = url;
                    console.log(`✅ Pattern 3 (carddavhome path): ${addressBookUrl}`);
                }
            }
        }
        
        if (addressBookUrl) {
            // iCloud addressbook path should end with 'card/'
            if (!addressBookUrl.endsWith('card/') && !addressBookUrl.endsWith('card')) {
                addressBookUrl = addressBookUrl.replace(/\/$/, '') + '/card/';
                console.log(`📍 Adjusted addressbook path to: ${addressBookUrl}`);
            }
            
            console.log(`✅ Address book discovered: ${addressBookUrl}`);
            return addressBookUrl;
        }
        
        // Fallback: construct from principal URL if discovery fails
        const principalMatch = this.principalUrl.match(/\/(\d+)\/principal\//);
        if (principalMatch) {
            const userId = principalMatch[1];
            const fallbackPath = `/${userId}/carddavhome/card/`;
            console.log(`⚠️ Using fallback addressbook path: ${fallbackPath}`);
            return fallbackPath;
        }
        
        return null;
    }

    /**
     * Fetch all contacts from iCloud
     */
    async fetchContacts() {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        console.log('📥 Fetching contacts from iCloud...');

        // addressBookUrl already ends with /card/ - don't append it again
        const targetUrl = this.iCloudBase + this.addressBookUrl;
        const proxyUrl = this.buildProxyUrl(targetUrl);

        const response = await this.proxyFetch(proxyUrl, {
            method: 'REPORT',
            headers: {
                'Authorization': this.makeAuthHeader(),
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '1'
            },
            body: `<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
</card:addressbook-query>`
        });

        if (!response.ok) {
            throw new Error(`REPORT failed: ${response.status}`);
        }

        const text = await response.text();
        return this.parseContactsFromXML(text);
    }

    /**
     * Parse contacts from XML response
     * @updated 2025-11-30T04:19:00Z - FIXED: Extract ETags and hrefs from XML
     */
    parseContactsFromXML(xml) {
        const contacts = [];
        
        // Parse XML using DOMParser
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        
        // Get all response elements
        const responses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
        
        for (const response of responses) {
            try {
                // Extract href (contact URL)
                const hrefElement = response.getElementsByTagNameNS('DAV:', 'href')[0];
                const href = hrefElement ? hrefElement.textContent.trim() : null;
                
                // Extract ETag
                const etagElement = response.getElementsByTagNameNS('DAV:', 'getetag')[0];
                const etag = etagElement ? etagElement.textContent.trim() : null;
                
                // Extract vCard data
                const addressDataElements = response.getElementsByTagNameNS('urn:ietf:params:xml:ns:carddav', 'address-data');
                if (addressDataElements.length === 0) continue;
                
                let vcardRaw = addressDataElements[0].textContent;
                if (!vcardRaw || !vcardRaw.includes('BEGIN:VCARD')) continue;
                
                // Clean up XML formatting artifacts
                vcardRaw = vcardRaw.replace(/&#13;\n\s+/g, '');  // entity CR + real LF + spaces
                vcardRaw = vcardRaw.replace(/&#10;\n\s+/g, '');  // entity LF + real LF + spaces
                let vcard = vcardRaw;
                
                // Step 1: Protect newlines inside quoted LABEL parameters
                // Now convert remaining vCard entities to escaped newlines (for vCard format)
                vcard = vcard.replace(/LABEL="([\s\S]*?)"/g, (match, labelContent) => {
                    // Convert vCard entity newlines to escaped \n format
                    const protectedLabel = labelContent
                        .replace(/&#13;&#10;/g, '\\n')  // Convert vCard CRLF entities to escaped newline
                        .replace(/&#13;/g, '\\n')       // Convert vCard CR entities to escaped newline
                        .replace(/&#10;/g, '\\n')       // Convert vCard LF entities to escaped newline
                        .replace(/&quot;/g, '"')        // Decode quotes inside LABEL
                        .replace(/&amp;/g, '&');        // Decode ampersands inside LABEL
                    return `LABEL="${protectedLabel}"`;
                });
                
                // Step 2: Now decode remaining entities (outside quotes)
                vcard = vcard
                    .replace(/&#13;&#10;/g, '\r\n')  // CRLF for line breaks
                    .replace(/&#13;/g, '\r')          // CR for line breaks
                    .replace(/&#10;/g, '\n')          // LF for line breaks
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>');

                // ⏰ DEBUG ADDED 2025-11-30T03:16:21Z - BYTE-LEVEL INSPECTION
                if (contacts.length === 0 && vcard.includes('LABEL=')) {
                    console.log('🐛🐛🐛 WHITESPACE DEBUG ACTIVE 🐛🐛🐛');
                    
                    // Show raw vCard snippet with LABEL (first 500 chars for context)
                    const labelStartIdx = vcardRaw.indexOf('LABEL=');
                    if (labelStartIdx >= 0) {
                        const snippet = vcardRaw.substring(labelStartIdx, labelStartIdx + 500);
                        console.log('🐛 RAW vCard snippet (with entities):', snippet);
                        
                        // Show byte codes for the problematic section
                        const bytes = Array.from(snippet).map(c => {
                            const code = c.charCodeAt(0);
                            if (code === 13) return `\\r(13)`;
                            if (code === 10) return `\\n(10)`;
                            if (code === 9) return `\\t(9)`;
                            if (code === 32) return `_(32)`;
                            if (code < 32 || code > 126) return `?(${code})`;
                            return c;
                        }).join('');
                        console.log('🐛 Byte codes (CR=\\r(13), LF=\\n(10), Space=_(32), Tab=\\t(9)):', bytes.substring(0, 400));
                    }
                    
                    // Show processed LABEL AFTER protection
                    const labelMatches = vcard.match(/LABEL="([^"]+)"/g);
                    if (labelMatches) {
                        console.log('🐛 PROTECTED LABEL (after protection):', labelMatches);
                        // Show if whitespace artifacts remain
                        labelMatches.forEach((label, i) => {
                            if (label.includes('\r') || label.includes('\n')) {
                                console.log(`⚠️ Label ${i} still has raw line breaks:`, label);
                            }
                        });
                    }
                }
                
                const contact = this.parseVCard(vcard);
                
                // ⭐ CRITICAL FIX: Add ETag and href to contact
                contact.etag = etag;
                contact.href = href;
                
                // Debug: Log first contact's addresses to verify parsing
                if (contacts.length === 0 && contact.addresses && contact.addresses.length > 0) {
                    console.log('🐛 First contact addresses after parsing:', 
                        contact.addresses.map(addr => ({
                            type: addr.type,
                            label: addr.label,
                            street: addr.street,
                            city: addr.city,
                            country: addr.country
                        }))
                    );
                }
                
                contacts.push(contact);
            } catch (error) {
                console.error('❌ Error parsing contact response:', error);
                // Continue with next contact
            }
        }

        console.log(`✅ Fetched ${contacts.length} contact(s)`);
        return contacts;
    }

    /**
     * Parse vCard 3.0 string into contact object
     * FIXED: Protect quoted newlines before splitting (handles LABEL parameters)
     */
    parseVCard(vcard) {
        // Protect literal \n inside quotes to prevent incorrect line splitting
        const protectedVCard = this.protectQuotedNewlines(vcard);
        const lines = protectedVCard.split('\n').map(line => line.trim()).filter(line => line);
        // Restore protected newlines
        const restoredLines = lines.map(line => this.restoreQuotedNewlines(line));
        
        const contact = {
            vcard: vcard,
            uid: null,
            fullName: null,
            phones: [],
            emails: [],
            urls: [],
            addresses: [],
            organization: null,
            title: null,
            birthday: null,
            note: null
        };

        for (const line of restoredLines) {
            if (line.startsWith('UID:')) {
                contact.uid = line.substring(4);
            } else if (line.startsWith('FN:')) {
                contact.fullName = line.substring(3);
            } else if (line.startsWith('TEL')) {
                const match = line.match(/TEL;TYPE=([^:]+):(.+)/);
                if (match) {
                    contact.phones.push({ type: match[1].toLowerCase(), value: match[2] });
                } else {
                    const simpleMatch = line.match(/TEL:(.+)/);
                    if (simpleMatch) {
                        contact.phones.push({ type: 'other', value: simpleMatch[1] });
                    }
                }
            } else if (line.startsWith('EMAIL')) {
                const match = line.match(/EMAIL;[^:]*:(.+)/);
                if (match) {
                    contact.emails.push(match[1]);
                } else {
                    const simpleMatch = line.match(/EMAIL:(.+)/);
                    if (simpleMatch) {
                        contact.emails.push(simpleMatch[1]);
                    }
                }
            } else if (line.startsWith('URL')) {
                const match = line.match(/URL;TYPE=([^:]+):(.+)/);
                if (match) {
                    contact.urls.push({ type: match[1].toLowerCase(), value: match[2] });
                } else {
                    const simpleMatch = line.match(/URL:(.+)/);
                    if (simpleMatch) {
                        contact.urls.push({ type: 'other', value: simpleMatch[1] });
                    }
                }
            } else if (line.startsWith('ORG:')) {
                contact.organization = line.substring(4).replace(/\\;/g, ';');
            } else if (line.startsWith('TITLE:')) {
                contact.title = line.substring(6);
            } else if (line.startsWith('BDAY:')) {
                contact.birthday = line.substring(5);
            } else if (line.startsWith('NOTE:')) {
                contact.note = line.substring(5);
            } else if (line.startsWith('ADR')) {
                const match = line.match(/ADR;TYPE=([^:]+):(.+)/);
                if (match) {
                    contact.addresses.push({ type: match[1].toLowerCase(), value: match[2] });
                }
            }
        }

        return contact;
    }

    /**
     * Normalize vCard line endings to RFC 2426 format (\r\n)
     * iCloud requires proper CRLF line endings
     */
    normalizeVCardLineEndings(vcard) {
        // First normalize to \n, then convert to \r\n
        return vcard.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
    }

    /**
     * Fetch a single contact by UID to get fresh ETag
     * Used for ETag refresh after 412 Precondition Failed errors
     * @added 2025-11-30T09:15:00Z - For handling 412 conflicts
     */
    async getContactByUID(uid) {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        console.log(`🔍 Fetching contact by UID: ${uid}`);

        const targetUrl = this.iCloudBase + this.addressBookUrl;
        const proxyUrl = this.buildProxyUrl(targetUrl);

        try {
            const response = await this.proxyFetch(proxyUrl, {
                method: 'REPORT',
                headers: {
                    'Authorization': this.makeAuthHeader(),
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Depth': '1'
                },
                body: `<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
  <card:filter>
    <card:prop-filter name="UID">
      <card:text-match>${uid}</card:text-match>
    </card:prop-filter>
  </card:filter>
</card:addressbook-query>`
            });

            if (!response.ok) {
                return { success: false, error: `REPORT failed: ${response.status}` };
            }

            const text = await response.text();
            const contacts = this.parseContactsFromXML(text);
            
            if (contacts.length === 0) {
                return { success: false, error: 'Contact not found' };
            }

            const contact = contacts[0];
            console.log(`✅ Found contact with ETag: ${contact.etag}`);
            
            return {
                success: true,
                etag: contact.etag,
                href: contact.href,
                vcard: contact.vcard,
                uid: contact.uid
            };

        } catch (error) {
            console.error('❌ Failed to fetch contact by UID:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create new contact on iCloud
     */
    async createContact(vcard) {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Normalize line endings to \r\n (RFC 2426 requirement)
        vcard = this.normalizeVCardLineEndings(vcard);

        // Extract UID from vCard or generate one
        const uidMatch = vcard.match(/UID:([^\r\n]+)/);
        let uid = uidMatch ? uidMatch[1].trim() : null;
        
        // Validate UID - if invalid, generate new one and update vCard
        if (!uid || !this.isValidICloudUID(uid)) {
            const oldUID = uid || 'none';
            uid = this.generateUID();
            console.log(`⚠️ Invalid UID detected ("${oldUID}"), regenerating: ${uid}`);
            
            // Replace UID in vCard
            if (uidMatch) {
                vcard = vcard.replace(/UID:[^\r\n]+/g, `UID:${uid}`);
            } else {
                // Insert UID after VERSION line
                vcard = vcard.replace(/(VERSION:[^\r\n]+[\r\n]+)/, `$1UID:${uid}\r\n`);
            }
        }

        // addressBookUrl already ends with /card/ - just append uid and .vcf
        const targetUrl = this.iCloudBase + this.addressBookUrl + uid + '.vcf';
        const proxyUrl = this.buildProxyUrl(targetUrl);

        const response = await this.proxyFetch(proxyUrl, {
            method: 'PUT',
            headers: {
                'Authorization': this.makeAuthHeader(),
                'Content-Type': 'text/vcard; charset=utf-8'
            },
            body: vcard
        });

        if (response.ok || response.status === 201) {
            console.log(`✅ Created contact: ${uid}`);
            return { success: true, uid, etag: response.headers.get('etag'), href: targetUrl };
        } else {
            const error = await response.text();
            console.error(`❌ Failed to create contact (${response.status}): ${error}`);
            console.error(`   URL: ${targetUrl}`);
            console.error(`   UID: ${uid}`);
            return { success: false, error: `${response.status} - ${error}`, status: response.status };
        }
    }

    /**
     * Update existing contact on iCloud
     */
    async updateContact(uid, vcard, etag = null) {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Normalize line endings to \r\n (RFC 2426 requirement)
        vcard = this.normalizeVCardLineEndings(vcard);

        // addressBookUrl already ends with /card/ - just append uid and .vcf
        const targetUrl = this.iCloudBase + this.addressBookUrl + uid + '.vcf';
        const proxyUrl = this.buildProxyUrl(targetUrl);

        const headers = {
            'Authorization': this.makeAuthHeader(),
            'Content-Type': 'text/vcard; charset=utf-8'
        };

        // Add If-Match for conflict detection
        if (etag) {
            headers['If-Match'] = etag;
        }

        const response = await this.proxyFetch(proxyUrl, {
            method: 'PUT',
            headers,
            body: vcard
        });

        if (response.ok || response.status === 204) {
            console.log(`✅ Updated contact: ${uid}`);
            return { success: true, uid, etag: response.headers.get('etag') };
        } else {
            const error = await response.text();
            console.error(`❌ Failed to update contact (${response.status}): ${error}`);
            return { success: false, error: `${response.status} - ${error}`, status: response.status };
        }
    }

    /**
     * Delete contact from iCloud
     */
    async deleteContact(uid, etag = null) {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // addressBookUrl already ends with /card/ - just append uid and .vcf
        const targetUrl = this.iCloudBase + this.addressBookUrl + uid + '.vcf';
        const proxyUrl = this.buildProxyUrl(targetUrl);

        const headers = {
            'Authorization': this.makeAuthHeader()
        };

        // Add If-Match for conflict detection
        if (etag) {
            headers['If-Match'] = etag;
        }

        const response = await this.proxyFetch(proxyUrl, {
            method: 'DELETE',
            headers
        });

        if (response.ok || response.status === 204) {
            console.log(`✅ Deleted contact: ${uid}`);
            return { success: true, uid };
        } else {
            const error = await response.text();
            console.error(`❌ Failed to delete contact: ${error}`);
            return { success: false, error, status: response.status };
        }
    }

    /**
     * Validate UID format for iCloud compatibility
     * Accept any UID format - iCloud will use its own format if needed
     * Only reject truly invalid UIDs (empty, too short, plain numbers)
     */
    isValidICloudUID(uid) {
        if (!uid || uid.length < 5) return false;
        
        // Reject plain numbers only
        if (/^\d+$/.test(uid)) return false;
        
        // Accept all other formats (including iCloud's AF559AB3-... format)
        return true;
    }

    /**
     * Generate UUID for new contacts
     */
    generateUID() {
        return 'icloud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Temporarily replace literal \n inside quoted strings to prevent line splitting
     * @param {string} vCardString - vCard content
     * @returns {string} - Protected vCard content
     */
    protectQuotedNewlines(vCardString) {
        let result = '';
        let inQuotes = false;
        
        for (let i = 0; i < vCardString.length; i++) {
            const char = vCardString[i];
            const nextChar = vCardString[i + 1];
            
            if (char === '"') {
                inQuotes = !inQuotes;
                result += char;
            } else if (inQuotes && char === '\\' && nextChar === 'n') {
                // Replace \n with placeholder inside quotes
                result += '\x00NEWLINE\x00';
                i++; // Skip the 'n'
            } else {
                result += char;
            }
        }
        
        return result;
    }
    
    /**
     * Restore literal \n in quoted strings after line splitting
     * @param {string} line - Split line
     * @returns {string} - Line with restored newlines
     */
    restoreQuotedNewlines(line) {
        return line.replace(/\x00NEWLINE\x00/g, '\\n');
    }
}
