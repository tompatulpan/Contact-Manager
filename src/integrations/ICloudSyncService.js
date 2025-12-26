/**
 * ICloudSyncService - Two-Way Sync Between Contact Manager and iCloud
 * 
 * Sync Strategy:
 * - OWNED/IMPORTED contacts: Two-way sync (CM ↔ iCloud)
 * - SHARED contacts: One-way sync (CM → iCloud only, server has read-only ACL)
 * 
 * ETag-Based Conflict Detection:
 * - Use ETags to detect changes on both sides
 * - "Latest wins" strategy for owned contacts
 * - Force push for shared contacts (maintain ecosystem integrity)
 */

import { APP_CONFIG } from '../config/app.config.js';
import { ICloudCardDAVClient } from './ICloudCardDAVClient.js';

export class ICloudSyncService {
    constructor(eventBus, contactManager) {
        this.eventBus = eventBus;
        this.contactManager = contactManager;
        this.iCloudClient = null;
        
        // Sync state
        this.isConnected = false;
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.syncInterval = null;
        this.syncErrors = [];
        
        // Credentials
        this.credentials = null;
        
        // Sync statistics
        this.stats = {
            totalSyncs: 0,
            successfulSyncs: 0,
            failedSyncs: 0,
            contactsPushed: 0,
            contactsPulled: 0,
            conflictsResolved: 0,
            lastSyncDuration: 0
        };
    }

