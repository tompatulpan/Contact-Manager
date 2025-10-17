/**
 * ContactManager - Main contact business logic
 * Handles all contact operations with RFC 9553 compliance and comprehensive metadata
 */
export class ContactManager {
    constructor(eventBus, database, vCardStandard, validator) {
        this.eventBus = eventBus;
        this.database = database;
        this.vCardStandard = vCardStandard;
        this.validator = validator;
        
        // In-memory contact storage for performance
        this.contacts = new Map();
        this.settings = {};
        this.isLoaded = false;
        
        // Search and filter cache
        this.searchCache = new Map();
        this.lastSearchQuery = '';
        
        // Distribution sharing restoration state
        this.pendingDistributionSharing = null;
        this.contactsLoaded = false;
        this.distributionSharingLoaded = false;
        
        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Initialize the contact manager
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
                console.log('✅ Database already authenticated, proceeding with initialization...');
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

        // Handle distribution sharing updates
        this.eventBus.on('distributionSharing:changed', (data) => {
            this.handleDistributionSharingChanged(data.distributionSharing);
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
            const contactId = this.vCardStandard.generateContactId();
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
                    distributionLists: sanitizedData.distributionLists || existingContact.metadata.distributionLists,
                    sync: {
                        ...(existingContact.metadata.sync || {}),
                        version: (existingContact.metadata.sync?.version || 0) + 1,
                        lastSyncedAt: new Date().toISOString()
                    }
                }
            };

            // 🔧 DEBUG: Log contact update process
            console.log('🔧 ContactManager updateContact DEBUG:', {
                originalCardName: existingContact.cardName,
                sanitizedCardName: sanitizedData.cardName,
                finalCardName: updatedContact.cardName,
                cardNameChanged: existingContact.cardName !== updatedContact.cardName
            });

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

            // For owned contacts, mark as deleted; for shared contacts, remove locally
            if (contact.metadata.isOwned) {
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
            } else {
                // Hard delete for shared contacts (removes from local view)
                const deleteResult = await this.database.deleteContact(contactId);
                if (!deleteResult.success) {
                    return { success: false, error: 'Failed to delete contact' };
                }
                
                this.contacts.delete(contactId);
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
                        lastUpdated: new Date().toISOString()
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
                    if (contact.cardName.toLowerCase().includes(searchTerm)) return true;
                    
                    // Search in vCard content
                    if (contact.vcard.toLowerCase().includes(searchTerm)) return true;
                    
                    // Search in distribution lists
                    if (contact.metadata.distributionLists?.some(list => 
                        list.toLowerCase().includes(searchTerm))) return true;
                    
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
            // Shows contacts created/imported by the current user (excludes shared contacts)
            filtered = filtered.filter(contact => contact.metadata.isOwned && !contact.metadata.isImported);
        } else if (filters.ownership === 'shared') {
            // Shows contacts shared by other users (excludes owned and imported contacts)
            filtered = filtered.filter(contact => !contact.metadata.isOwned);
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
                    valueA = aData.fullName.toLowerCase();
                    valueB = bData.fullName.toLowerCase();
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
     * Get contacts by distribution list
     * @param {string} listName - Distribution list name
     * @returns {Array} Contacts in the list
     */
    getContactsByDistributionList(listName) {
        return Array.from(this.contacts.values()).filter(contact => 
            !contact.metadata.isDeleted && 
            !contact.metadata.isArchived &&
            contact.metadata.distributionLists?.includes(listName)
        );
    }

    /**
     * Get contact statistics
     * @returns {Object} Statistics object
     */
    getContactStatistics() {
        const allContacts = Array.from(this.contacts.values());
        const activeContacts = allContacts.filter(c => !c.metadata.isDeleted && !c.metadata.isArchived);
        
        return {
            total: activeContacts.length,
            active: activeContacts.length,
            archived: allContacts.filter(c => c.metadata.isArchived && !c.metadata.isDeleted).length,
            deleted: allContacts.filter(c => c.metadata.isDeleted).length,
            owned: activeContacts.filter(c => c.metadata.isOwned).length,
            shared: activeContacts.filter(c => !c.metadata.isOwned).length,
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
     * Track contact access
     * @param {string} contactId - Contact ID
     * @param {number} viewDuration - View duration in seconds
     */
    async trackContactAccess(contactId, viewDuration = null) {
        try {
            const contact = this.contacts.get(contactId);
            if (!contact) return;

            const now = new Date().toISOString();
            
            // Ensure usage metadata exists with proper defaults
            const currentUsage = contact.metadata?.usage || {};
            
            // Keep interaction history very small to prevent 10KB limit issues
            const currentHistory = currentUsage.interactionHistory || [];
            const limitedHistory = currentHistory.slice(-4); // Keep only last 5 interactions
            
            // Create minimal interaction entry to save space
            const newInteraction = {
                action: 'viewed',
                timestamp: now,
                duration: viewDuration
            };
            
            const updatedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    usage: {
                        accessCount: (currentUsage.accessCount || 0) + 1,
                        lastAccessedAt: now,
                        viewDuration,
                        interactionHistory: [...limitedHistory, newInteraction]
                    }
                    // Note: lastUpdated is NOT updated for access tracking - only for content changes
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
        
        // Debug: Check what we received
        console.log('🔍 findSimilarContacts received:', {
            hasVcard: !!newContact?.vcard,
            hasSuccess: !!newContact?.success,
            isResultObject: !!(newContact?.success !== undefined),
            contactKeys: Object.keys(newContact || {})
        });
        
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
     * @returns {Promise<Object>} Import result with duplicate information
     */
    async importContactFromVCard(vCardString, cardName = null, markAsImported = true) {
        try {
            const contact = this.vCardStandard.importFromVCard(vCardString, cardName, markAsImported);
            
            // Debug: Check what importFromVCard returned
            console.log('🔍 importFromVCard returned:', {
                hasVcard: !!contact?.vcard,
                hasSuccess: !!contact?.success,
                isResultObject: !!(contact?.success !== undefined),
                contactKeys: Object.keys(contact || {}),
                cardName: contact?.cardName || contact?.contact?.cardName,
                fn: contact?.fn || contact?.contact?.fn
            });
            
            // Check for duplicates before saving
            const similarContacts = this.findSimilarContacts(contact);
            
            if (similarContacts.length > 0) {
                const bestMatch = similarContacts[0];
                console.log(`⚠️ Potential duplicate detected for ${contact.cardName}:`);
                console.log(`   Existing: ${bestMatch.contact.cardName} (${Math.round(bestMatch.matchPercentage * 100)}% match)`);
                console.log(`   Matched fields:`, bestMatch.matchedFields);
                
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
            
            const saveResult = await this.database.saveContact(contact);
            
            if (saveResult.success) {
                // NOTE: Don't add to local cache here - let the database change handler
                // handle it to ensure itemId is properly set by Userbase
                // The database change handler will receive the contact with proper itemId
                
                this.clearSearchCache();
                this.eventBus.emit('contact:imported', { contact });
                return { ...saveResult, contact }; // Include contact in success result
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
            
            // Mark that contacts have been loaded
            this.contactsLoaded = true;
            
        } else {
            // Handle shared contacts from a specific user
            // Remove old shared contacts from this same sharer/database
            const oldSharedContactIds = Array.from(this.contacts.keys()).filter(id => {
                const contact = this.contacts.get(id);
                return !contact.metadata.isOwned && 
                       contact.metadata.sharedBy === sharedBy &&
                       contact.metadata.databaseId === databaseId;
            });
            
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

        // 🔑 CRITICAL FIX: Check if we can now restore distribution sharing metadata
        await this.attemptDistributionSharingRestoration();

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
        this.contactsLoaded = false;
        this.distributionSharingLoaded = false;
        this.pendingDistributionSharing = null;
        
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
     * Handle distribution sharing changed event from database
     * @param {Array} distributionSharing - Updated distribution sharing array
     */
    handleDistributionSharingChanged(distributionSharing) {
        // Store the distribution sharing data
        this.pendingDistributionSharing = distributionSharing;
        this.distributionSharingLoaded = true;
        
        // Attempt to restore sharing metadata
        this.attemptDistributionSharingRestoration();
        
        this.eventBus.emit('contactManager:distributionSharingUpdated', { distributionSharing });
    }

    /**
     * Attempt to restore distribution sharing metadata if both contacts and sharing data are loaded
     */
    async attemptDistributionSharingRestoration() {
        // Only proceed if both contacts and distribution sharing data are available
        if (!this.contactsLoaded || !this.distributionSharingLoaded || !this.pendingDistributionSharing) {
            return;
        }
        
        // Process sharing relationships to restore contact metadata
        await this.restoreContactSharingMetadata(this.pendingDistributionSharing);
        
        // Emit event to notify UI that restoration is complete
        this.eventBus.emit('contactManager:sharingRestorationComplete', {
            restoredRecords: this.pendingDistributionSharing.length,
            contactCount: this.contacts.size
        });
    }

    /**
     * Restore contact sharing metadata from persistent distribution sharing records
     * This ensures sharing relationships are visible after browser/PC switches
     * @param {Array} distributionSharing - Array of distribution sharing records
     */
    async restoreContactSharingMetadata(distributionSharing) {
        try {
            // Group sharing records by contact ID
            const sharingByContact = new Map();
            let validRecords = 0;
            let invalidRecords = 0;
            
            distributionSharing.forEach((record, index) => {
                if (!record.contactId) {
                    invalidRecords++;
                    return;
                }
                
                if (!sharingByContact.has(record.contactId)) {
                    sharingByContact.set(record.contactId, []);
                }
                sharingByContact.get(record.contactId).push(record);
                validRecords++;
            });
            
            // Update contact metadata for each contact with sharing records
            let contactsFound = 0;
            let contactsNotFound = 0;
            let contactsUpdated = 0;
            
            for (const [contactId, records] of sharingByContact.entries()) {
                const contact = this.contacts.get(contactId);
                
                if (!contact) {
                    contactsNotFound++;
                    continue;
                }
                
                contactsFound++;
                
                // Restore the sharing metadata
                const primaryRecord = records[0]; // Most recent record
                const listNames = records.map(r => r.listName);
                const allUsernames = new Set();
                
                records.forEach(record => {
                    if (record.usernames && Array.isArray(record.usernames)) {
                        record.usernames.forEach(username => allUsernames.add(username));
                    }
                });
                
                // Ensure metadata structure exists
                if (!contact.metadata) {
                    contact.metadata = {};
                }
                if (!contact.metadata.sharing) {
                    contact.metadata.sharing = {};
                }
                
                // Update contact metadata with restored sharing information
                const updatedContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        // Add distribution list sharing metadata
                        sharedWithDistributionList: primaryRecord.listName, // Most recent list (legacy)
                        sharedWithDistributionLists: listNames, // All lists (new field)
                        lastSharedAt: primaryRecord.sharedAt,
                        lastSharedBy: primaryRecord.sharedBy,
                        
                        // Update sharing metadata
                        sharing: {
                            ...contact.metadata.sharing,
                            isShared: allUsernames.size > 0,
                            sharedWithUsers: Array.from(allUsernames),
                            shareCount: allUsernames.size,
                            distributionListSharing: records.map(r => ({
                                listName: r.listName,
                                usernames: r.usernames,
                                sharedAt: r.sharedAt,
                                sharedBy: r.sharedBy
                            }))
                        }
                    }
                };
                
                // Update in cache (don't save to database to avoid loops)
                this.contacts.set(contactId, updatedContact);
                contactsUpdated++;
            }
            
            // Emit events to notify UI of restoration
            this.eventBus.emit('contactManager:contactsUpdated', {
                contactCount: this.contacts.size,
                contacts: Array.from(this.contacts.values()),
                sharingRestored: true
            });
            
        } catch (error) {
            console.error('❌ Error restoring contact sharing metadata:', error);
        }
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
        return contact.metadata.isOwned || 
               contact.metadata.sharing?.sharePermissions?.[this.database.currentUser?.username]?.level === 'write';
    }

    /**
     * Check if user can delete contact
     * @param {Object} contact - Contact object
     * @returns {boolean} Can delete
     */
    canDeleteContact(contact) {
        return contact.metadata.isOwned || !contact.metadata.isOwned; // Users can always delete shared contacts from their view
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
     * Add interaction to contact history
     * @param {Object} contact - Contact object
     * @param {string} action - Action type
     * @param {Object} details - Action details
     */
    addInteractionHistory(contact, action, details = {}) {
        // Ensure metadata and usage exist
        if (!contact.metadata) {
            contact.metadata = {};
        }
        if (!contact.metadata.usage) {
            contact.metadata.usage = {};
        }
        if (!contact.metadata.usage.interactionHistory) {
            contact.metadata.usage.interactionHistory = [];
        }

        contact.metadata.usage.interactionHistory.push({
            action,
            timestamp: new Date().toISOString(),
            userId: this.database.currentUser?.userId,
            ...details
        });

        // Keep only the last 50 interactions
        if (contact.metadata.usage.interactionHistory.length > 50) {
            contact.metadata.usage.interactionHistory = 
                contact.metadata.usage.interactionHistory.slice(-50);
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

            // Update contact with new metadata
            const updatedContact = {
                ...contact,
                ...updates,
                metadata: {
                    ...contact.metadata,
                    ...updates.metadata,
                    lastUpdated: new Date().toISOString(),
                    lastUpdatedBy: this.database.currentUser?.username || 'unknown'
                }
            };

            // Save to database
            const saveResult = await this.database.updateContact(updatedContact);
            if (!saveResult.success) {
                throw new Error(saveResult.error);
            }

            // Update local cache
            this.contacts.set(contactId, updatedContact);

            // Add interaction history
            this.addInteractionHistory(updatedContact, 'metadata_updated', {
                fields: Object.keys(updates.metadata || {}),
                updatedBy: this.database.currentUser?.username
            });

            this.eventBus.emit('contact:updated', { 
                contact: updatedContact,
                changes: Object.keys(updates.metadata || [])
            });

            console.log('✅ Contact metadata updated:', contact.cardName);
            return { success: true, contact: updatedContact };

        } catch (error) {
            console.error('❌ Update contact metadata failed:', error);
            this.eventBus.emit('contact:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Load shared contact metadata from user's metadata database and merge with contacts
     */
    async loadAndMergeSharedContactMetadata() {
        try {
            console.log('📊 Loading shared contact metadata from user database...');
            
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
     * Add a contact to a distribution list
     * @param {string} contactId - ID of the contact to add
     * @param {string} listName - Name of the distribution list
     * @returns {Promise<Object>} Addition result
     */
    async addContactToDistributionList(contactId, listName) {
        try {
            console.log('📝 Adding contact to distribution list:', contactId, listName);
            
            // Get the contact
            const contact = this.contacts.get(contactId);
            if (!contact) {
                return { success: false, error: 'Contact not found' };
            }
            
            // Verify the distribution list exists
            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            if (!distributionLists[listName]) {
                return { success: false, error: 'Distribution list not found' };
            }
            
            // Initialize distributionLists array if it doesn't exist
            if (!contact.metadata.distributionLists) {
                contact.metadata.distributionLists = [];
            }
            
            // Add to list if not already there
            if (!contact.metadata.distributionLists.includes(listName)) {
                contact.metadata.distributionLists.push(listName);
                contact.metadata.lastUpdated = new Date().toISOString();
                
                // Update the contact (not save as new)
                await this.database.updateContact(contact);
                
                // Update local cache
                this.contacts.set(contactId, contact);
                
                console.log('✅ Contact added to distribution list successfully');
                this.eventBus.emit('contact:updated', { contact });
                this.eventBus.emit('distributionList:contactAdded', { contactId, listName });
                
                return { success: true };
            } else {
                return { success: false, error: 'Contact already in this distribution list' };
            }
            
        } catch (error) {
            console.error('❌ Error adding contact to distribution list:', error);
            return { success: false, error: error.message };
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
     * Get contacts in a specific distribution list
     * @param {string} listName - Name of the distribution list
     * @returns {Array} Array of contacts in the list
     */
    getContactsByDistributionList(listName) {
        const contacts = [];
        
        for (const contact of this.contacts.values()) {
            if (!contact.metadata?.isDeleted && 
                contact.metadata && 
                contact.metadata.distributionLists && 
                contact.metadata.distributionLists.includes(listName)) {
                contacts.push(contact);
            }
        }
        
        return contacts;
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
            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            
            if (!distributionLists[listName]) {
                throw new Error(`Distribution list "${listName}" not found`);
            }
            
            // Initialize usernames array if it doesn't exist
            if (!distributionLists[listName].usernames) {
                distributionLists[listName].usernames = [];
            }
            
            // 🆕 VALIDATE USERNAME EXISTS: Test if user exists before adding to list
            if (!distributionLists[listName].usernames.includes(username)) {
                console.log(`🔍 Validating username "${username}" exists before adding to distribution list...`);
                
                try {
                    // Test username validity by attempting to create a temporary test database
                    const testDbName = `test-user-validation-${Date.now()}`;
                    await userbase.openDatabase({
                        databaseName: testDbName,
                        changeHandler: () => {}
                    });
                    
                    // Try to share with the user (this will fail if user doesn't exist)
                    // requireVerified: false - Allow adding users to distribution lists without verification
                    await userbase.shareDatabase({
                        databaseName: testDbName,
                        username: username.trim(),
                        readOnly: true,
                        resharingAllowed: false,
                        requireVerified: false
                    });
                    
                    // If we get here, the user exists
                    // Note: Userbase SDK doesn't have deleteDatabase, so we skip cleanup
                    // The test database will remain but won't cause issues
                    
                    console.log(`✅ Username "${username}" validated - user exists`);
                    
                } catch (validationError) {
                    console.error(`❌ Username validation failed for "${username}":`, validationError.message);
                    
                    // Categorize the error for better user feedback
                    let errorType = 'unknown';
                    let userMessage = `Failed to add "${username}" to distribution list.`;
                    
                    if (validationError.message.includes('User not found') || 
                        validationError.message.includes('UserNotFound')) {
                        errorType = 'userNotFound';
                        userMessage = `User "${username}" not found. Please check the username and make sure they have an account.`;
                    } else if (validationError.message.includes('subscription') || 
                               validationError.message.includes('trial') || 
                               validationError.message.includes('plan')) {
                        errorType = 'subscription';
                        userMessage = `Subscription issue: Cannot add "${username}". Check your account subscription status.`;
                    } else if (validationError.message.includes('network') || 
                               validationError.message.includes('connection')) {
                        errorType = 'network';
                        userMessage = `Network error: Cannot validate "${username}". Check your internet connection and try again.`;
                    } else {
                        userMessage = `Error adding "${username}": ${validationError.message}`;
                    }
                    
                    return {
                        success: false,
                        error: userMessage,
                        errorType: errorType,
                        username: username
                    };
                }
                
                // ✅ Validation passed - add username to distribution list
                distributionLists[listName].usernames.push(username);
                
                // Update settings
                const updatedSettings = {
                    ...settings,
                    distributionLists: distributionLists
                };
                
                await this.database.updateSettings(updatedSettings);
                
                console.log(`✅ Added username "${username}" to distribution list "${listName}"`);
                
                // 🔄 RETROACTIVE SHARING: Share existing contacts with the newly added user
                const existingContactsToShare = await this.findContactsSharedWithDistributionList(listName);
                let retroactiveResults = {
                    contactsFound: existingContactsToShare.length,
                    successfulShares: 0,
                    failedShares: 0,
                    alreadyShared: 0,
                    errors: []
                };
                
                if (existingContactsToShare.length > 0) {
                    console.log(`🔄 Found ${existingContactsToShare.length} existing contacts to retroactively share with "${username}"`);
                    
                    for (const contact of existingContactsToShare) {
                        try {
                            const result = await this.shareContact(contact.contactId, username, true);
                            if (result.success) {
                                if (result.wasAlreadyShared) {
                                    retroactiveResults.alreadyShared++;
                                    console.log(`ℹ️ Contact "${contact.cardName}" was already shared with ${username}`);
                                } else {
                                    retroactiveResults.successfulShares++;
                                    console.log(`✅ Retroactively shared contact "${contact.cardName}" with ${username}`);
                                }
                            } else {
                                retroactiveResults.failedShares++;
                                retroactiveResults.errors.push(`${contact.cardName}: ${result.error}`);
                                console.error(`❌ Failed to retroactively share "${contact.cardName}" with ${username}:`, result.error);
                            }
                        } catch (error) {
                            retroactiveResults.failedShares++;
                            retroactiveResults.errors.push(`${contact.cardName}: ${error.message}`);
                            console.error(`❌ Error retroactively sharing "${contact.cardName}" with ${username}:`, error);
                        }
                    }
                    
                    console.log(`🎯 Retroactive sharing complete: ${retroactiveResults.successfulShares} new shares, ${retroactiveResults.alreadyShared} already shared, ${retroactiveResults.failedShares} failed`);
                }
                
                this.eventBus.emit('distributionListsUpdated');
                
                return { 
                    success: true, 
                    retroactiveSharing: retroactiveResults
                };
            } else {
                console.log(`ℹ️ Username "${username}" already in distribution list "${listName}"`);
                return { success: true, message: 'Username already in list' };
            }
            
        } catch (error) {
            console.error('❌ Error adding username to distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Find contacts that have been previously shared with a specific distribution list
     * Uses persistent storage to ensure relationships survive browser/PC switches
     * @param {string} listName - Name of the distribution list
     * @returns {Array} Array of contacts that have been shared with this distribution list
     */
    async findContactsSharedWithDistributionList(listName) {
        try {
            console.log('🔍 Finding contacts shared with distribution list using persistent storage:', listName);
            
            // 🔑 CRITICAL FIX: Use persistent storage instead of contact metadata
            const contactIds = await this.database.getContactsSharedWithDistributionList(listName);
            console.log('📋 Found persisted contact IDs for list:', contactIds);
            
            const contactsSharedWithList = [];
            
            // Get the actual contact objects from our cache
            for (const contactId of contactIds) {
                const contact = this.contacts.get(contactId);
                
                if (!contact) {
                    console.log(`⚠️ Contact ${contactId} found in sharing records but not in cache`);
                    continue;
                }
                
                console.log(`🔍 Checking contact ${contact.cardName}:`, {
                    isDeleted: contact.metadata?.isDeleted,
                    isArchived: contact.metadata?.isArchived,
                    isOwned: contact.metadata?.isOwned,
                    contactId: contact.contactId
                });
                
                // Skip deleted or archived contacts
                if (contact.metadata?.isDeleted || contact.metadata?.isArchived) {
                    console.log(`⏭️ Skipping ${contact.cardName} - deleted or archived`);
                    continue;
                }
                
                // Skip contacts that aren't owned by the current user (can't share others' contacts)
                if (!contact.metadata?.isOwned) {
                    console.log(`⏭️ Skipping ${contact.cardName} - not owned by current user`);
                    continue;
                }
                
                console.log(`✅ Found contact ${contact.cardName} shared with list ${listName} (from persistent storage)`);
                contactsSharedWithList.push(contact);
            }
            
            console.log(`📋 Found ${contactsSharedWithList.length} contacts previously shared with distribution list "${listName}" from persistent storage`);
            return contactsSharedWithList;
            
        } catch (error) {
            console.error('❌ Error finding contacts shared with distribution list:', error);
            
            // 🔄 FALLBACK: Use old method if persistent storage fails
            console.log('🔄 Falling back to metadata-based search...');
            return await this.findContactsSharedWithDistributionListFallback(listName);
        }
    }

    /**
     * Fallback method to find contacts shared with distribution list using metadata
     * @param {string} listName - Name of the distribution list
     * @returns {Array} Array of contacts found via metadata
     */
    async findContactsSharedWithDistributionListFallback(listName) {
        try {
            const contactsSharedWithList = [];
            
            // Search through all contacts for ones that have been shared with this distribution list
            for (const contact of this.contacts.values()) {
                // Debug: log contact metadata
                console.log(`🔍 Checking contact ${contact.cardName}:`, {
                    isDeleted: contact.metadata?.isDeleted,
                    isArchived: contact.metadata?.isArchived,
                    isOwned: contact.metadata?.isOwned,
                    sharedWithDistributionList: contact.metadata?.sharedWithDistributionList,
                    distributionLists: contact.metadata?.distributionLists
                });
                
                // Skip deleted or archived contacts
                if (contact.metadata?.isDeleted || contact.metadata?.isArchived) {
                    console.log(`⏭️ Skipping ${contact.cardName} - deleted or archived`);
                    continue;
                }
                
                // Skip contacts that aren't owned by the current user (can't share others' contacts)
                if (!contact.metadata?.isOwned) {
                    console.log(`⏭️ Skipping ${contact.cardName} - not owned by current user`);
                    continue;
                }
                
                // Check if contact metadata indicates it was shared with this distribution list
                if (contact.metadata?.sharedWithDistributionList === listName) {
                    console.log(`✅ Found contact ${contact.cardName} shared with list ${listName}`);
                    contactsSharedWithList.push(contact);
                    continue;
                }
                
                // Also check if the contact is in the distribution list (older method)
                if (contact.metadata?.distributionLists?.includes(listName)) {
                    console.log(`✅ Found contact ${contact.cardName} in distribution lists`);
                    contactsSharedWithList.push(contact);
                    continue;
                }
                
                console.log(`⏭️ Contact ${contact.cardName} not shared with list ${listName}`);
            }
            
            console.log(`📋 Found ${contactsSharedWithList.length} contacts previously shared with distribution list "${listName}" via fallback`);
            return contactsSharedWithList;
            
        } catch (error) {
            console.error('❌ Error in fallback search:', error);
            return [];
        }
    }

    /**
     * Remove username from distribution list
     */
    async removeUsernameFromDistributionList(listName, username) {
        try {
            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            
            if (!distributionLists[listName] || !distributionLists[listName].usernames) {
                return { success: true, message: 'Username not in list' };
            }
            
            // Check if username is actually in the list
            const index = distributionLists[listName].usernames.indexOf(username);
            if (index === -1) {
                return { success: true, message: 'Username not in list' };
            }
            
            // Remove username
            distributionLists[listName].usernames.splice(index, 1);
            
            // Update settings first
            const updatedSettings = {
                ...settings,
                distributionLists: distributionLists
            };
            
            await this.database.updateSettings(updatedSettings);
            
            console.log(`✅ Removed username "${username}" from distribution list "${listName}"`);
            
            // **NEW: Revoke access to all contacts shared with this distribution list**
            await this.revokeDistributionListAccess(listName, username);
            
            this.eventBus.emit('distributionListsUpdated');
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Error removing username from distribution list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Revoke access to all contacts that were shared with a distribution list
     * @param {string} listName - Distribution list name
     * @param {string} username - Username to revoke access from
     */
    async revokeDistributionListAccess(listName, username) {
        try {
            console.log(`🔒 Revoking access for "${username}" to contacts shared with distribution list "${listName}"`);
            
            // 🔑 CRITICAL FIX: Use persistent storage to find shared contacts
            const sharedContacts = await this.findContactsSharedWithDistributionList(listName);
            
            console.log(`🔍 Found ${sharedContacts.length} contacts to revoke access from for user "${username}"`);
            
            let revokedCount = 0;
            let errorCount = 0;
            
            for (const contact of sharedContacts) {
                try {
                    console.log(`🔒 Revoking access to contact "${contact.cardName}" (${contact.contactId}) from user "${username}"`);
                    
                    const result = await this.individualSharingStrategy.revokeIndividualAccess(contact.contactId, username);
                    
                    if (result.success) {
                        revokedCount++;
                        console.log(`✅ Successfully revoked access to "${contact.cardName}" from "${username}"`);
                    } else {
                        errorCount++;
                        console.error(`❌ Failed to revoke access to "${contact.cardName}" from "${username}":`, result.error);
                    }
                    
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error revoking access to "${contact.cardName}" from "${username}":`, error);
                }
            }
            
            // 🔑 IMPORTANT: Update the persistent sharing records to remove the revoked username
            console.log('🔄 Updating persistent sharing records to remove revoked user...');
            for (const contact of sharedContacts) {
                try {
                    // Get current sharing relationship
                    const sharingRecords = await this.database.getDistributionListSharingForContact(contact.contactId);
                    const listSharing = sharingRecords.find(record => record.listName === listName);
                    
                    if (listSharing && listSharing.usernames.includes(username)) {
                        // Remove the username from the sharing record
                        const updatedUsernames = listSharing.usernames.filter(u => u !== username);
                        
                        if (updatedUsernames.length > 0) {
                            // Update with remaining usernames
                            await this.database.updateDistributionListSharing(contact.contactId, listName, updatedUsernames);
                            console.log(`✅ Updated sharing record for "${contact.cardName}" - removed "${username}"`);
                        } else {
                            // No usernames left, delete the entire sharing record
                            await this.database.deleteDistributionListSharing(contact.contactId, listName);
                            console.log(`✅ Deleted sharing record for "${contact.cardName}" - no users remaining`);
                        }
                    }
                } catch (error) {
                    console.error(`❌ Error updating sharing record for "${contact.cardName}":`, error);
                }
            }
            
            console.log(`🔒 Access revocation complete: ${revokedCount} revoked, ${errorCount} errors`);
            
            return {
                success: true,
                revokedCount,
                errorCount,
                totalContacts: sharedContacts.length
            };
            
        } catch (error) {
            console.error('❌ Error in revokeDistributionListAccess:', error);
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
     * @param {boolean} readOnly - Whether sharing is read-only (default: true)
     * @param {boolean} resharingAllowed - Whether resharing is allowed (default: false)
     * @returns {Promise<Object>} Share result
     */
    async shareContact(contactId, username, readOnly = true, resharingAllowed = false) {
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
                } else if (contact) {
                    console.log('🔍 DEBUG: Contact object keys:', Object.keys(contact));
                    console.log('🔍 DEBUG: Contact object itemId value:', contact.itemId);
                    console.log('🔍 DEBUG: Contact object structure:', {
                        contactId: contact.contactId,
                        itemId: contact.itemId,
                        cardName: contact.cardName,
                        hasItemId: !!contact.itemId,
                        itemIdType: typeof contact.itemId,
                        itemIdValue: contact.itemId
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
            
            // Check if already shared with this user
            const currentSharedUsers = contact.metadata.sharing?.sharedWithUsers || [];
            const isAlreadyShared = currentSharedUsers.includes(username);
            
            if (isAlreadyShared) {
                console.log('ℹ️ Contact already shared with user:', username, '- checking database state');
                
                // 🔧 CRITICAL FIX: Validate that the user actually exists before assuming share is valid
                // This prevents false positive "already shared" results for non-existent users
                try {
                    console.log('🔍 Validating user existence for:', username);
                    await this.database.validateUserExists(username);
                    console.log('✅ User exists, proceeding with database state check');
                } catch (userError) {
                    console.error(`❌ User ${username} does not exist, removing from shared users list:`, userError.message);
                    
                    // Remove the non-existent user from the metadata
                    const updatedSharedUsers = currentSharedUsers.filter(u => u !== username);
                    const updatedContact = {
                        ...contact,
                        metadata: {
                            ...contact.metadata,
                            sharing: {
                                ...contact.metadata.sharing,
                                sharedWithUsers: updatedSharedUsers,
                                shareCount: updatedSharedUsers.length,
                                isShared: updatedSharedUsers.length > 0
                            }
                        }
                    };
                    
                    // Update contact metadata to remove invalid user
                    await this.updateContact(contactId, updatedContact);
                    
                    // Return failure since the user doesn't exist
                    return { 
                        success: false, 
                        error: `User '${username}' does not exist`,
                        cleanedMetadata: true
                    };
                }
                
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
                        console.log('✅ Shared database contains contact data - updating permissions only');
                    }
                } catch (error) {
                    needsContactData = true;
                    console.log('⚠️ Cannot access shared database - will re-share contact:', error.message);
                }
                
                // If database is empty, insert the contact data
                if (needsContactData) {
                    console.log('🔄 Re-populating empty shared database with contact data');
                    try {
                        // Use Userbase SDK directly to insert contact
                        await window.userbase.insertItem({
                            databaseName: sharedDbName,
                            itemId: contactId,
                            item: contact
                        });
                        console.log('✅ Contact data inserted into previously empty shared database');
                    } catch (insertError) {
                        if (insertError.message.includes('Item with the same id already exists')) {
                            console.log('ℹ️ Contact already exists in shared database - proceeding with permission update');
                        } else {
                            console.error('❌ Failed to insert contact into empty shared database:', insertError.message);
                        }
                        // Continue with permission update even if insert fails
                    }
                }
                
                // Update permissions
                const updatedContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        sharing: {
                            ...contact.metadata.sharing,
                            sharePermissions: {
                                ...contact.metadata.sharing?.sharePermissions,
                                [username]: {
                                    ...contact.metadata.sharing?.sharePermissions?.[username],
                                    level: readOnly ? 'readOnly' : 'write',
                                    lastUpdated: new Date().toISOString(),
                                    canReshare: resharingAllowed
                                }
                            }
                        }
                    }
                };
                
                // Update in database
                await this.updateContact(contactId, updatedContact);
                
                return {
                    success: true,
                    message: needsContactData ? 
                        `Re-shared and updated permissions for ${username}` : 
                        `Permissions updated for ${username}`,
                    action: needsContactData ? 'reshared' : 'updated'
                };
            }
            
            // Share using individual sharing strategy only (no group databases)
            const result = await this.database.shareContactIndividually(contact, username, readOnly, resharingAllowed);
            
            if (result.success) {
                // Get current shared users and deduplicate
                const currentSharedUsers = contact.metadata.sharing?.sharedWithUsers || [];
                const uniqueSharedUsers = [...new Set([...currentSharedUsers, username])];
                
                // Update contact metadata to track sharing
                const updatedContact = {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        sharing: {
                            ...contact.metadata.sharing,
                            isShared: true,
                            sharedWithUsers: uniqueSharedUsers,
                            shareCount: uniqueSharedUsers.length, // 🔧 ADD MISSING shareCount
                            sharePermissions: {
                                ...contact.metadata.sharing?.sharePermissions,
                                [username]: {
                                    level: readOnly ? 'readOnly' : 'write',
                                    sharedAt: new Date().toISOString(),
                                    sharedBy: this.database.currentUser?.username,
                                    canReshare: resharingAllowed
                                }
                            },
                            shareHistory: [
                                ...(contact.metadata.sharing?.shareHistory || []),
                                {
                                    action: 'shared',
                                    targetUser: username,
                                    timestamp: new Date().toISOString(),
                                    permission: readOnly ? 'readOnly' : 'write',
                                    sharedBy: this.database.currentUser?.username
                                }
                            ]
                        },
                        lastUpdated: new Date().toISOString()
                    }
                };
                
                // Update the contact in our local cache first
                this.contacts.set(contactId, updatedContact);
                
                // CRITICAL: Ensure the contact has itemId for database update
                console.log('🔍 Contact before database update - itemId:', updatedContact.itemId, 'contactId:', updatedContact.contactId);
                if (!updatedContact.itemId) {
                    console.error('❌ Contact missing itemId, cannot update database:', contactId);
                    throw new Error('Contact missing itemId, cannot update database');
                }
                
                // Save the updated metadata to the database
                await this.database.updateContact(updatedContact);
                
                console.log('✅ Contact shared successfully:', contactId, 'with', username);
                
                this.eventBus.emit('contact:shared', { 
                    contactId, 
                    username, 
                    readOnly, 
                    resharingAllowed,
                    sharedDbName: result.sharedDbName
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
        try {
            const settings = await this.database.getSettings() || {};
            const distributionLists = settings.distributionLists || {};
            
            if (!distributionLists[listName]) {
                return [];
            }
            
            return distributionLists[listName].usernames || [];
            
        } catch (error) {
            console.error('❌ Error getting usernames in distribution list:', error);
            return [];
        }
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
     * @param {string} contactId - ID of the contact to share
     * @param {string} listName - Name of the distribution list
     * @param {boolean} readOnly - Whether sharing is read-only (default: true)
     * @returns {Promise<Object>} Share result with details
     */
    async shareContactWithDistributionList(contactId, listName, readOnly = true) {
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
            
            console.log(`🔄 Sharing contact "${contact.cardName}" with ${usernames.length} users from "${listName}":`, usernames);
            
            // Share the contact with each username
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
                    
                    const result = await this.shareContact(contactId, username, readOnly);
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
                            console.log(`✅ Successfully shared with: ${username}`);
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
            
            // 🔧 FIX: Only update contact metadata for successfully shared users, not all users
            const successfulUsernames = results
                .filter(result => result.success)
                .map(result => result.username);
            
            if (successfulUsernames.length > 0) {
                // Update contact metadata to track distribution list sharing
                await this.updateContactMetadata(contactId, {
                    metadata: {
                        sharedWithDistributionList: listName,
                        lastSharedAt: new Date().toISOString()
                    }
                });

                // 🔑 CRITICAL FIX: Save the distribution list sharing relationship to persistent storage
                // This ensures the relationship persists across browser/PC switches
                console.log('💾 Saving distribution list sharing relationship to persistent storage...');
                await this.database.saveDistributionListSharing(contactId, listName, successfulUsernames);
            } else {
                console.log('⚠️ No successful shares - skipping metadata and persistence updates');
            }
            
            console.log(`✅ Distribution list sharing complete: ${successCount} new shares, ${alreadySharedCount} already shared, ${errorCount} errors`);
            
            return {
                success: true,
                successCount,
                alreadySharedCount,
                errorCount,
                total: usernames.length,
                results,
                errors
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
     * Clean up contact metadata to reduce size
     * @param {Object} contact - Contact to clean up
     * @returns {Object} Cleaned contact
     */
    cleanupContactMetadata(contact) {
        const cleaned = { ...contact };
        
        // Limit interaction history to only essential data
        if (cleaned.metadata?.usage?.interactionHistory) {
            cleaned.metadata.usage.interactionHistory = cleaned.metadata.usage.interactionHistory
                .slice(-3) // Keep only last 3 interactions
                .map(interaction => ({
                    action: interaction.action,
                    timestamp: interaction.timestamp
                    // Remove duration and userId to save space
                }));
        }
        
        // Remove unnecessary fields that might accumulate
        if (cleaned.metadata?.sharing?.shareHistory) {
            cleaned.metadata.sharing.shareHistory = cleaned.metadata.sharing.shareHistory.slice(-5);
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