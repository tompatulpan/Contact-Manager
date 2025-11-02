import { VCard3Processor } from '../core/VCard3Processor.js';

/**
 * BaikalConnector - REFACTORED VERSION
 * Simplified CardDAV sync with ownership preservation
 * 
 * KEY CHANGES FROM OLD VERSION:
 * ❌ REMOVED: Authority override strategy (loses external changes)
 * ❌ REMOVED: Complex categorized sync intervals
 * ❌ REMOVED: forcePushWithAuthorityOverride()
 * 
 * ✅ ADDED: Ownership preservation (preserves external edits)
 * ✅ ADDED: UID-based contact matching
 * ✅ ADDED: Addressbook routing (/my-contacts/ vs /shared-contacts/)
 * ✅ ADDED: Simple pull → import → preserve pattern
 * ✅ ADDED: vCard 3.0 conversion for iCloud/Apple compatibility
 */
export class BaikalConnector {
    constructor(bridgeUrl = 'http://localhost:3001/api', eventBus = null) {
        this.version = '2025-10-30-shared-protection';
        console.log(`🔧 BaikalConnector v${this.version} - Shared Contact Protection + Server Detection`);
        
        this.bridgeUrl = bridgeUrl;
        this.eventBus = eventBus;
        this.connections = new Map();
        this.isConnected = false;
        this.contactManager = null;
        
        // Event callbacks
        this.onStatusChange = null;
        this.onContactsReceived = null;
        this.onError = null;
        
        // 🆕 Auto-sync intervals
        this.syncIntervals = new Map(); // Map<profileName, { syncInterval, pushInterval }>
        this.autoSyncEnabled = false;
        
        // 🛡️ Shared contact protection intervals
        this.protectionIntervals = new Map(); // Map<profileKey, interval>
        
        // 🔒 Sync lock to prevent concurrent operations
        this.syncInProgress = false;
        this.syncQueue = Promise.resolve(); // Chain sync operations
        
        // 🍎 vCard 3.0 processor for Apple/iCloud compatibility
        this.vCard3Processor = new VCard3Processor({});
        console.log('🍎 VCard3Processor initialized for iCloud/Apple compatibility');
    }