    /**
     * Initialize sync service with iCloud credentials
     */
    async initialize(credentials) {
        try {
            console.log('🔄 Initializing iCloud Sync Service...');
            
            // Validate credentials
            if (!credentials || !credentials.email || !credentials.password) {
                throw new Error('Invalid credentials: email and password required');
            }
            
            this.credentials = credentials;
            
            // Create iCloud client
            this.iCloudClient = new ICloudCardDAVClient(
                credentials.email,
                credentials.password
            );
            
            // Connect to iCloud
            const result = await this.iCloudClient.connect();
            
            if (!result.success) {
                throw new Error(`iCloud connection failed: ${result.error}`);
            }
            
            this.isConnected = true;
            
            console.log('✅ iCloud Sync Service initialized');
            console.log(`   Principal: ${result.principalUrl}`);
            console.log(`   Address Book: ${result.addressBookUrl}`);
            
            this.eventBus.emit('icloud:syncInitialized', {
                principalUrl: result.principalUrl,
                addressBookUrl: result.addressBookUrl
            });
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to initialize iCloud Sync Service:', error);
            this.isConnected = false;
            
            this.eventBus.emit('icloud:syncError', {
                error: error.message,
                phase: 'initialization'
            });
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Start automatic sync with configurable interval
     */
    startAutoSync(intervalMinutes = 10) {
        if (this.syncInterval) {
            console.warn('⚠️ Auto-sync already running');
            return;
        }
        
        const intervalMs = intervalMinutes * 60 * 1000;
        
        console.log(`🔄 Starting auto-sync (every ${intervalMinutes} minutes)...`);
        
        // Initial sync
        this.performSync();
        
        // Schedule periodic sync
        this.syncInterval = setInterval(() => {
            this.performSync();
        }, intervalMs);
        
        this.eventBus.emit('icloud:autoSyncStarted', { intervalMinutes });
    }

    /**
     * Stop automatic sync
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('⏹️ Auto-sync stopped');
            
            this.eventBus.emit('icloud:autoSyncStopped');
        }
    }

    /**
     * Perform full bidirectional sync
     */
    async performSync() {
        if (!this.isConnected) {
            console.error('❌ Cannot sync: Not connected to iCloud');
            return { success: false, error: 'Not connected to iCloud' };
        }
        
        if (this.isSyncing) {
            console.warn('⚠️ Sync already in progress, skipping...');
            return { success: false, error: 'Sync already in progress' };
        }
        
        this.isSyncing = true;
        const syncStartTime = Date.now();
        
        console.log('🔄 Starting iCloud sync...');
        
        this.eventBus.emit('icloud:syncStarted', {
            timestamp: new Date().toISOString()
        });
        
        try {
            this.stats.totalSyncs++;
            
            // Phase 1: Pull changes from iCloud (import external edits)
            const pullResult = await this.pullFromICloud();
            
            // Phase 1.5: Detect and handle deletions
            const deletionResult = await this.handleDeletions();
            
            // Phase 2: Push changes to iCloud (export local edits)
            const pushResult = await this.pushToICloud();
            
            const syncDuration = Date.now() - syncStartTime;
            this.stats.lastSyncDuration = syncDuration;
            this.stats.successfulSyncs++;
            this.lastSyncTime = new Date().toISOString();
            
            console.log(`✅ Sync complete in ${syncDuration}ms`);
            console.log(`   Pulled: ${pullResult.imported} contacts`);
            console.log(`   Pushed: ${pushResult.pushed} contacts`);
            
            this.eventBus.emit('icloud:syncCompleted', {
                duration: syncDuration,
                pulled: pullResult.imported,
                pushed: pushResult.pushed,
                timestamp: this.lastSyncTime
            });
            
            return {
                success: true,
                duration: syncDuration,
                pulled: pullResult,
                pushed: pushResult
            };
            
        } catch (error) {
            console.error('❌ Sync failed:', error);
            this.stats.failedSyncs++;
            this.syncErrors.push({
                timestamp: new Date().toISOString(),
                error: error.message
            });
            
            this.eventBus.emit('icloud:syncError', {
                error: error.message,
                phase: 'sync'
            });
            
            return { success: false, error: error.message };
            
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Pull contacts from iCloud (import external changes)
     * Only updates OWNED and IMPORTED contacts
     * Skips SHARED contacts (CM is authority)
     */
    async pullFromICloud() {
        console.log('📥 Phase 1: Pulling changes from iCloud...');
        
        try {
            // Fetch all contacts from iCloud
            const iCloudContacts = await this.iCloudClient.fetchContacts();
            
            console.log(`📥 Fetched ${iCloudContacts.length} contacts from iCloud`);
            
            // Diagnostic: Show what we fetched
            console.log('📊 iCloud contacts:');
            for (const ic of iCloudContacts) {
                console.log(`   ${ic.fullName || ic.uid}: ETag=${ic.etag?.substring(0, 10)}...`);
            }
            
            let imported = 0;
            let updated = 0;
            let skipped = 0;
            
            for (const iCloudContact of iCloudContacts) {
                try {
                    // Find local contact by UID
                    const localContact = this.findLocalContactByUID(iCloudContact.uid);
                    
                    if (!localContact) {
                        // New contact from iCloud → Import
                        const result = await this.contactManager.importContactFromVCard(
                            iCloudContact.vcard,
                            iCloudContact.fullName || 'Imported Contact',
                            true // markAsImported
                        );
                        
                        if (result.success) {
                            // Store iCloud metadata
                            const contact = result.contact;
                            if (contact) {
                                contact.metadata.importSource = 'iCloud';
                                
                                // Set lastSyncedAt to now since we just synced with iCloud
                                // This prevents unnecessary push-back on next sync
                                contact.metadata.carddav = {
                                    source: 'iCloud',
                                    etag: iCloudContact.etag,
                                    href: iCloudContact.href,
                                    lastSyncedAt: new Date().toISOString(), // ✅ Just synced with iCloud
                                    syncStatus: 'synced'
                                };
                                await this.contactManager.database.updateContact(contact);
                                imported++;
                                this.stats.contactsPulled++;
                            }
                        }
                        
                    } else {
                        // Contact exists locally
                        
                        // Skip SHARED contacts (push-only, never pull from iCloud)
                        if (!localContact.metadata.isOwned) {
                            console.log(`⏭️ Skipping shared contact (push-only): ${localContact.cardName}`);
                            skipped++;
                            continue;
                        }
                        
                        // For OWNED/IMPORTED contacts: Check if iCloud version is newer
                        const localETag = localContact.metadata?.carddav?.etag;
                        const iCloudETag = iCloudContact.etag;
                        
                        if (localETag !== iCloudETag) {
                            // ETag mismatch → iCloud version is different
                            console.log(`🔄 Updating contact from iCloud: ${localContact.cardName}`);
                            console.log(`   Local ETag: ${localETag || 'none'}`);
                            console.log(`   iCloud ETag: ${iCloudETag}`);
                            
                            // CRITICAL: Update contact directly, bypassing duplicate detection
                            // We know the contact exists locally (we found it by UID)
                            // We just need to update its vCard content from iCloud
                            
                            try {
                                // Parse the iCloud vCard
                                const vCardData = this.contactManager.vCardStandard.parseVCard(iCloudContact.vcard);
                                
                                // Update the local contact's vCard while preserving metadata
                                localContact.vcard = iCloudContact.vcard;
                                localContact.metadata.lastUpdated = new Date().toISOString();
                                localContact.metadata.importSource = 'iCloud';
                                
                                // ✅ FIXED: Update lastSyncedAt during pull to prevent unnecessary push-back
                                // We just synced with iCloud, so mark it as synced NOW
                                // Only push if local edits happen AFTER this sync
                                localContact.metadata.carddav = {
                                    source: 'iCloud',
                                    etag: iCloudETag,
                                    href: iCloudContact.href,
                                    lastSyncedAt: new Date().toISOString(), // ✅ Just synced with iCloud
                                    syncStatus: 'synced'
                                };
                                
                                // Update in database
                                const updateResult = await this.contactManager.database.updateContact(localContact);
                                
                                if (updateResult.success) {
                                    console.log(`✅ Updated local contact from iCloud: ${localContact.cardName}`);
                                    updated++;
                                    this.stats.contactsPulled++;
                                } else {
                                    console.error(`❌ Failed to save updated contact: ${updateResult.error}`);
                                }
                            } catch (error) {
                                console.error(`❌ Failed to update contact from iCloud:`, error);
                            }
                        } else {
                            // ETags match → no changes
                            skipped++;
                        }
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to process contact ${iCloudContact.uid}:`, error);
                }
            }
            
            console.log(`✅ Pull complete: ${imported} imported, ${updated} updated, ${skipped} skipped`);
            
            return { imported, updated, skipped };
            
        } catch (error) {
            console.error('❌ Pull from iCloud failed:', error);
            throw error;
        }
    }

    /**
     * Detect and handle deletions in both directions
     * - If contact deleted on iCloud → delete locally (OWNED/IMPORTED only)
     * - If contact deleted locally → delete on iCloud (push deletion)
     */
    async handleDeletions() {
        console.log('🗑️ Phase 1.5: Checking for deletions...');
        
        try {
            let localDeleted = 0;
            let remoteDeleted = 0;
            
            // Get all contacts from iCloud
            const iCloudContacts = await this.iCloudClient.fetchContacts();
            const iCloudUIDs = new Set(iCloudContacts.map(c => c.uid));
            
            // Get all local contacts that should sync with iCloud
            const localContacts = Array.from(this.contactManager.contacts.values())
                .filter(c => !c.metadata.isDeleted && !c.metadata.isArchived);
            
            // Check for contacts deleted on iCloud (exist locally but not on iCloud)
            for (const localContact of localContacts) {
                // Only check OWNED/IMPORTED contacts (skip SHARED)
                if (!localContact.metadata.isOwned) continue;
                
                const uid = this.extractUIDFromVCard(localContact.vcard);
                const hasCardDAVSync = localContact.metadata?.carddav?.etag;
                
                // If contact was synced to iCloud before but no longer exists there
                if (hasCardDAVSync && !iCloudUIDs.has(uid)) {
                    console.log(`🗑️ Contact deleted on iCloud: ${localContact.cardName} (UID: ${uid})`);
                    console.log(`   Deleting locally...`);
                    
                    // Delete locally
                    await this.contactManager.deleteContact(localContact.contactId);
                    localDeleted++;
                    console.log(`✅ Deleted locally: ${localContact.cardName}`);
                }
            }
            
            // Check for contacts deleted locally (exist on iCloud but deleted in CM)
            // This is handled in push phase when contact has isDeleted flag
            // We'll push the deletion to iCloud
            
            console.log(`✅ Deletion check complete: ${localDeleted} deleted locally, ${remoteDeleted} deleted remotely`);
            
            return { localDeleted, remoteDeleted };
            
        } catch (error) {
            console.error('❌ Deletion handling failed:', error);
            return { localDeleted: 0, remoteDeleted: 0 };
        }
    }

    /**
     * Push contacts to iCloud (export local changes)
     * - OWNED/IMPORTED contacts: Push if modified locally
     * - SHARED contacts: Force push (maintain ecosystem integrity)
     */
    async pushToICloud() {
        console.log('📤 Phase 2: Pushing changes to iCloud...');
        
        try {
            // Get all contacts from Contact Manager
            const allContacts = Array.from(this.contactManager.contacts.values());
            
            // Separate deleted contacts from active contacts
            const deletedContacts = allContacts.filter(contact => 
                contact.metadata.isDeleted && 
                contact.metadata?.carddav?.etag // Only if previously synced to iCloud
            );
            
            // Filter contacts that should be synced to iCloud (exclude deleted and archived)
            const contactsToSync = allContacts.filter(contact => 
                !contact.metadata.isDeleted && 
                !contact.metadata.isArchived
            );
            
            console.log(`📤 Processing ${contactsToSync.length} contacts (${deletedContacts.length} deletions)...`);
            
            // Diagnostic: Show sync state of each contact
            console.log('📊 Contact sync states:');
            for (const contact of contactsToSync) {
                const lastSynced = contact.metadata?.carddav?.lastSyncedAt;
                const lastModified = contact.metadata?.lastUpdated;
                const hasETag = !!contact.metadata?.carddav?.etag;
                console.log(`   ${contact.cardName}:`)
                console.log(`      - Has ETag: ${hasETag}`)
                console.log(`      - Last synced: ${lastSynced || 'never'}`)
                console.log(`      - Last modified: ${lastModified || 'unknown'}`)
                console.log(`      - Will push: ${!lastSynced || (lastModified && new Date(lastModified) > new Date(lastSynced))}`)
            }
            
            let pushed = 0;
            let skipped = 0;
            let errors = 0;
            let deleted = 0;
            
            // First, handle deletions
            for (const contact of deletedContacts) {
                try {
                    const uid = this.extractUIDFromVCard(contact.vcard);
                    const etag = contact.metadata.carddav.etag;
                    
                    console.log(`🗑️ Deleting from iCloud: ${contact.cardName} (UID: ${uid})`);
                    
                    const result = await this.iCloudClient.deleteContact(uid, etag);
                    
                    if (result.success) {
                        console.log(`✅ Deleted from iCloud: ${contact.cardName}`);
                        deleted++;
                        
                        // Remove from local database completely (hard delete from Userbase)
                        try {
                            await userbase.deleteItem({
                                databaseName: 'contacts',
                                itemId: contact.contactId
                            });
                            // Also remove from memory
                            this.contactManager.contacts.delete(contact.contactId);
                            console.log(`✅ Removed from local database: ${contact.cardName}`);
                        } catch (dbError) {
                            console.error(`⚠️ Failed to remove from local database:`, dbError);
                        }
                    } else {
                        console.error(`❌ Failed to delete from iCloud: ${contact.cardName}`, result.error);
                        errors++;
                    }
                } catch (error) {
                    console.error(`❌ Error deleting contact from iCloud:`, error);
                    errors++;
                }
            }
            
            // Then, handle active contacts
            for (const contact of contactsToSync) {
                try {
                    const shouldPush = this.shouldPushContact(contact);
                    
                    if (!shouldPush.push) {
                        console.log(`⏭️ Skipping: ${contact.cardName} (${shouldPush.reason})`);
                        skipped++;
                        continue;
                    }
                    
                    // Determine if this is a create or update
                    const existsOnICloud = contact.metadata?.carddav?.etag;
                    
                    if (existsOnICloud) {
                        // Update existing contact
                        console.log(`🔄 Updating on iCloud: ${contact.cardName}`);
                        
                        // Regenerate vCard WITHOUT internal metadata (CATEGORIES, etc.)
                        // iCloud rejects vCards with custom CATEGORIES format
                        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
                        
                        // 🐛 DEBUG: Log displayData to diagnose email sync issue
                        console.log(`📊 DisplayData for ${contact.cardName}:`, {
                            fullName: displayData.fullName,
                            emailCount: displayData.emails?.length || 0,
                            emails: displayData.emails,
                            phoneCount: displayData.phones?.length || 0,
                            hasVCard: !!contact.vcard
                        });
                        
                        let cleanVCard = this.contactManager.vCardStandard.generateVCard(displayData, {
                            skipInternalMetadata: true  // Skip CATEGORIES with sharing info
                        });
                        
                        // 🐛 DEBUG: Log generated vCard to see if emails are included
                        const hasEmailInVCard = cleanVCard.includes('EMAIL');
                        console.log(`📄 Generated vCard has EMAIL properties: ${hasEmailInVCard}`);
                        if (!hasEmailInVCard && displayData.emails?.length > 0) {
                            console.error(`❌ CRITICAL: displayData has ${displayData.emails.length} emails but vCard has none!`);
                        }
                        
                        const result = await this.iCloudClient.updateContact(
                            this.extractUIDFromVCard(contact.vcard),
                            cleanVCard,
                            contact.metadata.carddav.etag
                        );
                        
                        // Handle 412: ETag mismatch (contact changed on iCloud)
                        // Check FIRST before 404 to prioritize ETag conflicts
                        if (!result.success && (result.status === 412 || (result.error && result.error.includes('412')))) {
                            console.warn(`⚠️ ETag mismatch (412), fetching fresh ETag from iCloud: ${contact.cardName}`);
                            
                            try {
                                // Fetch current contact from iCloud to get fresh ETag
                                const uid = this.extractUIDFromVCard(contact.vcard);
                                const fetchResult = await this.iCloudClient.getContactByUID(uid);
                                
                                if (fetchResult.success && fetchResult.etag) {
                                    console.log(`🔄 Got fresh ETag (${fetchResult.etag}), retrying update`);
                                    
                                    // Retry update with fresh ETag
                                    const retryResult = await this.iCloudClient.updateContact(
                                        uid,
                                        cleanVCard,
                                        fetchResult.etag  // Use fresh ETag
                                    );
                                    
                                    if (retryResult.success) {
                                        console.log(`✅ Updated contact on iCloud (after ETag refresh): ${contact.cardName}`);
                                        
                                        // Update metadata with new ETag
                                        if (!contact.metadata.isOwned) {
                                            // Shared contact: cache only
                                            if (!this.sharedContactSyncCache) {
                                                this.sharedContactSyncCache = new Map();
                                            }
                                            this.sharedContactSyncCache.set(contact.contactId, {
                                                etag: retryResult.etag,
                                                href: retryResult.href || contact.metadata.carddav?.href,
                                                uid: uid,
                                                lastSyncedAt: new Date().toISOString(),
                                                syncStatus: 'synced'
                                            });
                                        } else {
                                            // Owned/imported: update database
                                            contact.metadata.carddav.etag = retryResult.etag;
                                            contact.metadata.carddav.lastSyncedAt = new Date().toISOString();
                                            contact.metadata.carddav.syncStatus = 'synced';
                                            await this.contactManager.database.updateContact(contact);
                                        }
                                        
                                        pushed++;
                                        this.stats.contactsPushed++;
                                        continue;  // Successfully updated
                                    }
                                }
                                
                                // If we get here, fallback to skipping
                                console.error(`❌ Could not resolve 412 conflict for: ${contact.cardName}`);
                                skipped++;
                                continue;
                                
                            } catch (fetchError) {
                                console.error(`❌ Failed to fetch fresh ETag:`, fetchError);
                                skipped++;
                                continue;
                            }
                        }
                        
                        // Handle 404: Contact doesn't exist on iCloud (stale href)
                        // Check for both "404" status and iCloud's "doesn't exist" error message
                        const is404Error = !result.success && (result.status === 404 || (result.error && (
                            result.error.includes('404') || 
                            result.error.includes("doesn't exist") ||
                            result.error.includes("card user is trying to update a card which doesn't exist")
                        )));
                        
                        if (is404Error) {
                            console.warn(`⚠️ Contact not found on iCloud (404/doesn't exist): ${contact.cardName}`);
                            console.log(`🔍 Checking if contact exists on iCloud with different UID...`);
                            
                            // ✅ CRITICAL FIX: Before creating, check if this contact already exists on iCloud
                            // This happens when: user edits contact in CM but iCloud has it with different UID
                            // We need to find and sync the iCloud UID instead of creating duplicate
                            
                            const currentUID = this.extractUIDFromVCard(contact.vcard);
                            const contactName = displayData.fullName;
                            
                            // Search for matching contact on iCloud by name/phone/email
                            const iCloudContacts = await this.iCloudClient.fetchContacts();
                            let matchingContact = null;
                            const matchingCandidates = [];
                            
                            for (const iCloudContact of iCloudContacts) {
                                // Skip if UID matches (shouldn't happen in 404 case)
                                if (iCloudContact.uid === currentUID) continue;
                                
                                // Check if name matches
                                if (iCloudContact.fullName === contactName) {
                                    matchingCandidates.push(iCloudContact);
                                }
                            }
                            
                            if (matchingCandidates.length > 0) {
                                console.log(`📊 Found ${matchingCandidates.length} matching contact(s) with name "${contactName}"`);
                                
                                // Prefer iCloud's native UUID format (XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX)
                                // over CM-generated format (icloud_timestamp_random)
                                matchingContact = matchingCandidates.reduce((best, current) => {
                                    // Check if UID is iCloud's native UUID format
                                    const currentIsUUID = current.uid?.includes('-') && current.uid.length >= 36;
                                    const bestIsUUID = best.uid?.includes('-') && best.uid.length >= 36;
                                    
                                    console.log(`   Candidate: ${current.uid} (UUID: ${currentIsUUID})`);
                                    
                                    // Prefer UUID format (original iCloud contact) over CM-generated
                                    if (currentIsUUID && !bestIsUUID) return current;
                                    if (!currentIsUUID && bestIsUUID) return best;
                                    
                                    // If both same format, keep first one
                                    return best;
                                });
                                
                                console.log(`✅ Found matching contact on iCloud: "${matchingContact.fullName}" (UID: ${matchingContact.uid})`);
                            }
                            
                            if (matchingContact) {
                                // ✅ Contact exists with different UID - sync iCloud's UID
                                console.log(`🔄 Syncing iCloud's UID: ${currentUID} → ${matchingContact.uid}`);
                                
                                // Update local contact with iCloud's UID
                                contact.vcard = contact.vcard.replace(/UID:[^\r\n]+/g, `UID:${matchingContact.uid}`);
                                cleanVCard = cleanVCard.replace(/UID:[^\r\n]+/g, `UID:${matchingContact.uid}`);
                                
                                // Now retry UPDATE with correct UID
                                const retryResult = await this.iCloudClient.updateContact(
                                    matchingContact.uid,
                                    cleanVCard,
                                    matchingContact.etag
                                );
                                
                                if (retryResult.success) {
                                    contact.metadata.carddav = {
                                        source: 'iCloud',
                                        etag: retryResult.etag,
                                        href: retryResult.href,
                                        uid: matchingContact.uid,
                                        lastSyncedAt: new Date().toISOString(),
                                        syncStatus: 'synced'
                                    };
                                    
                                    if (contact.metadata.isOwned) {
                                        await this.contactManager.database.updateContact(contact);
                                    }
                                    
                                    console.log(`✅ Updated with synced UID: ${contact.cardName}`);
                                    pushed++;
                                    this.stats.contactsPushed++;
                                } else {
                                    console.error(`❌ Failed to update after UID sync: ${contact.cardName}`, retryResult.error);
                                    errors++;
                                }
                                
                                continue;
                            }
                            
                            // ❌ Contact doesn't exist - create new
                            console.log(`📤 Creating new contact on iCloud: ${contact.cardName}`);
                            
                            // Clear stale metadata
                            delete contact.metadata.carddav;
                            
                            let createResult = await this.iCloudClient.createContact(cleanVCard);
                            
                            // ✅ FIX: If CREATE returns 404, the old UID is blocked/deleted
                            // Generate a fresh UID and retry
                            if (!createResult.success && createResult.status === 404) {
                                console.warn(`⚠️ UID blocked/deleted on iCloud, generating fresh UID...`);
                                
                                const oldUIDMatch = cleanVCard.match(/UID:([^\r\n]+)/);
                                const oldUID = oldUIDMatch ? oldUIDMatch[1].trim() : null;
                                const newUID = this.iCloudClient.generateUID();
                                
                                console.log(`🔄 Replacing blocked UID: ${oldUID} → ${newUID}`);
                                
                                // Replace in both cleanVCard and contact.vcard
                                cleanVCard = cleanVCard.replace(/UID:[^\r\n]+/g, `UID:${newUID}`);
                                contact.vcard = contact.vcard.replace(/UID:[^\r\n]+/g, `UID:${newUID}`);
                                
                                // Retry create with new UID
                                createResult = await this.iCloudClient.createContact(cleanVCard);
                            }
                            
                            if (createResult.success) {
                                // ✅ CRITICAL: Update local vCard with iCloud's assigned UID
                                // iCloud may have assigned a different UID (like AF559AB3-...)
                                // We need to sync this back to avoid duplicates on next sync
                                if (createResult.uid) {
                                    const oldUIDMatch = cleanVCard.match(/UID:([^\r\n]+)/);
                                    const oldUID = oldUIDMatch ? oldUIDMatch[1].trim() : null;
                                    
                                    if (oldUID !== createResult.uid) {
                                        console.log(`🔄 Syncing iCloud's assigned UID: ${oldUID} → ${createResult.uid}`);
                                        contact.vcard = contact.vcard.replace(/UID:[^\r\n]+/g, `UID:${createResult.uid}`);
                                    }
                                }
                                
                                // Set lastSyncedAt after successful creation (PUSH operation)
                                contact.metadata.carddav = {
                                    source: 'iCloud',
                                    etag: createResult.etag,
                                    href: createResult.href,
                                    uid: createResult.uid,
                                    lastSyncedAt: new Date().toISOString(), // PUSH timestamp
                                    syncStatus: 'synced'
                                };
                                
                                if (contact.metadata.isOwned) {
                                    await this.contactManager.database.updateContact(contact);
                                }
                                
                                console.log(`✅ Created contact on iCloud after 404: ${contact.cardName}`);
                                pushed++;
                                this.stats.contactsPushed++;
                            } else {
                                console.error(`❌ Failed to create contact after 404: ${contact.cardName}`, createResult.error);
                                errors++;
                            }
                            continue;
                        }
                        
                        if (result.success) {
                            // For SHARED contacts (green), store metadata in memory-only cache
                            if (!contact.metadata.isOwned) {
                                // Store sync state in memory (local cache)
                                if (!this.sharedContactSyncCache) {
                                    this.sharedContactSyncCache = new Map();
                                }
                                
                                this.sharedContactSyncCache.set(contact.contactId, {
                                    etag: result.etag,
                                    href: result.href,
                                    uid: this.extractUIDFromVCard(contact.vcard),
                                    lastSyncedAt: new Date().toISOString(),
                                    syncStatus: 'synced'
                                });
                                
                                console.log(`✅ Updated shared contact on iCloud (cached): ${contact.cardName}`);
                            } else {
                                // For OWNED/IMPORTED contacts, update metadata and store in database
                                // Update lastSyncedAt since we just PUSHED to iCloud
                                contact.metadata.carddav.etag = result.etag;
                                contact.metadata.carddav.lastSyncedAt = new Date().toISOString(); // PUSH timestamp
                                contact.metadata.carddav.syncStatus = 'synced';
                                
                                // Update contact in database
                                const updateResult = await this.contactManager.database.updateContact(contact);
                                if (!updateResult.success) {
                                    console.error(`❌ Failed to update metadata for ${contact.cardName}:`, updateResult.error);
                                }
                            }
                            
                            pushed++;
                            this.stats.contactsPushed++;
                        }
                        
                    } else {
                        // Create new contact on iCloud
                        console.log(`➕ Creating on iCloud: ${contact.cardName}`);
                        
                        // Regenerate vCard WITHOUT internal metadata (CATEGORIES, etc.)
                        // iCloud rejects vCards with custom CATEGORIES format
                        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
                        
                        // 🐛 DEBUG: Log displayData to diagnose email sync issue
                        console.log(`📊 DisplayData for ${contact.cardName}:`, {
                            fullName: displayData.fullName,
                            emailCount: displayData.emails?.length || 0,
                            emails: displayData.emails,
                            phoneCount: displayData.phones?.length || 0,
                            hasVCard: !!contact.vcard
                        });
                        
                        const cleanVCard = this.contactManager.vCardStandard.generateVCard(displayData, {
                            skipInternalMetadata: true  // Skip CATEGORIES with sharing info
                        });
                        
                        // 🐛 DEBUG: Log generated vCard to see if emails are included
                        const hasEmailInVCard = cleanVCard.includes('EMAIL');
                        console.log(`📄 Generated vCard has EMAIL properties: ${hasEmailInVCard}`);
                        if (!hasEmailInVCard && displayData.emails?.length > 0) {
                            console.error(`❌ CRITICAL: displayData has ${displayData.emails.length} emails but vCard has none!`);
                        }
                        
                        // Debug: Log vCard preview for troubleshooting
                        const vCardPreview = cleanVCard.substring(0, 500).replace(/\r\n/g, '\\r\\n');
                        console.log(`📝 vCard preview (first 500 chars): ${vCardPreview}`);
                        
                        // Validation: Warn if contact lacks EMAIL (iCloud may reject with 404)
                        const hasEmail = cleanVCard.includes('EMAIL:') || cleanVCard.includes('EMAIL;');
                        if (!hasEmail) {
                            console.warn(`⚠️ Contact "${contact.cardName}" has no EMAIL property`);
                            console.warn(`   iCloud may reject this contact with "404 Persist Error"`);
                            console.warn(`   Consider adding an email address before syncing to iCloud`);
                        }
                        
                        const result = await this.iCloudClient.createContact(cleanVCard);
                        
                        if (result.success) {
                            // Store iCloud metadata in database
                            // Set lastSyncedAt since we just PUSHED/created on iCloud
                            contact.metadata.carddav = {
                                source: 'iCloud',
                                etag: result.etag,
                                href: result.href,
                                uid: result.uid,
                                lastSyncedAt: new Date().toISOString(), // PUSH timestamp
                                syncStatus: 'synced'
                            };
                            
                            // Update contact metadata in database (only for owned contacts)
                            if (contact.metadata.isOwned) {
                                const updateResult = await this.contactManager.database.updateContact(contact);
                                
                                if (updateResult.success) {
                                    console.log(`✅ Created and synced: ${contact.cardName}`);
                                } else {
                                    console.warn(`⚠️ Failed to store sync metadata for ${contact.cardName}: ${updateResult.error}`);
                                }
                            } else {
                                // Shared contact - can't update metadata (read-only in recipient's database)
                                console.log(`✅ Created on iCloud (shared contact, no metadata update): ${contact.cardName}`);
                            }
                            
                            pushed++;
                            this.stats.contactsPushed++;
                        }
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to push contact ${contact.cardName}:`, error);
                    errors++;
                    
                    // Mark contact as having sync error
                    if (contact.metadata.carddav) {
                        contact.metadata.carddav.syncStatus = 'error';
                        contact.metadata.carddav.lastSyncError = error.message;
                        await this.contactManager.database.updateContact(contact);
                    }
                }
            }
            
            console.log(`✅ Push complete: ${pushed} pushed, ${deleted} deleted, ${skipped} skipped, ${errors} errors`);
            
            return { pushed, deleted, skipped, errors };
            
        } catch (error) {
            console.error('❌ Push to iCloud failed:', error);
            throw error;
        }
    }

    /**
     * Determine if a contact should be pushed to iCloud
     */
    shouldPushContact(contact) {
        // Always skip deleted or archived contacts
        if (contact.metadata.isDeleted || contact.metadata.isArchived) {
            return { push: false, reason: 'deleted or archived' };
        }
        
        // SHARED contact (green) → Always push and overwrite
        // These are contacts shared with us by other users via Userbase
        // We PUSH shared contacts to iCloud and overwrite any existing version
        if (!contact.metadata.isOwned) {
            return { push: true, reason: 'shared contact (overwrite mode)' };
        }
        
        // OWNED or IMPORTED contact
        const carddavMeta = contact.metadata?.carddav;
        
        if (!carddavMeta) {
            // No CardDAV metadata → needs initial push
            return { push: true, reason: 'not yet synced' };
        }
        
        // CRITICAL FIX: Check if contact actually exists on iCloud
        // If no ETag, the contact was never successfully created on iCloud
        if (!carddavMeta.etag) {
            return { push: true, reason: 'no ETag (not on iCloud yet)' };
        }
        
        // Check if contact was modified after last sync
        const lastSynced = carddavMeta.lastSyncedAt ? new Date(carddavMeta.lastSyncedAt) : null;
        const lastModified = new Date(contact.metadata.lastUpdated);
        
        if (!lastSynced || lastModified > lastSynced) {
            return { push: true, reason: 'modified locally' };
        }
        
        // Contact is up to date
        return { push: false, reason: 'already synced' };
    }

    /**
     * Find local contact by vCard UID
     */
    findLocalContactByUID(uid) {
        for (const contact of this.contactManager.contacts.values()) {
            const contactUID = this.extractUIDFromVCard(contact.vcard);
            if (contactUID === uid) {
                return contact;
            }
        }
        return null;
    }

    /**
     * Extract UID from vCard string
     */
    extractUIDFromVCard(vcard) {
        const match = vcard.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Get sync statistics
     */
    getStats() {
        return {
            ...this.stats,
            isConnected: this.isConnected,
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            autoSyncEnabled: !!this.syncInterval,
            recentErrors: this.syncErrors.slice(-5) // Last 5 errors
        };
    }

    /**
     * Disconnect from iCloud and cleanup
     */
    disconnect() {
        this.stopAutoSync();
        this.isConnected = false;
        this.iCloudClient = null;
        this.credentials = null;
        
        console.log('🔌 Disconnected from iCloud Sync Service');
        
        this.eventBus.emit('icloud:syncDisconnected');
    }
}
