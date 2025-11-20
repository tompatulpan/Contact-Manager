/**
 * BaikalConnector - CardDAV Sync for Baikal/Radicale/Nextcloud
 * Bidirectional sync with ownership preservation
 * 
 * KEY FEATURES:
 * ✅ Ownership preservation (preserves external edits)
 * ✅ UID-based contact matching
 * ✅ Addressbook routing (/my-contacts/ vs /shared-contacts/)
 * ✅ Simple pull → import → preserve pattern
 * ✅ Bidirectional sync (pull and push)
 * ✅ Shared contact protection with read-only addressbooks
 * ✅ Lightweight bridge (200 lines, direct tsdav) - no HTTP server required
 * 
 * NOTE: For iCloud, use ICloudConnector instead (one-way export only)
 */
import { PERFORMANCE_CONFIG } from '../config/app.config.js';
import CardDAVBridgeAdapter from './CardDAVBridgeAdapter.js';

export class BaikalConnector {
    constructor(eventBus = null) {
        this.version = '2025-11-18-lite-bridge-only';
        
        this.eventBus = eventBus;
        this.connections = new Map();
        this.isConnected = false;
        this.contactManager = null;
        
        // CardDAV Bridge Adapter (lite bridge only)
        this.bridgeAdapter = new CardDAVBridgeAdapter();
        
        // Event callbacks
        this.onStatusChange = null;
        this.onContactsReceived = null;
        this.onError = null;
        
        // 🆕 Auto-sync intervals
        this.syncIntervals = new Map(); // Map<profileName, { pullInterval, pushInterval }>
        this.autoSyncEnabled = false;
        
        // 🛡️ Shared contact protection intervals
        this.protectionIntervals = new Map(); // Map<profileKey, interval>
        
        // 🔒 Sync lock to prevent concurrent operations
        this.syncInProgress = false;
        this.syncQueue = Promise.resolve(); // Chain sync operations
        
        // Log which bridge we're using
        const bridgeInfo = this.bridgeAdapter.getBridgeInfo();
        console.log(`🌉 BaikalConnector: Using ${bridgeInfo.type} bridge (${bridgeInfo.linesOfCode} lines)`);
    }

    /**
     * Set ContactManager reference for integration
     * @param {ContactManager} contactManager - ContactManager instance
     */
    setContactManager(contactManager) {
        this.contactManager = contactManager;
    }