    /**
     * Set ContactManager reference for integration
     * @param {ContactManager} contactManager - ContactManager instance
     */
    setContactManager(contactManager) {
        this.contactManager = contactManager;
        console.log('🔗 BaikalConnector integrated with ContactManager');
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
            console.log(`🔍 Discovering addressbooks: ${config.serverUrl}`);
            
            const response = await fetch(`${this.bridgeUrl}/discover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serverUrl: config.serverUrl,
                    username: config.username,
                    password: config.password,
                    profileName: config.profileName
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log(`✅ Found ${result.addressbooks.length} addressbook(s)`);
                result.addressbooks.forEach(ab => {
                    console.log(`   📂 ${ab.displayName} (${ab.href})`);
                });
                
                // Store addressbooks in connection for later use
                if (this.connections.has(config.profileName)) {
                    const connection = this.connections.get(config.profileName);
                    connection.addressbooks = result.addressbooks;
                    connection.serverType = result.serverType;
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
            console.log('🔗 Connecting to CardDAV server:', config.serverUrl);
            
            const response = await fetch(`${this.bridgeUrl}/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();

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
                console.log(`✅ Connected to ${capabilities.serverType}: ${config.profileName}`);
                console.log(`   📊 Server Capabilities:`);
                console.log(`      - ACL Support: ${capabilities.supportsACL ? '✅ Yes' : '❌ No'}`);
                console.log(`      - Separate Addressbooks: ${capabilities.supportsSeparateAddressbooks ? '✅ Yes' : '❌ No'}`);
                console.log(`      - Protection Strategy: ${capabilities.protectionStrategy}`);
                console.log(`      - ${capabilities.notes}`);
                
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

            console.log(`🔌 Disconnected from Baikal: ${profileName}`);
            this.onStatusChange?.({ connected: false, profileName });

            return { success: true };

        } catch (error) {
            console.error('❌ Disconnect failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🍎 Detect if server is Apple/iCloud CardDAV (requires vCard 3.0)
     * @param {string} profileName - Profile name to check
     * @returns {boolean} True if Apple/iCloud server
     */
    isAppleCardDAVServer(profileName) {
        const connection = this.connections.get(profileName);
        if (!connection) return false;
        
        const serverUrl = (connection.serverUrl || '').toLowerCase();
        const isApple = serverUrl.includes('icloud.com') || 
                       serverUrl.includes('apple.com') || 
                       serverUrl.includes('me.com') || 
                       serverUrl.includes('mac.com');
        
        if (isApple) {
            console.log(`🍎 Detected Apple CardDAV server: ${profileName}`);
        }
        
        return isApple;
    }

    /**
     * 🔍 Detect server capabilities and choose protection strategy
     * @param {string} serverUrl - Server URL to analyze
     * @returns {Object} Server capabilities
     */
    detectServerCapabilities(serverUrl) {
        const url = serverUrl.toLowerCase();
        
        // Detect server type and capabilities
        if (url.includes('icloud.com') || url.includes('apple.com') || 
            url.includes('me.com') || url.includes('mac.com')) {
            return {
                serverType: 'iCloud',
                supportsACL: false,
                supportsSeparateAddressbooks: false,
                protectionStrategy: 'client_side_validation',
                supportsVCard3: true,
                vCardVersion: '3.0',
                notes: 'Single addressbook, no ACL - client-side protection required'
            };
        } else if (url.includes('dav.php') || url.includes('baikal')) {
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
            console.log('⏸️ Sync already in progress, queuing...');
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
        this.syncInProgress = true;
        try {
            console.log(`🔄 Syncing from Baikal: ${profileName}`);
            
            // Track last used profile for orphan cleanup
            this.lastUsedProfile = profileName;

            const response = await fetch(`${this.bridgeUrl}/sync/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Sync failed');
            }

            const serverContacts = result.syncResult?.contacts || result.contacts || [];
            console.log(`📥 Received ${serverContacts.length} contacts from server`);

            // Import contacts with ownership preservation (includes vCard 3.0 conversion for Apple)
            const importResults = await this.importContactsWithOwnershipPreservation(serverContacts, profileName);

            // 🐛 DEBUG: Verify imported contact metadata
            if (this.contactManager && importResults.imported > 0) {
                console.log('🐛 DEBUG: Verifying imported contact metadata...');
                const allContacts = Array.from(this.contactManager.contacts.values());
                const recentImports = allContacts
                    .filter(c => c.metadata?.cardDAV?.lastSyncedAt)
                    .slice(-Math.min(3, importResults.imported)); // Check last 3 imported
                
                recentImports.forEach(contact => {
                    console.log(`   Contact: ${contact.cardName}`);
                    console.log(`   - isOwned: ${contact.metadata?.isOwned}`);
                    console.log(`   - isImported: ${contact.metadata?.isImported}`);
                    console.log(`   - contactId: ${contact.contactId}`);
                    console.log(`   - has CardDAV metadata: ${!!contact.metadata?.cardDAV}`);
                });
            }

            // 🆕 Detect and handle server-side deletions (bidirectional sync)
            const deletionResults = await this.detectAndHandleServerDeletions(serverContacts, profileName);

            this.onContactsReceived?.({
                contacts: serverContacts,
                profileName,
                imported: importResults,
                deletions: deletionResults
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
            this.syncInProgress = false;
            console.log('🔓 Sync lock released');
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
            return { imported: 0, updated: 0, failed: 0 };
        }

        let imported = 0;
        let updated = 0;
        let failed = 0;
        let orphanedDeleted = 0;
        let vCard3Converted = 0;
        
        // 🔑 Track deleted orphans to avoid duplicate deletion attempts
        const deletedOrphanUIDs = new Set();
        
        // 🍎 Detect if this is an Apple server requiring vCard 3.0 conversion
        const isAppleServer = profileName && this.isAppleCardDAVServer(profileName);
        if (isAppleServer) {
            console.log(`🍎 Apple server detected - will convert vCard 3.0 → 4.0`);
        }

        for (const serverContact of serverContacts) {
            try {
                // 🔑 Skip if this UID was already deleted as an orphan during this sync
                if (deletedOrphanUIDs.has(serverContact.uid)) {
                    console.log(`⏭️ Skipping already-deleted orphan: ${serverContact.name || serverContact.uid}`);
                    continue;
                }
                
                // 🍎 Convert vCard 3.0 → 4.0 if from Apple server
                let processedContact = serverContact;
                if (isAppleServer && serverContact.vcard) {
                    try {
                        // VCard3Processor.import() returns contact object directly (throws on error)
                        const importedContact = this.vCard3Processor.import(
                            serverContact.vcard,
                            serverContact.name || 'Imported Contact',
                            true // markAsImported
                        );
                        
                        // Use the converted vCard 4.0 from the imported contact
                        if (importedContact && importedContact.vcard) {
                            processedContact = {
                                ...serverContact,
                                vcard: importedContact.vcard, // Use converted vCard 4.0
                                uid: serverContact.uid // ⚠️ CRITICAL: Preserve original UID from server
                            };
                            vCard3Converted++;
                            console.log(`🍎 Converted "${serverContact.name}" from vCard 3.0 → 4.0 (UID: ${serverContact.uid})`);
                        } else {
                            console.warn(`⚠️ vCard 3.0 conversion returned invalid contact for "${serverContact.name}", using original`);
                        }
                    } catch (conversionError) {
                        console.error(`❌ vCard 3.0 conversion error for "${serverContact.name}":`, conversionError);
                        console.warn(`⚠️ Using original vCard without conversion`);
                    }
                }
                
                // Determine addressbook context from contact data
                const syncContext = {
                    addressbook: processedContact.addressbook || 'my-contacts'
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
                            console.log(`✅ Successfully deleted orphaned contact from ${targetAddressbook}`);
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

        console.log(`✅ Import complete: ${imported} imported, ${updated} updated, ${failed} failed`);
        if (vCard3Converted > 0) {
            console.log(`🍎 Converted ${vCard3Converted} contacts from vCard 3.0 → 4.0`);
        }
        if (orphanedDeleted > 0) {
            console.log(`🗑️ Cleaned up ${orphanedDeleted} orphaned shared contacts from Baikal`);
        }

        return { imported, updated, failed, orphanedDeleted, vCard3Converted, total: serverContacts.length };
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

        console.log('🔍 Checking for server-side deletions...');

        // Build set of UIDs currently on server
        const serverUIDs = new Set(serverContacts.map(c => c.uid).filter(uid => uid));
        console.log(`📊 Server has ${serverUIDs.size} contacts`);
        
        // 🐛 DEBUG: Log first few server UIDs for comparison
        if (serverUIDs.size > 0) {
            const uidArray = Array.from(serverUIDs);
            const sampleUIDs = uidArray.slice(0, Math.min(5, uidArray.length));
            console.log(`   Sample server UIDs: ${sampleUIDs.join(', ')}`);
        }

        // Get all local contacts that are synced with this profile
        const localContacts = Array.from(this.contactManager.contacts.values())
            .filter(contact => {
                // Only check contacts that are synced with CardDAV
                const hasCardDAVMetadata = contact.metadata?.cardDAV?.lastSyncedAt;
                const notDeleted = !contact.metadata?.isDeleted;
                const notArchived = !contact.metadata?.isArchived;
                
                return hasCardDAVMetadata && notDeleted && notArchived;
            });

        console.log(`📊 Local has ${localContacts.length} synced contacts to check`);
        
        // 🐛 DEBUG: Log contact ownership breakdown
        const ownedCount = localContacts.filter(c => c.metadata?.isOwned === true).length;
        const importedCount = localContacts.filter(c => c.metadata?.isImported === true).length;
        const sharedCount = localContacts.filter(c => c.contactId?.startsWith('shared_')).length;
        console.log(`   📊 Breakdown: ${ownedCount} owned, ${importedCount} imported, ${sharedCount} shared`);
        
        // 🐛 DEBUG: Log first few local UIDs for comparison
        const localUIDs = localContacts
            .map(c => this.contactManager.extractUIDFromVCard(c.vcard))
            .filter(uid => uid);
        if (localUIDs.length > 0) {
            const sampleLocalUIDs = localUIDs.slice(0, Math.min(5, localUIDs.length));
            console.log(`   Sample local UIDs: ${sampleLocalUIDs.join(', ')}`);
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
                    
                    // ✅ SAFETY CHECK: Determine if contact should be deleted
                    const isOwned = localContact.metadata?.isOwned === true;
                    const isShared = localContact.contactId?.startsWith('shared_');
                    const isImported = localContact.metadata?.isImported === true;
                    
                    // 🐛 DEBUG: Log deletion candidate details
                    console.log(`🔍 Deletion candidate: ${localContact.cardName} (UID: ${localUID})`);
                    console.log(`   - isOwned: ${isOwned}`);
                    console.log(`   - isShared: ${isShared}`);
                    console.log(`   - isImported: ${isImported}`);
                    console.log(`   - metadata.isOwned: ${localContact.metadata?.isOwned}`);
                    console.log(`   - metadata.isImported: ${localContact.metadata?.isImported}`);

                    // 🔒 NEVER delete shared contacts (managed separately)
                    if (isShared) {
                        console.log(`⏭️ Skipping shared contact (managed separately): ${localContact.cardName}`);
                        skipped++;
                        continue;
                    }

                    // 🔧 UPDATED DELETION LOGIC (matches new ownership model):
                    // 
                    // NEW OWNERSHIP MODEL:
                    // - OWNED: isOwned=true, isImported=false (BLUE) - NEVER delete
                    // - IMPORTED: isOwned=true, isImported=true (ORANGE) - DELETE if missing from server
                    // - SHARED: isOwned=false (GREEN) - Handled separately above
                    // 
                    // DELETE RULES:
                    // 1. If isImported=true → DELETE (server has authority)
                    // 2. If isOwned=false → DELETE (not our contact)
                    // 3. If isOwned=true AND isImported=false → KEEP (user created, user has authority)
                    
                    const shouldDelete = isImported || !isOwned;
                    
                    console.log(`🎯 Deletion decision for ${localContact.cardName}:`);
                    console.log(`   - isImported=${isImported} → ${isImported ? 'DELETE' : 'keep'}`);
                    console.log(`   - isOwned=${isOwned} → ${!isOwned ? 'DELETE' : 'keep'}`);
                    console.log(`   - Final decision: ${shouldDelete ? '🗑️ DELETE' : '⏭️ SKIP'}`);
                    
                    if (!shouldDelete) {
                        console.log(`⏭️ Skipping owned contact (user has authority): ${localContact.cardName}`);
                        console.log(`   Not imported and marked as owned - preserving local version`);
                        skipped++;
                        continue;
                    }

                    // ✅ Safe to delete - this is an imported contact deleted on server
                    console.log(`🗑️ Server-side deletion detected: ${localContact.cardName} (UID: ${localUID})`);
                    console.log(`   Reason: Contact missing from server (isImported=${isImported}, isOwned=${isOwned})`);
                    
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
                        console.log(`✅ Removed from Contact Manager: ${localContact.cardName}`);
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
            console.log(`✅ Server deletion sync: Removed ${deleted} contacts deleted on server`);
            deletedContacts.forEach(c => console.log(`   🗑️ ${c.name}`));
        } else {
            console.log(`✅ Server deletion sync: No deletions detected`);
        }

        if (skipped > 0) {
            console.log(`ℹ️ Skipped ${skipped} contacts (owned/shared/non-imported)`);
        }

        return {
            deleted,
            skipped,
            checked: localContacts.length,
            deletedContacts
        };
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
     * Push contact to Baikal (with addressbook routing)
     * 
     * ADDRESSBOOK ROUTING:
     * - OWNED contacts → /my-contacts/ (read-write)
     * - SHARED contacts → /shared-contacts/ (read-only)
     * - IMPORTED contacts → /my-contacts/ (read-write)
     * 
     * @param {Object} contact - Contact to push
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Push result
     */
    async pushContactToBaikal(contact, profileName) {
        try {
            // Determine addressbook based on contact type AND server capabilities
            const addressbook = this.getAddressbookForContact(contact, profileName);
            
            console.log(`📤 Pushing contact to ${addressbook}:`, contact.cardName);

            // Extract or ensure UID exists in vCard
            let uid = this.contactManager?.extractUIDFromVCard(contact.vcard);
            let vCardToSend = contact.vcard;
            
            // If vCard is missing UID, add it before pushing
            if (!uid) {
                // For SHARED contacts: Use stable contactId to prevent duplicates
                // For OWNED contacts: Generate new UID
                if (contact.metadata?.isOwned === false) {
                    // Use contactId as stable UID for shared contacts
                    uid = contact.contactId;
                    console.log(`🔒 SHARED contact: Using stable contactId as UID: ${uid}`);
                } else {
                    // Generate UID for owned contacts
                    uid = this.contactManager?.vCardStandard?.generateContactId() || 
                          `contact_${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    console.log(`⚠️ OWNED contact missing UID, adding: ${uid}`);
                }
                
                // Insert UID before END:VCARD
                vCardToSend = contact.vcard.replace(
                    /END:VCARD/i,
                    `UID:${uid}\nEND:VCARD`
                );
                
                // Update local contact with UID (ONLY for owned contacts)
                // SHARED contacts are read-only and exist in other user's database
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
                    
                    // Save updated contact with UID (skip for shared contacts)
                    await this.contactManager.database.updateContact(updatedContact);
                } else if (contact.metadata?.isOwned === false) {
                    console.log(`⏭️ Skipping database update for SHARED contact (contactId used as stable UID)`);
                }
            }

            // 🍎 Convert vCard 4.0 → 3.0 for Apple/iCloud servers
            if (this.isAppleCardDAVServer(profileName)) {
                console.log(`🍎 Converting vCard 4.0 → 3.0 for Apple server`);
                
                // Create temporary contact object for VCard3Processor.export()
                const tempContact = {
                    contactId: contact.contactId,
                    cardName: contact.cardName,
                    vcard: vCardToSend,
                    metadata: contact.metadata
                };
                
                try {
                    // Export as vCard 3.0
                    const vCard3Result = this.vCard3Processor.export(tempContact);
                    
                    // VCard3Processor.export() returns { content, filename, mimeType, format }
                    if (vCard3Result && vCard3Result.content) {
                        vCardToSend = vCard3Result.content;
                        console.log(`✅ Converted to vCard 3.0 (${vCard3Result.content.length} bytes)`);
                    } else {
                        console.warn(`⚠️ VCard3Processor export failed, using original vCard 4.0`);
                    }
                } catch (conversionError) {
                    console.error(`❌ vCard 3.0 conversion failed:`, conversionError);
                    console.warn(`⚠️ Falling back to original vCard 4.0`);
                }
            }

            // 🔍 DEBUG: Log ETag being used for push
            console.log(`🔍 Push using ETag:`, contact.metadata?.cardDAV?.etag || 'none');
            console.log(`🔍 Last synced:`, contact.metadata?.cardDAV?.lastSyncedAt || 'never');
            
            const response = await fetch(`${this.bridgeUrl}/push/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contact: {
                        uid: uid,
                        vcard: vCardToSend,
                        etag: contact.metadata?.cardDAV?.etag
                    },
                    addressbook: addressbook
                })
            });

            const result = await response.json();

            if (result.success) {
                // Update contact with new ETag (ONLY for owned contacts)
                // SHARED contacts are read-only and shouldn't be updated in local database
                if (result.etag && this.contactManager && contact.metadata?.isOwned !== false) {
                    await this.contactManager.updateContactCardDAVMetadata(contact.contactId, {
                        etag: result.etag,
                        href: result.href,
                        addressbook: addressbook,
                        lastSyncedAt: new Date().toISOString()
                    });
                } else if (contact.metadata?.isOwned === false) {
                    console.log(`⏭️ Skipping CardDAV metadata update for SHARED contact (read-only)`);
                }

                console.log(`✅ Pushed contact to Baikal:`, contact.cardName);
            }

            return result;

        } catch (error) {
            console.error('❌ Push to Baikal failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete contact from Baikal
     * @param {Object} contact - Contact to delete
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Delete result
     */
    async deleteContactFromBaikal(contact, profileName) {
        try {
            console.log(`🗑️ Deleting contact from Baikal:`, contact.cardName);

            // Extract UID from vCard (primary identifier per RFC 9553)
            const uid = this.contactManager?.extractUIDFromVCard(contact.vcard) || contact.contactId;
            
            // Get correct addressbook based on contact type AND server capabilities
            const addressbook = this.getAddressbookForContact(contact, profileName);
            
            console.log(`📂 Delete from addressbook: ${addressbook}`);
            console.log(`🆔 Contact UID: ${uid}`);

            // Send delete request to bridge server
            const response = await fetch(`${this.bridgeUrl}/delete/${profileName}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: uid,  // ✅ Use 'uid' as primary identifier (RFC 9553 compliant)
                    contactUrl: contact.metadata?.cardDAV?.href || null,
                    addressbook: addressbook
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log(`✅ Deleted contact from Baikal:`, contact.cardName);
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
            console.log(`📂 Single addressbook server - routing all contacts to 'default'`);
            return 'default';
        }
        
        // Servers with separate addressbooks (Baikal, Nextcloud)
        // SHARED contacts → read-only addressbook
        if (contact.metadata?.isOwned === false && contact.contactId?.startsWith('shared_')) {
            console.log(`📂 SHARED contact - routing to 'shared-contacts' (read-only)`);
            return 'shared-contacts';
        }
        
        // OWNED and IMPORTED contacts → read-write addressbook
        console.log(`📂 OWNED/IMPORTED contact - routing to 'my-contacts' (read-write)`);
        return 'my-contacts';
    }

    /**
     * Test connection to bridge server
     * @returns {Promise<Object>} Test result
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.bridgeUrl}/health`);
            const result = await response.json();

            console.log('🏥 Bridge server health:', result);

            return {
                success: true,
                bridgeVersion: result.version,
                status: result.status
            };

        } catch (error) {
            console.error('❌ Bridge server unreachable:', error);
            return {
                success: false,
                error: error.message,
                note: 'Bridge server may not be running'
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
                console.log(`🔌 Disconnected from Baikal: ${profileName}`);
                
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
     * Test sync operation (pulls contacts from server)
     * This is the same as syncFromBaikal but used by UI
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Sync result
     */
    async testSync(profileName) {
        return await this.syncFromBaikal(profileName);
    }

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
                console.log(`📤 Using ${contactsToSync.length} pre-filtered contacts for push`);
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

                console.log(`📤 Fetched ${eligibleContacts.length} eligible contacts from ContactManager (including imported for bidirectional sync)`);
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
                
                console.log(`📊 Sync filtering stats:`);
                console.log(`   Total contacts in Contact Manager: ${totalContacts}`);
                console.log(`   Deleted: ${deletedCount} (excluded)`);
                console.log(`   Archived: ${archivedCount} (excluded)`);
                console.log(`   ✅ Eligible for push: ${eligibleContacts.length}`);
                console.log(`      - Owned: ${ownedContacts.length}`);
                console.log(`      - Imported: ${importedContacts.length}`);
                console.log(`      - Shared: ${sharedContacts.length}`);
            }

            console.log(`📤 Pushing ${eligibleContacts.length} contacts to ${profileName} (${ownedContacts.length} owned, ${importedContacts.length} imported, ${sharedContacts.length} shared)`);

            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            // Push all eligible contacts (owned go to my-contacts, shared go to shared-contacts)
            for (const contact of eligibleContacts) {
                try {
                    const result = await this.pushContactToBaikal(contact, profileName);
                    
                    if (result.success) {
                        successCount++;
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

            console.log(`✅ Push complete: ${successCount} succeeded, ${errorCount} failed`);

            return {
                success: successCount > 0,
                total: eligibleContacts.length,
                successCount,
                errorCount,
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
                console.log(`🧹 No archived/deleted contacts to clean up from Baikal`);
                return { success: true, deletedCount: 0 };
            }

            console.log(`🧹 Cleaning up ${contactsToDelete.length} archived/deleted contacts from Baikal...`);

            let deletedCount = 0;
            const errors = [];

            for (const contact of contactsToDelete) {
                try {
                    const contactType = contact.metadata?.isArchived ? 'archived' : 'deleted';
                    console.log(`🗑️ Deleting ${contactType} contact from Baikal: ${contact.cardName}`);
                    
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
                            console.log(`⏭️ Skipping metadata clear for shared contact: ${contact.cardName} (read-only)`);
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

            console.log(`✅ Cleanup complete: ${deletedCount}/${contactsToDelete.length} contacts deleted from Baikal`);

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
     * @param {number} interval - Protection interval in ms (default: 5 min)
     * @returns {Promise<Object>} Result
     */
    async initializeSharedContactProtection(profileName, interval = 300000) {
        const connection = this.connections.get(profileName);
        
        if (!connection) {
            console.error('❌ Profile not found:', profileName);
            return { success: false, error: 'Profile not connected' };
        }
        
        const capabilities = connection.capabilities;
        
        console.log('🛡️ Initializing shared contact protection...');
        console.log(`   📊 Server: ${capabilities.serverType}`);
        console.log(`   🔒 Strategy: ${capabilities.protectionStrategy}`);
        
        if (capabilities.supportsACL) {
            // Strategy 1: Server-side ACL protection (Baikal, Nextcloud)
            console.log('✅ Server supports ACL - using server-side read-only addressbook');
            console.log('   🔒 Shared contacts pushed to /shared-contacts/ (read-only via ACL)');
            console.log('   ⚡ No periodic re-push needed - server blocks unauthorized edits');
            
            return {
                success: true,
                profileName,
                strategy: 'server_side_acl',
                protectionMethod: 'read_only_addressbook',
                requiresPeriodicPush: false,
                notes: 'Server enforces read-only via ACL - 100% protection'
            };
        } else {
            // Strategy 2: Client-side validation (iCloud, Google)
            console.log('⚠️ Server does NOT support ACL - using client-side protection');
            console.log(`   📊 Interval: ${interval / 60000} minutes`);
            console.log('   🔍 Method: Periodic re-push to override unauthorized edits');
            console.log('   ⚠️ Note: ~5 min delay before corrections are applied');
            
            // Setup periodic re-push for shared contacts
            const protectionKey = `${profileName}_shared_protection`;
            
            // Clear existing protection interval
            if (this.protectionIntervals.has(protectionKey)) {
                clearInterval(this.protectionIntervals.get(protectionKey));
            }
            
            // Setup new protection interval
            const protectionInterval = setInterval(async () => {
                const now = new Date();
                console.log(`\n🛡️ SHARED CONTACT PROTECTION CHECK - ${now.toLocaleTimeString()}`);
                console.log(`   Profile: ${profileName}`);
                console.log(`   Interval: ${interval / 60000} minutes`);
                await this.detectAndCorrectUnauthorizedEdits(profileName);
                console.log(`   ⏰ Next check at: ${new Date(Date.now() + interval).toLocaleTimeString()}\n`);
            }, interval);
            
            this.protectionIntervals.set(protectionKey, protectionInterval);
            
            console.log('✅ Client-side protection enabled');
            console.log(`   ⏰ First protection check at: ${new Date(Date.now() + interval).toLocaleTimeString()}`);
            
            return {
                success: true,
                profileName,
                strategy: 'client_side_validation',
                protectionMethod: 'periodic_repush',
                requiresPeriodicPush: true,
                interval,
                notes: 'Periodic re-push every 5 minutes to override unauthorized edits'
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
            console.log('⏸️ Skipping unauthorized edit detection - sync in progress');
            return { corrected: 0, checked: 0 };
        }
        
        const startTime = Date.now();
        console.log('\n🔍 =================================================');
        console.log('🔍 UNAUTHORIZED EDIT DETECTION STARTED');
        console.log(`🔍 Profile: ${profileName}`);
        console.log(`🔍 Time: ${new Date().toLocaleString()}`);
        console.log('🔍 =================================================\n');
        
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not available');
            return { corrected: 0, checked: 0 };
        }
        
        // Get all shared contacts (green)
        const allContacts = Array.from(this.contactManager.contacts.values());
        console.log(`📊 Total contacts in Contact Manager: ${allContacts.length}`);
        
        const sharedContacts = allContacts.filter(c => 
                c.metadata?.isOwned === false && 
                c.contactId?.startsWith('shared_') &&
                !c.metadata?.isDeleted &&
                !c.metadata?.isArchived
            );
        
        console.log(`📊 Shared contacts found: ${sharedContacts.length}`);
        
        if (sharedContacts.length > 0) {
            console.log('\n📋 Shared contacts to check:');
            sharedContacts.forEach((c, idx) => {
                console.log(`   ${idx + 1}. ${c.cardName} (${c.contactId})`);
                console.log(`      ETag: ${c.metadata?.cardDAV?.etag || 'none'}`);
            });
            console.log('');
        }
        
        if (sharedContacts.length === 0) {
            console.log('   ℹ️ No shared contacts to check');
            console.log('🔍 =================================================\n');
            return { corrected: 0, checked: 0 };
        }
        
        let correctedCount = 0;
        const correctedContacts = [];
        const etagComparisons = [];
        
        try {
            console.log('📥 Pulling current state from server...');
            
            // Pull current state from server
            const serverResult = await this.syncFromBaikal(profileName);
            
            if (!serverResult.success) {
                console.error('❌ Failed to check server state');
                console.log('🔍 =================================================\n');
                return { corrected: 0, checked: sharedContacts.length };
            }
            
            const serverContacts = serverResult.contacts || [];
            console.log(`📥 Server returned ${serverContacts.length} contacts\n`);
            
            console.log('🔍 Starting ETag comparison...\n');
            
            for (const localContact of sharedContacts) {
                try {
                    // Find corresponding server contact by UID
                    const uid = this.contactManager.extractUIDFromVCard(localContact.vcard);
                    const serverContact = serverContacts.find(sc => sc.uid === uid);
                    
                    if (!serverContact) {
                        console.log(`⏭️ ${localContact.cardName}`);
                        console.log(`   Status: NOT FOUND on server`);
                        console.log(`   UID: ${uid}\n`);
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
                    
                    console.log(`📋 ${localContact.cardName}`);
                    console.log(`   Local ETag:  ${localETag || 'none'}`);
                    console.log(`   Server ETag: ${serverETag || 'none'}`);
                    console.log(`   Match: ${comparison.match ? '✅ YES' : '❌ NO (EDIT DETECTED!)'}\n`);
                    
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
                            console.log(`✅ Corrected: ${localContact.cardName}`);
                            
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
            
            console.log('\n🔍 =================================================');
            console.log('🔍 DETECTION SUMMARY');
            console.log('🔍 =================================================');
            console.log(`   Shared contacts checked: ${sharedContacts.length}`);
            console.log(`   Unauthorized edits found: ${correctedCount}`);
            console.log(`   Corrections applied: ${correctedCount}`);
            console.log(`   Duration: ${duration}ms`);
            
            if (etagComparisons.length > 0) {
                console.log('\n   📊 ETag Comparison Results:');
                etagComparisons.forEach((comp, idx) => {
                    const status = comp.match ? '✅' : '❌';
                    console.log(`   ${idx + 1}. ${status} ${comp.name} - ${comp.match ? 'No changes' : 'EDITED!'}`);
                });
            }
            
            if (correctedCount > 0) {
                console.log('\n   🔄 Corrected contacts:');
                correctedContacts.forEach((name, idx) => {
                    console.log(`   ${idx + 1}. ${name}`);
                });
            } else {
                console.log('\n   ✅ All shared contacts intact - no unauthorized edits detected');
            }
            
            console.log('🔍 =================================================\n');
            
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
            console.log(`🔄 Force-pushing shared contact (override mode): ${contact.cardName}`);
            
            // Extract UID
            const uid = this.contactManager?.extractUIDFromVCard(contact.vcard) || contact.contactId;
            
            // Get addressbook (will be 'default' for iCloud/Google)
            const addressbook = this.getAddressbookForContact(contact, profileName);
            
            // Prepare vCard for push
            let vCardToSend = contact.vcard;
            
            // Convert to vCard 3.0 if Apple server
            if (this.isAppleCardDAVServer(profileName)) {
                try {
                    const vCard3Result = this.vCard3Processor.export({
                        contactId: contact.contactId,
                        cardName: contact.cardName,
                        vcard: vCardToSend,
                        metadata: contact.metadata
                    });
                    
                    if (vCard3Result?.content) {
                        vCardToSend = vCard3Result.content;
                    }
                } catch (conversionError) {
                    console.warn('⚠️ vCard 3.0 conversion failed, using original');
                }
            }
            
            // Force-push with NULL ETag (overrides server version)
            const response = await fetch(`${this.bridgeUrl}/push/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contact: {
                        uid: uid,
                        vcard: vCardToSend,
                        etag: null  // ❌ NULL ETag = force override
                    },
                    addressbook: addressbook,
                    forceOverride: true  // Explicit flag
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ Force-push successful: ${contact.cardName}`);
                
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
     * 🛑 Stop shared contact protection
     * @param {string} profileName - Profile name
     * @returns {Object} Result
     */
    stopSharedContactProtection(profileName) {
        const protectionKey = `${profileName}_shared_protection`;
        
        if (this.protectionIntervals.has(protectionKey)) {
            clearInterval(this.protectionIntervals.get(protectionKey));
            this.protectionIntervals.delete(protectionKey);
            
            console.log(`🛑 Shared contact protection stopped for: ${profileName}`);
            
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
            // Default: 5 minutes for both pull and push (for testing)
            const defaultIntervals = {
                pull: 300000,  // 5 minutes - sync FROM Baikal
                push: 300000   // 5 minutes - push TO Baikal
            };

            const syncConfig = { ...defaultIntervals, ...intervals };

            console.log('🔄 Initializing automatic synchronization:');
            console.log(`   📥 Pull interval (sync from Baikal): ${syncConfig.pull / 1000}s (${syncConfig.pull / 60000} min)`);
            console.log(`   📤 Push interval (push to Baikal): ${syncConfig.push / 1000}s (${syncConfig.push / 60000} min)`);
            console.log('');
            console.log('📊 Contact Categories:');
            console.log('   🔵 BLUE = Owned (created by you) → Push to /my-contacts/');
            console.log('   🟢 GREEN = Shared (from others) → Push to /shared-contacts/');
            console.log('   🟠 ORANGE = Imported (from Baikal) → Preserve external edits');

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
                    console.log(`\n📥 ========================================`);
                    console.log(`📥 AUTO-SYNC (PULL) - ${new Date().toLocaleTimeString()}`);
                    console.log(`📥 Profile: ${profileName}`);
                    console.log(`📥 ========================================`);
                    try {
                        const result = await this.syncFromBaikal(profileName);
                        if (result.success) {
                            console.log(`✅ Auto-sync (pull): Imported ${result.imported?.imported || 0} contacts, updated ${result.imported?.updated || 0}`);
                            if (result.deletions?.deleted > 0) {
                                console.log(`🗑️ Auto-sync (pull): Detected ${result.deletions.deleted} server-side deletions`);
                            }
                        } else {
                            console.error(`❌ Auto-sync (pull) failed:`, result.error);
                        }
                    } catch (error) {
                        console.error(`❌ Auto-sync (pull) error (continuing...):`, error.message);
                        // Don't throw - let the interval continue
                    }
                    console.log(`📥 ========================================\n`);
                }, syncConfig.pull);

                console.log(`✅ Pull auto-sync enabled (every ${syncConfig.pull / 60000} minutes)`);
                console.log(`   Next pull sync at: ${new Date(Date.now() + syncConfig.pull).toLocaleTimeString()}`);
            }

            // 2. Push interval - Push TO Baikal (sends local changes)
            // ⏰ IMPORTANT: Push runs 30 seconds AFTER pull to allow deletions to complete
            if (syncConfig.push > 0) {
                // Delay first push by 30 seconds to stagger with pull
                setTimeout(() => {
                    // Run first push after delay
                    (async () => {
                        console.log(`\n📤 ========================================`);
                        console.log(`📤 AUTO-SYNC (PUSH) - ${new Date().toLocaleTimeString()}`);
                        console.log(`📤 Profile: ${profileName} (initial delayed push)`);
                        console.log(`📤 ========================================`);
                        
                        if (!this.contactManager) {
                            console.warn('⚠️ Auto-sync (push): ContactManager not available, skipping this cycle');
                            return;
                        }
                        
                        try {
                            const result = await this.testPushOwnedContacts(profileName);
                            if (result.success) {
                                console.log(`✅ Auto-sync (push): Pushed ${result.successCount} contacts`);
                            } else {
                                console.error(`❌ Auto-sync (push) failed:`, result.error);
                            }
                        } catch (error) {
                            console.error(`❌ Auto-sync (push) error (continuing...):`, error.message);
                        }
                        console.log(`📤 ========================================\n`);
                    })();
                    
                    // Then set up recurring interval
                    profileIntervals.pushInterval = setInterval(async () => {
                        console.log(`\n📤 ========================================`);
                        console.log(`📤 AUTO-SYNC (PUSH) - ${new Date().toLocaleTimeString()}`);
                        console.log(`📤 Profile: ${profileName}`);
                        console.log(`📤 ========================================`);
                        
                        // Safety check: ensure ContactManager is available
                        if (!this.contactManager) {
                            console.warn('⚠️ Auto-sync (push): ContactManager not available, skipping this cycle');
                            return;
                        }
                        
                        try {
                            const result = await this.testPushOwnedContacts(profileName);
                            if (result.success) {
                                console.log(`✅ Auto-sync (push): Pushed ${result.successCount} contacts`);
                            } else {
                                console.error(`❌ Auto-sync (push) failed:`, result.error);
                            }
                        } catch (error) {
                            console.error(`❌ Auto-sync (push) error (continuing...):`, error.message);
                            // Don't throw - let the interval continue
                        }
                        console.log(`📤 ========================================\n`);
                    }, syncConfig.push);
                }, 30000); // 30-second delay before first push

                console.log(`✅ Push auto-sync enabled (every ${syncConfig.push / 60000} minutes)`);
                console.log(`   ⏰ STAGGERED: Push runs 30s after pull to allow deletions to complete`);
                console.log(`   First push at: ${new Date(Date.now() + 30000).toLocaleTimeString()}`);
                console.log(`   Next push at: ${new Date(Date.now() + 30000 + syncConfig.push).toLocaleTimeString()}`);
            }

            this.autoSyncEnabled = true;
            console.log(`✅ Auto-sync intervals registered for profile: ${profileName}`);
            console.log(`🔍 Interval IDs: pull=${profileIntervals.pullInterval?._id || 'active'}, push=${profileIntervals.pushInterval?._id || 'active'}`);

            // 🆕 DIAGNOSTIC: Add heartbeat to verify intervals stay alive
            let heartbeatCount = 0;
            profileIntervals.heartbeatInterval = setInterval(() => {
                heartbeatCount++;
                console.log(`💓 Auto-sync heartbeat [${profileName}]: Intervals still running (count: ${heartbeatCount})`);
                console.log(`   📥 Pull interval: ${profileIntervals.pullInterval ? '✅ active' : '❌ stopped'}`);
                console.log(`   📤 Push interval: ${profileIntervals.pushInterval ? '✅ active' : '❌ stopped'}`);
                console.log(`   ⏰ Next sync in ~${Math.floor(syncConfig.pull / 60000)} minutes`);
            }, 60000); // Heartbeat every 1 minute

            console.log(`💓 Heartbeat diagnostic enabled (1 minute intervals)`);

            // 🛡️ Initialize shared contact protection
            try {
                const protectionResult = await this.initializeSharedContactProtection(
                    profileName, 
                    syncConfig.protection || 300000 // 5 min default
                );
                
                if (protectionResult.success) {
                    console.log(`✅ Shared contact protection: ${protectionResult.strategy}`);
                }
            } catch (protectionError) {
                console.warn('⚠️ Shared contact protection setup failed (continuing):', protectionError.message);
            }

            // Perform initial sync immediately (optional - skip if ContactManager not ready)
            if (this.contactManager) {
                console.log('🔄 Performing initial sync...');
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
     * 🆕 Perform initial sync (pull + push on startup)
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Result
     */
    async performInitialSync(profileName) {
        try {
            console.log('📥 Initial sync: Pulling from Baikal...');
            const pullResult = await this.syncFromBaikal(profileName);

            // ⏰ Wait 2 seconds for deletions to commit to database
            // This prevents deleted contacts from being immediately re-pushed
            console.log('⏸️ Waiting 2s for database operations to complete...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log('📤 Initial sync: Pushing to Baikal...');
            const pushResult = await this.testPushOwnedContacts(profileName);

            console.log('✅ Initial sync completed');
            console.log(`   📥 Pulled: ${pullResult.imported?.total || 0} contacts`);
            console.log(`   📤 Pushed: ${pushResult.successCount || 0} contacts`);
            if (pullResult.deletions?.deleted > 0) {
                console.log(`   🗑️ Deletions detected: ${pullResult.deletions.deleted} contacts removed`);
            }

            return {
                success: true,
                pull: pullResult,
                push: pushResult
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
                console.log('🛑 Pull auto-sync stopped');
            }

            if (profileIntervals.pushInterval) {
                clearInterval(profileIntervals.pushInterval);
                console.log('🛑 Push auto-sync stopped');
            }

            if (profileIntervals.heartbeatInterval) {
                clearInterval(profileIntervals.heartbeatInterval);
                console.log('🛑 Heartbeat diagnostic stopped');
            }

            this.syncIntervals.delete(profileName);
        }

        // 🛡️ Stop shared contact protection
        this.stopSharedContactProtection(profileName);

        // Check if any profiles still have auto-sync enabled
        this.autoSyncEnabled = this.syncIntervals.size > 0;

        console.log(`🛑 Auto-sync stopped for profile: ${profileName}`);

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
        console.log(`🔄 Updating sync intervals for ${profileName}:`, intervals);

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
}
