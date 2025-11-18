/**
 * CardDAV Bridge Adapter
 * 
 * Provides a unified interface that can switch between:
 * - Lightweight Bridge (200 lines, direct tsdav)
 * - Legacy Bridge (5,931 lines, HTTP server)
 * 
 * Controlled by FEATURE_FLAGS.useLiteBridge in app.config.js
 */

import { FEATURE_FLAGS } from '../config/app.config.js';

// Lazy-load bridges to avoid loading both
let SimpleCardDAVBridge = null;
let LegacyBaikalConnector = null;

/**
 * Get the appropriate bridge based on configuration
 */
async function getBridgeClass(useLite) {
    if (useLite) {
        if (!SimpleCardDAVBridge) {
            // Dynamically import lite bridge (Node.js require)
            const { default: LiteBridge } = await import('../../contact-carddav-bridge-lite/index.js');
            SimpleCardDAVBridge = LiteBridge;
        }
        return SimpleCardDAVBridge;
    } else {
        // Use legacy bridge (already imported in BaikalConnector.js)
        return null; // Legacy bridge uses HTTP API, not a class
    }
}

/**
 * Unified CardDAV Bridge Interface
 * Adapts between lite and legacy bridges
 */
export class CardDAVBridgeAdapter {
    constructor(config = {}) {
        this.useLite = config.useLiteBridge ?? FEATURE_FLAGS.useLiteBridge;
        this.config = config;
        this.bridge = null;
        this.legacyBridgeUrl = config.legacyBridgeUrl || 'http://localhost:3001/api';
        this.connectedProfiles = new Map(); // Store profile → {serverUrl, addressbookUrl} mappings
        
        console.log(`🌉 CardDAV Bridge: Using ${this.useLite ? 'LITE' : 'LEGACY'} bridge`);
    }

    /**
     * Initialize bridge
     */
    async initialize() {
        if (this.useLite) {
            const BridgeClass = await getBridgeClass(true);
            this.bridge = new BridgeClass(this.config);
            console.log('✅ Lite bridge initialized (200 lines)');
        } else {
            console.log('✅ Legacy bridge initialized (HTTP API)');
        }
    }

