/**
 * ContactManager - Main contact business logic
 * Handles all contact operations with RFC 9553 compliance and comprehensive metadata
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * SHARING ARCHITECTURE: GROUPS AS COLLECTIONS (NOT DATA STRUCTURES)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PRINCIPLE: Distribution lists/groups are UI CONVENIENCE ONLY
 * - Groups expand to individual shares at the time of sharing
 * - Contact metadata stores ONLY individual usernames in sharedWithUsers array
 * - No group references stored in contact metadata
 * - Each user appears as separate entry in contact detail sharing list
 * - Revocation is always per-user (granular control)
 * 
 * BENEFITS:
 * ✅ Simplified data model (only user arrays, no group structures)
 * ✅ Consistent UI (all shares look the same, regardless of origin)
 * ✅ Granular control (revoke individual users, not entire groups)
 * ✅ No sync issues (no group membership changes to track)
 * ✅ Clear audit trail (see exactly who has access)
 * 
 * IMPLEMENTATION:
 * - shareContactWithDistributionList() → expands to individual shareContact() calls
 * - Each shareContact() updates metadata.sharing.sharedWithUsers array
 * - renderSharingInfo() displays all users individually (no group distinction)
 * - Revocation removes single username from sharedWithUsers array
 * 
 * EXAMPLE:
 * User shares contact with group "Work Colleagues" (alice, bob, charlie)
 * Result in metadata:
 *   sharedWithUsers: ["alice", "bob", "charlie"]  ✅ Individual users
 *   NOT: sharedGroups: ["Work Colleagues"]        ❌ No group tracking
 * 
 * UI Display: Shows 3 separate entries with individual revoke buttons
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { ContactIdentifier } from '../utils/ContactIdentifier.js';

export class ContactManager {
    constructor(eventBus, database, vCardStandard, validator) {
        this.eventBus = eventBus;
        this.database = database;
        this.vCardStandard = vCardStandard;
        this.validator = validator;
        this.iCloudSyncService = null;
        
        // In-memory contact storage for performance
        this.contacts = new Map();
        this.settings = {};
        this.isLoaded = false;
        
        // Search and filter cache
        this.searchCache = new Map();
        this.lastSearchQuery = '';
        
        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Set iCloudSyncService reference (called after construction)
     * @param {ICloudSyncService} iCloudSyncService - iCloudSyncService instance
     */
    setiCloudSyncService(iCloudSyncService) {
        this.iCloudSyncService = iCloudSyncService;
    }

    /**
     * Pause the iCloud auto-sync cycle.
     * Used during bulk operations to prevent race conditions
     * @returns {Object} Pause result with paused services info
     */
    pauseAllSync() {
        const pausedServices = {
            iCloud: false,
            timestamp: new Date().toISOString()
        };

        try {
            if (this.iCloudSyncService && this.iCloudSyncService.syncInterval) {
                this.iCloudSyncService.stopAutoSync();
                pausedServices.iCloud = true;
                console.log('⏸️ Paused iCloud auto-sync');
            }

            return { success: true, pausedServices };

        } catch (error) {
            console.error('❌ Error pausing sync services:', error);
            return { success: false, error: error.message, pausedServices };
        }
    }

    /**
     * Resume the iCloud auto-sync cycle if it was paused
     * @param {Object} pausedServices - Services that were paused (from pauseAllSync)
     * @returns {Promise<Object>} Resume result
     */
    async resumeAllSync(pausedServices) {
        const resumedServices = {
            iCloud: false,
            timestamp: new Date().toISOString()
        };

        try {
            if (pausedServices.iCloud && this.iCloudSyncService) {
                // skipInitialSync: the bulk operation we were paused for is
                // done — do not trigger a full pull+deletion+push cycle now
                this.iCloudSyncService.startAutoSync(null, { skipInitialSync: true });
                resumedServices.iCloud = true;
                console.log('▶️ Resumed iCloud auto-sync');
            }

            return { success: true, resumedServices };

        } catch (error) {
            console.error('❌ Error resuming sync services:', error);
            return { success: false, error: error.message, resumedServices };
        }
    }

    /**
     * Initialize Kontakt
     * @returns {Promise<Object>} Initialization result
     */
    async initialize() {
        try {
            // Prevent double initialization
            if (this.isLoaded) {
                console.log('✅ ContactManager already initialized, skipping...');
                return { success: true, contactCount: this.contacts.size, alreadyLoaded: true };
            }
            
            // Wait for database authentication
            if (!this.database.currentUser) {
                console.log('⏳ Waiting for database authentication...');
                await new Promise((resolve) => {
                    const unsubscribe = this.eventBus.on('database:authenticated', () => {
                        console.log('🔐 Database authenticated, proceeding...');
                        unsubscribe();
                        resolve();
                    });
                });
            } else {
                // Database already authenticated, proceed with initialization
            }

            // Load existing contacts and settings
            await this.loadContacts();
            await this.loadSettings();
            
            this.isLoaded = true;
            
            this.eventBus.emit('contactManager:initialized', {
                contactCount: this.contacts.size,
                isReady: true
            });

            return { success: true, contactCount: this.contacts.size };
        } catch (error) {
            console.error('ContactManager initialization failed:', error);
            this.eventBus.emit('contactManager:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Initialize with existing session - optimized for page refreshes
     * Skips database re-initialization when session is already active
     * @returns {Promise<Object>} Initialization result
     */
    async initializeWithExistingSession() {
        try {
            console.log('⚡ Initializing ContactManager with existing session...');
            
            // Prevent double initialization
            if (this.isLoaded) {
                console.log('✅ ContactManager already initialized, using cached data');
                return { success: true, contactCount: this.contacts.size, fromCache: true };
            }
            
            // Database should already be authenticated, so we can set up databases and load data
            console.log('📊 Loading contacts with existing database connection...');
            
            // Set up databases to register change handlers (this will trigger contact loading)
            await this.database.setupDatabases();
            
            // The actual contact loading happens via change handlers triggered by setupDatabases()
            // Give it a moment to load
            await new Promise(resolve => setTimeout(resolve, 100));
            
            this.isLoaded = true;
            
            this.eventBus.emit('contactManager:initialized', {
                contactCount: this.contacts.size,
                isReady: true,
                fastLoad: true
            });

            console.log(`✅ Fast initialization complete: ${this.contacts.size} contacts loaded`);
            return { success: true, contactCount: this.contacts.size, fastLoad: true };
            
        } catch (error) {
            console.error('Fast ContactManager initialization failed:', error);
            
            // Fallback to full initialization
            console.log('🔄 Falling back to full initialization...');
            return await this.initialize();
        }
    }

    /**
     * Setup event listeners for database changes
     */
    setupEventListeners() {
        // Handle real-time contact updates
        this.eventBus.on('contacts:changed', (data) => {
            this.handleContactsChanged(data);
        });

        // Handle settings updates
        this.eventBus.on('settings:changed', (data) => {
            this.handleSettingsChanged(data.settings);
        });

        // Handle user sign out - clear all cached data
        this.eventBus.on('database:signedOut', (data) => {
            this.handleSignedOut(data);
        });
    }

    /**
     * Create new contact with RFC 9553 compliance
     * @param {Object} contactData - Contact form data
     * @returns {Promise<Object>} Creation result
     */
    async createContact(contactData) {
        try {
            // Sanitize and validate input data
            const sanitizedData = this.validator.sanitizeContactData(contactData);
            const validation = this.validator.validateContactData(sanitizedData, '4.0', false);
            
            if (!validation.isValid) {
                return {
                    success: false,
                    error: 'Validation failed',
                    validationErrors: validation.errors,
                    validationWarnings: validation.warnings
                };
            }

            // Generate vCard string
            const vCardString = this.vCardStandard.generateVCard(sanitizedData);
            
            // Validate RFC 9553 compliance
            const vCardValidation = this.vCardStandard.validateVCard(vCardString);
            if (!vCardValidation.isValid) {
                return {
                    success: false,
                    error: `Invalid vCard: ${vCardValidation.errors.join(', ')}`,
                    vCardErrors: vCardValidation.errors
                };
            }

            // Create contact object with comprehensive metadata
            // Generate UID for the contact (used in vCard and as contactId)
            const contactId = this.vCardStandard.generateUID();
            const contact = {
                contactId,
                cardName: sanitizedData.cardName || 'Unnamed Contact',
                vcard: vCardString,
                metadata: {
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    isOwned: true,
                    isArchived: false,
                    isDeleted: false,
                    isFavorite: false,
                    isPinned: false,
                    // TODO(import-metadata, docs/SYNC_RULES.md section 1):
                    // Imported cards (orange) get their metadata from
                    // VCardStandard.importFromVCard (saved directly via
                    // importContactFromVCard), which only sets isImported +
                    // importSource — NOT importedAt (VCardImporter.js:506 is
                    // dead code; nothing live ever writes importedAt), and not
                    // isOwned (imported cards rely on the `isOwned !== false`
                    // legacy default) or the other defaults this constructor
                    // sets (isArchived, isFavorite, sharing, usage, ...).
                    // Fix: make VCardStandard.importFromVCard emit the same
                    // metadata shape as here, with importedAt and
                    // importSource: 'vcard-file' | 'iCloud' | 'shared-copy'.
                    isImported: sanitizedData.isImported || false,
                    distributionLists: sanitizedData.distributionLists || [],
                    
                    // Sharing metadata
                    sharing: {
                        isShared: false,
                        shareCount: 0,
                        sharedWithUsers: [],
                        sharePermissions: {},
                        shareHistory: []
                    },
                    
                    // Usage tracking
                    usage: {
                        accessCount: 0,
                        lastAccessedAt: null,
                        interactionHistory: []
                    },
                    
                    // Sync metadata
                    sync: {
                        version: 1,
                        lastSyncedAt: new Date().toISOString(),
                        hasUnresolvedConflicts: false
                    }
                }
            };

            // Save to database
            const saveResult = await this.database.saveContact(contact);
            if (!saveResult.success) {
                return {
                    success: false,
                    error: 'Failed to save contact',
                    databaseError: saveResult.error
                };
            }

            // NOTE: Don't add to local cache here - let the database change handler
            // handle it to ensure itemId is properly set by Userbase
            // this.contacts.set(contactId, contact);
            
            // Clear search cache
            this.clearSearchCache();

            // Log activity
            await this.database.logActivity({
                action: 'contact_created',
                contactId,
                details: {
                    contactName: sanitizedData.cardName
                }
            });

            this.eventBus.emit('contact:created', { 
                contact, 
                validationWarnings: validation.warnings 
            });

            // 🆕 AUTO-PUSH TO iCLOUD: immediately sync new contact to iCloud without waiting
            // for the next scheduled sync cycle.
            if (this.iCloudSyncService &&
                this.iCloudSyncService.isConnected &&
                (contact.metadata.isOwned !== false) &&
                !contact.metadata.isArchived &&
                !contact.metadata.isDeleted) {

                console.log(`📤 iCloud AUTO-PUSH: syncing new contact "${contact.cardName}"...`);
                this.iCloudSyncService.pushSingleContact(contact).then(result => {
                    if (result?.success) {
                        console.log(`✅ iCloud auto-push succeeded for "${contact.cardName}"`);
                    } else {
                        console.warn(`⚠️ iCloud auto-push failed for "${contact.cardName}":`, result?.error);
                    }
                }).catch(err => {
                    console.warn(`⚠️ iCloud auto-push error for "${contact.cardName}":`, err.message);
                });
            }

            return {
                success: true,
                contact,
                contactId,
                validationWarnings: validation.warnings
            };

        } catch (error) {
            console.error('Create contact failed:', error);
            this.eventBus.emit('contact:error', { 
                action: 'create', 
                error: error.message 
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update existing contact
     * @param {string} contactId - Contact ID
     * @param {Object} contactData - Updated contact data
     * @returns {Promise<Object>} Update result
     */
    async updateContact(contactId, contactData) {
        try {
            const existingContact = this.contacts.get(contactId);
            if (!existingContact) {
                return { success: false, error: 'Contact not found' };
            }

            // Validate permissions
            if (!this.canEditContact(existingContact)) {
                return { success: false, error: 'No permission to edit this contact' };
            }

            // Sanitize and validate input data
            const sanitizedData = this.validator.sanitizeContactData(contactData);
            
            const validation = this.validator.validateContactData(sanitizedData, '4.0', true);
            
            if (!validation.isValid) {
                return {
                    success: false,
                    error: 'Validation failed',
                    validationErrors: validation.errors,
                    validationWarnings: validation.warnings
                };
            }

            // 🔑 CRITICAL FIX: Preserve UID from existing contact to prevent duplicate creation
            // Extract UID from existing vCard and add it to sanitizedData
            // This ensures Thunderbird edits don't create new contacts with different UIDs
            if (existingContact.vcard) {
                const existingUID = this.extractUIDFromVCard(existingContact.vcard);
                if (existingUID && !sanitizedData.uid) {
                    sanitizedData.uid = existingUID;
                    console.log(`🔑 Preserved UID from existing contact: ${existingUID}`);
                }
            }

            // Generate updated vCard string
            const vCardString = this.vCardStandard.generateVCard(sanitizedData);
            
            // Create updated contact with preserved metadata
            const updatedContact = {
                ...existingContact,
                cardName: sanitizedData.cardName !== undefined ? sanitizedData.cardName : existingContact.cardName,
                vcard: vCardString,
                metadata: {
                    ...existingContact.metadata,
                    lastUpdated: new Date().toISOString(),
                    // S-1: mark for iCloud push; cleared when the push succeeds
                    carddav: {
                        ...(existingContact.metadata.carddav || {}),
                        dirty: true
                    },
                    distributionLists: sanitizedData.distributionLists || existingContact.metadata.distributionLists,
                    sync: {
                        ...(existingContact.metadata.sync || {}),
                        version: (existingContact.metadata.sync?.version || 0) + 1,
                        lastSyncedAt: new Date().toISOString()
                    }
                }
            };

            // Track the update in usage history
            this.addInteractionHistory(updatedContact, 'edited', {
                fieldsChanged: this.getChangedFields(existingContact, updatedContact)
            });

            // Save to database
            const saveResult = await this.database.updateContact(updatedContact);
            if (!saveResult.success) {
                return {
                    success: false,
                    error: 'Failed to update contact',
                    databaseError: saveResult.error
                };
            }

            // 🔑 CRITICAL FIX: Update shared databases for cross-device sharing
            // If this contact is shared, we need to update the shared databases too
            // Shared database updates are handled by the database layer's updateSharedContactDatabases method
            // This ensures consistent Individual Database Strategy usage

            // Update local cache
            this.setContactInCache(contactId, updatedContact, 'updateContact');
            
            // Clear search cache
            this.clearSearchCache();

            // Log activity
            await this.database.logActivity({
                action: 'contact_updated',
                contactId,
                details: {
                    contactName: updatedContact.cardName
                }
            });

            this.eventBus.emit('contact:updated', { 
                contact: updatedContact, 
                validationWarnings: validation.warnings 
            });

            // 🆕 AUTO-PUSH TO iCLOUD: immediately sync edit to iCloud without waiting
            // for the next scheduled sync cycle.
            // Note: isSyncing guard removed — pushSingleContact doesn't set isSyncing, so
            // skipping here caused silent data loss when a scheduled sync happened to run.
            if (this.iCloudSyncService &&
                this.iCloudSyncService.isConnected &&
                (updatedContact.metadata.isOwned !== false) &&
                !updatedContact.metadata.isArchived &&
                !updatedContact.metadata.isDeleted) {

                console.log(`📤 iCloud AUTO-PUSH: syncing edit for "${updatedContact.cardName}"...`);
                // Run async, don't block the UI update
                this.iCloudSyncService.pushSingleContact(updatedContact).then(result => {
                    if (result?.success) {
                        console.log(`✅ iCloud auto-push succeeded for "${updatedContact.cardName}"`);
                    } else {
                        console.warn(`⚠️ iCloud auto-push failed for "${updatedContact.cardName}":`, result?.error);
                    }
                }).catch(err => {
                    console.warn(`⚠️ iCloud auto-push error for "${updatedContact.cardName}":`, err.message);
                });
            }

            return {
                success: true,
                contact: updatedContact,
                validationWarnings: validation.warnings
            };

        } catch (error) {
            console.error('Update contact failed:', error);
            this.eventBus.emit('contact:error', { 
                action: 'update', 
                contactId, 
                error: error.message 
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Delete contact (soft delete)
     * @param {string} contactId - Contact ID
     * @returns {Promise<Object>} Delete result
     */
    async deleteContact(contactId) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Contact not found' };
            }

            // Check permissions
            if (!this.canDeleteContact(contact)) {
                return { success: false, error: 'No permission to delete this contact' };
            }

            // For owned contacts, mark as deleted. Shared (green) cards are
            // delete-authoritative on the owner side only — a recipient asks
            // the owner to revoke, or archives the card locally
            // (SYNC_RULES.md section 4.1 / Decision 1).
            if (contact.metadata.isOwned !== false) {
                // Soft delete - mark as deleted but keep in database
                const deletedContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        isDeleted: true,
                        deletedAt: new Date().toISOString(),
                        deletedBy: this.database.currentUser?.userId,
                        lastUpdated: new Date().toISOString()
                    }
                };

                const saveResult = await this.database.updateContact(deletedContact);
                if (!saveResult.success) {
                    return { success: false, error: 'Failed to delete contact' };
                }
                
                this.contacts.set(contactId, deletedContact);
                
                // Push the deletion to iCloud immediately when sync is active
                if (this.iCloudSyncService && this.iCloudSyncService.isConnected) {
                    try {
                        await this.iCloudSyncService.performSync();
                        console.log(`✅ Contact deletion synced to iCloud`);
                    } catch (iCloudError) {
                        console.error(`❌ Failed to sync deletion to iCloud:`, iCloudError);
                    }
                }
            } else {
                // SYNC_RULES.md section 4.1 / Decision 1: a green (shared)
                // card is removed by its owner (revoke), never by the
                // recipient. The previous code attempted deleteItem on the
                // user's own contacts database with the composite shared ID
                // — an item that does not exist there, so it always failed
                // with ItemDoesNotExist.
                return {
                    success: false,
                    error: 'Shared contacts are removed by their owner. Archive it instead, or ask the owner to revoke the share.'
                };
            }

            // Clear search cache
            this.clearSearchCache();

            // Log activity
            await this.database.logActivity({
                action: 'contact_deleted',
                contactId,
                details: {
                    contactName: contact.cardName,
                    softDelete: contact.metadata.isOwned
                }
            });

            this.eventBus.emit('contact:deleted', { contactId });

            return { success: true };

        } catch (error) {
            console.error('Delete contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Archive contact
     * @param {string} contactId - Contact ID
     * @param {string} reason - Archive reason
     * @returns {Promise<Object>} Archive result
     */
    async archiveContact(contactId, reason = null) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Contact not found' };
            }

            // Check if this is a shared contact (starts with 'shared_')
            if (contactId.startsWith('shared_')) {
                console.log('📦 Archiving shared contact locally:', contactId);
                return await this.archiveSharedContactLocally(contactId, reason);
            }

            // For owned contacts, update in database
            const archivedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    isArchived: true,
                    archivedAt: new Date().toISOString(),
                    archivedBy: this.database.currentUser?.userId,
                    archiveReason: reason,
                    lastUpdated: new Date().toISOString()
                }
            };

            const saveResult = await this.database.updateContact(archivedContact);
            if (!saveResult.success) {
                return { success: false, error: 'Failed to archive contact' };
            }

            this.contacts.set(contactId, archivedContact);
            this.clearSearchCache();

            await this.database.logActivity({
                action: 'contact_archived',
                contactId,
                details: { reason }
            });

            this.eventBus.emit('contact:archived', { contact: archivedContact });
            return { success: true, contact: archivedContact };

        } catch (error) {
            console.error('Archive contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Archive shared contact locally (doesn't update original database)
     * @param {string} contactId - Shared contact ID
     * @param {string} reason - Archive reason
     * @returns {Promise<Object>} Archive result
     */
    async archiveSharedContactLocally(contactId, reason = null) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Shared contact not found' };
            }

            console.log('📦 Archiving shared contact in user metadata:', {
                contactId,
                cardName: contact.cardName,
                sharedBy: contact.metadata.sharedBy
            });

            // Store archive state in user's shared contact metadata database
            const metadataResult = await this.database.updateSharedContactMetadata(contactId, {
                isArchived: true,
                archivedAt: new Date().toISOString(),
                archivedBy: this.database.currentUser?.userId,
                archiveReason: reason,
                originalContactId: contact.metadata.originalContactId,
                sharedBy: contact.metadata.sharedBy
            });

            if (!metadataResult.success) {
                return { success: false, error: 'Failed to save archive state to metadata' };
            }

            // Update local cache with archive state
            const archivedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    isArchived: true,
                    archivedAt: new Date().toISOString(),
                    archivedBy: this.database.currentUser?.userId,
                    archiveReason: reason,
                    lastUpdated: new Date().toISOString()
                }
            };

            this.contacts.set(contactId, archivedContact);
            this.clearSearchCache();

            // Log locally only
            await this.database.logActivity({
                action: 'shared_contact_archived',
                contactId,
                details: { 
                    reason,
                    sharedBy: contact.metadata.sharedBy,
                    originalContactId: contact.metadata.originalContactId
                }
            });

            // Emit events for UI updates
            this.eventBus.emit('contact:archived', { contact: archivedContact });
            this.eventBus.emit('contactManager:contactsUpdated', { 
                contactCount: this.contacts.size,
                action: 'shared_contact_archived'
            });

            return { success: true, contact: archivedContact };

        } catch (error) {
            console.error('❌ Archive shared contact locally failed:', error);
            this.eventBus.emit('contact:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Restore contact from archive
     * @param {string} contactId - Contact ID
     * @returns {Promise<Object>} Restore result
     */
    async restoreContact(contactId) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Contact not found' };
            }

            // Check if this is a shared contact
            if (contactId.startsWith('shared_')) {
                console.log('🔄 Restoring shared contact locally:', contactId);
                
                // For shared contacts, update the user's metadata
                const restoredContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        isArchived: false,
                        archivedAt: null,
                        archivedBy: null,
                        archiveReason: null,
                        restoredAt: new Date().toISOString(),
                        restoredBy: this.database.currentUser?.userId,
                        lastUpdated: new Date().toISOString()
                    }
                };

                // Update metadata in user's metadata database
                console.log('🔄 Restoring shared contact in user metadata:', {
                    contactId: restoredContact.contactId,
                    cardName: restoredContact.cardName,
                    sharedBy: restoredContact.metadata.sharedBy
                });

                const metadataResult = await this.database.updateSharedContactMetadata(contactId, {
                    isArchived: false,
                    archivedAt: null,
                    archivedBy: null,
                    archiveReason: null,
                    restoredAt: new Date().toISOString(),
                    restoredBy: this.database.currentUser?.userId,
                    lastUpdated: new Date().toISOString()
                });

                if (!metadataResult.success) {
                    console.error('❌ Failed to restore shared contact metadata:', metadataResult.error);
                    return { success: false, error: 'Failed to restore shared contact metadata' };
                }

                // Update in memory
                this.contacts.set(contactId, restoredContact);
                this.clearSearchCache();

                console.log('✅ Shared contact restored in user metadata:', contactId);
                this.eventBus.emit('contact:restored', { contact: restoredContact });
                return { success: true, contact: restoredContact };
            } else {
                // For owned contacts, update the contact directly
                const restoredContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        isArchived: false,
                        archivedAt: null,
                        archivedBy: null,
                        archiveReason: null,
                        restoredAt: new Date().toISOString(),
                        restoredBy: this.database.currentUser?.userId,
                        lastUpdated: new Date().toISOString(),
                        // S-1: card is active again — ensure iCloud gets the current version
                        carddav: {
                            ...(contact.metadata.carddav || {}),
                            dirty: true
                        }
                    }
                };

                const saveResult = await this.database.updateContact(restoredContact);
                if (!saveResult.success) {
                    return { success: false, error: 'Failed to restore contact' };
                }

                this.contacts.set(contactId, restoredContact);
                this.clearSearchCache();

                this.eventBus.emit('contact:restored', { contact: restoredContact });
                return { success: true, contact: restoredContact };
            }

        } catch (error) {
            console.error('Restore contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Search contacts with caching
     * @param {string} query - Search query
     * @param {Object} filters - Additional filters
     * @returns {Array} Search results
     */
    searchContacts(query, filters = {}) {
        try {
            const cacheKey = `${query}_${JSON.stringify(filters)}`;
            
            // Check cache first
            if (this.searchCache.has(cacheKey)) {
                return this.searchCache.get(cacheKey);
            }

            let results = Array.from(this.contacts.values());

            // Filter out deleted contacts by default
            if (!filters.includeDeleted) {
                results = results.filter(contact => !contact.metadata.isDeleted);
            }

            // Handle archive filtering with new logic
            if (filters.archiveOnly) {
                // Show ONLY archived contacts
                results = results.filter(contact => contact.metadata.isArchived);
            } else if (!filters.includeArchived) {
                // Filter out archived contacts (default behavior)
                results = results.filter(contact => !contact.metadata.isArchived);
            }
            // If includeArchived is true but archiveOnly is false, show both archived and active

            // Text search
            if (query && query.trim()) {
                const searchTerm = query.toLowerCase().trim();
                results = results.filter(contact => {
                    // Search in card name
                    if (contact.cardName && contact.cardName.toLowerCase().includes(searchTerm)) return true;
                    
                    // Search in vCard content
                    if (contact.vcard && contact.vcard.toLowerCase().includes(searchTerm)) return true;
                    
                    // Search in distribution lists
                    if (contact.metadata?.distributionLists?.some(list => 
                        list && list.toLowerCase().includes(searchTerm))) return true;
                    
                    return false;
                });
            }

            // Apply additional filters
            results = this.applyFilters(results, filters);

            // Cache results
            this.searchCache.set(cacheKey, results);
            this.lastSearchQuery = query;

            return results;

        } catch (error) {
            console.error('Search contacts failed:', error);
            return [];
        }
    }

    /**
     * Apply filters to contact results
     * @param {Array} contacts - Contact array
     * @param {Object} filters - Filter object
     * @returns {Array} Filtered contacts
     */
    applyFilters(contacts, filters) {
        let filtered = [...contacts];

        // Handle imported-only filter first (special case)
        // Shows only contacts that were imported from files by the current user
        if (filters.importedOnly) {
            filtered = filtered.filter(contact => contact.metadata.isImported === true && contact.metadata.isOwned);
            return filtered; // Return early for imported-only filter
        }

        // Distribution list filter
        if (filters.distributionList) {
            filtered = filtered.filter(contact => {
                const hasListAssignment = contact.metadata.distributionLists?.includes(filters.distributionList);
                return hasListAssignment;
            });
        }

        // Ownership filter
        if (filters.ownership === 'owned') {
            // Shows ONLY contacts created by the current user (excludes imported contacts)
            // Imported contacts have their own filter checkbox
            filtered = filtered.filter(contact => contact.metadata.isOwned && !contact.metadata.isImported);
        } else if (filters.ownership === 'shared') {
            // Shows contacts shared by other users (excludes owned and imported contacts)
            filtered = filtered.filter(contact => !contact.metadata.isOwned);
        }

        // "My Contacts" + "Shared with Me": union of the two groups, which both
        // exclude imported contacts (they have their own filter checkbox)
        if (filters.excludeImported) {
            filtered = filtered.filter(contact => contact.metadata.isImported !== true);
        }

        // Include imported filter (combine imported with other filters)
        if (filters.includeImported) {
            const importedContacts = contacts.filter(contact => contact.metadata.isImported === true);
            
            // Add imported contacts to current filtered results (avoid duplicates)
            const currentIds = new Set(filtered.map(c => c.contactId));
            const newImportedContacts = importedContacts.filter(c => !currentIds.has(c.contactId));
            filtered = [...filtered, ...newImportedContacts];
        }

        // Favorite filter
        if (filters.onlyFavorites) {
            filtered = filtered.filter(contact => contact.metadata.isFavorite);
        }

        // Recently accessed filter
        if (filters.recentlyAccessed) {
            const days = filters.recentlyAccessed;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            filtered = filtered.filter(contact => {
                const lastAccessed = contact.metadata.usage?.lastAccessedAt;
                return lastAccessed && new Date(lastAccessed) > cutoffDate;
            });
        }

        return filtered;
    }

    /**
     * Sort contacts
     * @param {Array} contacts - Contacts to sort
     * @param {string} sortBy - Sort field
     * @param {string} direction - Sort direction (asc/desc)
     * @returns {Array} Sorted contacts
     */
    sortContacts(contacts, sortBy = 'name', direction = 'asc') {
        const sorted = [...contacts].sort((a, b) => {
            let valueA, valueB;

            switch (sortBy) {
                case 'name':
                    // Suppress itemId warnings during sorting operations
                    const aData = this.vCardStandard.extractDisplayData(a, true, true);
                    const bData = this.vCardStandard.extractDisplayData(b, true, true);
                    // 🛡️ DEFENSIVE: Handle corrupted contacts without vcard data
                    valueA = aData && aData.fullName ? aData.fullName.toLowerCase() : 'zzz_corrupted';
                    valueB = bData && bData.fullName ? bData.fullName.toLowerCase() : 'zzz_corrupted';
                    break;
                
                case 'created':
                    valueA = new Date(a.metadata.createdAt);
                    valueB = new Date(b.metadata.createdAt);
                    break;
                
                case 'updated':
                    valueA = new Date(a.metadata.lastUpdated);
                    valueB = new Date(b.metadata.lastUpdated);
                    break;
                
                case 'accessed':
                    valueA = a.metadata.usage?.lastAccessedAt ? new Date(a.metadata.usage.lastAccessedAt) : new Date(0);
                    valueB = b.metadata.usage?.lastAccessedAt ? new Date(b.metadata.usage.lastAccessedAt) : new Date(0);
                    break;
                
                case 'recent-activity':
                    // Use the most recent of lastAccessedAt or lastUpdated
                    // For shared contacts, also check the top-level lastAccessedAt from metadata merge
                    const aAccessedUsage = a.metadata.usage?.lastAccessedAt ? new Date(a.metadata.usage.lastAccessedAt) : new Date(0);
                    const aAccessedTop = a.metadata.lastAccessedAt ? new Date(a.metadata.lastAccessedAt) : new Date(0);
                    const aAccessed = aAccessedUsage > aAccessedTop ? aAccessedUsage : aAccessedTop;
                    const aUpdated = new Date(a.metadata.lastUpdated);
                    valueA = aAccessed > aUpdated ? aAccessed : aUpdated;
                    
                    const bAccessedUsage = b.metadata.usage?.lastAccessedAt ? new Date(b.metadata.usage.lastAccessedAt) : new Date(0);
                    const bAccessedTop = b.metadata.lastAccessedAt ? new Date(b.metadata.lastAccessedAt) : new Date(0);
                    const bAccessed = bAccessedUsage > bAccessedTop ? bAccessedUsage : bAccessedTop;
                    const bUpdated = new Date(b.metadata.lastUpdated);
                    valueB = bAccessed > bUpdated ? bAccessed : bUpdated;
                    
                    break;
                
                default:
                    valueA = a.cardName.toLowerCase();
                    valueB = b.cardName.toLowerCase();
            }

            if (valueA < valueB) return direction === 'asc' ? -1 : 1;
            if (valueA > valueB) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }


    /**
     * Get contact statistics
     * @returns {Object} Statistics object
     */
    getContactStatistics() {
        const allContacts = Array.from(this.contacts.values());
        const activeContacts = allContacts.filter(c => !c.metadata.isDeleted && !c.metadata.isArchived);
        
        // Separate owned and shared for clarity
        // "Owned" matches the My Contacts filter (applyFilters ownership: 'owned'):
        // contacts created by the user, excluding imported ones (they have their own filter)
        const ownedContacts = activeContacts.filter(c => c.metadata.isOwned && c.metadata.isImported !== true);
        const sharedContacts = activeContacts.filter(c => !c.metadata.isOwned);
        
        return {
            total: activeContacts.length, // Total includes both owned AND shared
            active: activeContacts.length,
            archived: allContacts.filter(c => c.metadata.isArchived && !c.metadata.isDeleted).length,
            deleted: allContacts.filter(c => c.metadata.isDeleted).length,
            owned: ownedContacts.length,
            shared: sharedContacts.length,
            imported: activeContacts.filter(c => c.metadata.isImported === true).length,
            recent: activeContacts.length, // All contacts (sorted by recent activity when filtered)
            favorites: allContacts.filter(c => c.metadata.isFavorite).length,
            distributionLists: this.getDistributionListCounts()
        };
    }

    /**
     * Get count of contacts accessed within the last N days
     * @param {number} days - Number of days to look back
     * @returns {number} Count of recently accessed contacts
     */
    getRecentContactsCount(days = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const allContacts = Array.from(this.contacts.values());
        return allContacts.filter(contact => {
            // Skip deleted contacts
            if (contact.metadata.isDeleted) return false;
            
            const lastAccessed = contact.metadata.usage?.lastAccessedAt;
            return lastAccessed && new Date(lastAccessed) > cutoffDate;
        }).length;
    }

    /**
     * Track contact access with optimized memory usage
     * @param {string} contactId - Contact ID
     * @param {number} viewDuration - View duration in seconds (optional)
     * @returns {Promise<void>}
     */
    async trackContactAccess(contactId, viewDuration = null) {
        try {
            // Validate input
            if (!contactId || typeof contactId !== 'string') {
                console.warn('⚠️ Invalid contactId for access tracking');
                return;
            }

            const contact = this.contacts.get(contactId);
            if (!contact) {
                console.debug(`⏭️ Contact ${contactId} not found for access tracking`);
                return;
            }

            const now = new Date().toISOString();
            
            // MEMORY OPTIMIZATION: Reuse existing usage object instead of creating new one
            const currentUsage = contact.metadata?.usage || {};
            
            // Keep interaction history minimal (last 3 entries, down from 5)
            // Rationale: 3 entries = ~150 bytes, sufficient for "recently viewed" features
            const currentHistory = currentUsage.interactionHistory || [];
            const limitedHistory = currentHistory.slice(-2); // Keep 2, add 1 = 3 total
            
            // Create minimal interaction entry (remove null values to save space)
            const newInteraction = {
                action: 'viewed',
                timestamp: now
            };
            
            // Only add duration if provided and meaningful
            if (viewDuration !== null && viewDuration !== undefined && viewDuration > 0) {
                newInteraction.duration = viewDuration;
            }
            
            // PERFORMANCE: Build updated contact efficiently
            const updatedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    lastAccessedAt: now,  // Top-level for sorting performance
                    usage: {
                        accessCount: (currentUsage.accessCount || 0) + 1,
                        lastAccessedAt: now,
                        // Don't store viewDuration at usage level - it's in history
                        interactionHistory: [...limitedHistory, newInteraction]
                    }
                    // Note: lastUpdated NOT updated (only for content changes)
                }
            };

            // For shared contacts, store usage in user's metadata database
            if (contactId.startsWith('shared_')) {
                // Get existing metadata or create new
                const existingMetadata = await this.database.getSharedContactMetadata(contactId) || {};
                
                // Update metadata with usage tracking
                await this.database.updateSharedContactMetadata(contactId, {
                    ...existingMetadata,
                    usage: updatedContact.metadata.usage,
                    lastAccessedAt: now
                });
                
                // Immediately merge the updated metadata into the contact for sorting
                const mergedContact = {
                    ...updatedContact,
                    metadata: {
                        ...updatedContact.metadata,
                        lastAccessedAt: now, // Top-level lastAccessedAt for sorting
                        usage: updatedContact.metadata.usage
                    }
                };
                
                // Update local cache with merged metadata
                this.contacts.set(contactId, mergedContact);
                
                // Clear search cache to ensure updated data is used in searches
                this.clearSearchCache();
                
                // Emit event to trigger UI refresh for shared contacts
                this.eventBus.emit('contact:updated', { contact: mergedContact });
            } else {
                // Validate contact size before saving
                const sizeValidation = this.validateContactSize(updatedContact);
                
                if (!sizeValidation.isValid) {
                    console.warn('🚨 Contact too large, cleaning up metadata:', sizeValidation);
                    const cleanedContact = this.cleanupContactMetadata(updatedContact);
                    
                    // Validate again after cleanup
                    const newValidation = this.validateContactSize(cleanedContact);
                    if (newValidation.isValid) {
                        await this.database.updateContactMetadataOnly(cleanedContact);
                        this.contacts.set(contactId, cleanedContact);
                        console.log('✅ Contact metadata saved after cleanup, size:', newValidation.sizeInKB + 'KB');
                        
                        // Emit event to trigger UI refresh
                        this.eventBus.emit('contact:updated', { contact: cleanedContact });
                    } else {
                        console.error('❌ Contact still too large after cleanup:', newValidation);
                        // Still update cache but don't save to database
                        this.contacts.set(contactId, cleanedContact);
                        
                        // Still emit event for UI refresh
                        this.eventBus.emit('contact:updated', { contact: cleanedContact });
                    }
                } else {
                    // For owned contacts, update both database and cache using metadata-only method
                    // This preserves the original lastUpdated timestamp (only content changes should update it)
                    await this.database.updateContactMetadataOnly(updatedContact);
                    this.contacts.set(contactId, updatedContact);
                    
                    // Emit event to trigger UI refresh
                    this.eventBus.emit('contact:updated', { contact: updatedContact });
                    
                    if (sizeValidation.warning) {
                        console.warn('⚠️ Contact size warning:', sizeValidation.warning, sizeValidation.sizeInKB + 'KB');
                    }
                }
            }

        } catch (error) {
            console.error('Track contact access failed:', error);
        }
    }

    /**
     * Export contact as vCard
     * @param {string} contactId - Contact ID
     * @returns {Object} Export data
     */
    exportContactAsVCard(contactId) {
        const contact = this.contacts.get(contactId);
        if (!contact) {
            return { success: false, error: 'Contact not found' };
        }

        return {
            success: true,
            ...this.vCardStandard.exportAsVCard(contact)
        };
    }

    /**
     * Find similar contacts based on name and primary contact info
     * Used for duplicate detection during import with improved algorithm
     * @param {Object} newContact - Contact to check for duplicates
     * @returns {Array} Array of similar contacts
     */
    findSimilarContacts(newContact) {
        const similar = [];
        
        // Handle case where we received a result object instead of contact
        const actualContact = newContact?.success ? newContact.contact : newContact;
        
        // Suppress itemId warning during import operations (contact hasn't been saved yet)
        const newData = this.vCardStandard.extractDisplayData(actualContact, true, true);
        
        if (!newData) {
            console.error('❌ Failed to extract display data from contact');
            return [];
        }
        
        // Extract comparison data
        const newName = newData.fullName?.toLowerCase().trim() || '';
        const newPhone = newData.phones?.[0]?.value?.replace(/[^\d]/g, '') || '';
        const newEmail = newData.emails?.[0]?.value?.toLowerCase().trim() || '';
        
        // Extract additional data for better matching
        const newOrg = newData.organization?.toLowerCase().trim() || '';
        const newTitle = newData.title?.toLowerCase().trim() || '';
        
        if (!newName && !newPhone && !newEmail) {
            return []; // Not enough data to compare
        }
        
        for (const [contactId, existingContact] of this.contacts.entries()) {
            if (existingContact.metadata?.isDeleted || existingContact.metadata?.isArchived) {
                continue; // Skip deleted/archived contacts
            }
            
            const existingData = this.vCardStandard.extractDisplayData(existingContact);
            const existingName = existingData.fullName?.toLowerCase().trim() || '';
            const existingPhone = existingData.phones?.[0]?.value?.replace(/[^\d]/g, '') || '';
            const existingEmail = existingData.emails?.[0]?.value?.toLowerCase().trim() || '';
            const existingOrg = existingData.organization?.toLowerCase().trim() || '';
            const existingTitle = existingData.title?.toLowerCase().trim() || '';
            
            // Calculate individual field matches
            const matches = this.calculateFieldMatches(
                { name: newName, phone: newPhone, email: newEmail, org: newOrg, title: newTitle },
                { name: existingName, phone: existingPhone, email: existingEmail, org: existingOrg, title: existingTitle }
            );
            
            // Apply strict duplicate detection rules
            if (this.isDuplicateContact(matches, newName, existingName)) {
                const matchScore = matches.totalScore;
                const matchPercentage = matches.percentage;
                
                similar.push({
                    contact: existingContact,
                    matchScore: matchScore,
                    matchPercentage: matchPercentage,
                    matchedFields: {
                        name: matches.nameMatch,
                        phone: matches.phoneMatch,
                        email: matches.emailMatch,
                        organization: matches.orgMatch,
                        title: matches.titleMatch
                    }
                });
            }
        }
        
        // Sort by match score (highest first)
        return similar.sort((a, b) => b.matchScore - a.matchScore);
    }

    /**
     * Calculate field matches with scoring focused on available strong identifiers
     * @param {Object} newData - New contact data
     * @param {Object} existingData - Existing contact data
     * @returns {Object} Match results with scores
     */
    calculateFieldMatches(newData, existingData) {
        const matches = {
            nameMatch: false,
            phoneMatch: false,
            emailMatch: false,
            orgMatch: false,
            titleMatch: false,
            totalScore: 0,
            maxPossibleScore: 0,
            percentage: 0
        };

        // Only calculate scores for fields that both contacts have
        // This prevents dilution from missing data
        
        // Name matching (weight: 2.0 - most important for identification)
        if (newData.name && existingData.name) {
            matches.maxPossibleScore += 2.0;
            if (newData.name === existingData.name) {
                matches.nameMatch = true;
                matches.totalScore += 2.0;
            } else if (this.namesAreSimilar(newData.name, existingData.name)) {
                // Calculate word overlap for partial name matches
                const nameWords1 = newData.name.split(/\s+/).filter(w => w.length > 1);
                const nameWords2 = existingData.name.split(/\s+/).filter(w => w.length > 1);
                
                let matchingWords = 0;
                let totalWords = Math.max(nameWords1.length, nameWords2.length);
                
                for (const word1 of nameWords1) {
                    for (const word2 of nameWords2) {
                        if (word1 === word2 && word1.length >= 2) {
                            matchingWords++;
                            break;
                        }
                    }
                }
                
                const wordOverlap = matchingWords / totalWords;
                if (wordOverlap >= 0.5) { // At least 50% of words must match
                    matches.nameMatch = true;
                    matches.totalScore += 2.0 * wordOverlap;
                }
            }
        }

        // Phone matching (weight: 3.0 - highest reliability)
        if (newData.phone && existingData.phone) {
            matches.maxPossibleScore += 3.0;
            if (newData.phone.length >= 7 && existingData.phone.length >= 7) {
                const newPhoneLast7 = newData.phone.slice(-7);
                const existingPhoneLast7 = existingData.phone.slice(-7);
                if (newPhoneLast7 === existingPhoneLast7) {
                    matches.phoneMatch = true;
                    matches.totalScore += 3.0;
                }
            }
        }

        // Email matching (weight: 2.5 - high reliability)
        if (newData.email && existingData.email) {
            matches.maxPossibleScore += 2.5;
            if (newData.email === existingData.email) {
                matches.emailMatch = true;
                matches.totalScore += 2.5;
            }
        }

        // Organization matching (supporting evidence - only if we have other matches)
        if (newData.org && existingData.org && (matches.nameMatch || matches.phoneMatch || matches.emailMatch)) {
            matches.maxPossibleScore += 1.0;
            if (newData.org === existingData.org) {
                matches.orgMatch = true;
                matches.totalScore += 1.0;
            }
        }

        // Title matching (weak supporting evidence - only if we have other matches)
        if (newData.title && existingData.title && (matches.nameMatch || matches.phoneMatch || matches.emailMatch)) {
            matches.maxPossibleScore += 0.5;
            if (newData.title === existingData.title) {
                matches.titleMatch = true;
                matches.totalScore += 0.5;
            }
        }

        // Calculate percentage - only based on what we can actually compare
        if (matches.maxPossibleScore === 0) {
            matches.percentage = 0;
        } else {
            matches.percentage = Math.min(1.0, matches.totalScore / matches.maxPossibleScore);
        }

        return matches;
    }

    /**
     * Determine if contacts are duplicates using strict rules
     * @param {Object} matches - Field match results
     * @param {string} newName - New contact name  
     * @param {string} existingName - Existing contact name
     * @returns {boolean} True if likely duplicate
     */
    isDuplicateContact(matches, newName, existingName) {
        // Guard: contacts with context qualifiers like (work)/(home)/(privat) are intentionally
        // separate cards even when they share a phone number — never auto-merge them.
        const contextQualifiers = ['(work)', '(home)', '(mobile)', '(personal)', '(business)', '(privat)', '(cell)', '(jobb)', '(privé)'];
        const newHasQualifier = contextQualifiers.some(q => newName.toLowerCase().includes(q));
        const existingHasQualifier = contextQualifiers.some(q => existingName.toLowerCase().includes(q));
        if (newHasQualifier !== existingHasQualifier) {
            // One has a qualifier and the other doesn't — intentionally separate cards
            return false;
        }

        // Special rule: Phone match + name similarity = very likely duplicate
        if (matches.phoneMatch && matches.nameMatch) {
            return true; // Phone + name is strong evidence regardless of other fields
        }
        
        // Special rule: Email match + name similarity = very likely duplicate  
        if (matches.emailMatch && matches.nameMatch) {
            return true; // Email + name is strong evidence regardless of other fields
        }

        // Rule 1: Strong phone match alone (different names might be nicknames/variations)
        if (matches.phoneMatch && matches.percentage >= 0.6) {
            return true; // Phone match is very strong evidence
        }
        
        // Rule 2: Strong email match alone  
        if (matches.emailMatch && matches.percentage >= 0.6) {
            return true; // Email match is very strong evidence
        }

        // Rule 3: Exact name match with supporting evidence
        if (newName === existingName && (matches.orgMatch || matches.titleMatch)) {
            return matches.percentage >= 0.70;
        }

        // Rule 4: Very high overall match
        if (matches.percentage >= 0.90) {
            return true;
        }

        // Rule 5: Multiple strong matches
        const strongMatches = [matches.phoneMatch, matches.emailMatch, matches.nameMatch].filter(Boolean).length;
        if (strongMatches >= 2 && matches.percentage >= 0.70) {
            return true;
        }

        // Rule 6: Don't consider duplicate if only partial name match without strong evidence
        if (matches.nameMatch && !matches.phoneMatch && !matches.emailMatch) {
            // Check if it's just a shared first name or single word
            const nameWords1 = newName.split(/\s+/).filter(w => w.length > 1);
            const nameWords2 = existingName.split(/\s+/).filter(w => w.length > 1);
            
            if (nameWords1.length <= 2 && nameWords2.length <= 2) {
                // For short names, require very high similarity
                return matches.percentage >= 0.95;
            }
            
            // For longer names, still require high similarity if only name matches
            return matches.percentage >= 0.85;
        }

        // Default: Not a duplicate
        return false;
    }
    
    /**
     * Check if two names are similar (handles variations)
     * @param {string} name1 - First name
     * @param {string} name2 - Second name
     * @returns {boolean} True if names are similar
     */

    /**
     * Score how "rich" a contact is based on how many distinct data fields it has.
     * Used to decide which version to keep when a duplicate is detected.
     * @param {Object} contact - Contact object
     * @returns {number} Richness score (higher = more data)
     */
    contactRichnessScore(contact) {
        try {
            const data = this.vCardStandard.extractDisplayData(contact, true, true);
            if (!data) return 0;
            let score = 0;
            score += (data.phones?.length  || 0) * 2;
            score += (data.emails?.length  || 0) * 2;
            score += (data.addresses?.length || 0) * 1.5;
            score += (data.urls?.length    || 0) * 1;
            score += data.organization ? 1 : 0;
            score += data.title        ? 1 : 0;
            score += data.note         ? 1 : 0;
            score += data.birthday     ? 1 : 0;
            score += data.photo        ? 2 : 0;
            return score;
        } catch {
            return 0;
        }
    }

    namesAreSimilar(name1, name2) {
        // Simple similarity checks
        const words1 = name1.split(/\s+/).filter(w => w.length > 1);
        const words2 = name2.split(/\s+/).filter(w => w.length > 1);
        
        // Check if any significant words match
        for (const word1 of words1) {
            for (const word2 of words2) {
                if (word1 === word2 && word1.length >= 3) {
                    return true;
                }
                // Check for common name variations
                if (this.isNameVariation(word1, word2)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Check for common name variations
     * @param {string} name1 - First name
     * @param {string} name2 - Second name
     * @returns {boolean} True if names are variations
     */
    isNameVariation(name1, name2) {
        const variations = {
            'john': ['jon', 'johnny', 'jack'],
            'michael': ['mike', 'mick'],
            'william': ['bill', 'will', 'billy'],
            'robert': ['rob', 'bob', 'bobby'],
            'richard': ['rick', 'dick', 'rich'],
            'james': ['jim', 'jimmy'],
            'thomas': ['tom', 'tommy'],
            'anthony': ['tony'],
            'elizabeth': ['liz', 'beth', 'betty'],
            'katherine': ['kate', 'katie', 'kathy'],
            'patricia': ['pat', 'patty', 'tricia'],
            'jennifer': ['jen', 'jenny']
        };
        
        for (const [full, shorts] of Object.entries(variations)) {
            if ((name1 === full && shorts.includes(name2)) || 
                (name2 === full && shorts.includes(name1))) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Import contact from vCard with duplicate detection
     * @param {string} vCardString - vCard string
     * @param {string} cardName - Optional card name
     * @param {boolean} markAsImported - Whether to mark contact as imported (default: true)
     * @param {boolean} skipDuplicateCheck - Skip duplicate detection (for CardDAV sync)
     * @returns {Promise<Object>} Import result with duplicate information
     */
    async importContactFromVCard(vCardString, cardName = null, markAsImported = true, skipDuplicateCheck = false) {
        try {
            const result = this.vCardStandard.importFromVCard(vCardString, cardName, markAsImported);
            
            // Extract contact from result object
            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'Failed to parse vCard'
                };
            }
            
            const contact = result.contact;
            
            // Generate contactId if missing
            if (!contact.contactId) {
                contact.contactId = this.vCardStandard.generateUID();
            }
            
            // Check for duplicates before saving (skip for CardDAV sync)
            if (!skipDuplicateCheck) {
                const similarContacts = this.findSimilarContacts(contact);
                
                if (similarContacts.length > 0) {
                const bestMatch = similarContacts[0];
                // Extract display data to get the contact name
                const displayData = this.vCardStandard.extractDisplayData(contact, true, true);
                const contactName = displayData?.fullName || contact.cardName || 'Unknown';
                console.log(`⚠️ Potential duplicate detected for ${contactName}:`);
                console.log(`   Existing: ${bestMatch.contact.cardName} (${Math.round(bestMatch.matchPercentage * 100)}% match)`);
                console.log(`   Matched fields:`, bestMatch.matchedFields);

                // Richness comparison: if the incoming contact has significantly more data
                // than the existing one, update the existing instead of blocking the import.
                const incomingRichness = this.contactRichnessScore(contact);
                const existingRichness = this.contactRichnessScore(bestMatch.contact);
                console.log(`   Richness — incoming: ${incomingRichness}, existing: ${existingRichness}`);

                if (incomingRichness > existingRichness * 1.3) {
                    // Incoming is at least 30% richer: update existing contact's vCard data
                    // while preserving its contactId, itemId and metadata.
                    console.log(`📈 Incoming is richer — updating existing contact instead of blocking`);
                    const mergedContact = { ...bestMatch.contact };
                    mergedContact.vCard = contact.vCard; // replace vCard payload with richer one
                    // Preserve original metadata flags
                    mergedContact.metadata = {
                        ...contact.metadata,
                        ...bestMatch.contact.metadata,
                        lastUpdated: new Date().toISOString()
                    };
                    try {
                        await this.database.updateContact(mergedContact);
                        this.contacts.set(mergedContact.contactId, mergedContact);
                        this.eventBus.emit('contact:updated', { contact: mergedContact });
                        console.log(`✅ Existing contact enriched with richer incoming data`);
                        return { success: true, contact: mergedContact, enriched: true };
                    } catch (updateErr) {
                        console.warn(`⚠️ Could not enrich existing contact:`, updateErr.message);
                        // Fall through to normal duplicate-block behaviour
                    }
                }

                    return {
                        success: false,
                        isDuplicate: true,
                        duplicateOf: bestMatch.contact,
                        matchScore: bestMatch.matchScore,
                        matchPercentage: bestMatch.matchPercentage,
                        matchedFields: bestMatch.matchedFields,
                        error: `Potential duplicate of existing contact: ${bestMatch.contact.cardName}`
                    };
                }
            }
            
            const saveResult = await this.database.saveContact(contact);
            
            if (saveResult.success) {
                // NOTE: Don't add to local cache here - let the database change handler
                // handle it to ensure itemId is properly set by Userbase
                // The database change handler will receive the contact with proper itemId
                
                this.clearSearchCache();
                this.eventBus.emit('contact:imported', { 
                    contact
                });
                return { ...saveResult, contact };
            }

            return saveResult;
        } catch (error) {
            console.error('Import contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Debug wrapper for contacts.set to track itemId issues
     */
    setContactInCache(contactId, contact, source = 'unknown') {
        if (!contact.itemId) {
            console.error(`🚨 WARNING: Storing contact WITHOUT itemId from ${source}:`, contactId);
            console.trace(`🚨 CALL STACK for itemId-less storage from ${source}:`);
        }
        
        this.contacts.set(contactId, contact);
    }
    getContact(contactId) {
        const contact = this.contacts.get(contactId);
        
        // Check if contact is missing itemId and warn
        if (contact && !contact.itemId) {
            console.error('🚨 CRITICAL: Contact retrieved from cache missing itemId!', contactId);
            console.trace('🚨 CALL STACK for missing itemId retrieval:');
        }
        
        return contact || null;
    }

    /**
     * Get contact by vCard UID (sync duplicate detection)
     */
    getContactByUID(uid) {
        // First try direct contactId match
        const directMatch = this.contacts.get(uid);
        if (directMatch) {
            return directMatch;
        }
        
        // Then search through vCard content for UID property
        for (const contact of this.contacts.values()) {
            if (contact.vcard) {
                const extractedUID = this.extractUIDFromVCard(contact.vcard);
                if (extractedUID === uid) {
                    return contact;
                }
            }
        }
        
        return null;
    }

    /**
     * Extract UID from vCard content
     */
    extractUIDFromVCard(vcard) {
        return ContactIdentifier.extractUIDFromVCard(vcard);
    }

    /**
     * Find contact by vCard UID (used for sync matching)
     * CRITICAL: Use UID matching instead of contactId for CardDAV sync
     * 
     * @param {string} uid - vCard UID to search for
     * @returns {Object|null} - Contact object or null
     */
    findContactByUID(uid) {
        return ContactIdentifier.findContactByUID(this.contacts.values(), uid);
    }

    /**
     * Extract name from vCard for display
     * @param {string} vcard - vCard string
     * @returns {string} - Extracted name
     */
    extractNameFromVCard(vcard) {
        if (!vcard) return null;
        
        const lines = vcard.split('\n');
        for (const line of lines) {
            if (line.startsWith('FN:')) {
                return line.substring(3).trim();
            }
        }
        return null;
    }

    /**
     * Get all owned and shared contacts eligible for CardDAV push
     * Per RFC 9553 sync strategy: both OWNED and SHARED contacts use Contact-Manager authority
     */
    getAllOwnedContacts() {
        const eligibleContacts = [];
        
        for (const [contactId, contact] of this.contacts.entries()) {
            if (!contact || !contact.metadata) continue;
            
            // Skip deleted and archived contacts
            if (contact.metadata.isDeleted || contact.metadata.isArchived) continue;
            
            // Include OWNED contacts (user created)
            const isOwned = contact.metadata.isOwned === true;
            
            // Include SHARED contacts (received from other users)
            // Per CardDAV sync strategy: SHARED contacts use Contact-Manager authority override
            const isShared = contactId.startsWith('shared_') || 
                           contact.metadata.isShared === true ||
                           contact.metadata.sharedBy;
            
            if (isOwned || isShared) {
                eligibleContacts.push(contact);
            }
        }
        
        console.log(`📋 Found ${eligibleContacts.length} contacts eligible for CardDAV push (owned + shared)`);
        return eligibleContacts;
    }

    /**
     * Get all contacts (owned and shared, excluding deleted)
     */
    getAllContacts() {
        const allContacts = [];
        
        for (const [contactId, contact] of this.contacts.entries()) {
            // Include all contacts that are not deleted
            if (contact && 
                contact.metadata && 
                !contact.metadata.isDeleted) {
                allContacts.push(contact);
            }
        }
        
        console.log(`📋 Found ${allContacts.length} total contacts (owned + shared)`);
        return allContacts;
    }

    /**
     * Load contacts from database
     */
    async loadContacts() {
        // Contacts are loaded via database change handlers
        // This method is here for explicit loading if needed
    }

    /**
     * Load user settings
     */
    async loadSettings() {
        // Settings are loaded via database change handlers
        // This method is here for explicit loading if needed
    }

    /**
     * Handle contacts changed event from database
     * @param {Object} data - Event data with contacts and metadata
     */
    async handleContactsChanged(data) {
        // Handle both old format (array) and new format (object)
        if (Array.isArray(data)) {
            // Old format - just contacts array
            data = { contacts: data, isOwned: true };
        }
        
        const { contacts = [], isOwned = true, sharedBy = null, databaseId = null } = data;
        
        // Ensure contacts is an array
        const contactsArray = Array.isArray(contacts) ? contacts : [];
        
        if (isOwned) {
            // Handle owned contacts - replace all owned contacts
            const ownedContactIds = Array.from(this.contacts.keys()).filter(id => {
                const contact = this.contacts.get(id);
                return contact.metadata.isOwned;
            });
            
            // Remove old owned contacts
            ownedContactIds.forEach(id => this.contacts.delete(id));
            
            // Add new owned contacts
            contactsArray.forEach(contact => {
                // CRITICAL: Preserve the Userbase itemId before any processing
                const originalItemId = contact.itemId;
                
                // Ensure owned contacts have correct metadata and preserve itemId
                const processedContact = {
                    ...contact,
                    itemId: originalItemId, // Explicitly preserve itemId
                    metadata: {
                        ...contact.metadata,
                        isOwned: true,
                        sharedBy: null,
                        databaseId: null
                    }
                };
                
                // Validate itemId is present
                if (!processedContact.itemId) {
                    console.error('❌ Contact missing itemId:', contact.contactId);
                    // For newly created contacts, itemId should equal contactId
                    processedContact.itemId = contact.contactId;
                }
                
                // Store the contact in cache
                this.setContactInCache(processedContact.contactId, processedContact, 'handleContactsChanged');
                
                // Deep verify storage by checking the stored contact
                const storedContact = this.getContact(processedContact.contactId);
                if (storedContact === processedContact) {
                } else {
                    console.error('❌ Different object reference - possible mutation!');
                }
            });
            
        } else {
            // Handle shared contacts from a specific user
            
            // 🐛 BUG FIX: Build map of incoming contacts to detect actual revocations
            const incomingContactIds = new Set(
                contactsArray.map(c => `shared_${sharedBy}_${c.contactId}`)
            );
            
            // Find contacts that exist locally but are NOT in the incoming batch
            // These are the ACTUALLY REVOKED contacts
            const oldSharedContactIds = Array.from(this.contacts.keys()).filter(id => {
                const contact = this.contacts.get(id);
                return !contact.metadata.isOwned && 
                       contact.metadata.sharedBy === sharedBy &&
                       contact.metadata.databaseId === databaseId &&
                       !incomingContactIds.has(id);  // ✅ CRITICAL: Only if NOT in incoming batch
            });
            
            if (oldSharedContactIds.length > 0) {
                console.log(`ℹ️ ${oldSharedContactIds.length} shared contact(s) removed by sharer`);
            }
            
            oldSharedContactIds.forEach(id => this.contacts.delete(id));
            
            // Add new shared contacts
            contactsArray.forEach(contact => {
                // CRITICAL: Preserve the Userbase itemId before any processing
                const originalItemId = contact.itemId;
                const originalContactId = contact.contactId;
                
                // Validate that we have the essential identifiers
                if (!originalItemId) {
                    console.error('❌ CRITICAL: Shared contact missing itemId:', contact);
                    console.error('❌ Contact data keys:', Object.keys(contact));
                    return; // Skip this contact if it's missing itemId
                }
                
                if (!originalContactId) {
                    console.error('❌ CRITICAL: Shared contact missing contactId:', contact);
                    return; // Skip this contact if it's missing contactId
                }
                
                // Create unique ID for shared contacts to avoid conflicts
                const sharedContactId = `shared_${sharedBy}_${originalContactId}`;
                
                // Create new contact object to avoid modifying the original
                const processedContact = {
                    ...contact,
                    contactId: sharedContactId,
                    itemId: originalItemId, // Explicitly preserve itemId
                    metadata: {
                        ...contact.metadata,
                        isOwned: false,
                        isImported: false, // Clear isImported flag for shared contacts
                        sharedBy: sharedBy,
                        databaseId: databaseId,
                        originalContactId: originalContactId  // Store original ID for reference
                    }
                };
                
                // Final validation before storing
                if (!processedContact.itemId) {
                    console.error('❌ CRITICAL: Processed shared contact lost itemId during creation!', {
                        sharedContactId,
                        originalItemId,
                        processedContact: Object.keys(processedContact)
                    });
                    return; // Skip storing this contact
                }
                
                this.contacts.set(sharedContactId, processedContact);
            });
            
            // Load and merge user's metadata for shared contacts
            await this.loadAndMergeSharedContactMetadata();
        }

        // Clear search cache
        this.clearSearchCache();

        // Emit update event
        this.eventBus.emit('contactManager:contactsUpdated', {
            contactCount: this.contacts.size,
            contacts: Array.from(this.contacts.values())
        });
    }

    /**
     * Handle settings changed event from database
     * @param {Array} settings - Updated settings array
     */
    handleSettingsChanged(settings) {
        if (settings.length > 0) {
            this.settings = settings[0]; // There should be only one settings object
            this.eventBus.emit('contactManager:settingsUpdated', { settings: this.settings });
        }
    }

    /**
     * Handle user signed out event - clear all cached data
     * @param {Object} data - Sign out event data
     */
    handleSignedOut(data) {
        // Clear all cached contact data
        this.contacts.clear();
        
        // Reset all state variables
        this.settings = {};
        this.isLoaded = false;
        // Clear search cache
        this.searchCache.clear();
        this.lastSearchQuery = '';
        
        // Emit empty contacts changed event to update UI
        this.eventBus.emit('contacts:changed', { 
            contacts: [], 
            reason: 'signed_out' 
        });
        
        // Emit settings cleared event
        this.eventBus.emit('contactManager:settingsUpdated', { 
            settings: {} 
        });
    }

    /**
     * Clear search cache
     */
    clearSearchCache() {
        this.searchCache.clear();
    }

    /**
     * Check if user can edit contact
     * @param {Object} contact - Contact object
     * @returns {boolean} Can edit
     */
    canEditContact(contact) {
        return contact.metadata?.isOwned === true;
    }

    /**
     * Check if user can delete contact
     * @param {Object} contact - Contact object
     * @returns {boolean} Can delete
     */
    canDeleteContact(contact) {
        // SYNC_RULES.md section 4.1 / Decision 1: green (shared) cards are
        // delete-authoritative on the owner side only (revoke). The recipient
        // archives a shared card instead of deleting it. Contacts without an
        // isOwned flag (legacy) are treated as owned.
        return contact.metadata?.isOwned !== false;
    }

    /**
     * Get distribution list counts
     * @returns {Object} Distribution list statistics
     */
    getDistributionListCounts() {
        const counts = {};
        Array.from(this.contacts.values())
            .filter(c => !c.metadata.isDeleted && !c.metadata.isArchived)
            .forEach(contact => {
                contact.metadata.distributionLists?.forEach(list => {
                    counts[list] = (counts[list] || 0) + 1;
                });
            });
        
        // Convert to array format expected by UI
        return Object.entries(counts).map(([name, count]) => ({
            name,
            count
        }));
    }

    /**
     * Get changed fields between two contacts
     * @param {Object} oldContact - Original contact
     * @param {Object} newContact - Updated contact
     * @returns {Array} Array of changed fields
     */
    getChangedFields(oldContact, newContact) {
        const changes = [];
        
        if (oldContact.cardName !== newContact.cardName) changes.push('cardName');
        if (oldContact.vcard !== newContact.vcard) changes.push('vcard');
        
        return changes;
    }

    /**
     * Add interaction to contact history with memory-efficient management
     * @param {Object} contact - Contact object
     * @param {string} action - Action type (viewed, edited, metadata_updated, etc.)
     * @param {Object} details - Action details
     * @returns {void}
     */
    addInteractionHistory(contact, action, details = {}) {
        // Validate input
        if (!contact || typeof contact !== 'object') {
            console.warn('⚠️ Invalid contact object for interaction history');
            return;
        }

        // Ensure metadata structure exists (fail-safe initialization)
        if (!contact.metadata) {
            contact.metadata = {};
        }
        if (!contact.metadata.usage) {
            contact.metadata.usage = {};
        }
        if (!contact.metadata.usage.interactionHistory) {
            contact.metadata.usage.interactionHistory = [];
        }

        // Create minimal interaction entry (memory optimization)
        const interaction = {
            action,
            timestamp: new Date().toISOString()
        };

        // Only include userId if available (save space)
        if (this.database.currentUser?.userId) {
            interaction.userId = this.database.currentUser.userId;
        }

        // Only include essential details (filter out undefined/null)
        const essentialDetails = {};
        if (details && typeof details === 'object') {
            for (const [key, value] of Object.entries(details)) {
                if (value !== undefined && value !== null) {
                    essentialDetails[key] = value;
                }
            }
            if (Object.keys(essentialDetails).length > 0) {
                Object.assign(interaction, essentialDetails);
            }
        }

        // Add to history
        contact.metadata.usage.interactionHistory.push(interaction);

        // MEMORY OPTIMIZATION: Keep only last 5 interactions (down from 50)
        // Rationale: 5 entries = ~250 bytes vs 50 entries = ~2500 bytes
        const MAX_HISTORY_ENTRIES = 5;
        if (contact.metadata.usage.interactionHistory.length > MAX_HISTORY_ENTRIES) {
            contact.metadata.usage.interactionHistory = 
                contact.metadata.usage.interactionHistory.slice(-MAX_HISTORY_ENTRIES);
        }
    }

    /**
     * Update contact metadata without changing vCard data
     * @param {string} contactId - Contact ID
     * @param {Object} updates - Metadata updates
     * @returns {Promise<Object>} Update result
     */
    async updateContactMetadata(contactId, updates) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) {
                throw new Error('Contact not found');
            }
            
            if (!contact.itemId) {
                console.error('❌ Contact missing itemId in updateContactMetadata:', contactId);
                throw new Error('Contact missing itemId, cannot update');
            }

            console.log('🔄 Updating contact metadata for:', contactId, 'itemId:', contact.itemId);

            // 🔧 DEEP MERGE: Recursively merge nested metadata objects
            // This fixes the bug where updating sharing.sharedWithUsers would replace entire metadata
            const deepMergeMetadata = (target, source) => {
                const result = { ...target };
                
                for (const key in source) {
                    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        // Recursively merge nested objects
                        result[key] = deepMergeMetadata(target[key] || {}, source[key]);
                    } else {
                        // Direct assignment for primitives and arrays
                        result[key] = source[key];
                    }
                }
                
                return result;
            };

            // Update contact with new metadata using deep merge
            const updatedContact = {
                ...contact,
                ...updates,
                metadata: {
                    ...deepMergeMetadata(contact.metadata, updates.metadata || {}),
                    lastUpdated: new Date().toISOString(),
                    lastUpdatedBy: this.database.currentUser?.username || 'unknown'
                }
            };
            if (Object.hasOwn(updates.metadata || {}, 'sharing')) {
                // A revocation is a complete snapshot; deep merge would retain removed permission keys.
                updatedContact.metadata.sharing = updates.metadata.sharing;
            }

            // 🎯 OPTIMIZE: Trim metadata before saving to avoid 10KB limit
            const optimizedContact = await this.database.optimizeContactForStorage(updatedContact);

            // Save to database (no retry - conflicts indicate real race conditions that should fail)
            const saveResult = await this.database.updateContact(optimizedContact);
            if (!saveResult.success) {
                throw new Error(saveResult.error);
            }

            // Update local cache with optimized contact
            this.contacts.set(contactId, optimizedContact);

            // Add interaction history (using optimized contact)
            this.addInteractionHistory(optimizedContact, 'metadata_updated', {
                fields: Object.keys(updates.metadata || {}),
                updatedBy: this.database.currentUser?.username
            });

            this.eventBus.emit('contact:updated', { 
                contact: optimizedContact,
                changes: Object.keys(updates.metadata || [])
            });

            console.log('✅ Contact metadata updated:', contact.cardName);
            return { success: true, contact: optimizedContact };

        } catch (error) {
            console.error('❌ Update contact metadata failed:', error);
            this.eventBus.emit('contact:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Revoke one recipient's access and remove them from the owner's sharing metadata.
     */
    async revokeContactSharing(contactId, username) {
        const normalizedUsername = typeof username === 'string' ? username.trim() : '';
        if (!contactId || !normalizedUsername) {
            return { success: false, error: 'Contact ID and username are required' };
        }

        const contact = this.getContact(contactId);
        if (!contact || !this.canEditContact(contact)) {
            return { success: false, error: 'Can only revoke sharing for contacts you own' };
        }

        try {
            const revokeResult = await this.database.revokeIndividualContactAccess(contactId, normalizedUsername);
            if (!revokeResult.success) {
                return revokeResult;
            }

            const revokedAt = new Date().toISOString();
            const revokedBy = this.database.currentUser?.username || 'unknown';
            const maxRetries = 3;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const latestContact = this.getContact(contactId);
                if (!latestContact) {
                    return {
                        success: false,
                        accessRevoked: true,
                        error: 'Access was revoked, but the contact is no longer available to update'
                    };
                }

                const sharing = latestContact.metadata?.sharing || {};
                const sharedWithUsers = Array.isArray(sharing.sharedWithUsers)
                    ? sharing.sharedWithUsers
                    : [];
                if (!sharedWithUsers.includes(normalizedUsername)) {
                    return {
                        success: true,
                        message: `Sharing revoked from ${normalizedUsername}`,
                        details: {
                            username: normalizedUsername,
                            revokedAt,
                            remainingShares: sharedWithUsers.length,
                            databaseRevoked: true,
                            metadataUpdated: true
                        }
                    };
                }

                const remainingUsers = sharedWithUsers.filter(user => user !== normalizedUsername);
                const sharePermissions = { ...(sharing.sharePermissions || {}) };
                delete sharePermissions[normalizedUsername];

                const revokedFrom = Array.isArray(latestContact.metadata.revokedFrom)
                    ? latestContact.metadata.revokedFrom
                    : [];
                const updateResult = await this.updateContactMetadata(contactId, {
                    metadata: {
                        sharing: {
                            ...sharing,
                            sharedWithUsers: remainingUsers,
                            sharePermissions,
                            isShared: remainingUsers.length > 0,
                            shareCount: remainingUsers.length
                        },
                        revokedFrom: [...revokedFrom, {
                            username: normalizedUsername,
                            revokedAt,
                            revokedBy
                        }]
                    }
                });

                const savedUsers = updateResult.contact?.metadata?.sharing?.sharedWithUsers;
                if (updateResult.success &&
                    Array.isArray(savedUsers) &&
                    !savedUsers.includes(normalizedUsername)) {
                    return {
                        success: true,
                        message: `Sharing revoked from ${normalizedUsername}`,
                        details: {
                            username: normalizedUsername,
                            revokedAt,
                            remainingShares: remainingUsers.length,
                            databaseRevoked: true,
                            metadataUpdated: true
                        }
                    };
                }

                const error = updateResult.error || 'Sharing metadata was not updated';
                const isConflict = /conflict/i.test(error);
                if (!isConflict || attempt === maxRetries) {
                    return {
                        success: false,
                        accessRevoked: true,
                        error: `Access was revoked, but the sharing list could not be updated: ${error}`
                    };
                }

                await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
            }

            return {
                success: false,
                accessRevoked: true,
                error: 'Access was revoked, but the sharing list could not be updated'
            };
        } catch (error) {
            console.error('❌ Failed to revoke contact sharing:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Load shared contact metadata from user's metadata database and merge with contacts
     */
    async loadAndMergeSharedContactMetadata() {
        try {
            const metadataMap = await this.database.getAllSharedContactMetadata();
            
            // Merge metadata with shared contacts in cache
            for (const [sharedContactId, contact] of this.contacts.entries()) {
                if (sharedContactId.startsWith('shared_') && metadataMap.has(sharedContactId)) {
                    const userMetadata = metadataMap.get(sharedContactId);
                    
                    // Merge user-specific metadata with contact
                    const updatedContact = {
                        ...contact,
                        itemId: contact.itemId, // Explicitly preserve itemId
                        metadata: {
                            ...contact.metadata,
                            // User-specific states
                            isArchived: userMetadata.isArchived || false,
                            archivedAt: userMetadata.archivedAt,
                            archivedBy: userMetadata.archivedBy,
                            archiveReason: userMetadata.archiveReason,
                            // User-specific usage tracking
                            usage: {
                                ...contact.metadata.usage,
                                ...(userMetadata.usage || {})
                            },
                            lastAccessedAt: userMetadata.lastAccessedAt || contact.metadata.lastAccessedAt
                        }
                    };
                    
                    // Validate itemId is still present after merge
                    if (!updatedContact.itemId) {
                        console.error('❌ CRITICAL: Lost itemId during metadata merge for:', sharedContactId);
                        console.error('❌ Original contact itemId:', contact.itemId);
                        // Restore the itemId
                        updatedContact.itemId = contact.itemId;
                    }
                    
                    this.contacts.set(sharedContactId, updatedContact);
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to load shared contact metadata:', error);
        }
    }

    /**
     * Create a new distribution list
     * @param {Object} listData - Distribution list data
     * @returns {Promise<Object>} Creation result
     */
    async createDistributionList(listData) {
        try {
            // Validate list data
            if (!listData.name || typeof listData.name !== 'string') {
                return { success: false, error: 'List name is required' };
            }
            
            const listName = listData.name.trim();
            if (listName.length === 0) {
                return { success: false, error: 'List name cannot be empty' };
            }
            
            // Get current settings and existing lists
            const currentSettings = await this.database.getSettings() || {};
            
            let distributionLists = currentSettings.distributionLists || {};
            
            // Defensive programming: ensure distributionLists is an object
            if (Array.isArray(distributionLists)) {
                console.warn('📋 [DEBUG] Found distributionLists as array, converting to object');
                distributionLists = {};
                // Save corrected structure
                await this.database.updateSettings({
                    ...currentSettings,
                    distributionLists
                });
            } else if (typeof distributionLists !== 'object') {
                console.warn('📋 [DEBUG] Invalid distributionLists type, resetting to empty object');
                distributionLists = {};
                // Save corrected structure
                await this.database.updateSettings({
                    ...currentSettings,
                    distributionLists
                });
            }
            
            console.log('📋 [DEBUG] Current distribution lists after validation:', Object.keys(distributionLists));
            console.log('📋 [DEBUG] Distribution lists type after validation:', typeof distributionLists);
            console.log('📋 [DEBUG] Distribution lists structure after validation:', distributionLists);
            
            // Check if list already exists (case-insensitive)
            const existingListKey = Object.keys(distributionLists).find(key => 
                key.toLowerCase() === listName.toLowerCase());
            
            if (existingListKey) {
                console.log('📋 [DEBUG] List already exists:', existingListKey);
                return { success: false, error: 'A list with this name already exists' };
            }
            
            // Create the list metadata
            const listMetadata = {
                name: listName,
                description: listData.description || '',
                color: listData.color || '#007bff',
                createdAt: new Date().toISOString(),
                createdBy: this.database.getCurrentUser()?.username || 'unknown',
                usernames: []  // Initialize empty usernames array
            };
            
            console.log('📋 [DEBUG] Created list metadata:', listMetadata);
            
            // Add to existing distribution lists
            distributionLists[listName] = listMetadata;
            console.log('📋 [DEBUG] Updated distribution lists object:', distributionLists);
            console.log('📋 [DEBUG] Distribution lists keys after addition:', Object.keys(distributionLists));
            
            const settingsToUpdate = {
                ...currentSettings,
                distributionLists
            };
            console.log('📋 [DEBUG] Settings to update:', settingsToUpdate);
            console.log('📋 [DEBUG] Distribution lists in settings to update:', settingsToUpdate.distributionLists);
            
            const updateResult = await this.database.updateSettings(settingsToUpdate);
            console.log('📋 [DEBUG] Update result:', updateResult);
            
            if (updateResult) {
                console.log('✅ [DEBUG] Distribution list created successfully:', listMetadata);
                
                // Verify the update by getting settings again
                console.log('📋 [DEBUG] Verifying creation by re-fetching settings...');
                const verificationSettings = await this.database.getSettings();
                console.log('📋 [DEBUG] Verification settings:', verificationSettings);
                console.log('📋 [DEBUG] Verification distribution lists:', verificationSettings?.distributionLists);
                
                // Emit event for UI updates
                this.eventBus.emit('distributionList:created', { list: listMetadata });
                
                return { success: true, list: listMetadata };
            } else {
                console.error('❌ [DEBUG] Failed to save distribution list - updateSettings returned false');
                return { success: false, error: 'Failed to save distribution list' };
            }
            
        } catch (error) {
            console.error('❌ Error creating distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all distribution lists with metadata
     * @returns {Promise<Array>} Array of distribution list objects
     */
    async getDistributionLists() {
        try {
            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            
            // Convert to array with user counts (not contact counts)
            const lists = Object.values(distributionLists).map(list => {
                return {
                    ...list,
                    userCount: list.usernames ? list.usernames.length : 0, // Count usernames instead of contacts
                    contactCount: 0 // Legacy support - will be removed
                };
            });
            
            const sortedLists = lists.sort((a, b) => a.name.localeCompare(b.name));
            
            return sortedLists;
            
        } catch (error) {
            console.error('❌ [DEBUG] Error getting distribution lists:', error);
            console.error('❌ [DEBUG] Error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            return [];
        }
    }

    /**
     * Remove a contact from a distribution list
     * @param {string} contactId - ID of the contact to remove
     * @param {string} listName - Name of the distribution list
     * @returns {Promise<Object>} Removal result
     */
    async removeContactFromDistributionList(contactId, listName) {
        try {
            console.log('📝 Removing contact from distribution list:', contactId, listName);
            
            // Get the contact
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Contact not found' };
            }
            
            // Remove from list if present
            if (contact.metadata.distributionLists && 
                contact.metadata.distributionLists.includes(listName)) {
                
                contact.metadata.distributionLists = contact.metadata.distributionLists
                    .filter(list => list !== listName);
                contact.metadata.lastUpdated = new Date().toISOString();
                
                // Update the contact (not save as new)
                await this.database.updateContact(contact);
                
                // Update local cache
                this.contacts.set(contactId, contact);
                
                console.log('✅ Contact removed from distribution list successfully');
                this.eventBus.emit('contact:updated', { contact });
                this.eventBus.emit('distributionList:contactRemoved', { contactId, listName });
                
                return { success: true };
            } else {
                return { success: false, error: 'Contact not in this distribution list' };
            }
            
        } catch (error) {
            console.error('❌ Error removing contact from distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a distribution list
     * @param {string} listName - Name of the list to delete
     * @returns {Promise<Object>} Deletion result
     */
    async deleteDistributionList(listName) {
        console.log('�🚨🚨 FORCE RELOAD: Browser cache cleared - deleteDistributionList method starting for:', listName);
        try {
            console.log('🗑️ Deleting distribution list:', listName);
            
            // Remove from settings
            const currentSettings = await this.database.getSettings() || {};
            const distributionLists = currentSettings.distributionLists || {};
            
            if (!distributionLists[listName]) {
                return { success: false, error: 'Distribution list not found' };
            }
            
            delete distributionLists[listName];
            
            const updateResult = await this.database.updateSettings({
                ...currentSettings,
                distributionLists
            });
            
            console.log('🔍 updateResult from database:', updateResult);
            
            if (updateResult) { // updateSettings returns boolean, not {success: true}
                console.log('✅ Database update successful, removing list from contacts...');
                
                // Remove the list from all contacts
                for (const contact of this.contacts.values()) {
                    if (contact.metadata.distributionLists?.includes(listName)) {
                        console.log('🔄 Removing list from contact:', contact.cardName);
                        const updatedLists = contact.metadata.distributionLists.filter(l => l !== listName);
                        await this.updateContact(contact.contactId, {
                            distributionLists: updatedLists
                        });
                    }
                }
                
                console.log('✅ Distribution list deleted successfully');
                this.eventBus.emit('distributionList:deleted', { listName });
                
                return { success: true };
            } else {
                console.log('❌ Database update failed');
                return { success: false, error: 'Failed to delete distribution list' };
            }
            
        } catch (error) {
            console.error('❌ Error deleting distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all contacts assigned to distribution lists with list info
     * @returns {Array} Array of contacts with their distribution list assignments
     */
    getContactsWithDistributionLists() {
        const contacts = [];
        
        for (const contact of this.contacts.values()) {
            if (!contact.metadata?.isDeleted) {
                contacts.push({
                    ...contact,
                    assignedLists: contact.metadata?.distributionLists || []
                });
            }
        }
        
        return contacts;
    }

    /**
     * Add username to distribution list
     */
    async addUsernameToDistributionList(listName, username) {
        try {
            const normalizedUsername = typeof username === 'string' ? username.trim() : '';
            if (!normalizedUsername) {
                return { success: false, error: 'Username is required' };
            }

            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            const list = distributionLists[listName];
            if (!list) {
                throw new Error(`Distribution list "${listName}" not found`);
            }

            const usernames = Array.isArray(list.usernames) ? list.usernames : [];
            if (usernames.includes(normalizedUsername)) {
                return { success: true, alreadyExists: true };
            }

            const updatedSettings = {
                ...settings,
                distributionLists: {
                    ...distributionLists,
                    [listName]: {
                        ...list,
                        usernames: [...usernames, normalizedUsername]
                    }
                }
            };
            const updated = await this.database.updateSettings(updatedSettings);
            if (!updated) {
                throw new Error('Failed to update distribution list');
            }

            this.eventBus.emit('distributionListsUpdated');
            return { success: true };
        } catch (error) {
            console.error('❌ Error adding username to distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove username from distribution list
     */
    async removeUsernameFromDistributionList(listName, username) {
        try {
            const normalizedUsername = typeof username === 'string' ? username.trim() : '';
            if (!normalizedUsername) {
                return { success: false, error: 'Username is required' };
            }

            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};

            const list = distributionLists[listName];
            if (!list || !Array.isArray(list.usernames)) {
                return { success: true, message: 'Username not in list' };
            }

            if (!list.usernames.includes(normalizedUsername)) {
                return { success: true, message: 'Username not in list' };
            }

            const updatedSettings = {
                ...settings,
                distributionLists: {
                    ...distributionLists,
                    [listName]: {
                        ...list,
                        usernames: list.usernames.filter(name => name !== normalizedUsername)
                    }
                }
            };

            if (!await this.database.updateSettings(updatedSettings)) {
                throw new Error('Failed to update distribution list');
            }

            console.log(`✅ Removed username "${normalizedUsername}" from distribution list "${listName}"`);

            // Existing contact shares are independent of later group membership changes.
            this.eventBus.emit('distributionListsUpdated');

            return { success: true };
        } catch (error) {
            console.error('❌ Error removing username from distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify user using their verification message
     * @param {string} verificationMessage - Verification message from the user being verified
     * @returns {Promise<Object>} Verification result
     */
    async verifyUser(verificationMessage) {
        return await this.database.verifyUser(verificationMessage);
    }

    /**
     * Get current user's verification message for sharing with others
     * @returns {Promise<Object>} Verification message result
     */
    async getVerificationMessage() {
        return await this.database.getVerificationMessage();
    }

    /**
     * Share individual contact with another user
     * @param {string} contactId - Contact ID to share
     * @param {string} username - Username to share with
     * @returns {Promise<Object>} Share result
     */
    async shareContact(contactId, username) {
        try {
            console.log('🔄 ContactManager: Sharing contact:', contactId, 'with user:', username);
            
            // Get the contact - retry a few times to handle race conditions
            let contact;
            let retries = 3;
            while (retries > 0) {
                contact = this.contacts.get(contactId);
                console.log(`🔍 Contact retrieval attempt ${4-retries}: contact found:`, !!contact, 'itemId present:', !!contact?.itemId);
                if (contact?.itemId) {
                    console.log('🔍 Contact object structure:', {
                        contactId: contact.contactId,
                        itemId: contact.itemId,
                        cardName: contact.cardName,
                        hasMetadata: !!contact.metadata,
                        isOwned: contact.metadata?.isOwned
                    });
                }
                if (contact && contact.itemId) {
                    break; // Contact found with itemId
                }
                console.log(`⏳ Contact not ready for sharing (attempt ${4-retries}/3), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
                retries--;
            }
            
            if (!contact) {
                throw new Error(`Contact not found: ${contactId}`);
            }
            
            if (!contact.itemId) {
                console.error('❌ Contact missing itemId:', contact);
                throw new Error(`Contact ${contactId} missing itemId, cannot share. Contact may need to be recreated.`);
            }
            
            console.log('✅ Contact ready for sharing - itemId:', contact.itemId);
            
            // Check if it's a shared contact - we can't share shared contacts
            if (contactId.startsWith('shared_')) {
                throw new Error('Cannot share contacts that were shared with you');
            }
            
            // TODO(orange-copy, docs/SYNC_RULES.md section 6 / Decision 3):
            // Sharing an IMPORTED (orange) card is not yet implemented. Per
            // the sync rules it must be a one-time copy transfer, not a share:
            // the recipient receives an independent orange card (isImported,
            // owned by the recipient, no live link, no sharedBy, re-shareable)
            // and rule 3 (owner-only edits) never applies to it. Green shares
            // may only ever originate from blue (owned, !isImported) cards.
            // When implementing: branch here on contact.metadata.isImported and
            // route to the copy path; keep the failing orange-copy integration
            // test in sync (see SYNC_RULES.md section 10, action items).
            
            // Check if already shared with this user
            const currentSharedUsers = contact.metadata.sharing?.sharedWithUsers || [];
            const isAlreadyShared = currentSharedUsers.includes(username);
            
            if (isAlreadyShared) {
                console.log('ℹ️ Contact already shared with user:', username, '- checking database state');

                // Check if the shared database actually contains the contact
                const cleanContactId = this.sanitizeContactId(contactId);
                const sharedDbName = `shared-contact-${cleanContactId}-to-${username.trim()}`;
                
                let needsContactData = false;
                try {
                    // Use proper method to check database items via openDatabase
                    const dbItems = await new Promise((resolve, reject) => {
                        userbase.openDatabase({
                            databaseName: sharedDbName,
                            changeHandler: (items) => resolve(items)
                        }).catch(reject);
                    });
                    
                    const hasContact = dbItems?.some(item => 
                        item.itemId === contactId || 
                        item.item?.contactId === contactId ||
                        item.item?.metadata?.originalContactId === contactId
                    );
                    
                    if (!hasContact) {
                        needsContactData = true;
                        console.log('⚠️ Shared database exists but is empty - will populate with contact data');
                    } else {
                        console.log('✅ Shared database contains contact data - checking user access...');
                        
                        // Even if contact data exists, verify user has access
                        try {
                            await this.database.safeShareDatabase({
                                databaseName: sharedDbName,
                                username: username.trim(),
                                readOnly: true,
                                resharingAllowed: false
                                // requireVerified defaults to true for security ✅
                            }, 'shareContact:verify-access');
                            console.log('✅ User access verified/granted');
                        } catch (shareError) {
                            // User doesn't have access - account was recreated
                            console.error('⚠️ User cannot access database:', shareError.message);
                            console.log('🔄 ACCOUNT RECREATION DETECTED - forcing fresh share...');
                            
                            // Remove from metadata and force fresh share
                            const cleanedSharedUsers = currentSharedUsers.filter(u => u !== username);
                            const cleanedContact = {
                                ...contact,
                                metadata: {
                                    ...contact.metadata,
                                    sharing: {
                                        ...contact.metadata.sharing,
                                        sharedWithUsers: cleanedSharedUsers,
                                        shareCount: cleanedSharedUsers.length
                                    }
                                }
                            };
                            await this.updateContact(contactId, cleanedContact);
                            this.contacts.set(contactId, cleanedContact);
                            
                            // Delete old database
                            try {
                                await window.userbase.deleteDatabase({ databaseName: sharedDbName });
                                console.log('✅ Deleted old sharing database');
                            } catch (deleteError) {
                                console.warn('⚠️ Could not delete old database:', deleteError.message);
                            }
                            
                            // Recursively call to create fresh share
                            console.log('🔄 Creating fresh share...');
                            return await this.shareContact(contactId, username);
                        }
                    }
                } catch (error) {
                    needsContactData = true;
                    console.log('⚠️ Cannot access shared database - will re-share contact:', error.message);
                }
                
                // If database is empty, insert the contact data
                if (needsContactData) {
                    console.log('🔄 Re-populating empty shared database with contact data');
                    try {
                        // Use the validated SDK wrapper to insert contact
                        await this.database.safeInsertItem({
                            databaseName: sharedDbName,
                            itemId: contactId,
                            item: contact
                        }, 'shareContact:repopulate');
                        console.log('✅ Contact data inserted into previously empty shared database');
                        
                        // CRITICAL: Grant access to the user
                        console.log('🔐 Granting database access to user:', username);
                        try {
                            await this.database.safeShareDatabase({
                                databaseName: sharedDbName,
                                username: username.trim(),
                                readOnly: true,
                                resharingAllowed: false
                                // requireVerified defaults to true for security ✅
                            }, 'shareContact:grant-access');
                            console.log('✅ Database access granted to user:', username);
                        } catch (shareError) {
                            // User account was recreated - old database is tied to old user ID
                            // Need to delete old database and create fresh share
                            console.error('⚠️ Cannot grant access to existing database:', shareError.message);
                            console.log('🔄 ACCOUNT RECREATION DETECTED - Cleaning up and forcing fresh share...');
                            
                            // Step 1: Remove user from metadata to bypass "already shared" check
                            const cleanedSharedUsers = currentSharedUsers.filter(u => u !== username);
                            const cleanedContact = {
                                ...contact,
                                metadata: {
                                    ...contact.metadata,
                                    sharing: {
                                        ...contact.metadata.sharing,
                                        sharedWithUsers: cleanedSharedUsers,
                                        shareCount: cleanedSharedUsers.length
                                    }
                                }
                            };
                            await this.updateContact(contactId, cleanedContact);
                            this.contacts.set(contactId, cleanedContact);
                            
                            // Step 2: Delete the old database
                            try {
                                await window.userbase.deleteDatabase({
                                    databaseName: sharedDbName
                                });
                                console.log('✅ Deleted old sharing database');
                            } catch (deleteError) {
                                console.warn('⚠️ Could not delete old database (may not exist):', deleteError.message);
                            }
                            
                            // Step 3: Recursively call shareContact to create fresh share
                            console.log('🔄 Creating fresh share with recreated user account...');
                            return await this.shareContact(contactId, username);
                        }
                        
                    } catch (insertError) {
                        if (insertError.message.includes('Item with the same id already exists')) {
                            console.log('ℹ️ Contact already exists in shared database - proceeding with permission update');
                        } else {
                            console.error('❌ Failed to populate shared database:', insertError.message);
                        }
                        // Continue with permission update even if insert fails
                    }
                }
                
                // Update permissions and return (normal "already shared" path)
                const contactWithUpdatedPermissions = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        sharing: {
                            ...contact.metadata.sharing,
                            sharePermissions: {
                                ...contact.metadata.sharing?.sharePermissions,
                                [username]: {
                                    ...contact.metadata.sharing?.sharePermissions?.[username],
                                        level: 'readOnly',
                                    lastUpdated: new Date().toISOString(),
                                        canReshare: false
                                }
                            }
                        }
                        // ⚠️ IMPORTANT: DO NOT update contact's lastUpdated when only changing sharing permissions
                    }
                };
                
                await this.updateContact(contactId, contactWithUpdatedPermissions);
                
                return {
                    success: true,
                    message: needsContactData ? 
                        `Re-shared and updated permissions for ${username}` : 
                        `Permissions updated for ${username}`,
                    action: needsContactData ? 'reshared' : 'updated'
                }
            }
            
            // Share using individual sharing strategy only (no group databases)
            const result = await this.database.shareContactIndividually(contact, username);
            
            if (result.success) {
                // 🔧 CRITICAL FIX: Get fresh contact from cache to avoid race conditions
                // When sharing in a loop, we need the latest state with previous shares
                const freshContact = this.contacts.get(contactId);
                const currentSharedUsers = freshContact.metadata.sharing?.sharedWithUsers || [];
                const uniqueSharedUsers = [...new Set([...currentSharedUsers, username])];
                
                console.log(`🔍 Sharing metadata update: current users: ${JSON.stringify(currentSharedUsers)}, adding: ${username}, result: ${JSON.stringify(uniqueSharedUsers)}`);
                
                // Update contact metadata to track sharing (use freshContact!)
                const updatedContact = {
                    ...freshContact,  // ← Use FRESH contact, not stale one
                    metadata: {
                        ...freshContact.metadata,  // ← Use FRESH metadata
                        sharing: {
                            ...freshContact.metadata.sharing,  // ← Use FRESH sharing
                            isShared: true,
                            sharedWithUsers: uniqueSharedUsers,
                            shareCount: uniqueSharedUsers.length, // 🔧 ADD MISSING shareCount
                            sharePermissions: {
                                ...freshContact.metadata.sharing?.sharePermissions,  // ← Use FRESH permissions
                                [username]: {
                                    level: 'readOnly',
                                    sharedAt: new Date().toISOString(),
                                    sharedBy: this.database.currentUser?.username,
                                    canReshare: false
                                }
                            },
                            shareHistory: [
                                ...(freshContact.metadata.sharing?.shareHistory || []),  // ← Use FRESH history
                                {
                                    action: 'shared',
                                    targetUser: username,
                                    timestamp: new Date().toISOString(),
                                    permission: 'readOnly',
                                    sharedBy: this.database.currentUser?.username
                                }
                            ]
                        }
                        // ⚠️ IMPORTANT: DO NOT update lastUpdated when sharing
                        // Sharing is metadata-only and doesn't change the actual contact data (vCard)
                        // lastUpdated should only be updated when the contact data (name, phone, email, etc.) changes
                    }
                };
                
                // 🎯 OPTIMIZE: Trim metadata before saving to avoid 10KB limit
                const optimizedContact = await this.database.optimizeContactForStorage(updatedContact);
                
                // Update the contact in our local cache first
                this.contacts.set(contactId, optimizedContact);
                
                // CRITICAL: Ensure the contact has itemId for database update
                console.log('🔍 Contact before database update - itemId:', optimizedContact.itemId, 'contactId:', optimizedContact.contactId);
                if (!optimizedContact.itemId) {
                    console.error('❌ Contact missing itemId, cannot update database:', contactId);
                    throw new Error('Contact missing itemId, cannot update database');
                }
                
                // Save the updated metadata to the database
                await this.database.updateContact(optimizedContact);
                
                console.log('✅ Contact shared successfully:', contactId, 'with', username);
                
                this.eventBus.emit('contact:shared', { 
                    contactId, 
                    username, 
                    readOnly: true,
                    resharingAllowed: false,
                    sharedDbName: result.sharedDbName
                });
                
                // Also emit contact:updated so UI refreshes with new sharing info
                console.log(`🔍 Emitting contact:updated with ${optimizedContact.metadata?.sharing?.sharedWithUsers?.length || 0} shared users: ${JSON.stringify(optimizedContact.metadata?.sharing?.sharedWithUsers || [])}`);
                this.eventBus.emit('contact:updated', { 
                    contact: optimizedContact,
                    reason: 'contact-shared'
                });
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ ContactManager: Share contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get usernames in a distribution list
     */
    async getUsernamesInDistributionList(listName) {
        const settings = await this.database.getSettings() || {};
        const distributionLists = settings.distributionLists || {};
        const usernames = distributionLists[listName]?.usernames;
        return Array.isArray(usernames) ? usernames : [];
    }

    /**
     * Share my profile with distribution list
     */
    async shareMyProfileWithDistributionList(profileContactId, listName) {
        try {
            // Get the profile contact
            const profileContact = this.contacts.get(profileContactId);
            if (!profileContact) {
                throw new Error('Profile contact not found');
            }
            
            // Get usernames in the distribution list
            const usernames = await this.getUsernamesInDistributionList(listName);
            if (usernames.length === 0) {
                throw new Error('No usernames in distribution list');
            }
            
            // Share the profile with each username
            const results = [];
            for (const username of usernames) {
                try {
                    const result = await this.shareContact(profileContactId, username);
                    results.push({
                        username,
                        success: result.success,
                        error: result.error || null
                    });
                } catch (error) {
                    results.push({
                        username,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            const successCount = results.filter(r => r.success).length;
            console.log(`✅ Shared profile with ${successCount}/${usernames.length} users in "${listName}"`);
            
            return {
                success: true,
                sharedWith: successCount,
                total: usernames.length,
                results: results
            };
            
        } catch (error) {
            console.error('❌ Error sharing profile with distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Share a specific contact with all users in a distribution list
     * Groups are just UI convenience - they expand to individual shares
     * No group metadata is stored, only individual usernames in contact.metadata.sharing.sharedWithUsers
     * @param {string} contactId - ID of the contact to share
     * @param {string} listName - Name of the distribution list (UI only)
     * @returns {Promise<Object>} Share result with details
     */
    async shareContactWithDistributionList(contactId, listName) {
        try {
            // Get the contact to share
            const contact = this.contacts.get(contactId);
            if (!contact) {
                throw new Error('Contact not found');
            }
            
            // Get usernames in the distribution list
            const usernames = await this.getUsernamesInDistributionList(listName);
            if (usernames.length === 0) {
                throw new Error('No usernames in distribution list');
            }
            
            console.log(`🔄 Sharing contact "${contact.cardName}" with ${usernames.length} users from group "${listName}":`, usernames);
            console.log('📝 Expanding current group membership into individual shares');
            
            // Share the contact with each username individually
            let successCount = 0;
            let errorCount = 0;
            let alreadySharedCount = 0;
            const results = [];
            const errors = [];
            
            for (const username of usernames) {
                try {
                    // Skip sharing with self
                    if (username === this.database.currentUser?.username) {
                        console.log(`⏭️ Skipping self-share with: ${username}`);
                        continue;
                    }
                    
                    // Use individual sharing - this automatically updates metadata.sharing.sharedWithUsers
                    const result = await this.shareContact(contactId, username);
                    results.push({
                        username,
                        success: result.success,
                        wasAlreadyShared: result.wasAlreadyShared,
                        error: result.error || null
                    });
                    
                    if (result.success) {
                        if (result.wasAlreadyShared) {
                            alreadySharedCount++;
                            console.log(`ℹ️ Contact was already shared with: ${username}`);
                        } else {
                            successCount++;
                            console.log(`✅ Successfully shared with: ${username} (added to sharedWithUsers array)`);
                        }
                    } else {
                        errorCount++;
                        errors.push(`${username}: ${result.error}`);
                        console.error(`❌ Failed to share with ${username}:`, result.error);
                    }
                } catch (error) {
                    errorCount++;
                    errors.push(`${username}: ${error.message}`);
                    console.error(`❌ Error sharing with ${username}:`, error);
                    results.push({
                        username,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            console.log(`✅ Group sharing complete: ${successCount} new shares, ${alreadySharedCount} already shared, ${errorCount} errors`);

            const hasAnyExistingAccess = successCount + alreadySharedCount > 0;
            return {
                success: hasAnyExistingAccess,
                ...(!hasAnyExistingAccess && {
                    error: errorCount > 0
                        ? 'Could not share with any users in the distribution list'
                        : 'The distribution list contains no other users to share with'
                }),
                successCount,
                alreadySharedCount,
                errorCount,
                total: usernames.length,
                results,
                errors,
                groupName: listName // For UI display only
            };
            
        } catch (error) {
            console.error('❌ Error sharing contact with distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate contact data size to prevent 10KB limit issues
     * @param {Object} contact - Contact object to validate
     * @returns {Object} Validation result with size info
     */
    validateContactSize(contact) {
        try {
            const contactString = JSON.stringify(contact);
            const sizeInBytes = new Blob([contactString]).size;
            const sizeInKB = sizeInBytes / 1024;
            
            const isValid = sizeInKB < 9; // Keep under 9KB to be safe (limit is 10KB)
            
            return {
                isValid,
                sizeInBytes,
                sizeInKB: Math.round(sizeInKB * 100) / 100,
                warning: sizeInKB > 7 ? 'Contact approaching size limit' : null
            };
        } catch (error) {
            console.error('Error validating contact size:', error);
            return { isValid: false, error: error.message };
        }
    }

    /**
     * Clean up contact metadata with aggressive memory optimization
     * Removes or trims non-essential data to prevent 10KB limit issues
     * @param {Object} contact - Contact to clean up
     * @returns {Object} Cleaned contact (shallow copy with trimmed metadata)
     */
    cleanupContactMetadata(contact) {
        // Input validation
        if (!contact || typeof contact !== 'object') {
            console.warn('⚠️ Invalid contact for metadata cleanup');
            return contact;
        }

        const cleaned = { ...contact };
        
        // OPTIMIZATION 1: Trim interaction history to essential data only
        if (cleaned.metadata?.usage?.interactionHistory) {
            cleaned.metadata.usage.interactionHistory = cleaned.metadata.usage.interactionHistory
                .slice(-3) // Keep only last 3 interactions
                .map(interaction => {
                    // Return only essential fields
                    const minimal = {
                        action: interaction.action,
                        timestamp: interaction.timestamp
                    };
                    // Include duration only if meaningful
                    if (interaction.duration && interaction.duration > 0) {
                        minimal.duration = interaction.duration;
                    }
                    return minimal;
                });
        }
        
        // OPTIMIZATION 2: Trim share history (audit trail)
        if (cleaned.metadata?.sharing?.shareHistory) {
            cleaned.metadata.sharing.shareHistory = cleaned.metadata.sharing.shareHistory
                .slice(-3) // Reduced from 5 to 3 for memory savings
                .map(entry => ({
                    // Keep only essential sharing audit data
                    action: entry.action,
                    targetUser: entry.targetUser,
                    timestamp: entry.timestamp
                    // Remove sharedBy, permission details (recoverable from sharePermissions)
                }));
        }

        // OPTIMIZATION 3: Remove UI state (should not be persisted)
        if (cleaned.metadata?.ui) {
            delete cleaned.metadata.ui;
        }

        // OPTIMIZATION 4: Trim CardDAV push history
        if (cleaned.metadata?.carddav?.pushHistory) {
            cleaned.metadata.carddav.pushHistory = cleaned.metadata.carddav.pushHistory.slice(-5);
        }
        
        return cleaned;
    }

    /**
     * Clean up duplicate sharing entries across all contacts
     * This method fixes any existing duplicate entries in the database
     */
    async cleanupSharingDuplicates() {
        console.log('🧹 Starting sharing duplicates cleanup...');
        let fixedCount = 0;
        
        try {
            for (const [contactId, contact] of this.contacts.entries()) {
                if (!contact.metadata?.sharing?.sharedWithUsers?.length) {
                    continue; // Skip contacts with no sharing
                }
                
                const originalUsers = contact.metadata.sharing.sharedWithUsers;
                const uniqueUsers = [...new Set(originalUsers)];
                
                // Check if there were duplicates
                if (originalUsers.length !== uniqueUsers.length) {
                    console.log(`🔧 Fixing duplicates in contact ${contact.cardName}: ${originalUsers.length} → ${uniqueUsers.length} users`);
                    
                    // Update the contact with deduplicated users
                    const updatedContact = {
                        ...contact,
                        metadata: {
                            ...contact.metadata,
                            sharing: {
                                ...contact.metadata.sharing,
                                sharedWithUsers: uniqueUsers,
                                shareCount: uniqueUsers.length, // 🔧 ADD MISSING shareCount
                                isShared: uniqueUsers.length > 0 // 🔧 ADD MISSING isShared flag
                            }
                        }
                    };
                    
                    // Save the cleaned contact
                    await this.updateContact(contactId, updatedContact);
                    fixedCount++;
                }
            }
            
            console.log(`✅ Sharing cleanup complete. Fixed ${fixedCount} contacts.`);
            return { success: true, fixedCount };
            
        } catch (error) {
            console.error('❌ Error during sharing cleanup:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Sanitize contact ID for database naming (same logic as IndividualSharingStrategy)
     * @param {string} contactId - The contact ID to sanitize
     * @returns {string} Clean contact ID suitable for database naming
     */
    sanitizeContactId(contactId) {
        // Remove 'contact_' prefix to avoid double naming
        return contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
    }

}