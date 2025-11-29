/**
 * ICloudConnector - iCloud CardDAV Integration
 * 
 * Handles iCloud-specific CardDAV operations with app-specific password authentication
 * Built on SimpleCardDAVBridge for standard CardDAV operations
 */

// Lazy-load bridge
let SimpleCardDAVBridge = null;

async function getBridgeClass() {
    if (!SimpleCardDAVBridge) {
        const { default: LiteBridge } = await import('../../contact-carddav-bridge-lite/index.js');
        SimpleCardDAVBridge = LiteBridge;
    }
    return SimpleCardDAVBridge;
}

export class ICloudConnector {
    constructor(eventBus = null, proxyConfig = {}) {
        this.eventBus = eventBus;
        this.bridge = null;
        this.isConnected = false;
        this.currentProfile = null;
        
        // Store proxy configuration for bridge initialization
        this.proxyConfig = proxyConfig;
        
        // iCloud-specific configuration
        this.iCloudConfig = {
            serverUrl: 'https://contacts.icloud.com/',
            discoveryPath: '/',
            addressbookBasePath: '/carddavhome/card/'
        };
    }

    /**
     * Connect to iCloud CardDAV with app-specific password
     * @param {Object} credentials - { appleId, appSpecificPassword }
     * @returns {Promise<Object>} Connection result with addressbooks
     */
    async connect(credentials) {
        try {
            console.log('🍎 Connecting to iCloud CardDAV...');
            console.log(`   Apple ID: ${credentials.appleId}`);
            
            // Validate credentials format
            const validation = this.validateCredentials(credentials);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            // Initialize bridge with iCloud server and proxy config
            const BridgeClass = await getBridgeClass();
            this.bridge = new BridgeClass({
                serverUrl: this.iCloudConfig.serverUrl,
                username: credentials.appleId,
                password: credentials.appSpecificPassword,
                ...this.proxyConfig  // Add proxy configuration
            });

            // Connect to server
            const connectResult = await this.bridge.connect();
            if (!connectResult.success) {
                throw new Error(`Connection failed: ${connectResult.error}`);
            }

            // Discover addressbooks (finds numeric user ID)
            const discoveryResult = await this.bridge.discoverAddressbooks();
            if (!discoveryResult.success || discoveryResult.addressbooks.length === 0) {
                throw new Error('No addressbooks found. Please check your Apple ID and app-specific password.');
            }

            // Use first addressbook (iCloud typically has one main addressbook)
            const primaryAddressbook = discoveryResult.addressbooks[0];
            
            this.isConnected = true;
            this.currentProfile = {
                name: 'iCloud',
                serverType: 'iCloud',
                appleId: credentials.appleId,
                addressbookUrl: primaryAddressbook.url,
                displayName: primaryAddressbook.displayName,
                connectedAt: new Date().toISOString()
            };

            console.log(`✅ Connected to iCloud addressbook: ${primaryAddressbook.displayName}`);
            console.log(`📍 URL: ${primaryAddressbook.url}`);

            if (this.eventBus) {
                this.eventBus.emit('icloud:connected', {
                    profile: this.currentProfile,
                    addressbooks: discoveryResult.addressbooks
                });
            }

            return {
                success: true,
                profile: this.currentProfile,
                addressbooks: discoveryResult.addressbooks,
                primaryAddressbook
            };

        } catch (error) {
            console.error('❌ iCloud connection failed:', error);
            
            if (this.eventBus) {
                this.eventBus.emit('icloud:connectionError', {
                    error: error.message,
                    appleId: credentials.appleId
                });
            }

            return {
                success: false,
                error: error.message,
                errorType: this.categorizeError(error)
            };
        }
    }

    /**
     * Disconnect from iCloud CardDAV
     */
    disconnect() {
        if (this.bridge) {
            this.bridge.disconnect();
        }
        
        this.isConnected = false;
        const previousProfile = this.currentProfile;
        this.currentProfile = null;

        console.log('🔌 Disconnected from iCloud CardDAV');

        if (this.eventBus) {
            this.eventBus.emit('icloud:disconnected', {
                profile: previousProfile
            });
        }

        return { success: true };
    }

