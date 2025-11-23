/**
 * CardDAV Bridge Adapter
 * 
 * Direct interface to the lightweight CardDAV bridge (200 lines, tsdav-based)
 * No HTTP server required - direct CardDAV protocol communication
 */

// Lazy-load lite bridge
let SimpleCardDAVBridge = null;

/**
 * Get the lite bridge class
 */
async function getBridgeClass() {
    if (!SimpleCardDAVBridge) {
        // Dynamically import lite bridge
        const { default: LiteBridge } = await import('../../contact-carddav-bridge-lite/index.js');
        SimpleCardDAVBridge = LiteBridge;
    }
    return SimpleCardDAVBridge;
}

/**
 * CardDAV Bridge Interface - Lite Bridge Only
 */
export class CardDAVBridgeAdapter {
    constructor(config = {}) {
        this.config = config;
        this.bridge = null;
        this.connectedProfiles = new Map(); // Store profile → {serverUrl, addressbookUrl} mappings
        
        console.log('🌉 CardDAV Bridge: Using LITE bridge');
    }

    /**
     * Initialize lite bridge
     */
    async initialize() {
        const BridgeClass = await getBridgeClass();
        this.bridge = new BridgeClass(this.config);
        console.log('✅ Lite bridge initialized (200 lines)');
    }

    /**
     * Connect to CardDAV server
     */
    async connect(credentials) {
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
    }

    /**
     * Disconnect from CardDAV server
     */
    disconnect() {
        if (this.bridge) {
            this.bridge.disconnect();
        }
    }

    /**
     * Fetch contacts from addressbook
     */
    async fetchContacts(addressbookUrl) {
        if (!this.bridge) await this.initialize();
        return await this.bridge.fetchContacts(addressbookUrl);
    }

    /**
     * Push contact to CardDAV server
     * @param {string} profileName - CardDAV profile name
     * @param {string} addressbook - Target addressbook (my-contacts/shared-contacts) - unused, kept for compatibility
     * @param {string} vcard - vCard content
     * @param {string} uid - Contact UID
     * @param {string|null} etag - Optional ETag for conflict detection
     */
    async pushContact(profileName, addressbook, vcard, uid, etag = null) {
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
        // Pass etag for RFC 7232 compliant If-Match header
        return await this.bridge.pushContact(profile.addressbookUrl, vcard, uid, etag);
    }

    /**
     * Delete contact from CardDAV server
     * @param {string} profileName - CardDAV profile name
     * @param {string} addressbook - Target addressbook (my-contacts/shared-contacts) - unused, kept for compatibility
     * @param {string} uid - Contact UID
     * @param {string|null} contactUrl - Optional contact URL
     */
    async deleteContact(profileName, addressbook, uid, contactUrl = null) {
        if (!this.bridge) await this.initialize();
        
        // Get addressbook URL from stored profile
        const profile = this.connectedProfiles.get(profileName);
        if (!profile || !profile.addressbookUrl) {
            return {
                success: false,
                error: `No addressbook URL configured for profile "${profileName}". Please connect and select an addressbook first.`
            };
        }
        
        // Construct absolute URL - FIX for relative paths
        let fullContactUrl;
        if (contactUrl) {
            // If href is relative, make it absolute using the addressbook URL
            if (contactUrl.startsWith('/') || !contactUrl.startsWith('http')) {
                // Get base URL without the path
                const url = new URL(profile.addressbookUrl);
                fullContactUrl = `${url.protocol}//${url.host}${contactUrl}`;
            } else {
                // Already absolute
                fullContactUrl = contactUrl;
            }
        } else {
            // Construct from addressbook URL + UID
            fullContactUrl = `${profile.addressbookUrl}${uid}.vcf`;
        }
        
        // 🐛 DEBUG: Log URL construction
        console.log(`🗑️ CardDAVBridgeAdapter.deleteContact:`);
        console.log(`   Profile: ${profileName}`);
        console.log(`   UID: ${uid}`);
        console.log(`   Addressbook URL: ${profile.addressbookUrl}`);
        console.log(`   Original href: ${contactUrl || 'none'}`);
        console.log(`   Final absolute URL: ${fullContactUrl}`);
        
        return await this.bridge.deleteContact(fullContactUrl);
    }

    /**
     * Two-way sync
     * @param {string} profileName - Profile name
     * @param {Array} localContacts - Optional local contacts for comparison
     */
    async sync(profileName, localContacts = []) {
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
    }

    /**
     * Discover addressbooks
     */
    async discoverAddressbooks() {
        if (!this.bridge) await this.initialize();
        return await this.bridge.discoverAddressbooks();
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
            type: 'lite',
            description: 'Lightweight bridge (200 lines, direct tsdav)',
            linesOfCode: 200,
            filesCount: 2,
            hasHttpServer: false
        };
    }
}

export default CardDAVBridgeAdapter;