    /**
     * Connect to CardDAV server
     */
    async connect(credentials) {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            const result = await this.bridge.connect(credentials);
            
            // Store profile info for later use
            if (result.success && credentials.profileName) {
                this.connectedProfiles.set(credentials.profileName, {
                    serverUrl: credentials.serverUrl,
                    username: credentials.username,
                    // Will be set after addressbook discovery
                    addressbookUrl: null
                });
            }
            
            return result;
        } else {
            // Legacy bridge: HTTP POST to /connect endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            });
            return await response.json();
        }
    }

    /**
     * Disconnect from CardDAV server
     */
    disconnect() {
        if (this.useLite) {
            if (this.bridge) {
                this.bridge.disconnect();
            }
        } else {
            // Legacy bridge: No explicit disconnect
            console.log('Legacy bridge: No disconnect needed');
        }
    }

    /**
     * Fetch contacts from addressbook
     */
    async fetchContacts(addressbookUrl) {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            return await this.bridge.fetchContacts(addressbookUrl);
        } else {
            // Legacy bridge: HTTP POST to /sync endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addressbookUrl })
            });
            return await response.json();
        }
    }

    /**
     * Push contact to CardDAV server
     * @param {string} profileName - CardDAV profile name
     * @param {string} addressbook - Target addressbook (my-contacts/shared-contacts) - unused for lite bridge
     * @param {string} vcard - vCard content
     * @param {string} uid - Contact UID
     * @param {string|null} etag - Optional ETag for conflict detection
     */
    async pushContact(profileName, addressbook, vcard, uid, etag = null) {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            
            // Get addressbook URL from stored profile
            const profile = this.connectedProfiles.get(profileName);
            if (!profile || !profile.addressbookUrl) {
                return {
                    success: false,
                    error: `No addressbook URL configured for profile "${profileName}". Please connect and select an addressbook first.`
                };
            }
            
            // Lite bridge uses full addressbook URL
            return await this.bridge.pushContact(profile.addressbookUrl, vcard, uid);
        } else {
            // Legacy bridge: HTTP POST to /push/:profileName endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/push/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contact: { vcard, uid },
                    addressbook,
                    etag
                })
            });
            return await response.json();
        }
    }

    /**
     * Delete contact from CardDAV server
     * @param {string} profileName - CardDAV profile name
     * @param {string} addressbook - Target addressbook (my-contacts/shared-contacts) - unused for lite bridge
     * @param {string} uid - Contact UID
     * @param {string|null} contactUrl - Optional contact URL
     */
    async deleteContact(profileName, addressbook, uid, contactUrl = null) {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            
            // Get addressbook URL from stored profile
            const profile = this.connectedProfiles.get(profileName);
            if (!profile || !profile.addressbookUrl) {
                return {
                    success: false,
                    error: `No addressbook URL configured for profile "${profileName}". Please connect and select an addressbook first.`
                };
            }
            
            // Construct contact URL: addressbookUrl + uid.vcf
            const fullContactUrl = contactUrl || `${profile.addressbookUrl}${uid}.vcf`;
            return await this.bridge.deleteContact(fullContactUrl);
        } else {
            // Legacy bridge: HTTP DELETE to /delete/:profileName endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/delete/${profileName}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    uid,
                    contactUrl,
                    addressbook
                })
            });
            return await response.json();
        }
    }

    /**
     * Two-way sync
     * @param {string} profileName - Profile name
     * @param {Array} localContacts - Optional local contacts for comparison
     */
    async sync(profileName, localContacts = []) {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            
            // Get addressbook URL from stored profile
            const profile = this.connectedProfiles.get(profileName);
            if (!profile || !profile.addressbookUrl) {
                return {
                    success: false,
                    error: `No addressbook URL configured for profile "${profileName}". Please connect and select an addressbook first.`
                };
            }
            
            return await this.bridge.sync(profile.addressbookUrl, localContacts);
        } else {
            // Legacy bridge: HTTP POST to /sync/:profileName endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/sync/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ localContacts })
            });
            return await response.json();
        }
    }

    /**
     * Discover addressbooks
     */
    async discoverAddressbooks() {
        if (this.useLite) {
            if (!this.bridge) await this.initialize();
            return await this.bridge.discoverAddressbooks();
        } else {
            // Legacy bridge: HTTP GET to /discover endpoint
            const response = await fetch(`${this.legacyBridgeUrl}/discover`);
            return await response.json();
        }
    }

    /**
     * Set addressbook URL for a profile (for lite bridge)
     * @param {string} profileName - Profile name
     * @param {string} addressbookUrl - Addressbook URL to use for this profile
     */
    setAddressbookUrl(profileName, addressbookUrl) {
        const profile = this.connectedProfiles.get(profileName);
        if (profile) {
            profile.addressbookUrl = addressbookUrl;
            console.log(`📚 Set addressbook URL for ${profileName}: ${addressbookUrl}`);
            console.log(`📍 URL type: ${addressbookUrl.startsWith('http') ? 'absolute' : 'relative'}`);
        } else {
            console.warn(`⚠️ Cannot set addressbook URL: profile "${profileName}" not found`);
        }
    }

    /**
     * Get bridge info
     */
    getBridgeInfo() {
        return {
            type: this.useLite ? 'lite' : 'legacy',
            description: this.useLite 
                ? 'Lightweight bridge (200 lines, direct tsdav)'
                : 'Legacy bridge (5,931 lines, HTTP server)',
            linesOfCode: this.useLite ? 200 : 5931,
            filesCount: this.useLite ? 2 : 24,
            hasHttpServer: !this.useLite
        };
    }
}

export default CardDAVBridgeAdapter;
