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
            this.handleContactsChanged(data.contacts);
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

            // Update database and cache
            await this.database.updateContact(updatedContact);
            this.contacts.set(contactId, updatedContact);

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
    handleContactsChanged(data) {
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
            
            // Remove old owned contacts
            ownedContactIds.forEach(id => this.contacts.delete(id));
            
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
        } else {
            // Handle shared contacts from a specific user
            console.log(`📨 Processing shared contacts from: ${sharedBy}`);
            
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
                // Ensure shared contacts have correct metadata
                contact.metadata = {
                    ...contact.metadata,
                    isOwned: false,
                    sharedBy: sharedBy,
                    databaseId: databaseId
                };
                
                // Create unique ID for shared contacts to avoid conflicts
                const sharedContactId = `shared_${sharedBy}_${contact.contactId}`;
                contact.contactId = sharedContactId;
                
                console.log('📋 Adding shared contact to cache:', sharedContactId, contact.cardName || 'Unnamed', `(from ${sharedBy})`);
                this.contacts.set(sharedContactId, contact);
            });
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
        return counts;
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
}