    /**
     * Discover addressbooks for any CardDAV server (Baikal, iCloud, etc.)
     * Works with all RFC 6352 compliant servers
     * 
     * @param {Object} config - Server configuration
     * @returns {Promise<Object>} Discovery result
     */
    async discoverAddressbooks(config) {
        try {
            // ✅ Use CardDAV Bridge Adapter (switchable between lite and legacy)
            const result = await this.bridgeAdapter.discoverAddressbooks(config);

            if (result.success) {
                result.addressbooks.forEach(ab => {
                });
                
                // Store addressbooks in connection for later use
                if (this.connections.has(config.profileName)) {
                    const connection = this.connections.get(config.profileName);
                    connection.addressbooks = result.addressbooks;
                    connection.serverType = result.serverType;
                    
                    // For lite bridge: Set the first addressbook URL as default
                    if (result.addressbooks && result.addressbooks.length > 0) {
                        const defaultAddressbook = result.addressbooks[0];
                        this.bridgeAdapter.setAddressbookUrl(config.profileName, defaultAddressbook.url);
                        console.log(`📚 Using addressbook: ${defaultAddressbook.displayName || defaultAddressbook.url}`);
                    }
                }
            } else {
                console.error(`❌ Discovery failed: ${result.error}`);
            }

            return result;

        } catch (error) {
            console.error('❌ Addressbook discovery failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Connect to Baikal CardDAV server (or any CardDAV server like iCloud)
     * @param {Object} config - Connection configuration
     * @returns {Promise<Object>} Connection result
     */
    async connectToServer(config) {
        try {
            // Use CardDAV Bridge Adapter (switches between lite and legacy)
            const result = await this.bridgeAdapter.connect(config);

            if (result.success) {
                // Detect server capabilities
                const capabilities = await this.detectServerCapabilities(config.serverUrl);
                
                this.connections.set(config.profileName, {
                    profileName: config.profileName,
                    serverUrl: config.serverUrl,
                    username: config.username,
                    connected: true,
                    connectedAt: new Date().toISOString(),
                    serverType: capabilities.serverType,
                    capabilities: capabilities,
                    addressbooks: [] // Will be populated by discoverAddressbooks()
                });
                
                this.isConnected = true;
                
                // ✅ Automatically discover addressbooks after connection (for lite bridge)
                console.log('🔍 Auto-discovering addressbooks...');
                const discoveryResult = await this.discoverAddressbooks(config);
                if (discoveryResult.success && discoveryResult.addressbooks?.length > 0) {
                    console.log(`✅ Discovered ${discoveryResult.addressbooks.length} addressbooks`);
                } else {
                    console.warn('⚠️ Addressbook discovery failed:', discoveryResult.error);
                    
                    // For lite bridge: Try to construct a default addressbook URL from server URL
                    if (this.bridgeAdapter.config?.useLiteBridge && config.serverUrl) {
                        // Ensure serverUrl is absolute (has http/https protocol)
                        let defaultAddressbookUrl = config.serverUrl;
                        
                        // If it's a relative path, we can't use it
                        if (!defaultAddressbookUrl.startsWith('http://') && !defaultAddressbookUrl.startsWith('https://')) {
                            console.error(`❌ Cannot use relative URL as addressbook: ${defaultAddressbookUrl}`);
                            console.log('💡 Please connect using full URL like: http://127.0.0.1:5232/test/contacts/');
                        } else {
                            // Ensure URL ends with /
                            if (!defaultAddressbookUrl.endsWith('/')) {
                                defaultAddressbookUrl += '/';
                            }
                            
                            console.log(`📚 Using server URL as addressbook: ${defaultAddressbookUrl}`);
                            this.bridgeAdapter.setAddressbookUrl(config.profileName, defaultAddressbookUrl);
                        }
                    }
                }
                
                if (this.onStatusChange) {
                    this.onStatusChange({ connected: true, profile: config.profileName, capabilities });
                }
            }

            return result;
        } catch (error) {
            console.error('❌ Connection failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect from Baikal server
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Disconnect result
     */
    async disconnect(profileName) {
        try {
            this.connections.delete(profileName);
            this.isConnected = this.connections.size > 0;

            this.onStatusChange?.({ connected: false, profileName });

            return { success: true };

        } catch (error) {
            console.error('❌ Disconnect failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🔍 Detect server capabilities and choose protection strategy
     * @param {string} serverUrl - Server URL to analyze
     * @returns {Object} Server capabilities
     */
    detectServerCapabilities(serverUrl) {
        const url = serverUrl.toLowerCase();
        
        // Detect server type and capabilities
        if (url.includes('dav.php') || url.includes('baikal')) {
            return {
                serverType: 'Baikal',
                supportsACL: true,
                supportsSeparateAddressbooks: true,
                protectionStrategy: 'server_side_acl',
                supportsVCard3: false,
                vCardVersion: '4.0',
                notes: 'Full ACL support with separate addressbooks'
            };
        } else if (url.includes('nextcloud') || url.includes('owncloud')) {
            return {
                serverType: 'Nextcloud/ownCloud',
                supportsACL: true,
                supportsSeparateAddressbooks: true,
                protectionStrategy: 'server_side_acl',
                supportsVCard3: false,
                vCardVersion: '4.0',
                notes: 'Full ACL support with separate addressbooks'
            };
        } else if (url.includes('google') || url.includes('gmail')) {
            return {
                serverType: 'Google Contacts',
                supportsACL: false,
                supportsSeparateAddressbooks: false,
                protectionStrategy: 'client_side_validation',
                supportsVCard3: true,
                vCardVersion: '3.0',
                notes: 'Single addressbook, no ACL - client-side protection required'
            };
        } else {
            // Generic/Unknown CardDAV server - assume basic support
            console.warn('⚠️ Unknown CardDAV server type - assuming no ACL support');
            return {
                serverType: 'Generic CardDAV',
                supportsACL: false,
                supportsSeparateAddressbooks: false,
                protectionStrategy: 'client_side_validation',
                supportsVCard3: false,
                vCardVersion: '4.0',
                notes: 'Unknown server - using client-side protection (safe default)'
            };
        }
    }

    /**
     * ✅ CRITICAL FIX: Validate sync result to prevent data loss
     * 
     * SAFETY CHECKS:
     * 1. Server returned 0 contacts but we have local contacts
     * 2. Massive drop in contact count (>50% reduction)
     * 3. All contacts missing ETags (indicates server error)
     * 
     * @param {Array} serverContacts - Contacts from server
     * @param {string} profileName - Profile name for logging
     * @throws {Error} If sync result appears invalid/dangerous
     */
    async validateSyncResult(serverContacts, profileName) {
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not set, skipping sync validation');
            return;
        }

        const localContacts = Array.from(this.contactManager.contacts.values())
            .filter(c => !c.metadata?.isDeleted && !c.metadata?.isArchived);

        // Check 1: Zero contacts from server
        if (serverContacts.length === 0 && localContacts.length > 0) {
            const profile = this.connections.get(profileName);
            console.error('❌ SYNC VALIDATION FAILED:');
            console.error(`   📊 Server contacts: ${serverContacts.length}`);
            console.error(`   📊 Local contacts: ${localContacts.length}`);
            console.error(`   🔗 Server URL: ${profile?.serverUrl || 'unknown'}`);
            console.error(`   📁 Addressbook: ${profile?.addressbookUrl || 'unknown'}`);
            console.error('');
            console.error('⚠️ POSSIBLE CAUSES:');
            console.error('   1. Radicale server was restarted and lost data (in-memory storage?)');
            console.error('   2. Wrong addressbook path in connection settings');
            console.error('   3. Server configuration changed');
            console.error('   4. Network/CORS issue preventing data retrieval');
            console.error('');
            console.error('💡 TO FIX:');
            console.error('   1. Check if Radicale server is running: http://127.0.0.1:5232');
            console.error('   2. Verify addressbook exists: /test/contacts/');
            console.error('   3. Re-push contacts: Click "Manual Push" in CardDAV settings');
            
            // 🚨 Show user-friendly UI warning popup
            this.showServerEmptyWarning(profileName, serverContacts.length, localContacts.length, profile);
            
            throw new Error(
                `SAFETY ABORT: Server returned 0 contacts but you have ${localContacts.length} local contacts. ` +
                `This indicates a server error. Aborting sync to prevent data loss. See console for details.`
            );
        }

        // Check 2: Massive contact drop (>50% reduction)
        const localSyncedCount = localContacts.filter(c => 
            c.metadata?.cardDAV?.lastSyncedAt
        ).length;

        if (localSyncedCount > 10 && serverContacts.length < localSyncedCount * 0.5) {
            const dropPercent = Math.round((1 - serverContacts.length / localSyncedCount) * 100);
            throw new Error(
                `SAFETY ABORT: Server contact count dropped ${dropPercent}% ` +
                `(from ${localSyncedCount} to ${serverContacts.length}). ` +
                `This may indicate a server error. Aborting sync to prevent mass deletion.`
            );
        }

        // Check 3: Missing ETags (indicates incomplete server response)
        if (serverContacts.length > 0) {
            const contactsWithoutETag = serverContacts.filter(c => !c.etag).length;
            if (contactsWithoutETag / serverContacts.length > 0.9) {
                console.warn(
                    `⚠️ WARNING: ${Math.round(contactsWithoutETag / serverContacts.length * 100)}% ` +
                    `of contacts missing ETags. Server may be returning incomplete data.`
                );
            }
        }

        console.log(`✅ Sync validation passed: ${serverContacts.length} contacts from server`);
    }

    /**
     * Show user-friendly warning popup when server returns 0 contacts
     */
    showServerEmptyWarning(profileName, serverCount, localCount, profile) {
        const warningHTML = `
            <div class="server-empty-warning" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 3px solid #dc3545;
                border-radius: 12px;
                padding: 30px;
                max-width: 600px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                z-index: 10000;
                font-family: system-ui, -apple-system, sans-serif;
            ">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 64px; margin-bottom: 10px;">⚠️</div>
                    <h2 style="color: #dc3545; margin: 0; font-size: 24px;">CardDAV Server Empty!</h2>
                </div>
                
                <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                    <p style="margin: 0; font-size: 16px; line-height: 1.6;">
                        <strong>Server returned 0 contacts</strong> but you have <strong>${localCount} local contacts</strong>.<br>
                        Sync has been <strong>aborted to prevent data loss</strong>.
                    </p>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 16px; margin-bottom: 10px; color: #333;">🔍 Possible Causes:</h3>
                    <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                        <li>CardDAV server was restarted (in-memory storage)</li>
                        <li>Wrong addressbook path in settings</li>
                        <li>Server configuration changed</li>
                        <li>Network connectivity issue</li>
                    </ul>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 16px; margin-bottom: 10px; color: #333;">💡 Recommended Actions:</h3>
                    <ol style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                        <li>Check if CardDAV server is running</li>
                        <li>Verify addressbook path: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${profile?.addressbookUrl || 'N/A'}</code></li>
                        <li>Click <strong>"Manual Push"</strong> to restore ${localCount} contacts to server</li>
                    </ol>
                </div>
                
                <div style="text-align: center;">
                    <button onclick="this.closest('.server-empty-warning').remove(); document.querySelector('.modal-overlay-server-warning')?.remove();" style="
                        background: #007bff;
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        border-radius: 6px;
                        font-size: 16px;
                        cursor: pointer;
                        font-weight: 600;
                    ">I Understand</button>
                </div>
            </div>
            
            <div class="modal-overlay-server-warning" onclick="this.remove(); document.querySelector('.server-empty-warning')?.remove();" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
            "></div>
        `;
        
        // Remove any existing warnings
        document.querySelectorAll('.server-empty-warning, .modal-overlay-server-warning').forEach(el => el.remove());
        
        // Add warning to page
        document.body.insertAdjacentHTML('beforeend', warningHTML);
        
        console.log('🚨 Server empty warning displayed to user');
    }

    /**
     * ✅ CRITICAL FIX: Check if CardDAV server is healthy before sync
     * Prevents sync operations when server is down/unreachable
     * 
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Health check result
     */
    async performHealthCheck(profileName) {
        try {
            const connection = this.connections.get(profileName);
            if (!connection) {
                return { 
                    healthy: false, 
                    reason: 'No connection found for profile' 
                };
            }

            // Quick HEAD request to server root with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            try {
                const response = await fetch(connection.serverUrl, {
                    method: 'HEAD',
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Basic ${Buffer.from(
                            `${connection.username}:${connection.password}`
                        ).toString('base64')}`
                    }
                });

                clearTimeout(timeoutId);

                if (response.ok || response.status === 401) {
                    // 401 means server is up (just auth check)
                    return { healthy: true };
                } else {
                    return { 
                        healthy: false, 
                        reason: `Server returned ${response.status}` 
                    };
                }
            } finally {
                clearTimeout(timeoutId);
            }

        } catch (error) {
            return { 
                healthy: false, 
                reason: `Health check failed: ${error.message}` 
            };
        }
    }

    /**
     * Sync contacts from Baikal (PULL operation with ownership preservation)
     * 
     * NEW STRATEGY:
     * 1. Pull contacts from Baikal server
     * 2. Match by vCard UID (not contactId)
     * 3. PRESERVE metadata.isOwned on updates
     * 4. Import external edits from iPhone/Thunderbird
     * 
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Sync result
     */
    async syncFromBaikal(profileName) {
        // 🔒 Prevent concurrent sync operations (fixes ItemUpdateConflict)
        if (this.syncInProgress) {
            return await this.queueSync(() => this._syncFromBaikalInternal(profileName));
        }
        
        return await this._syncFromBaikalInternal(profileName);
    }
    
    /**
     * Queue sync operation to run after current sync completes
     */
    async queueSync(syncOperation) {
        this.syncQueue = this.syncQueue.then(async () => {
            try {
                return await syncOperation();
            } catch (error) {
                console.error('❌ Queued sync operation failed:', error);
                throw error;
            }
        });
        return this.syncQueue;
    }
    
    /**
     * Internal sync implementation with lock protection
     */
    async _syncFromBaikalInternal(profileName) {
        console.log('🔒 Sync lock acquired - syncInProgress = true');
        this.syncInProgress = true;
        
        // 🔒 Notify ContactManager to suppress database change handlers during sync
        if (this.contactManager) {
            this.contactManager.syncInProgress = true;
            console.log('🔒 ContactManager sync lock acquired');
        }
        
        try {
            
            // Track last used profile for orphan cleanup
            this.lastUsedProfile = profileName;

            // ✅ Use CardDAV Bridge Adapter (switchable between lite and legacy)
            const result = await this.bridgeAdapter.sync(profileName);

            // ✅ Validate result
            if (!result.success) {
                throw new Error(`Sync failed: ${result.error || 'Unknown error'}`);
            }

            // 🛡️ CRITICAL SAFETY CHECK: Detect server error state
            const serverError = result.isServerDown || 
                               result.syncResult?.skippedDueToError || 
                               !result.success;
            
            if (serverError) {
                console.error('🛡️ SERVER ERROR DETECTED - ABORTING SYNC TO PROTECT DATA');
                console.error(`   Error: ${result.error || 'Server returned error state'}`);
                console.warn('   ⚠️ Skipping import and deletion to prevent data loss');
                console.warn('   ✅ Your local contacts remain unchanged and safe');
                
                throw new Error(result.error || 'CardDAV server unavailable - sync aborted to prevent data loss');
            }

            const serverContacts = result.syncResult?.contacts || result.contacts || [];

            // ✅ CRITICAL FIX: Validate sync result before proceeding
            await this.validateSyncResult(serverContacts, profileName);

            // Import contacts with ownership preservation (includes vCard 3.0 conversion for Apple)
            const importResults = await this.importContactsWithOwnershipPreservation(serverContacts, profileName);

            // 🐛 DEBUG: Verify imported contact metadata
            if (this.contactManager && importResults.imported > 0) {
                const allContacts = Array.from(this.contactManager.contacts.values());
                const recentImports = allContacts
                    .filter(c => c.metadata?.cardDAV?.lastSyncedAt)
                    .slice(-Math.min(3, importResults.imported)); // Check last 3 imported
                
                recentImports.forEach(contact => {
                });
            }

            // 🛡️ SAFETY: Only detect deletions if server sync was fully successful
            const deletionResults = await this.detectAndHandleServerDeletions(serverContacts, profileName);

            // 🗑️ CLEANUP: Remove orphaned contacts from server (exist on server but deleted locally)
            const cleanupResults = await this.cleanupOrphanedServerContacts(serverContacts, profileName);

            this.onContactsReceived?.({
                contacts: serverContacts,
                profileName,
                imported: importResults,
                deletions: deletionResults,
                cleanup: cleanupResults
            });

            return {
                success: true,
                contacts: serverContacts,
                imported: importResults,
                deletions: deletionResults,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Sync from Baikal failed:', error);
            this.onError?.({ type: 'sync_failed', error: error.message });
            return { success: false, error: error.message };
        } finally {
            // 🔒 Release sync lock
            console.log('🔓 Sync lock released - syncInProgress = false');
            this.syncInProgress = false;
            
            // 🔒 Re-enable ContactManager database change handlers
            if (this.contactManager) {
                this.contactManager.syncInProgress = false;
                console.log('🔓 ContactManager sync lock released');
            }
            
        }
    }

    /**
     * Import contacts with ownership preservation
     * Uses ContactManager.importOrUpdateContact() which preserves metadata.isOwned
     * 🍎 Automatically converts vCard 3.0 → 4.0 for Apple/iCloud servers
     * 
     * @param {Array} serverContacts - Contacts from Baikal/iCloud
     * @param {string} profileName - Profile name (for Apple server detection)
     * @returns {Promise<Object>} Import results
     */
    async importContactsWithOwnershipPreservation(serverContacts, profileName = null) {
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not set, cannot import contacts');
            return { imported: 0, updated: 0, failed: 0, skipped: 0 };
        }

        let imported = 0;
        let updated = 0;
        let failed = 0;
        let skipped = 0;  // ⚡ PERFORMANCE: Track contacts skipped due to ETag match
        let orphanedDeleted = 0;
        let vCard3Converted = 0;
        
        // 🔑 Track deleted orphans to avoid duplicate deletion attempts
        const deletedOrphanUIDs = new Set();
        
        for (const serverContact of serverContacts) {
            try {
                // 🔑 Skip if this UID was already deleted as an orphan during this sync
                if (deletedOrphanUIDs.has(serverContact.uid)) {
                    continue;
                }
                
                // ⚡ PERFORMANCE OPTIMIZATION: Check ETag BEFORE calling importOrUpdateContact
                // This prevents unnecessary parsing, logging, and database operations for unchanged contacts
                const existingContact = this.contactManager.findContactByUID(serverContact.uid);
                if (existingContact && serverContact.etag && existingContact.metadata?.cardDAV?.etag === serverContact.etag) {
                    // Contact exists locally and ETag matches - skip entirely (no parsing, no logging, no work)
                    skipped++;
                    continue;
                } else if (existingContact && serverContact.etag) {
                    // 🐛 DEBUG: ETag changed - will update
                    console.log(`🔄 ETag changed for ${existingContact.cardName || serverContact.uid}:`);
                    console.log(`   OLD: ${existingContact.metadata?.cardDAV?.etag || 'none'}`);
                    console.log(`   NEW: ${serverContact.etag}`);
                }
                
                // Use server contact as-is (Baikal uses vCard 4.0)
                let processedContact = serverContact;
                
                // Determine addressbook context from contact data
                const syncContext = {
                    addressbook: processedContact.addressbook || 'my-contacts',
                    profileName: profileName  // ✅ Pass profile name for shared contact push-back
                };

                // Use ContactManager's importOrUpdateContact which preserves ownership
                const result = await this.contactManager.importOrUpdateContact(processedContact, syncContext);

                if (result.success) {
                    if (result.action === 'created') {
                        imported++;
                    } else if (result.action === 'updated') {
                        updated++;
                    }
                } else if ((result.reason === 'orphaned_shared_contact' || 
                           result.reason === 'orphaned_shared_contact_uid_collision') && 
                           result.shouldDelete) {
                    // 🗑️ Orphaned shared contact detected - delete from Baikal
                    
                    // ✅ FIX: Determine correct addressbook to delete from
                    // For UID collisions, delete from the addressbook where duplicate was found
                    let targetAddressbook = processedContact.addressbook || 'shared-contacts';
                    
                    // If we have deleteContact info with explicit addressbook, use that
                    if (result.deleteContact?.addressbook) {
                        targetAddressbook = result.deleteContact.addressbook;
                    }
                    
                    const orphanInfo = result.deleteContact || {
                        uid: processedContact.uid,
                        href: processedContact.href,
                        addressbook: targetAddressbook,
                        vcard: processedContact.vcard,
                        name: processedContact.name
                    };
                    
                    console.warn(`🗑️ Deleting orphaned shared contact from Baikal: ${orphanInfo.name || orphanInfo.uid}`);
                    console.warn(`📂 Target addressbook for deletion: ${targetAddressbook}`);
                    if (result.reason === 'orphaned_shared_contact_uid_collision') {
                        console.warn(`   Reason: UID collision - same UID exists in different addressbooks`);
                        console.warn(`   Local: ${result.deleteContact?.name} (owned)`);
                        console.warn(`   Baikal: ${orphanInfo.name} (${targetAddressbook})`);
                    }
                    
                    // Get the active profile name (assuming first connected profile)
                    const activeProfile = profileName || this.getFirstConnectedProfile();
                    if (activeProfile) {
                        const deleteContact = {
                            vcard: orphanInfo.vcard,
                            cardName: orphanInfo.name || 'Unknown',
                            contactId: orphanInfo.uid,
                            metadata: {
                                cardDAV: {
                                    href: orphanInfo.href,
                                    addressbook: targetAddressbook  // ✅ Use correct addressbook
                                }
                            }
                        };
                        
                        const deleteResult = await this.deleteContactFromBaikal(deleteContact, activeProfile);
                        if (deleteResult.success) {
                            orphanedDeleted++;
                            // 🔑 Mark this UID as deleted to prevent duplicate deletion attempts
                            deletedOrphanUIDs.add(processedContact.uid);
                        } else {
                            console.error(`❌ Failed to delete orphaned contact from ${targetAddressbook}:`, deleteResult.error);
                        }
                    }
                    failed++; // Count as failed import but with cleanup
                }

            } catch (error) {
                console.error(`❌ Failed to import contact:`, error);
                failed++;
            }
        }

        if (vCard3Converted > 0) {
        }
        if (orphanedDeleted > 0) {
        }

        // ✅ FIX: Emit event to trigger UI refresh after batch import
        if ((imported > 0 || updated > 0) && this.eventBus) {
            this.eventBus.emit('contactManager:contactsUpdated', {
                source: 'baikal-sync',
                imported,
                updated,
                skipped,
                total: serverContacts.length
            });
        }

        return { imported, updated, failed, skipped, orphanedDeleted, vCard3Converted, total: serverContacts.length };
    }

    /**
     * 🔄 Detect and handle server-side deletions (bidirectional sync)
     * Compares server contacts with local contacts and removes ones deleted on server
     * 
     * RULES:
     * - Only deletes IMPORTED contacts (metadata.isImported = true)
     * - Never deletes OWNED contacts (user has authority)
     * - Never deletes SHARED contacts (managed separately)
     * 
     * @param {Array} serverContacts - Contacts from server
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Deletion results
     */
    async detectAndHandleServerDeletions(serverContacts, profileName) {
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not set, cannot detect deletions');
            return { deleted: 0, checked: 0 };
        }


        // Build set of UIDs currently on server
        const serverUIDs = new Set(serverContacts.map(c => c.uid).filter(uid => uid));
        
        // 🚨 CRITICAL SAFETY CHECK: NEVER delete if server returns 0 contacts
        if (serverUIDs.size === 0) {
            const localImportedCount = Array.from(this.contactManager.contacts.values())
                .filter(c => c.metadata?.isImported && !c.metadata?.isDeleted)
                .length;
            
            if (localImportedCount > 0) {
                console.error('🚨 CRITICAL SAFETY ABORT: Server returned 0 contacts but you have imported contacts locally!');
                console.error(`   Local imported contacts: ${localImportedCount}`);
                console.error('   Possible causes:');
                console.error('   1. tsdav fetchVCards is failing silently');
                console.error('   2. Wrong addressbook being synced');
                console.error('   3. Authentication/permission issue');
                console.error('   ');
                console.error('   🛑 ABORTING DELETION to prevent data loss!');
                console.error('   Your imported contacts will NOT be deleted.');
                
                // ABORT - return immediately without deleting anything
                return { 
                    deleted: 0, 
                    checked: localImportedCount,
                    aborted: true,
                    reason: 'server_returned_zero_contacts_safety_abort'
                };
            }
        }
        
        // �🐛 DEBUG: Log first few server UIDs for comparison
        if (serverUIDs.size > 0) {
            const uidArray = Array.from(serverUIDs);
            const sampleUIDs = uidArray.slice(0, Math.min(5, uidArray.length));
        }

        // Get all local contacts that are synced with this profile
        const allLocalContacts = Array.from(this.contactManager.contacts.values());
        
        // 🐛 Check contacts WITHOUT CardDAV metadata but marked as imported
        // These may have been imported from vCard files, then deleted on server
        const contactsWithoutMetadata = allLocalContacts.filter(c => {
            const hasMetadata = c.metadata?.cardDAV?.lastSyncedAt || 
                               c.metadata?.cardDAV?.etag || 
                               c.metadata?.cardDAV?.href;
            return !hasMetadata && !c.metadata?.isDeleted && !c.metadata?.isArchived;
        });
        
        if (contactsWithoutMetadata.length > 0) {
            console.log(`⚠️ Found ${contactsWithoutMetadata.length} contacts WITHOUT CardDAV metadata:`);
            contactsWithoutMetadata.forEach(c => {
                const uid = this.contactManager.extractUIDFromVCard(c.vcard);
                console.log(`   - ${c.cardName} (UID: ${uid})`);
                console.log(`     isOwned: ${c.metadata?.isOwned}, isImported: ${c.metadata?.isImported}`);
                console.log(`     cardDAV: etag=${!!c.metadata?.cardDAV?.etag}, href=${!!c.metadata?.cardDAV?.href}, lastSyncedAt=${!!c.metadata?.cardDAV?.lastSyncedAt}`);
            });
            
            // ✅ Check if imported contacts without metadata exist on server
            // If not, they were deleted on server and should be removed locally
            const importedWithoutMetadata = contactsWithoutMetadata.filter(c => c.metadata?.isImported === true);
            
            if (importedWithoutMetadata.length > 0) {
                console.log(`🔍 Checking ${importedWithoutMetadata.length} imported contacts without metadata against server...`);
                
                for (const contact of importedWithoutMetadata) {
                    const uid = this.contactManager.extractUIDFromVCard(contact.vcard);
                    
                    if (uid && !serverUIDs.has(uid)) {
                        console.log(`🗑️ Imported contact "${contact.cardName}" (UID: ${uid}) missing from server - deleting locally`);
                        
                        try {
                            const deleteResult = await this.contactManager.deleteContact(contact.contactId);
                            
                            if (deleteResult.success) {
                                console.log(`   ✅ Deleted imported contact from Contact Manager`);
                            } else {
                                console.error(`   ❌ Failed to delete: ${deleteResult.error}`);
                            }
                        } catch (error) {
                            console.error(`   ❌ Error deleting contact:`, error);
                        }
                    } else if (uid) {
                        console.log(`   ℹ️ Imported contact "${contact.cardName}" exists on server - keeping locally`);
                    }
                }
            }
        }
        
        const localContacts = allLocalContacts.filter(contact => {
                // Check if contact has ANY CardDAV metadata (was synced to server)
                // - lastSyncedAt: Contact was pulled from server
                // - etag: Contact was pushed to server (has version tracking)
                // - href: Contact was pushed to server (has server URL)
                const hasCardDAVMetadata = 
                    contact.metadata?.cardDAV?.lastSyncedAt ||
                    contact.metadata?.cardDAV?.etag ||
                    contact.metadata?.cardDAV?.href;
                
                const notDeleted = !contact.metadata?.isDeleted;
                const notArchived = !contact.metadata?.isArchived;
                
                return hasCardDAVMetadata && notDeleted && notArchived;
            });

        console.log(`🔍 Deletion detection: ${localContacts.length} contacts with CardDAV metadata`);
        
        // 🐛 DEBUG: Log contact ownership breakdown
        const ownedCount = localContacts.filter(c => c.metadata?.isOwned === true).length;
        const importedCount = localContacts.filter(c => c.metadata?.isImported === true).length;
        const sharedCount = localContacts.filter(c => c.contactId?.startsWith('shared_')).length;
        console.log(`   📊 Owned: ${ownedCount}, Imported: ${importedCount}, Shared: ${sharedCount}`);
        
        // 🐛 DEBUG: Log first few local UIDs for comparison
        const localUIDs = localContacts
            .map(c => this.contactManager.extractUIDFromVCard(c.vcard))
            .filter(uid => uid);
        if (localUIDs.length > 0) {
            const sampleLocalUIDs = localUIDs.slice(0, Math.min(5, localUIDs.length));
        }

        let deleted = 0;
        let skipped = 0;
        const deletedContacts = [];

        for (const localContact of localContacts) {
            try {
                // Extract UID from local contact
                const localUID = this.contactManager.extractUIDFromVCard(localContact.vcard);
                
                if (!localUID) {
                    console.warn(`⚠️ Local contact "${localContact.cardName}" has no UID, skipping`);
                    skipped++;
                    continue;
                }

                // Check if contact still exists on server
                if (!serverUIDs.has(localUID)) {
                    // Contact was deleted on server
                    console.log(`🗑️ Contact missing from server: ${localContact.cardName} (UID: ${localUID})`);
                    
                    // ✅ SAFETY CHECK: Determine if contact should be deleted
                    const isOwned = localContact.metadata?.isOwned === true;
                    const isShared = localContact.contactId?.startsWith('shared_');
                    const isImported = localContact.metadata?.isImported === true;
                    
                    console.log(`   📊 isOwned: ${isOwned}, isShared: ${isShared}, isImported: ${isImported}`);

                    // 🔒 NEVER delete shared contacts (managed separately)
                    if (isShared) {
                        console.log(`   ⏭️  Skipping: Shared contact (managed separately)`);
                        skipped++;
                        continue;
                    }

                    // 🔧 UPDATED DELETION LOGIC (bidirectional sync):
                    // 
                    // If contact was synced to CardDAV and is now missing from server,
                    // it was deleted on server (e.g., in Thunderbird) → DELETE locally
                    // 
                    // DELETE RULES:
                    // 1. Contact has CardDAV metadata (was synced) → DELETE (server deletion detected)
                    // 2. Contact is IMPORTED (isImported=true) → DELETE (server authority)
                    // 3. Contact is SHARED (isOwned=false) → DELETE (not our contact)
                    // 4. Contact has NO CardDAV metadata → KEEP (never synced, local-only)
                    
                    const hasCardDAVMetadata = !!localContact.metadata?.cardDAV?.etag || 
                                              !!localContact.metadata?.cardDAV?.href ||
                                              !!localContact.metadata?.cardDAV?.lastSyncedAt;
                    
                    console.log(`   🔍 hasCardDAVMetadata: ${hasCardDAVMetadata}`);
                    console.log(`   🔍 CardDAV data: etag=${!!localContact.metadata?.cardDAV?.etag}, href=${!!localContact.metadata?.cardDAV?.href}, lastSyncedAt=${!!localContact.metadata?.cardDAV?.lastSyncedAt}`);
                    
                    const shouldDelete = hasCardDAVMetadata || isImported || !isOwned;
                    
                    console.log(`   ➜ shouldDelete: ${shouldDelete} (hasMetadata=${hasCardDAVMetadata} OR isImported=${isImported} OR !isOwned=${!isOwned})`);
                    
                    if (!shouldDelete) {
                        console.log(`   ⏭️  Skipping deletion of local-only contact: ${localContact.cardName}`);
                        skipped++;
                        continue;
                    }
                    
                    console.log(`   ✅ DELETING contact from Contact Manager: ${localContact.cardName}`);

                    // ✅ Safe to delete - this is an imported contact deleted on server
                    
                    // Delete from Contact Manager
                    const deleteResult = await this.contactManager.deleteContact(localContact.contactId);
                    
                    if (deleteResult.success) {
                        deleted++;
                        deletedContacts.push({
                            name: localContact.cardName,
                            uid: localUID,
                            reason: 'deleted_on_server',
                            wasImported: isImported
                        });
                    } else {
                        console.error(`❌ Failed to delete from Contact Manager: ${localContact.cardName}`);
                        console.error(`   Error: ${deleteResult.error || 'Unknown error'}`);
                    }
                }

            } catch (error) {
                console.error(`❌ Error checking deletion for contact:`, error);
            }
        }

        if (deleted > 0) {
        } else {
        }

        if (skipped > 0) {
        }

        return {
            deleted,
            skipped,
            checked: localContacts.length,
            deletedContacts
        };
    }

    /**
     * Cleanup orphaned contacts on server (exist on server but deleted locally)
     * 
     * This handles the bidirectional deletion sync issue where:
     * 1. Contact is deleted in Contact Manager
     * 2. DELETE request to Radicale fails with 501 (not supported)
     * 3. Contact remains on server but is gone locally
     * 4. Next sync would re-import the "deleted" contact (zombie resurrection)
     * 
     * Solution: During sync, detect contacts on server but not in local cache
     * and attempt to clean them up.
     * 
     * @param {Array} serverContacts - Contacts from CardDAV server
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Cleanup results
     */
    async cleanupOrphanedServerContacts(serverContacts, profileName) {
        if (!this.contactManager) {
            console.warn('⚠️ Cannot cleanup server - contactManager not set');
            return { cleaned: 0, checked: 0, orphaned: 0, errors: [] };
        }

        console.log(`🗑️ Checking for orphaned contacts on server (${profileName})...`);

        // Get ALL local contacts (not just those with CardDAV metadata)
        // This is important because newly created contacts might not have CardDAV metadata yet
        const localContacts = Array.from(this.contactManager.contacts.values())
            .filter(c => {
                // Exclude contacts marked as deleted
                if (c.metadata?.isDeleted) return false;
                
                // Include all non-deleted contacts (they might be pending sync)
                return true;
            });

        // Build set of local UIDs
        const localUIDs = new Set(
            localContacts
                .map(c => this.contactManager.extractUIDFromVCard(c.vcard))
                .filter(uid => uid) // Filter out null/undefined
        );

        console.log(`📊 Local contacts (all): ${localContacts.length}`);
        console.log(`📊 Server contacts: ${serverContacts.length}`);
        console.log(`🔍 Local UIDs:`, Array.from(localUIDs));
        console.log(`🔍 Server UIDs:`, serverContacts.map(sc => sc.uid));

        // Find contacts on server but NOT in local cache
        const orphanedContacts = serverContacts.filter(sc => {
            // Contact exists on server but not locally
            const isOrphaned = !localUIDs.has(sc.uid);
            
            // Additional safety check: Don't cleanup contacts that were JUST synced
            // Check if this contact was imported in the last 60 seconds
            if (isOrphaned) {
                // Check if we have any local contact with similar timestamp
                // (could be same contact but UID mismatch)
                const recentLocal = localContacts.find(lc => {
                    const createdRecently = lc.metadata?.createdAt && 
                        (Date.now() - new Date(lc.metadata.createdAt).getTime()) < 60000;
                    return createdRecently;
                });
                
                // If we have recent local contacts, be more cautious
                if (recentLocal) {
                    console.log(`⚠️ Found recent local contact, skipping cleanup for: ${sc.uid}`);
                    return false;
                }
            }
            
            return isOrphaned;
        });

        console.log(`🗑️ Orphaned contacts detected: ${orphanedContacts.length}`);

        if (orphanedContacts.length === 0) {
            console.log('✅ No orphaned contacts to cleanup');
            return {
                cleaned: 0,
                checked: serverContacts.length,
                orphaned: 0,
                errors: []
            };
        }

        // Attempt to clean up orphaned contacts
        let cleaned = 0;
        const errors = [];

        for (const orphan of orphanedContacts) {
            try {
                console.log(`🗑️ Attempting cleanup of orphaned contact: ${orphan.uid}`);
                
                // Try to delete from server
                const profile = this.connections.get(profileName);
                if (!profile) {
                    throw new Error(`Profile ${profileName} not connected`);
                }

                // Create minimal contact object for deletion
                // deleteContactFromBaikal expects a contact object with vcard property
                const orphanContact = {
                    vcard: orphan.vcard || `BEGIN:VCARD\nVERSION:3.0\nUID:${orphan.uid}\nEND:VCARD`,
                    contactId: orphan.uid,
                    metadata: {
                        cardDAV: {
                            href: orphan.href,
                            profileName: profileName
                        }
                    }
                };

                const deleteResult = await this.deleteContactFromBaikal(
                    orphanContact,
                    profileName
                );

                if (deleteResult.success) {
                    cleaned++;
                    console.log(`✅ Cleaned orphaned contact from server: ${orphan.uid}`);
                } else if (deleteResult.fallback) {
                    // Server returned 501 (DELETE not supported)
                    console.warn(`⚠️ Cannot delete orphaned contact ${orphan.uid} - server doesn't support DELETE (501)`);
                    console.warn(`   This contact will continue to exist on server until manually removed`);
                    errors.push({
                        uid: orphan.uid,
                        error: 'Server does not support DELETE (501)',
                        recommendation: 'Manual cleanup required'
                    });
                } else {
                    throw new Error(deleteResult.error || 'Unknown deletion error');
                }

            } catch (error) {
                console.error(`❌ Failed to cleanup orphaned contact ${orphan.uid}:`, error.message);
                errors.push({
                    uid: orphan.uid,
                    error: error.message
                });
            }
        }

        const result = {
            cleaned,
            checked: serverContacts.length,
            orphaned: orphanedContacts.length,
            errors
        };

        // Log summary
        if (cleaned > 0) {
            console.log(`✅ Server cleanup complete: ${cleaned} orphaned contacts removed`);
        }
        if (errors.length > 0) {
            console.warn(`⚠️ ${errors.length} orphaned contacts could not be cleaned - manual cleanup may be required`);
        }

        return result;
    }
    
    /**
     * Get first connected profile name (for orphan cleanup)
     * @returns {string|null} Profile name
     */
    getFirstConnectedProfile() {
        // This will be set by the UI when profiles are connected
        // For now, we'll track it during connect/sync operations
        return this.lastUsedProfile || null;
    }

    /**
     * Push contact to Baikal (with addressbook routing and retry logic)
     * 
     * ADDRESSBOOK ROUTING:
     * - OWNED contacts → /my-contacts/ (read-write)
     * - SHARED contacts → /shared-contacts/ (read-only)
     * - IMPORTED contacts → /my-contacts/ (read-write)
     * 
     * @param {Object} contact - Contact to push
     * @param {string} profileName - Profile name
     * @param {number} retryCount - Current retry attempt (internal use)
     * @returns {Promise<Object>} Push result
     */
    async pushContactToBaikal(contact, profileName, retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1000; // Start with 1 second

        try {
            // Determine addressbook based on contact type
            const addressbook = this.getAddressbookForContact(contact, profileName);
            
            // ⚡ OPTIMIZATION: Skip push if contact hasn't changed since last sync
            const lastSyncedAt = contact.metadata?.cardDAV?.lastSyncedAt;
            const lastUpdated = contact.metadata?.lastUpdated;
            const hasETag = !!contact.metadata?.cardDAV?.etag;
            
            if (lastSyncedAt && lastUpdated && hasETag) {
                const syncTime = new Date(lastSyncedAt).getTime();
                const updateTime = new Date(lastUpdated).getTime();
                
                // Skip if last sync happened AFTER last update (contact unchanged)
                if (syncTime >= updateTime) {
                    return { 
                        success: true, 
                        skipped: true, 
                        reason: 'unchanged_since_last_sync',
                        etag: contact.metadata.cardDAV.etag 
                    };
                }
            }

            // Extract or ensure UID exists in vCard
            let uid = this.contactManager?.extractUIDFromVCard(contact.vcard);
            let vCardToSend = contact.vcard;
            
            // If vCard is missing UID, add it before pushing
            if (!uid) {
                if (contact.metadata?.isOwned === false) {
                    uid = contact.contactId;
                } else {
                    uid = this.contactManager?.vCardStandard?.generateUID() || 
                          `contact_${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                }
                
                vCardToSend = contact.vcard.replace(
                    /END:VCARD/i,
                    `UID:${uid}\nEND:VCARD`
                );
                
                if (this.contactManager && contact.metadata?.isOwned !== false) {
                    const updatedContact = {
                        ...contact,
                        vcard: vCardToSend,
                        metadata: {
                            ...contact.metadata,
                            cardDAV: {
                                ...contact.metadata?.cardDAV,
                                uid: uid
                            }
                        }
                    };
                    await this.contactManager.database.updateContact(updatedContact);
                }
            }

            // ✅ Use CardDAV Bridge Adapter (switchable between lite and legacy)
            const result = await this.bridgeAdapter.pushContact(
                profileName,
                addressbook,
                vCardToSend,
                uid,
                null  // etag - null forces fresh comparison
            );

            // Handle errors with retry logic
            if (!result.success && retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.warn(
                    `⚠️ Push failed, retrying in ${delay}ms ` +
                    `(attempt ${retryCount + 1}/${MAX_RETRIES}): ${result.error || 'Unknown error'}`
                );
                
                await this.sleep(delay);
                return await this.pushContactToBaikal(contact, profileName, retryCount + 1);
            }

            if (!result.success) {
                throw new Error(`Push failed: ${result.error || 'Unknown error'}`);
            }

            // Update CardDAV metadata if successful
            if (result.success && result.etag && this.contactManager && contact.metadata?.isOwned !== false) {
                await this.contactManager.updateContactCardDAVMetadata(contact.contactId, {
                    etag: result.etag,
                    href: result.href,
                    addressbook: addressbook,
                    lastSyncedAt: new Date().toISOString()
                }, true); // ✅ syncTimestamps = true to prevent false conflicts
            }

            return result;

        } catch (error) {
            // Check if this is a network error (retryable)
            const isNetworkError = error.name === 'AbortError' || 
                                  error.name === 'TypeError' || 
                                  error.message.includes('fetch');

            if (isNetworkError && retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.warn(
                    `⚠️ Network error during push, retrying in ${delay}ms ` +
                    `(attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`
                );
                
                await this.sleep(delay);
                return await this.pushContactToBaikal(contact, profileName, retryCount + 1);
            }

            console.error('❌ Push to Baikal failed:', error);
            return { 
                success: false, 
                error: error.message,
                retries: retryCount
            };
        }
    }

    /**
     * Sleep utility for retry delays
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Delete contact from Baikal
     * @param {Object} contact - Contact to delete
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Delete result
     */
    async deleteContactFromBaikal(contact, profileName) {
        try {

            // Extract UID from vCard (primary identifier per RFC 9553)
            const uid = this.contactManager?.extractUIDFromVCard(contact.vcard) || contact.contactId;
            
            // Get correct addressbook based on contact type AND server capabilities
            const addressbook = this.getAddressbookForContact(contact, profileName);
            

            // ✅ Use CardDAV Bridge Adapter (switchable between lite and legacy)
            const result = await this.bridgeAdapter.deleteContact(
                profileName,
                addressbook,
                uid,
                contact.metadata?.cardDAV?.href || null
            );

            if (result.success) {
            }

            return result;

        } catch (error) {
            console.error('❌ Delete from Baikal failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get addressbook for contact based on ownership and server capabilities
     * 
     * ROUTING RULES:
     * - Servers WITH ACL (Baikal, Nextcloud):
     *   • SHARED contacts → shared-contacts (read-only via ACL)
     *   • OWNED/IMPORTED → my-contacts (read-write)
     * 
     * - Servers WITHOUT ACL (iCloud, Google):
     *   • ALL contacts → default (single addressbook)
     * 
     * @param {Object} contact - Contact object
     * @param {string} profileName - Profile name (optional, for capability detection)
     * @returns {string} Addressbook name
     */
    getAddressbookForContact(contact, profileName = null) {
        // Try to get capabilities from connection if profileName provided
        let capabilities = null;
        if (profileName) {
            const connection = this.connections.get(profileName);
            capabilities = connection?.capabilities;
        }
        
        // If no capabilities found, use contact metadata or default to ACL support
        const supportsSeparateAddressbooks = capabilities?.supportsSeparateAddressbooks ?? true;
        
        // Servers without separate addressbook support (iCloud, Google)
        if (!supportsSeparateAddressbooks) {
            return 'default';
        }
        
        // Servers with separate addressbooks (Baikal, Nextcloud)
        // SHARED contacts → read-only addressbook
        if (contact.metadata?.isOwned === false && contact.contactId?.startsWith('shared_')) {
            return 'shared-contacts';
        }
        
        // OWNED and IMPORTED contacts → read-write addressbook
        return 'my-contacts';
    }

    /**
     * Test connection to bridge server
     * @returns {Promise<Object>} Test result
     */
    async testConnection() {
        try {
            // Lite bridge: No HTTP server, always available
            const bridgeInfo = this.bridgeAdapter.getBridgeInfo();
            
            return {
                success: true,
                bridgeType: 'lite',
                bridgeVersion: '1.0.0',
                status: 'ready',
                linesOfCode: bridgeInfo.linesOfCode,
                note: 'Lite bridge - no HTTP server required'
            };

        } catch (error) {
            console.error('❌ Bridge initialization failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get sync status
     * @returns {Object} Current sync status
     */
    getSyncStatus() {
        return {
            connected: this.isConnected,
            activeConnections: this.connections.size,
            connections: Array.from(this.connections.keys()),
            version: this.version,
            strategy: 'ownership-preservation'
        };
    }

    /**
     * Get status (alias for backward compatibility)
     * @returns {Object} Current status
     */
    getStatus() {
        return this.getSyncStatus();
    }

    /**
     * Get all active connections
     * @returns {Array} Connections array with profile details
     */
    getConnections() {
        // Convert Map to Array for UI compatibility
        const connectionsArray = [];
        for (const [profileName, connection] of this.connections.entries()) {
            connectionsArray.push({
                profileName,
                ...connection
            });
        }
        return connectionsArray;
    }

    /**
     * Disconnect from a profile
     * @param {string} profileName - Profile to disconnect
     */
    async disconnect(profileName) {
        try {
            if (this.connections.has(profileName)) {
                this.connections.delete(profileName);
                
                if (this.connections.size === 0) {
                    this.isConnected = false;
                }
                
                this.onStatusChange?.({ 
                    connected: this.isConnected, 
                    profileName,
                    action: 'disconnected'
                });
            }
        } catch (error) {
            console.error(`❌ Disconnect error for ${profileName}:`, error);
        }
    }

    /**
     * Test sync operation (pulls contacts from server) - with iCloud one-way export detection
     * This is the same as syncFromBaikal but used by UI
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Sync result
     */
    async testSync(profileName) {
        // Bidirectional sync for Baikal/Nextcloud
        return await this.syncFromBaikal(profileName);
    }

    /**
    /**
     * Push owned contacts to Baikal
     * Used by UI to push all owned contacts
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Push result
     */
    async testPushOwnedContacts(profileName, contactsToSync = null) {
        try {
            if (!this.contactManager) {
                throw new Error('ContactManager not set');
            }

            // 🛑 DISABLED: Cleanup archived/deleted contacts BEFORE pushing
            // This was causing sync loop: pull → mark as deleted → cleanup deletes from server → push back
            // TODO: Re-enable with smarter logic (only delete if contact was explicitly deleted/archived by user)
            // await this.cleanupArchivedContactsFromBaikal(profileName);

            // Get contacts to push - either provided array or fetch from ContactManager
            let eligibleContacts;
            
            if (contactsToSync && Array.isArray(contactsToSync)) {
                // Use provided contacts (already filtered by caller)
                eligibleContacts = contactsToSync;
            } else {
                // Fallback: Get all contacts eligible for CardDAV push
                // BIDIRECTIONAL SYNC: Push ALL contacts (owned, imported, shared)
                // - OWNED → my-contacts addressbook (read-write)
                // - IMPORTED → my-contacts addressbook (bidirectional sync - server authority but push changes)
                // - SHARED → shared-contacts addressbook (read-only for Baikal, single addressbook for iCloud)
                const allContacts = Array.from(this.contactManager.contacts.values());

                // Push all non-deleted, non-archived contacts (including imported for bidirectional sync)
                eligibleContacts = allContacts.filter(contact => 
                    !contact.metadata?.isDeleted &&
                    !contact.metadata?.isArchived
                );

            }

            // Separate by type for logging
            const ownedContacts = eligibleContacts.filter(c => c.metadata?.isOwned === true && !c.metadata?.isImported);
            const importedContacts = eligibleContacts.filter(c => c.metadata?.isImported === true);
            const sharedContacts = eligibleContacts.filter(c => c.metadata?.isOwned === false && c.contactId?.startsWith('shared_'));
            
            // 📊 Show filtering statistics
            if (!contactsToSync) {
                const allContacts = Array.from(this.contactManager.contacts.values());
                const totalContacts = allContacts.length;
                const deletedCount = allContacts.filter(c => c.metadata?.isDeleted).length;
                const archivedCount = allContacts.filter(c => c.metadata?.isArchived).length;
                
            }


            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0; // ✅ Track skipped contacts
            const errors = [];

            // 🚀 PARALLEL PUSH: Process contacts in batches for better performance
            const BATCH_SIZE = 10; // Push 10 contacts at once
            const batches = [];
            
            for (let i = 0; i < eligibleContacts.length; i += BATCH_SIZE) {
                batches.push(eligibleContacts.slice(i, i + BATCH_SIZE));
            }
            
            
            const startTime = Date.now();
            
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const progress = Math.round(((batchIndex) / batches.length) * 100);
                
                // Push all contacts in this batch in parallel
                const batchPromises = batch.map(async (contact) => {
                    try {
                        const result = await this.pushContactToBaikal(contact, profileName);
                        return { 
                            success: result.success, 
                            contact, 
                            result,
                            skipped: result.skipped || false // ✅ Track skip flag
                        };
                    } catch (error) {
                        return { success: false, contact, error: error.message, skipped: false };
                    }
                });
                
                // Wait for all contacts in this batch to complete
                const batchResults = await Promise.all(batchPromises);
                
                // Count results
                batchResults.forEach(result => {
                    if (result.success) {
                        if (result.skipped) {
                            skippedCount++; // ✅ Count skipped contacts
                        } else {
                            successCount++;
                        }
                    } else {
                        errorCount++;
                        errors.push({
                            contact: result.contact.cardName,
                            error: result.error || result.result?.error
                        });
                    }
                });
                
            }
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const avgTimePerContact = (duration / eligibleContacts.length).toFixed(2);
            

            return {
                success: successCount > 0 || skippedCount > 0,
                total: eligibleContacts.length,
                successCount,
                skippedCount, // ✅ Include skipped count
                errorCount,
                totalCount: eligibleContacts.length,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            console.error('❌ Push owned contacts failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🆕 Clean up archived/deleted contacts from Baikal
     * Deletes contacts that are archived or deleted locally but still exist on server
     * 
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Cleanup result
     */
    async cleanupArchivedContactsFromBaikal(profileName) {
        try {
            if (!this.contactManager) {
                console.warn('⚠️ ContactManager not available, skipping cleanup');
                return { success: false, deletedCount: 0 };
            }

            // Get ALL contacts (including archived and deleted)
            const allContacts = Array.from(this.contactManager.contacts.values());
            
            // Find contacts that are archived or deleted AND have CardDAV metadata (were synced before)
            const contactsToDelete = allContacts.filter(contact => {
                const isArchived = contact.metadata?.isArchived === true;
                const isDeleted = contact.metadata?.isDeleted === true;
                const hasBaikalData = contact.metadata?.cardDAV?.href || contact.metadata?.cardDAV?.etag;
                
                return (isArchived || isDeleted) && hasBaikalData;
            });

            if (contactsToDelete.length === 0) {
                return { success: true, deletedCount: 0 };
            }


            let deletedCount = 0;
            const errors = [];

            for (const contact of contactsToDelete) {
                try {
                    const contactType = contact.metadata?.isArchived ? 'archived' : 'deleted';
                    
                    const result = await this.deleteContactFromBaikal(contact, profileName);
                    
                    if (result.success) {
                        deletedCount++;
                        
                        // Clear CardDAV metadata after successful deletion
                        // ⚠️ Only for OWNED contacts - shared contacts are read-only in user database
                        const isOwnedContact = contact.metadata?.isOwned === true;
                        if (isOwnedContact && this.contactManager.updateContactMetadata) {
                            try {
                                await this.contactManager.updateContactMetadata(contact.contactId, {
                                    metadata: {
                                        cardDAV: null
                                    }
                                });
                            } catch (metadataError) {
                                console.warn(`⚠️ Could not clear CardDAV metadata for ${contact.cardName}:`, metadataError.message);
                                // Non-critical error - deletion from Baikal was successful
                            }
                        } else if (!isOwnedContact) {
                        }
                    } else {
                        errors.push({
                            contact: contact.cardName,
                            error: result.error
                        });
                    }
                } catch (error) {
                    console.error(`❌ Failed to delete ${contact.cardName}:`, error.message);
                    errors.push({
                        contact: contact.cardName,
                        error: error.message
                    });
                }
            }


            return {
                success: deletedCount > 0 || contactsToDelete.length === 0,
                deletedCount,
                total: contactsToDelete.length,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            console.error('❌ Cleanup archived contacts failed:', error);
            return { success: false, error: error.message, deletedCount: 0 };
        }
    }

    /**
     * 🛡️ Initialize shared contact protection
     * 
     * STRATEGY SELECTION:
     * - Servers WITH ACL (Baikal, Nextcloud): Server-side protection (read-only addressbook)
     * - Servers WITHOUT ACL (iCloud, Google): Client-side protection (periodic re-push)
     * 
     * @param {string} profileName - Profile name
     * @param {number} interval - Protection interval in ms (default from config)
     * @returns {Promise<Object>} Result
     */
    async initializeSharedContactProtection(profileName, interval = PERFORMANCE_CONFIG.baikalProtectionInterval) {
        const connection = this.connections.get(profileName);
        
        if (!connection) {
            console.error('❌ Profile not found:', profileName);
            return { success: false, error: 'Profile not connected' };
        }
        
        const capabilities = connection.capabilities;
        
        
        if (capabilities.supportsACL) {
            // Strategy 1: Server-side ACL protection (Baikal, Nextcloud)
            
            return {
                success: true,
                profileName,
                strategy: 'server_side_acl',
                protectionMethod: 'read_only_addressbook',
                requiresPeriodicPush: false,
                notes: 'Server enforces read-only via ACL - 100% protection'
            };
        } else {
            // ⚠️ DISABLED: Client-side validation (was causing bulk pushes after every sync)
            console.log(`⚠️ Shared contact protection DISABLED for profile "${profileName}"`);
            console.log(`   Reason: Periodic pushes were overwriting server changes`);
            console.log(`   For Radicale/Baikal: Server-side ACL provides protection`);
            console.log(`   For iCloud/Google: Re-enable when bidirectional sync is stable`);
            
            // Strategy 2: Client-side validation (iCloud, Google)
            
            // // Setup periodic protection for shared contacts
            // const protectionKey = `${profileName}_shared_protection`;
            // 
            // // Clear existing protection interval
            // if (this.protectionIntervals.has(protectionKey)) {
            //     clearInterval(this.protectionIntervals.get(protectionKey));
            // }
            // 
            // // Setup new protection interval (runs TWO operations)
            // const protectionInterval = setInterval(async () => {
            //     const now = new Date();
            //     
            //     // Operation 1: Detect and correct unauthorized edits
            //     try {
            //         await this.detectAndCorrectUnauthorizedEdits(profileName);
            //     } catch (error) {
            //         console.error('❌ Unauthorized edit detection failed:', error.message);
            //     }
            //     
            //     // Operation 2: Refresh shared contacts (maintain ecosystem)
            //     try {
            //         await this.refreshSharedContactsToCardDAV(profileName);
            //     } catch (error) {
            //         console.error('❌ Shared contact refresh failed:', error.message);
            //     }
            //     
            // }, interval);
            // 
            // this.protectionIntervals.set(protectionKey, protectionInterval);
            
            
            return {
                success: true,
                profileName,
                strategy: 'disabled',  // ← Changed from 'client_side_validation'
                protectionMethod: 'none',  // ← Changed from 'dual_protection'
                operations: [],  // ← Empty - no operations
                requiresPeriodicPush: false,  // ← Changed from true
                interval: 0,  // ← No interval
                notes: 'Shared contact protection DISABLED to prevent bulk pushes that overwrite server changes. For Radicale/Baikal, server-side ACL provides protection.'
            };
        }
    }

    /**
     * 🔍 Detect and correct unauthorized edits to shared contacts
     * Uses ETag comparison to find modified contacts, then re-pushes original version
     * 
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Correction results
     */
    async detectAndCorrectUnauthorizedEdits(profileName) {
        // 🔒 Skip if sync is already in progress to avoid conflicts
        if (this.syncInProgress) {
            return { corrected: 0, checked: 0 };
        }
        
        const startTime = Date.now();
        
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not available');
            return { corrected: 0, checked: 0 };
        }
        
        // Get all shared contacts (green)
        const allContacts = Array.from(this.contactManager.contacts.values());
        
        const sharedContacts = allContacts.filter(c => 
                c.metadata?.isOwned === false && 
                c.contactId?.startsWith('shared_') &&
                !c.metadata?.isDeleted &&
                !c.metadata?.isArchived
            );
        
        
        if (sharedContacts.length > 0) {
            sharedContacts.forEach((c, idx) => {
            });
        }
        
        if (sharedContacts.length === 0) {
            return { corrected: 0, checked: 0 };
        }
        
        let correctedCount = 0;
        const correctedContacts = [];
        const etagComparisons = [];
        
        try {
            
            // Pull current state from server
            const serverResult = await this.syncFromBaikal(profileName);
            
            if (!serverResult.success) {
                console.error('❌ Failed to check server state');
                return { corrected: 0, checked: sharedContacts.length };
            }
            
            const serverContacts = serverResult.contacts || [];
            
            
            for (const localContact of sharedContacts) {
                try {
                    // Find corresponding server contact by UID
                    const uid = this.contactManager.extractUIDFromVCard(localContact.vcard);
                    const serverContact = serverContacts.find(sc => sc.uid === uid);
                    
                    if (!serverContact) {
                        continue;
                    }
                    
                    // Compare ETags
                    const localETag = localContact.metadata?.cardDAV?.etag;
                    const serverETag = serverContact.etag;
                    
                    const comparison = {
                        name: localContact.cardName,
                        uid,
                        localETag,
                        serverETag,
                        match: localETag === serverETag
                    };
                    etagComparisons.push(comparison);
                    
                    
                    if (localETag && serverETag && localETag !== serverETag) {
                        // ETag mismatch → Contact was modified externally (unauthorized edit)
                        console.warn(`\n⚠️ ========================================`);
                        console.warn(`⚠️ UNAUTHORIZED EDIT DETECTED!`);
                        console.warn(`⚠️ Contact: ${localContact.cardName}`);
                        console.warn(`⚠️ Local ETag:  ${localETag}`);
                        console.warn(`⚠️ Server ETag: ${serverETag}`);
                        console.warn(`⚠️ ========================================`);
                        console.warn(`🔄 Re-pushing original version...\n`);
                        
                        // Re-push the original from Contact Manager (force override)
                        const pushResult = await this.forcePushSharedContact(localContact, profileName);
                        
                        if (pushResult.success) {
                            correctedCount++;
                            correctedContacts.push(localContact.cardName);
                            
                            // Emit event for UI notification
                            if (this.eventBus) {
                                this.eventBus.emit('sharedContact:unauthorizedEditDetected', {
                                    contactName: localContact.cardName,
                                    contactId: localContact.contactId,
                                    corrected: true
                                });
                            }
                        } else {
                            console.error(`❌ Failed to correct: ${localContact.cardName}`);
                        }
                    }
                } catch (contactError) {
                    console.error(`❌ Error checking contact ${localContact.cardName}:`, contactError);
                }
            }
            
            const duration = Date.now() - startTime;
            
            
            if (etagComparisons.length > 0) {
                etagComparisons.forEach((comp, idx) => {
                    const status = comp.match ? '✅' : '❌';
                });
            }
            
            if (correctedCount > 0) {
                correctedContacts.forEach((name, idx) => {
                });
            } else {
            }
            
            
            return { 
                corrected: correctedCount, 
                contacts: correctedContacts,
                checked: sharedContacts.length,
                duration
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('\n❌ =================================================');
            console.error('❌ UNAUTHORIZED EDIT DETECTION FAILED');
            console.error('❌ =================================================');
            console.error(`   Error: ${error.message}`);
            console.error(`   Duration: ${duration}ms`);
            console.error('❌ =================================================\n');
            return { corrected: 0, checked: sharedContacts.length, error: error.message, duration };
        }
    }

    /**
     * 🔄 Force-push shared contact (overrides any external edits)
     * Used for client-side protection on servers without ACL support
     * 
     * @param {Object} contact - Shared contact to force-push
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Push result
     */
    async forcePushSharedContact(contact, profileName) {
        try {
            
            // Extract UID
            const uid = this.contactManager?.extractUIDFromVCard(contact.vcard) || contact.contactId;
            
            // Get addressbook (will be 'default' for iCloud/Google)
            const addressbook = this.getAddressbookForContact(contact, profileName);
            
            // Prepare vCard for push (Baikal/Nextcloud use vCard 4.0 natively)
            let vCardToSend = contact.vcard;
            
            // Note: For iCloud, use ICloudConnector instead
            // BaikalConnector is for Baikal/Nextcloud which support vCard 4.0 natively
            
            // ✅ Force-push using lite bridge (NULL ETag overrides server version)
            const result = await this.bridgeAdapter.pushContact(
                profileName,
                addressbook,
                vCardToSend,
                uid,
                null  // ❌ NULL ETag = force override
            );
            
            if (result.success) {
                
                // Update local ETag to match server
                if (result.etag && this.contactManager) {
                    await this.contactManager.updateContactCardDAVMetadata(contact.contactId, {
                        etag: result.etag,
                        href: result.href,
                        addressbook: addressbook,
                        lastSyncedAt: new Date().toISOString(),
                        lastForcePush: new Date().toISOString()
                    });
                }
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Force-push shared contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * � Refresh shared contacts to CardDAV server
     * Simulates user2 pressing "save contact" to maintain Userbase sharing ecosystem
     * 
     * USE CASE:
     * - User1 receives shared contacts from User2 (via Userbase)
     * - User1 connects to iCloud
     * - iCloud overwrites shared contacts (doesn't know about Userbase)
     * - This method re-pushes shared contacts every 5 minutes
     * - Maintains User2's shared contacts in User1's iCloud
     * 
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Refresh result
     */
    async refreshSharedContactsToCardDAV(profileName) {
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not available, cannot refresh shared contacts');
            return { success: false, refreshed: 0 };
        }

        const startTime = Date.now();

        // Get all shared contacts (green 🟢)
        const allContacts = Array.from(this.contactManager.contacts.values());
        const sharedContacts = allContacts.filter(c => 
            c.metadata?.isOwned === false && 
            c.contactId?.startsWith('shared_') &&
            !c.metadata?.isDeleted &&
            !c.metadata?.isArchived
        );


        if (sharedContacts.length === 0) {
            return { success: true, refreshed: 0 };
        }

        sharedContacts.forEach((c, idx) => {
            const sharedBy = c.metadata?.sharedBy || 'unknown';
        });

        let refreshedCount = 0;
        let errorCount = 0;
        const errors = [];

        // Re-push each shared contact (simulates "save contact")
        for (const contact of sharedContacts) {
            try {
                
                // Force-push to override any iCloud overwrites
                const result = await this.forcePushSharedContact(contact, profileName);
                
                if (result.success) {
                    refreshedCount++;
                } else {
                    errorCount++;
                    errors.push({
                        contact: contact.cardName,
                        error: result.error
                    });
                }
            } catch (error) {
                errorCount++;
                errors.push({
                    contact: contact.cardName,
                    error: error.message
                });
            }
        }

        const duration = Date.now() - startTime;


        if (errors.length > 0) {
            errors.forEach((err, idx) => {
            });
        }


        return {
            success: refreshedCount > 0,
            refreshed: refreshedCount,
            total: sharedContacts.length,
            errorCount,
            errors: errors.length > 0 ? errors : undefined,
            duration
        };
    }

    /**
     * �🛑 Stop shared contact protection
     * @param {string} profileName - Profile name
     * @returns {Object} Result
     */
    stopSharedContactProtection(profileName) {
        const protectionKey = `${profileName}_shared_protection`;
        
        if (this.protectionIntervals.has(protectionKey)) {
            clearInterval(this.protectionIntervals.get(protectionKey));
            this.protectionIntervals.delete(protectionKey);
            
            
            return { success: true, profileName, stopped: true };
        }
        
        return { success: true, profileName, stopped: false, note: 'Protection was not active' };
    }

    /**
     * 🆕 Initialize automatic synchronization
     * 
     * DEFAULT INTERVALS (for testing):
     * - Pull (sync from server): 5 minutes (300000ms)
     * - Push (send to server): 5 minutes (300000ms)
     * 
     * COLOR SCHEME:
     * - 🔵 BLUE = Owned contacts (created by you)
     * - 🟢 GREEN = Shared contacts (received from others)
     * - 🟠 ORANGE = Imported contacts (from Baikal server)
     * 
     * @param {string} profileName - Profile name to sync
     * @param {Object} intervals - Custom intervals { pull: ms, push: ms }
     * @returns {Promise<Object>} Result
     */
    async initializeAutoSync(profileName, intervals = {}) {
        try {
            // Default intervals from config
            const defaultIntervals = {
                pull: PERFORMANCE_CONFIG.baikalPullInterval,  // 30 minutes - sync FROM Baikal
                push: PERFORMANCE_CONFIG.baikalPushInterval   // 30 minutes - push TO Baikal
            };

            const syncConfig = { ...defaultIntervals, ...intervals };


            // Stop any existing intervals for this profile
            this.stopAutoSync(profileName);

            // Initialize intervals map for this profile
            if (!this.syncIntervals.has(profileName)) {
                this.syncIntervals.set(profileName, {});
            }

            const profileIntervals = this.syncIntervals.get(profileName);

            // 1. Pull interval - Sync FROM Baikal (imports external edits)
            if (syncConfig.pull > 0) {
                profileIntervals.pullInterval = setInterval(async () => {
                    try {
                        const result = await this.syncFromBaikal(profileName);
                        if (result.success) {
                            if (result.deletions?.deleted > 0) {
                            }
                        } else {
                            console.error(`❌ Auto-sync (pull) failed:`, result.error);
                        }
                    } catch (error) {
                        console.error(`❌ Auto-sync (pull) error (continuing...):`, error.message);
                        // Don't throw - let the interval continue
                    }
                }, syncConfig.pull);

            } else {
            }

            // 2. Push interval - Push TO Baikal (sends local changes)
            // ⚠️ DISABLED: Initial bulk push after 30 seconds (was overwriting Thunderbird edits)
            // Individual contacts are already pushed via updateContact() auto-push mechanism
            if (syncConfig.push > 0) {
                console.log(`⚠️ Initial bulk push DISABLED (30s delay)`);
                console.log(`   Reason: Was overwriting server changes after sync`);
                console.log(`   Solution: Use updateContact() for individual contact pushes`);
                
                // Delay first push by 30 seconds to stagger with pull
                setTimeout(() => {
                    // ⚠️ COMMENTED OUT: This was pushing ALL contacts after connection
                    // (async () => {
                    //     
                    //     if (!this.contactManager) {
                    //         console.warn('⚠️ Auto-sync (push): ContactManager not available, skipping this cycle');
                    //         return;
                    //     }
                    //     
                    //     try {
                    //         // 1. Push all contacts
                    //         const result = await this.testPushOwnedContacts(profileName);
                    //         if (result.success) {
                    //         } else {
                    //             console.error(`❌ Auto-sync (push) failed:`, result.error);
                    //         }
                    //         
                    //         // 2. 🔄 Force-refresh shared contacts
                    //         try {
                    //             const refreshResult = await this.refreshSharedContactsToCardDAV(profileName);
                    //             if (refreshResult.success) {
                    //             }
                    //         } catch (refreshError) {
                    //             console.warn(`⚠️ Shared contact refresh failed (continuing):`, refreshError.message);
                    //         }
                    //     } catch (error) {
                    //         console.error(`❌ Auto-sync (push) error (continuing...):`, error.message);
                    //     }
                    // })();
                    
                    // ⚠️ DISABLED: Periodic bulk push (was causing Thunderbird edits to be overwritten)
                    // Individual contacts are already pushed via updateContact() auto-push mechanism
                    console.log(`⚠️ Periodic push interval DISABLED - using individual auto-push instead`);
                    console.log(`   Auto-push triggers when contacts are edited via updateContact()`);
                    
                    // profileIntervals.pushInterval = setInterval(async () => {
                    //     // Safety check: ensure ContactManager is available
                    //     if (!this.contactManager) {
                    //         console.warn('⚠️ Auto-sync (push): ContactManager not available, skipping this cycle');
                    //         return;
                    //     }
                    //     
                    //     try {
                    //         // 1. Push all contacts (owned, imported, shared)
                    //         const result = await this.testPushOwnedContacts(profileName);
                    //         if (result.success) {
                    //         } else {
                    //             console.error(`❌ Auto-sync (push) failed:`, result.error);
                    //         }
                    //         
                    //         // 2. 🔄 ADDITIONAL: Force-refresh shared contacts (maintains ecosystem)
                    //         // This ensures shared contacts are always pushed even if iCloud overwrites them
                    //         try {
                    //             const refreshResult = await this.refreshSharedContactsToCardDAV(profileName);
                    //             if (refreshResult.success) {
                    //             }
                    //         } catch (refreshError) {
                    //             console.warn(`⚠️ Shared contact refresh failed (continuing):`, refreshError.message);
                    //         }
                    //     } catch (error) {
                    //         console.error(`❌ Auto-sync (push) error (continuing...):`, error.message);
                    //         // Don't throw - let the interval continue
                    //     }
                    // }, syncConfig.push);
                }, 30000); // 30-second delay before first push

            }

            this.autoSyncEnabled = true;

            // 🆕 DIAGNOSTIC: Add heartbeat to verify intervals stay alive
            let heartbeatCount = 0;
            profileIntervals.heartbeatInterval = setInterval(() => {
                heartbeatCount++;
            }, PERFORMANCE_CONFIG.baikalHeartbeatInterval); // Heartbeat every 1 minute


            // 🛡️ Initialize shared contact protection
            try {
                const protectionResult = await this.initializeSharedContactProtection(
                    profileName, 
                    syncConfig.protection || 300000 // 5 min default
                );
                
                if (protectionResult.success) {
                }
            } catch (protectionError) {
                console.warn('⚠️ Shared contact protection setup failed (continuing):', protectionError.message);
            }

            // Perform initial sync immediately (optional - skip if ContactManager not ready)
            if (this.contactManager) {
                try {
                    await this.performInitialSync(profileName);
                } catch (syncError) {
                    console.warn('⚠️ Initial sync failed (continuing with auto-sync):', syncError.message);
                }
            } else {
                console.warn('⚠️ ContactManager not set - skipping initial sync (auto-sync intervals still active)');
            }

            return {
                success: true,
                profileName,
                intervals: syncConfig,
                autoSyncEnabled: true
            };

        } catch (error) {
            console.error('❌ Auto-sync initialization failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🆕 Perform initial sync (pull only on startup)
     * ⚠️ REMOVED automatic push to prevent overwriting server changes
     * Individual contact changes are auto-pushed via updateContact() instead
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Result
     */
    async performInitialSync(profileName) {
        try {
            console.log(`🔄 Initial sync: Pull-only (auto-push disabled to prevent overwrites)`);
            const pullResult = await this.syncFromBaikal(profileName);

            if (pullResult.deletions?.deleted > 0) {
                console.log(`🗑️ Initial sync: Deleted ${pullResult.deletions.deleted} contacts from local database`);
            }

            return {
                success: true,
                pull: pullResult,
                push: { skipped: true, reason: 'Auto-push disabled - use updateContact() for individual pushes' }
            };

        } catch (error) {
            console.error('❌ Initial sync failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🆕 Stop automatic synchronization
     * @param {string} profileName - Profile name
     * @returns {Object} Result
     */
    stopAutoSync(profileName) {
        const profileIntervals = this.syncIntervals.get(profileName);

        if (profileIntervals) {
            if (profileIntervals.pullInterval) {
                clearInterval(profileIntervals.pullInterval);
            }

            if (profileIntervals.pushInterval) {
                clearInterval(profileIntervals.pushInterval);
            }

            if (profileIntervals.heartbeatInterval) {
                clearInterval(profileIntervals.heartbeatInterval);
            }

            this.syncIntervals.delete(profileName);
        }

        // 🛡️ Stop shared contact protection
        this.stopSharedContactProtection(profileName);

        // Check if any profiles still have auto-sync enabled
        this.autoSyncEnabled = this.syncIntervals.size > 0;


        return {
            success: true,
            profileName,
            autoSyncEnabled: this.autoSyncEnabled
        };
    }

    /**
     * 🆕 Update sync intervals (change intervals on the fly)
     * @param {string} profileName - Profile name
     * @param {Object} intervals - New intervals { pull: ms, push: ms }
     * @returns {Promise<Object>} Result
     */
    async updateSyncIntervals(profileName, intervals) {

        // Stop current intervals
        this.stopAutoSync(profileName);

        // Restart with new intervals
        return await this.initializeAutoSync(profileName, intervals);
    }

    /**
     * 🆕 Get auto-sync status
     * @param {string} profileName - Profile name (optional)
     * @returns {Object} Auto-sync status
     */
    getAutoSyncStatus(profileName = null) {
        if (profileName) {
            const profileIntervals = this.syncIntervals.get(profileName);
            
            if (!profileIntervals) {
                return {
                    profileName,
                    enabled: false,
                    intervals: null,
                    message: 'Auto-sync not configured for this profile'
                };
            }

            return {
                profileName,
                enabled: true,
                pullEnabled: !!profileIntervals.pullInterval,
                pushEnabled: !!profileIntervals.pushInterval,
                pullIntervalActive: profileIntervals.pullInterval ? true : false,
                pushIntervalActive: profileIntervals.pushInterval ? true : false,
                message: 'Auto-sync is active'
            };
        }

        // Return status for all profiles
        const allStatus = {};
        for (const [name, intervals] of this.syncIntervals.entries()) {
            allStatus[name] = {
                enabled: true,
                pullEnabled: !!intervals.pullInterval,
                pushEnabled: !!intervals.pushInterval,
                pullIntervalActive: intervals.pullInterval ? true : false,
                pushIntervalActive: intervals.pushInterval ? true : false
            };
        }

        return {
            autoSyncEnabled: this.autoSyncEnabled,
            activeProfiles: this.syncIntervals.size,
            profiles: allStatus,
            message: this.autoSyncEnabled 
                ? `Auto-sync active for ${this.syncIntervals.size} profile(s)` 
                : 'Auto-sync not enabled'
        };
    }

    /**
     * Stop periodic refresh (wrapper for stopAutoSync)
     * Used during bulk operations like import to prevent race conditions
     */
    stopPeriodicRefresh() {
        console.log('🛑 Stopping all periodic sync intervals');
        const profiles = Array.from(this.syncIntervals.keys());
        
        for (const profileName of profiles) {
            this.stopAutoSync(profileName);
        }
        
        console.log(`✅ Stopped periodic sync for ${profiles.length} profile(s)`);
    }

    /**
     * Start periodic refresh (wrapper for initializeAutoSync)
     * Restarts periodic sync after bulk operations complete
     */
    startPeriodicRefresh() {
        console.log('▶️ Starting periodic sync intervals');
        const profiles = Array.from(this.connections.keys());
        
        for (const profileName of profiles) {
            const connection = this.connections.get(profileName);
            if (connection && connection.connected) {
                // Use default intervals
                this.initializeAutoSync(profileName).catch(err => {
                    console.error(`❌ Failed to restart auto-sync for ${profileName}:`, err);
                });
            }
        }
        
        console.log(`✅ Started periodic sync for ${profiles.length} connected profile(s)`);
    }

    /**
     * Diagnose CardDAV connection and server status
     * @param {string} profileName - Connection profile name
     * @returns {Promise<Object>} Diagnostic results
     */
    async diagnoseConnection(profileName) {
        console.log(`🔍 Running diagnostics for profile: ${profileName}`);
        
        const diagnostics = {
            profileName,
            connected: false,
            serverReachable: false,
            addressbookExists: false,
            contactCount: 0,
            localContactCount: 0,
            issues: [],
            recommendations: []
        };

        try {
            // Check if profile exists
            const profile = this.connections.get(profileName);
            if (!profile) {
                diagnostics.issues.push('Profile not found in connections');
                diagnostics.recommendations.push('Reconnect to CardDAV server');
                return diagnostics;
            }

            diagnostics.connected = true;
            diagnostics.serverUrl = profile.serverUrl;
            diagnostics.addressbookUrl = profile.addressbookUrl;

            // Count local contacts
            if (this.contactManager) {
                const localContacts = Array.from(this.contactManager.contacts.values())
                    .filter(c => !c.metadata?.isDeleted && !c.metadata?.isArchived);
                diagnostics.localContactCount = localContacts.length;
            }

            // Try to fetch from server
            try {
                const result = await this.bridgeAdapter.testConnection(profileName);
                diagnostics.serverReachable = result.success;
                
                if (result.success && result.contactCount !== undefined) {
                    diagnostics.addressbookExists = true;
                    diagnostics.contactCount = result.contactCount;

                    // Analysis
                    if (diagnostics.contactCount === 0 && diagnostics.localContactCount > 0) {
                        diagnostics.issues.push(`Server has 0 contacts but you have ${diagnostics.localContactCount} locally`);
                        diagnostics.recommendations.push('Re-push contacts using "Manual Push" button');
                        diagnostics.recommendations.push('Check if Radicale is using persistent storage (not in-memory)');
                    } else if (diagnostics.contactCount > 0) {
                        diagnostics.status = 'healthy';
                        diagnostics.recommendations.push(`Server has ${diagnostics.contactCount} contacts - sync should work normally`);
                    }
                } else {
                    diagnostics.issues.push('Failed to fetch contacts from server');
                    diagnostics.recommendations.push('Check server URL and credentials');
                }
            } catch (fetchError) {
                diagnostics.serverReachable = false;
                diagnostics.issues.push(`Cannot reach server: ${fetchError.message}`);
                diagnostics.recommendations.push('Verify Radicale is running: http://127.0.0.1:5232');
                diagnostics.recommendations.push('Check network connectivity and CORS settings');
            }

        } catch (error) {
            diagnostics.issues.push(`Diagnostic error: ${error.message}`);
        }

        // Print diagnostic report
        console.log('\n📋 DIAGNOSTIC REPORT:');
        console.log(`   Profile: ${profileName}`);
        console.log(`   Connected: ${diagnostics.connected ? '✅' : '❌'}`);
        console.log(`   Server reachable: ${diagnostics.serverReachable ? '✅' : '❌'}`);
        console.log(`   Addressbook exists: ${diagnostics.addressbookExists ? '✅' : '❌'}`);
        console.log(`   Server contacts: ${diagnostics.contactCount}`);
        console.log(`   Local contacts: ${diagnostics.localContactCount}`);
        
        if (diagnostics.issues.length > 0) {
            console.log('\n⚠️ ISSUES FOUND:');
            diagnostics.issues.forEach(issue => console.log(`   - ${issue}`));
        }
        
        if (diagnostics.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            diagnostics.recommendations.forEach(rec => console.log(`   - ${rec}`));
        }
        
        console.log('');
        return diagnostics;
    }
}
