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
        
        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Initialize the contact manager
     * @returns {Promise<Object>} Initialization result
     */
    async initialize() {
        try {
            // Wait for database authentication
            if (!this.database.currentUser) {
                await new Promise((resolve) => {
                    const unsubscribe = this.eventBus.on('database:authenticated', () => {
                        unsubscribe();
                        resolve();
                    });
                });
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
            const validation = this.validator.validateContactData(sanitizedData);
            
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

            // Add to local cache
            this.contacts.set(contactId, contact);
            
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
            const validation = this.validator.validateContactData(sanitizedData);
            
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
                cardName: sanitizedData.cardName || existingContact.cardName,
                vcard: vCardString,
                metadata: {
                    ...existingContact.metadata,
                    lastUpdated: new Date().toISOString(),
                    distributionLists: sanitizedData.distributionLists || existingContact.metadata.distributionLists,
                    sync: {
                        ...existingContact.metadata.sync,
                        version: existingContact.metadata.sync.version + 1,
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

            // Update local cache
            this.contacts.set(contactId, updatedContact);
            
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

            console.log('✅ Shared contact archived in user metadata:', contactId);
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
            console.log('🔍 Starting search with', results.length, 'total contacts');

            // Debug: Log contact states
            results.forEach((contact, index) => {
                console.log(`🔍 Contact ${index + 1}: ${contact.cardName}`, {
                    isDeleted: contact.metadata.isDeleted,
                    isArchived: contact.metadata.isArchived,
                    contactId: contact.contactId
                });
            });

            // Filter out deleted contacts by default
            if (!filters.includeDeleted) {
                const beforeCount = results.length;
                results = results.filter(contact => !contact.metadata.isDeleted);
                console.log('🔍 After deleted filter:', results.length, '(removed', beforeCount - results.length, 'deleted contacts)');
            }

            // Filter out archived contacts by default
            if (!filters.includeArchived) {
                const beforeCount = results.length;
                results = results.filter(contact => !contact.metadata.isArchived);
                console.log('🔍 After archived filter:', results.length, '(removed', beforeCount - results.length, 'archived contacts)');
            }

            // Text search
            if (query && query.trim()) {
                const searchTerm = query.toLowerCase().trim();
                console.log('🔍 Applying text search for:', searchTerm);
                const beforeCount = results.length;
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
                console.log('🔍 After text search:', results.length, '(removed', beforeCount - results.length, 'non-matching contacts)');
            } else {
                console.log('🔍 No text search applied (empty query)');
            }

            // Apply additional filters
            results = this.applyFilters(results, filters);

            // Cache results
            this.searchCache.set(cacheKey, results);
            this.lastSearchQuery = query;

            console.log('🔍 Final search results:', results.length, 'contacts');
            results.forEach((contact, index) => {
                console.log(`🔍 Result ${index + 1}: ${contact.cardName} (${contact.contactId})`);
            });

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

        // Distribution list filter
        if (filters.distributionList) {
            filtered = filtered.filter(contact => 
                contact.metadata.distributionLists?.includes(filters.distributionList));
        }

        // Ownership filter
        if (filters.ownership === 'owned') {
            filtered = filtered.filter(contact => contact.metadata.isOwned);
        } else if (filters.ownership === 'shared') {
            filtered = filtered.filter(contact => !contact.metadata.isOwned);
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
                const lastAccessed = contact.metadata.usage.lastAccessedAt;
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
                    const aData = this.vCardStandard.extractDisplayData(a);
                    const bData = this.vCardStandard.extractDisplayData(b);
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
                    valueA = a.metadata.usage.lastAccessedAt ? new Date(a.metadata.usage.lastAccessedAt) : new Date(0);
                    valueB = b.metadata.usage.lastAccessedAt ? new Date(b.metadata.usage.lastAccessedAt) : new Date(0);
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
        
        return {
            total: allContacts.length,
            active: allContacts.filter(c => !c.metadata.isDeleted && !c.metadata.isArchived).length,
            archived: allContacts.filter(c => c.metadata.isArchived && !c.metadata.isDeleted).length,
            deleted: allContacts.filter(c => c.metadata.isDeleted).length,
            owned: allContacts.filter(c => c.metadata.isOwned).length,
            shared: allContacts.filter(c => !c.metadata.isOwned).length,
            favorites: allContacts.filter(c => c.metadata.isFavorite).length,
            distributionLists: this.getDistributionListCounts()
        };
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
            
            const updatedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    usage: {
                        accessCount: (contact.metadata.usage.accessCount || 0) + 1,
                        lastAccessedAt: now,
                        viewDuration,
                        interactionHistory: [
                            ...(contact.metadata.usage.interactionHistory || []).slice(-49), // Keep last 50
                            {
                                action: 'viewed',
                                timestamp: now,
                                userId: this.database.currentUser?.userId,
                                duration: viewDuration
                            }
                        ]
                    },
                    lastUpdated: now
                }
            };

            // For shared contacts, store usage in user's metadata database
            if (contactId.startsWith('shared_')) {
                console.log('📊 Tracking access for shared contact in user metadata:', contactId);
                
                // Get existing metadata or create new
                const existingMetadata = await this.database.getSharedContactMetadata(contactId) || {};
                
                // Update metadata with usage tracking
                await this.database.updateSharedContactMetadata(contactId, {
                    ...existingMetadata,
                    usage: updatedContact.metadata.usage,
                    lastAccessedAt: now
                });
                
                // Update local cache
                this.contacts.set(contactId, updatedContact);
            } else {
                // For owned contacts, update both database and cache
                await this.database.updateContact(updatedContact);
                this.contacts.set(contactId, updatedContact);
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
     * Import contact from vCard
     * @param {string} vCardString - vCard string
     * @param {string} cardName - Optional card name
     * @returns {Promise<Object>} Import result
     */
    async importContactFromVCard(vCardString, cardName = null) {
        try {
            const contact = this.vCardStandard.importFromVCard(vCardString, cardName);
            const saveResult = await this.database.saveContact(contact);
            
            if (saveResult.success) {
                this.contacts.set(contact.contactId, contact);
                this.clearSearchCache();
                this.eventBus.emit('contact:imported', { contact });
            }

            return saveResult;
        } catch (error) {
            console.error('Import contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get contact by ID
     * @param {string} contactId - Contact ID
     * @returns {Object|null} Contact object
     */
    getContact(contactId) {
        return this.contacts.get(contactId) || null;
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
        
        console.log(`📋 ContactManager: Received ${isOwned ? 'owned' : 'shared'} contacts changed event with`, 
                   contactsArray.length, 'contacts:', contactsArray);
        
        if (isOwned) {
            // Handle owned contacts - replace all owned contacts
            const ownedContactIds = Array.from(this.contacts.keys()).filter(id => {
                const contact = this.contacts.get(id);
                return contact.metadata.isOwned;
            });
            
            console.log('📋 Found existing owned contacts to remove:', ownedContactIds.length);
            console.log('📋 Existing total contacts before cleanup:', this.contacts.size);
            
            // Remove old owned contacts
            ownedContactIds.forEach(id => this.contacts.delete(id));
            
            console.log('📋 Contacts after removing owned:', this.contacts.size);
            
            // Add new owned contacts
            contactsArray.forEach(contact => {
                // Ensure owned contacts have correct metadata
                contact.metadata = {
                    ...contact.metadata,
                    isOwned: true,
                    sharedBy: null,
                    databaseId: null
                };
                console.log('📋 Adding owned contact to cache:', contact.contactId, contact.cardName || 'Unnamed');
                this.contacts.set(contact.contactId, contact);
            });
            
            console.log('📋 Final contact count after adding owned:', this.contacts.size);
        } else {
            // Handle shared contacts from a specific user
            console.log(`📨 Processing shared contacts from: ${sharedBy} (databaseId: ${databaseId})`);
            console.log('📨 Contacts before processing shared:', this.contacts.size);
            
            // Remove old shared contacts from this same sharer/database
            const oldSharedContactIds = Array.from(this.contacts.keys()).filter(id => {
                const contact = this.contacts.get(id);
                return !contact.metadata.isOwned && 
                       contact.metadata.sharedBy === sharedBy &&
                       contact.metadata.databaseId === databaseId;
            });
            
            console.log('📨 Found old shared contacts to remove:', oldSharedContactIds.length, oldSharedContactIds);
            
            oldSharedContactIds.forEach(id => this.contacts.delete(id));
            
            console.log('📨 Contacts after removing old shared:', this.contacts.size);
            
            // Add new shared contacts
            contactsArray.forEach(contact => {
                // Ensure shared contacts have correct metadata
                contact.metadata = {
                    ...contact.metadata,
                    isOwned: false,
                    sharedBy: sharedBy,
                    databaseId: databaseId,
                    originalContactId: contact.contactId  // Store original ID for reference
                };
                
                // Create unique ID for shared contacts to avoid conflicts
                const originalId = contact.contactId;
                const sharedContactId = `shared_${sharedBy}_${contact.contactId}`;
                contact.contactId = sharedContactId;
                
                console.log('📋 Adding shared contact to cache:', sharedContactId, contact.cardName || 'Unnamed', `(from ${sharedBy}, original: ${originalId})`);
                this.contacts.set(sharedContactId, contact);
            });
            
            // Load and merge user's metadata for shared contacts
            await this.loadAndMergeSharedContactMetadata();
            
            console.log('📨 Final contact count after adding shared:', this.contacts.size);
        }

        // Clear search cache
        this.clearSearchCache();

        console.log('📋 ContactManager: Total contacts in cache:', this.contacts.size);
        console.log('📋 ContactManager: Emitting contactsUpdated event');
        
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
            console.log('📊 Found metadata for', metadataMap.size, 'shared contacts');
            
            // Merge metadata with shared contacts in cache
            for (const [sharedContactId, contact] of this.contacts.entries()) {
                if (sharedContactId.startsWith('shared_') && metadataMap.has(sharedContactId)) {
                    const userMetadata = metadataMap.get(sharedContactId);
                    
                    console.log('📊 Merging metadata for shared contact:', sharedContactId, {
                        isArchived: userMetadata.isArchived,
                        accessCount: userMetadata.usage?.accessCount || 0
                    });
                    
                    // Merge user-specific metadata with contact
                    const updatedContact = {
                        ...contact,
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
                    
                    this.contacts.set(sharedContactId, updatedContact);
                }
            }
            
            console.log('✅ Shared contact metadata merged successfully');
            
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
            console.log('📋 Creating distribution list:', listData);
            
            // Validate list data
            if (!listData.name || typeof listData.name !== 'string') {
                return { success: false, error: 'List name is required' };
            }
            
            const listName = listData.name.trim();
            if (listName.length === 0) {
                return { success: false, error: 'List name cannot be empty' };
            }
            
            // Check if list already exists
            const existingLists = this.getDistributionListCounts();
            const existingList = existingLists.find(list => 
                list.name.toLowerCase() === listName.toLowerCase());
            
            if (existingList) {
                return { success: false, error: 'A list with this name already exists' };
            }
            
            // Create the list metadata
            const listMetadata = {
                name: listName,
                description: listData.description || '',
                color: listData.color || '#007bff',
                createdAt: new Date().toISOString(),
                createdBy: this.database.getCurrentUser()?.username || 'unknown',
                contactCount: 0
            };
            
            // Save to settings/preferences (this could be expanded to use a dedicated lists database)
            const currentSettings = await this.database.getSettings() || {};
            const distributionLists = currentSettings.distributionLists || {};
            
            distributionLists[listName] = listMetadata;
            
            const updateResult = await this.database.updateSettings({
                ...currentSettings,
                distributionLists
            });
            
            if (updateResult) {
                console.log('✅ Distribution list created successfully:', listMetadata);
                
                // Emit event for UI updates
                this.eventBus.emit('distributionList:created', { list: listMetadata });
                
                return { success: true, list: listMetadata };
            } else {
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
            
            // Convert to array with contact counts calculated directly
            const lists = Object.values(distributionLists).map(list => {
                // Count contacts assigned to this list
                let contactCount = 0;
                for (const contact of this.contacts.values()) {
                    if (!contact.isDeleted && 
                        contact.metadata && 
                        contact.metadata.distributionLists && 
                        contact.metadata.distributionLists.includes(list.name)) {
                        contactCount++;
                    }
                }
                
                return {
                    ...list,
                    contactCount: contactCount
                };
            });
            
            return lists.sort((a, b) => a.name.localeCompare(b.name));
            
        } catch (error) {
            console.error('❌ Error getting distribution lists:', error);
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
            
            if (updateResult.success) {
                // Remove the list from all contacts
                for (const contact of this.contacts.values()) {
                    if (contact.metadata.distributionLists?.includes(listName)) {
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
            if (!contact.isDeleted && 
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
            if (!contact.isDeleted) {
                contacts.push({
                    ...contact,
                    assignedLists: contact.metadata?.distributionLists || []
                });
            }
        }
        
        return contacts;
    }
}