    /**
     * Fetch all contacts from iCloud
     * @returns {Promise<Object>} Fetch result with contacts
     */
    async fetchContacts() {
        if (!this.isConnected || !this.currentProfile) {
            throw new Error('Not connected to iCloud CardDAV');
        }

        try {
            console.log('📥 Fetching contacts from iCloud...');
            
            const result = await this.bridge.fetchContacts(
                this.currentProfile.addressbookUrl
            );

            if (result.success) {
                console.log(`✅ Fetched ${result.contacts.length} contacts from iCloud`);
                
                if (this.eventBus) {
                    this.eventBus.emit('icloud:contactsFetched', {
                        profile: this.currentProfile,
                        contactCount: result.contacts.length
                    });
                }
            }

            return result;

        } catch (error) {
            console.error('❌ iCloud fetch failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Push contact to iCloud
     * @param {Object} contact - Contact with vcard and contactId
     * @param {string|null} etag - Optional ETag for conflict detection
     * @returns {Promise<Object>} Push result
     */
    async pushContact(contact, etag = null) {
        if (!this.isConnected || !this.currentProfile) {
            throw new Error('Not connected to iCloud CardDAV');
        }

        try {
            const uid = this.extractUIDFromVCard(contact.vcard);
            
            const result = await this.bridge.pushContact(
                this.currentProfile.addressbookUrl,
                contact.vcard,
                uid,
                etag
            );

            if (result.success && this.eventBus) {
                this.eventBus.emit('icloud:contactPushed', {
                    profile: this.currentProfile,
                    contactId: contact.contactId,
                    action: result.action,
                    etag: result.etag
                });
            }

            return result;

        } catch (error) {
            console.error('❌ iCloud push failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Delete contact from iCloud
     * @param {Object} contact - Contact with href or contactId
     * @returns {Promise<Object>} Delete result
     */
    async deleteContact(contact) {
        if (!this.isConnected || !this.currentProfile) {
            throw new Error('Not connected to iCloud CardDAV');
        }

        try {
            const vcardUrl = contact.metadata?.cardDAV?.href || 
                           `${this.currentProfile.addressbookUrl}${contact.contactId}.vcf`;

            const result = await this.bridge.deleteContact(vcardUrl);

            if (result.success && this.eventBus) {
                this.eventBus.emit('icloud:contactDeleted', {
                    profile: this.currentProfile,
                    contactId: contact.contactId
                });
            }

            return result;

        } catch (error) {
            console.error('❌ iCloud delete failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sync contacts with iCloud (two-way)
     * @param {Array} localContacts - Local contacts to push
     * @returns {Promise<Object>} Sync result
     */
    async sync(localContacts = []) {
        if (!this.isConnected || !this.currentProfile) {
            throw new Error('Not connected to iCloud CardDAV');
        }

        try {
            console.log('🔄 Starting iCloud sync...');
            
            const result = await this.bridge.sync(
                this.currentProfile.addressbookUrl,
                localContacts
            );

            if (result.success && this.eventBus) {
                this.eventBus.emit('icloud:syncCompleted', {
                    profile: this.currentProfile,
                    contactCount: result.contacts?.length || 0,
                    pushedCount: result.pushedCount,
                    failedCount: result.failedCount
                });
            }

            return result;

        } catch (error) {
            console.error('❌ iCloud sync failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validate iCloud credentials
     * @param {Object} credentials - { appleId, appSpecificPassword }
     * @returns {Object} Validation result
     */
    validateCredentials(credentials) {
        // Check Apple ID format
        if (!credentials.appleId || !credentials.appleId.includes('@')) {
            return {
                isValid: false,
                error: 'Invalid Apple ID format. Must be a valid email address.'
            };
        }

        // Check app-specific password format (xxxx-xxxx-xxxx-xxxx)
        if (!credentials.appSpecificPassword) {
            return {
                isValid: false,
                error: 'App-specific password is required.'
            };
        }

        const passwordPattern = /^[a-zA-Z0-9\-]{19}$/;
        if (!passwordPattern.test(credentials.appSpecificPassword)) {
            return {
                isValid: false,
                error: 'Invalid app-specific password format. Should be 16 characters with dashes (xxxx-xxxx-xxxx-xxxx).'
            };
        }

        return { isValid: true };
    }

    /**
     * Categorize connection errors for better user feedback
     * @param {Error} error - Connection error
     * @returns {string} Error category
     */
    categorizeError(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('401') || message.includes('unauthorized')) {
            return 'invalid_credentials';
        } else if (message.includes('no addressbooks')) {
            return 'no_addressbooks';
        } else if (message.includes('network') || message.includes('fetch')) {
            return 'network_error';
        } else if (message.includes('timeout')) {
            return 'timeout';
        }
        
        return 'unknown_error';
    }

    /**
     * Extract UID from vCard content
     * @param {string} vcard - vCard content
     * @returns {string} UID value
     */
    extractUIDFromVCard(vcard) {
        const match = vcard.match(/^UID:(.+)$/m);
        if (!match) {
            throw new Error('vCard missing UID property');
        }
        return match[1].trim();
    }

    /**
     * Get current connection status
     * @returns {Object} Connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            profile: this.currentProfile,
            serverType: 'iCloud',
            serverUrl: this.iCloudConfig.serverUrl
        };
    }

    /**
     * Test connection to iCloud CardDAV
     * @returns {Promise<Object>} Test result
     */
    async testConnection() {
        if (!this.isConnected || !this.bridge) {
            return {
                success: false,
                error: 'Not connected to iCloud CardDAV'
            };
        }

        try {
            // Try to fetch addressbooks as connection test
            const result = await this.bridge.discoverAddressbooks();
            
            return {
                success: result.success,
                addressbookCount: result.addressbooks?.length || 0,
                profile: this.currentProfile
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get iCloud setup instructions
     * @returns {Object} Setup instructions
     */
    static getSetupInstructions() {
        return {
            title: '🍎 iCloud CardDAV Setup',
            steps: [
                {
                    step: 1,
                    title: 'Generate App-Specific Password',
                    instructions: [
                        'Go to https://appleid.apple.com',
                        'Sign in with your Apple ID',
                        'Navigate to: Security → App-Specific Passwords',
                        'Click "Generate Password"',
                        'Enter label: "Contact Manager CardDAV"',
                        'Copy the generated password (xxxx-xxxx-xxxx-xxxx)'
                    ]
                },
                {
                    step: 2,
                    title: 'Connect to Contact Manager',
                    instructions: [
                        'Return to Contact Manager',
                        'Enter your full Apple ID email',
                        'Paste the app-specific password',
                        'Click "Connect to iCloud"'
                    ]
                },
                {
                    step: 3,
                    title: 'Verify Connection',
                    instructions: [
                        'Wait for connection confirmation',
                        'Check that addressbook is discovered',
                        'Contacts will sync automatically'
                    ]
                }
            ],
            notes: [
                '⚠️ Do NOT use your regular Apple ID password',
                '✅ App-specific password is required for CardDAV access',
                '🔒 Password is only stored locally and encrypted',
                '📱 Works with all iCloud-synced devices (iPhone, iPad, Mac)'
            ],
            troubleshooting: {
                'Connection Failed': 'Verify Apple ID and app-specific password are correct',
                'No Addressbooks Found': 'Ensure iCloud Contacts is enabled in Apple ID settings',
                'Invalid Password Format': 'Password should be 16 characters with dashes (xxxx-xxxx-xxxx-xxxx)'
            }
        };
    }
}

export default ICloudConnector;
