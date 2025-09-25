/**
 * ContactDatabase - Userbase integration for encrypted contact storage
 * Handles all database operations with real-time synchronization
 */
export class ContactDatabase {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.isInitialized = false;
        this.currentUser = null;
        this.databases = {
            contacts: 'contacts',
            settings: 'user-settings',
            activity: 'activity-log',
            sharedContactMeta: 'shared-contact-metadata',  // Store user's metadata for shared contacts
            distributionSharing: 'distribution-sharing'   // Store distribution list sharing relationships
        };
        this.changeHandlers = new Map();
        this.lastKnownSharedCount = 0;
        this.sharedDatabaseMonitor = null;
        this.settingsItems = []; // Initialize settings items array
    }

    /**
     * Get current authenticated user
     * @returns {Object|null} Current user object
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Initialize Userbase connection with retry logic
     * @param {string} appId - Userbase application ID
     */
    /**
     * Initialize the database connection
     * @param {string} appId - Userbase app ID
     * @returns {Promise<void>}
     */
    async initialize(appId) {
        if (this.isInitialized) {
            return;
        }

        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount <= maxRetries) {
            try {
                // Check if Userbase SDK is available
                if (typeof window.userbase === 'undefined') {
                    console.error('❌ Userbase SDK not loaded!');
                    throw new Error('Userbase SDK not loaded. Make sure userbase.js is loaded before app.js');
                }

                this.appId = appId;
                
                // Clear any corrupted storage on retry
                if (retryCount > 0) {
                    this.clearCorruptedStorage();
                    await this.sleep(1000); // Wait 1 second before retry
                }
                
                // Initialize Userbase - this can restore previous sessions
                const session = await window.userbase.init({ 
                    appId,
                    updateUserHandler: (user) => {
                        this.currentUser = user;
                        this.eventBus.emit('database:userUpdated', { user });
                    }
                });
                
                // Check user's persistence preferences regardless of session state
                const persistentPreference = localStorage.getItem('auth_persist_preference');
                const sessionPreference = sessionStorage.getItem('auth_persist_preference');
                
                // CRITICAL: If user has no persistence preference, they should not stay logged in
                // This handles both cases: session.user exists OR Userbase has hidden session data
                const shouldForceLogout = !persistentPreference && !sessionPreference;
                
                if (shouldForceLogout) {
                    console.log('⚠️ No auth persistence preference found - forcing logout');
                    try {
                        // Force sign out to clear any hidden Userbase session data
                        await userbase.signOut();
                    } catch (error) {
                        // Ignore "not signed in" errors
                        if (!error.message.includes('Not signed in')) {
                            console.warn('Warning during forced signOut:', error);
                        }
                    }
                    
                    // Clear our state and emit signed out event
                    this.currentUser = null;
                    this.eventBus.emit('database:signedOut', { reason: 'no_persistence_preference' });
                    
                    // Don't process session.user even if it exists
                } else if (session.user) {
                    if (persistentPreference === 'persistent') {
                        // User wants to stay signed in across refreshes
                        this.currentUser = session.user;
                        await this.setupDatabases();
                        this.eventBus.emit('database:authenticated', { user: this.currentUser });
                    } else if (sessionPreference === 'session-only') {
                        // User is OK with session persistence within the same browser session
                        this.currentUser = session.user;
                        await this.setupDatabases();
                        this.eventBus.emit('database:authenticated', { user: this.currentUser });
                    } else {
                        // Unknown preference state - log out for security
                        await userbase.signOut();
                        this.currentUser = null;
                        this.eventBus.emit('database:signedOut', { reason: 'unknown_preference_state' });
                    }
                }
                
                this.isInitialized = true;
                
                this.eventBus.emit('database:initialized', { 
                    appId,
                    timestamp: new Date().toISOString() 
                });

                // Start periodic check for new shared databases
                this.startSharedDatabaseMonitoring();
                
                return; // Success, exit retry loop
                
            } catch (error) {
                console.error(`Database initialization failed (attempt ${retryCount + 1}):`, error);
                
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    await this.sleep(2000);
                } else {
                    console.error('❌ Max retry attempts reached for database initialization');
                    this.eventBus.emit('database:error', { 
                        error: `Initialization failed after ${maxRetries + 1} attempts: ${error.message}`,
                        phase: 'initialization',
                        retryCount: maxRetries + 1
                    });
                    throw error;
                }
            }
        }
    }

    /**
     * Clear potentially corrupted storage
     */
    clearCorruptedStorage() {
        try {
            // Clear Userbase-related storage
            if (typeof localStorage !== 'undefined') {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.includes('userbase') || key.includes('Userbase') || key.startsWith('ub_')) {
                        localStorage.removeItem(key);
                    }
                });
            }
            
            if (typeof sessionStorage !== 'undefined') {
                const keys = Object.keys(sessionStorage);
                keys.forEach(key => {
                    if (key.includes('userbase') || key.includes('Userbase') || key.startsWith('ub_')) {
                        sessionStorage.removeItem(key);
                    }
                });
            }
        } catch (error) {
            console.error('Error clearing corrupted storage:', error);
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
     * Sign up new user
     * @param {string} username - Username
     * @param {string} password - Password
     * @returns {Promise<Object>} Signup result
     */
    async signUp(username, password) {
        try {
            const result = await userbase.signUp({
                username,
                password
            });

            this.currentUser = result.user || result; // Handle both wrapped and unwrapped formats
            await this.setupDatabases();
            
            this.eventBus.emit('database:authenticated', { user: this.currentUser });
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.error('Sign up failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign in existing user
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {boolean} rememberMe - Whether to keep the user signed in
     * @returns {Promise<Object>} Signin result
     */
    async signIn(username, password, rememberMe = false) {
        try {
            // Store the user's preference for session persistence
            if (rememberMe) {
                localStorage.setItem('auth_persist_preference', 'persistent');
            } else {
                // Use sessionStorage for non-persistent sessions
                sessionStorage.setItem('auth_persist_preference', 'session-only');
                // Clear any persistent preference
                localStorage.removeItem('auth_persist_preference');
            }
            
            const userbaseOptions = {
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session' // 'local' = persistent, 'session' = session only
            };
            
            const result = await userbase.signIn(userbaseOptions);

            // Userbase signIn returns the user object directly, not wrapped in { user: ... }
            this.currentUser = result.user || result; // Handle both wrapped and unwrapped formats
            await this.setupDatabases();
            
            this.eventBus.emit('database:authenticated', { user: this.currentUser });
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.error('Sign in failed:', error);
            
            // Handle case where user is already signed in
            if (error.name === 'UserAlreadySignedIn') {
                
                // If currentUser is null but Userbase says user is signed in,
                // we need to restore from what Userbase already knows
                if (!this.currentUser) {
                    // Check if the app was already initialized with a user session
                    // The user should already be in this.currentUser from initialization
                    console.log('❌ currentUser is null but should have been set during init');
                    this.eventBus.emit('database:error', { error: 'Session state mismatch - please reload page' });
                    return { success: false, error: 'Session state error - please reload page' };
                }
                
                await this.setupDatabases();
                this.eventBus.emit('database:authenticated', { user: this.currentUser });
                return { success: true, user: this.currentUser };
            }
            
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign out current user
     * @returns {Promise<Object>} Signout result
     */
    async signOut() {
        try {
            // Sign out from Userbase
            await userbase.signOut();
            
            // Clear all application state
            this.currentUser = null;
            this.changeHandlers.clear();
            
            // Clear localStorage and sessionStorage to ensure complete logout
            try {
                // Clear our app storage
                localStorage.clear();
                sessionStorage.clear();
                
                // Also try to clear IndexedDB databases that might be used by Userbase
                if ('indexedDB' in window) {
                    try {
                        const databases = await indexedDB.databases();
                        for (const db of databases) {
                            if (db.name && (db.name.includes('userbase') || db.name.includes('Userbase'))) {
                                indexedDB.deleteDatabase(db.name);
                            }
                        }
                    } catch (idbError) {
                        console.warn('⚠️ Could not clear IndexedDB:', idbError);
                    }
                }
            } catch (storageError) {
                console.warn('⚠️ Could not clear storage:', storageError);
                // Continue with logout even if storage clearing fails
            }
            
            this.eventBus.emit('database:signedOut', {});
            console.log('✅ User signed out successfully');
            return { success: true };
        } catch (error) {
            console.error('❌ Sign out failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup user databases with change handlers
     */
    async setupDatabases() {
        try {
            // Setup own contacts database with real-time updates
            await this.openDatabase('contacts', (items) => {
                this.eventBus.emit('contacts:changed', { contacts: items, isOwned: true });
            });

            // Setup shared contact databases - CRITICAL for cross-device sharing
            await this.setupSharedDatabases();

            // Force initial monitoring check for any existing shared databases
            console.log('🔍 Performing initial shared database check...');
            await this.checkForNewSharedDatabases();

            // Setup settings database
            await this.openDatabase('user-settings', (items) => {
                this.settingsItems = items; // Store settings locally
                this.eventBus.emit('settings:changed', { settings: items });
            });

            // Setup activity log database
            await this.openDatabase('activity-log', (items) => {
                this.eventBus.emit('activity:changed', { activities: items });
            });

            // Setup distribution sharing database
            await this.openDatabase('distribution-sharing', (items) => {
                this.eventBus.emit('distributionSharing:changed', { distributionSharing: items });
            });

        } catch (error) {
            console.error('❌ Database setup failed:', error);
            throw error;
        }
    }

    /**
     * Setup shared contact databases - CRITICAL FIX for cross-device sharing
     */
    async setupSharedDatabases() {
        try {
            // Get ALL databases (both owned and received) to handle cross-device sharing
            const allDatabases = await this.getAllSharedContactDatabases();
            if (!allDatabases.success) {
                console.log('📭 No shared databases found or error accessing them');
                return;
            }

            const { ownedSharedDatabases, receivedSharedDatabases } = allDatabases;
            
            // 🔑 CRITICAL FIX: Handle OWNED shared databases (for cross-device editing)
            // When User1 switches devices, they need to monitor their own shared databases
            // to ensure updates propagate to recipients
            for (const db of ownedSharedDatabases) {
                try {
                    await userbase.openDatabase({
                        databaseName: db.databaseName, // Use databaseName for owned databases
                        changeHandler: (items) => {
                            // Don't emit contacts:changed for owned shared databases
                            // These are just for monitoring outgoing changes
                            // The contact changes will be handled by the main contacts database
                        }
                    });
                } catch (error) {
                    console.error(`❌ Failed to open owned shared database ${db.databaseName}:`, error);
                }
            }

            // Handle RECEIVED shared databases (from other users)
            for (const db of receivedSharedDatabases) {
                try {
                    await userbase.openDatabase({
                        databaseId: db.databaseId,
                        changeHandler: (items) => {
                            // Transform individual contact
                            const contacts = items.map(userbaseItem => {
                                const item = userbaseItem.item || {};
                                return {
                                    contactId: item.contactId || userbaseItem.itemId,
                                    itemId: userbaseItem.itemId, // ✅ Preserve Userbase itemId
                                    cardName: item.cardName || 'Unnamed Contact',
                                    vcard: item.vcard || '',
                                    metadata: {
                                        ...item.metadata,
                                        isOwned: false,
                                        sharedBy: db.receivedFromUsername,
                                        databaseId: db.databaseId,
                                        shareType: 'individual',
                                        lastUpdated: item.metadata?.lastUpdated || new Date().toISOString()
                                    }
                                };
                            });
                            
                            this.eventBus.emit('contacts:changed', { 
                                contacts: contacts, 
                                isOwned: false,
                                sharedBy: db.receivedFromUsername,
                                databaseId: db.databaseId,
                                shareType: 'individual'
                            });
                        }
                    });
                } catch (error) {
                    console.error(`❌ Failed to open received shared contact from ${db.receivedFromUsername}:`, error);
                }
            }
        } catch (error) {
            console.error('❌ Setup shared databases failed:', error);
        }
    }

    /**
     * Open database with change handler
     * @param {string} databaseName - Database name
     * @param {Function} changeHandler - Change handler function
     */
    async openDatabase(databaseName, changeHandler) {
        try {
            await userbase.openDatabase({
                databaseName,
                changeHandler: (items) => {
                    // Process items and emit appropriate events
                    const processedItems = items.map((item, index) => {
                        const processed = {
                            ...item.item,
                            itemId: item.itemId,
                            contactId: item.item.contactId || item.itemId // Ensure contactId is available
                        };
                        
                        return processed;
                    });
                    
                    changeHandler(processedItems);
                }
            });

            this.changeHandlers.set(databaseName, changeHandler);
        } catch (error) {
            console.error(`Failed to open database ${databaseName}:`, error);
            throw error;
        }
    }

    /**
     * Save contact to database
     * @param {Object} contact - Contact object
     * @returns {Promise<Object>} Save result
     */
    async saveContact(contact) {
        try {
            // Use contactId as itemId to ensure we can reference it later
            const itemId = contact.contactId;
            
            await userbase.insertItem({
                databaseName: this.databases.contacts,
                itemId: itemId, // Specify the itemId explicitly
                item: {
                    ...contact,
                    contactId: contact.contactId // Keep contactId for clarity
                }
            });

            this.eventBus.emit('contact:saved', { contact, itemId });
            return { success: true, itemId };
        } catch (error) {
            console.error('Save contact failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update existing contact
     * @param {Object} contact - Updated contact object
     * @returns {Promise<Object>} Update result
     */
    async updateContact(contact) {
        try {
            const itemId = contact.itemId || contact.contactId;
            
            if (!itemId) {
                throw new Error('No itemId or contactId provided for update');
            }
            
            // Update in main contacts database
            await userbase.updateItem({
                databaseName: this.databases.contacts,
                item: {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        lastUpdated: new Date().toISOString()
                    }
                },
                itemId
            });

            // If this contact has been shared individually, update all shared databases
            if (contact.metadata?.isOwned !== false) { // Only for owned contacts
                await this.updateSharedContactDatabases(contact);
            }

            this.eventBus.emit('contact:updated', { contact });
            return { success: true, itemId };
        } catch (error) {
            console.error('Update contact failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update contact metadata only (for access tracking) without updating lastUpdated timestamp
     * This preserves the lastUpdated field to only reflect actual content changes
     * @param {Object} contact - Contact object with metadata updates
     * @returns {Promise<Object>} Update result
     */
    async updateContactMetadataOnly(contact) {
        try {
            const itemId = contact.itemId || contact.contactId;
            
            if (!itemId) {
                throw new Error('No itemId or contactId provided for metadata update');
            }
            
            // Update in main contacts database WITHOUT changing lastUpdated
            await userbase.updateItem({
                databaseName: this.databases.contacts,
                item: {
                    ...contact
                    // Note: Explicitly NOT updating lastUpdated timestamp
                },
                itemId
            });

            // Don't update shared databases for metadata-only changes (access tracking)
            // This is typically only used for usage tracking which is user-specific

            // Emit a different event to avoid confusion with content updates
            this.eventBus.emit('contact:metadataUpdated', { contact });
            return { success: true, itemId };
        } catch (error) {
            console.error('Update contact metadata failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update contact in all shared databases (for real-time sync)
     * @param {Object} contact - Updated contact object
     */
    async updateSharedContactDatabases(contact) {
        try {
            const sharedDbName = `shared-contact-${contact.contactId}`;
            
            // Try to update the shared database
            // Note: We can't easily check if the database exists, so we try to update and catch errors
            try {
                await userbase.updateItem({
                    databaseName: sharedDbName,
                    itemId: contact.contactId,
                    item: {
                        ...contact,
                        metadata: {
                            ...contact.metadata,
                            lastUpdated: new Date().toISOString(),
                            sharedAt: contact.metadata?.sharedAt, // Preserve original sharing timestamp
                            sharedBy: contact.metadata?.sharedBy // Preserve sharing info
                        }
                    }
                });
                
            } catch (error) {
                // If the shared database doesn't exist, not open, or we don't have access, that's okay
                if (error.name === 'DatabaseDoesNotExist' || 
                    error.name === 'DatabaseNotOpen' || 
                    error.name === 'Unauthorized') {
                } else {
                    console.error(`❌ Failed to update shared database ${sharedDbName}:`, error);
                }
            }
        } catch (error) {
            console.error('❌ Error in updateSharedContactDatabases:', error);
        }
    }

    // ========== DISTRIBUTION LIST SHARING PERSISTENCE METHODS ==========

    /**
     * Save distribution list sharing relationship 
     * @param {string} contactId - Contact ID that was shared
     * @param {string} listName - Distribution list name
     * @param {Array} usernames - Array of usernames shared with
     * @returns {Promise<Object>} Save result
     */
    async saveDistributionListSharing(contactId, listName, usernames) {
        try {
            const sharingRecord = {
                contactId,
                listName,
                usernames: usernames.slice(), // Create a copy
                sharedAt: new Date().toISOString(),
                sharedBy: this.currentUser?.username || 'unknown',
                lastUpdated: new Date().toISOString()
            };

            // Use a deterministic itemId based on contact and list
            const itemId = `sharing_${contactId}_${listName}`;

            await userbase.insertItem({
                databaseName: this.databases.distributionSharing,
                item: sharingRecord,
                itemId: itemId
            });

            return { success: true, itemId, sharingRecord };

        } catch (error) {
            // If item already exists, update it
            if (error.name === 'ItemAlreadyExists') {
                return await this.updateDistributionListSharing(contactId, listName, usernames);
            }
            
            console.error('❌ Save distribution list sharing failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update distribution list sharing relationship
     * @param {string} contactId - Contact ID
     * @param {string} listName - Distribution list name 
     * @param {Array} usernames - Updated array of usernames
     * @returns {Promise<Object>} Update result
     */
    async updateDistributionListSharing(contactId, listName, usernames) {
        try {
            const itemId = `sharing_${contactId}_${listName}`;
            
            const sharingRecord = {
                contactId,
                listName,
                usernames: usernames.slice(), // Create a copy
                sharedAt: new Date().toISOString(), // Keep original time if needed
                sharedBy: this.currentUser?.username || 'unknown',
                lastUpdated: new Date().toISOString()
            };

            await userbase.updateItem({
                databaseName: this.databases.distributionSharing,
                itemId: itemId,
                item: sharingRecord
            });

            return { success: true, itemId, sharingRecord };

        } catch (error) {
            // If item doesn't exist, create it
            if (error.name === 'ItemDoesNotExist') {
                console.log('📝 Sharing record doesn\'t exist, creating new:', contactId, listName);
                return await this.saveDistributionListSharing(contactId, listName, usernames);
            }
            
            console.error('❌ Update distribution list sharing failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get distribution list sharing relationships for a contact
     * @param {string} contactId - Contact ID
     * @returns {Promise<Array>} Array of sharing relationships
     */
    async getDistributionListSharingForContact(contactId) {
        try {
            return new Promise((resolve, reject) => {
                userbase.openDatabase({
                    databaseName: this.databases.distributionSharing,
                    changeHandler: (items) => {
                        const contactSharings = items
                            .filter(item => item.item && item.item.contactId === contactId)
                            .map(item => item.item);
                        resolve(contactSharings);
                    },
                }).catch(reject);
            });
        } catch (error) {
            console.error('❌ Get distribution list sharing for contact failed:', error);
            return [];
        }
    }

    /**
     * Get all distribution list sharing relationships
     * @returns {Promise<Array>} Array of all sharing relationships
     */
    async getAllDistributionListSharings() {
        try {
            return new Promise((resolve, reject) => {
                userbase.openDatabase({
                    databaseName: this.databases.distributionSharing,
                    changeHandler: (items) => {
                        const sharings = items.map(item => item.item).filter(Boolean);
                        resolve(sharings);
                    },
                }).catch(reject);
            });
        } catch (error) {
            console.error('❌ Get all distribution list sharings failed:', error);
            return [];
        }
    }

    /**
     * Delete distribution list sharing relationship
     * @param {string} contactId - Contact ID
     * @param {string} listName - Distribution list name
     * @returns {Promise<Object>} Delete result
     */
    async deleteDistributionListSharing(contactId, listName) {
        try {
            const itemId = `sharing_${contactId}_${listName}`;

            await userbase.deleteItem({
                databaseName: this.databases.distributionSharing,
                itemId: itemId
            });

            return { success: true, deleted: true };

        } catch (error) {
            console.error('❌ Delete distribution list sharing failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get contacts shared with a specific distribution list
     * @param {string} listName - Distribution list name
     * @returns {Promise<Array>} Array of contact IDs shared with this list
     */
    async getContactsSharedWithDistributionList(listName) {
        try {
            return new Promise((resolve, reject) => {
                userbase.openDatabase({
                    databaseName: this.databases.distributionSharing,
                    changeHandler: (items) => {
                        const contactIds = items
                            .filter(item => item.item && item.item.listName === listName)
                            .map(item => item.item.contactId);
                        resolve(contactIds);
                    },
                }).catch(reject);
            });
        } catch (error) {
            console.error('❌ Get contacts shared with distribution list failed:', error);
            return [];
        }
    }

    /**
     * Save or update shared contact metadata (user-specific states like archive, access tracking)
     * @param {string} sharedContactId - The shared contact ID
     * @param {Object} metadata - Metadata to store
     * @returns {Promise<Object>} Save result
     */
    async saveSharedContactMetadata(sharedContactId, metadata) {
        try {
            const metadataItem = {
                sharedContactId,
                ...metadata,
                lastUpdated: new Date().toISOString()
            };

            await userbase.insertItem({
                databaseName: this.databases.sharedContactMeta,
                item: metadataItem,
                itemId: sharedContactId // Use shared contact ID as the item ID
            });

            return { success: true, metadata: metadataItem };
        } catch (error) {
            console.error('❌ Save shared contact metadata failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update shared contact metadata
     * @param {string} sharedContactId - The shared contact ID
     * @param {Object} metadata - Metadata to update
     * @returns {Promise<Object>} Update result
     */
    async updateSharedContactMetadata(sharedContactId, metadata) {
        try {
            const metadataItem = {
                sharedContactId,
                ...metadata,
                lastUpdated: new Date().toISOString()
            };

            await userbase.updateItem({
                databaseName: this.databases.sharedContactMeta,
                itemId: sharedContactId,
                item: metadataItem
            });

            return { success: true, metadata: metadataItem };
        } catch (error) {
            // If item doesn't exist, create it
            if (error.name === 'ItemDoesNotExist') {
                console.log('📝 Metadata doesn\'t exist, creating new:', sharedContactId);
                return await this.saveSharedContactMetadata(sharedContactId, metadata);
            }
            console.error('❌ Update shared contact metadata failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get shared contact metadata
     * @param {string} sharedContactId - The shared contact ID
     * @returns {Promise<Object>} Metadata or null
     */
    async getSharedContactMetadata(sharedContactId) {
        try {
            // We need to open the database and find the item
            // Since we can't query directly, we'll get all and filter
            const items = await new Promise((resolve, reject) => {
                userbase.openDatabase({
                    databaseName: this.databases.sharedContactMeta,
                    changeHandler: (items) => resolve(items),
                }).catch(reject);
            });

            const metadataItem = items.find(item => item.itemId === sharedContactId);
            return metadataItem ? metadataItem.item : null;
        } catch (error) {
            console.error('❌ Get shared contact metadata failed:', error);
            return null;
        }
    }

    /**
     * Get all shared contact metadata for the current user
     * @returns {Promise<Map>} Map of sharedContactId -> metadata
     */
    async getAllSharedContactMetadata() {
        try {
            return new Promise((resolve, reject) => {
                userbase.openDatabase({
                    databaseName: this.databases.sharedContactMeta,
                    changeHandler: (items) => {
                        const metadataMap = new Map();
                        items.forEach(item => {
                            if (item.item && item.item.sharedContactId) {
                                metadataMap.set(item.item.sharedContactId, item.item);
                            }
                        });
                        resolve(metadataMap);
                    },
                }).catch(reject);
            });
        } catch (error) {
            console.error('❌ Get all shared contact metadata failed:', error);
            return new Map();
        }
    }

    /**
     * Delete shared contact metadata
     * @param {string} sharedContactId - The shared contact ID
     * @returns {Promise<Object>} Delete result
     */
    async deleteSharedContactMetadata(sharedContactId) {
        try {
            await userbase.deleteItem({
                databaseName: this.databases.sharedContactMeta,
                itemId: sharedContactId
            });

            return { success: true };
        } catch (error) {
            console.error('❌ Delete shared contact metadata failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete contact from database
     * @param {string} itemId - Contact item ID
     * @returns {Promise<Object>} Delete result
     */
    async deleteContact(itemId) {
        try {
            await userbase.deleteItem({
                databaseName: this.databases.contacts,
                itemId
            });

            this.eventBus.emit('contact:deleted', { itemId });
            return { success: true };
        } catch (error) {
            console.error('Delete contact failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Share individual contact with another user
     * Creates a separate database for the contact to avoid sharing entire contact list
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @param {boolean} readOnly - Whether sharing is read-only
     * @param {boolean} resharingAllowed - Whether resharing is allowed
     * @returns {Promise<Object>} Share result
     */
    async shareContact(contact, username, readOnly = true, resharingAllowed = false) {
        try {
            if (!username || username.trim() === '') {
                throw new Error('Username is required for sharing');
            }
            
            if (!contact || !contact.contactId) {
                throw new Error('Valid contact is required for sharing');
            }

            // Create a unique database name for this shared contact
            const sharedDbName = `shared-contact-${contact.contactId}`;
            
            console.log('📦 Preparing to share contact database:', sharedDbName);

            // Check if the shared database already exists
            let databaseExists = false;
            try {
                const databases = await userbase.getDatabases();
                const dbList = databases.databases || databases;
                databaseExists = dbList.some(db => 
                    db.databaseName === sharedDbName && db.isOwner
                );
                console.log('🔍 Database exists check:', sharedDbName, '→', databaseExists);
            } catch (checkError) {
                console.log('⚠️ Could not check database existence, proceeding with creation:', checkError.message);
            }

            if (databaseExists) {
                // Database already exists, just add the new user to it
                console.log('📤 Adding user to existing shared database:', username);
                await userbase.shareDatabase({
                    databaseName: sharedDbName,
                    username: username.trim(),
                    readOnly,
                    resharingAllowed,
                    requireVerified: false
                });
                console.log('✅ Successfully added user to existing shared database:', username);
                
                // Update the existing contact item in the shared database to ensure it's current
                try {
                    await this.updateSharedContactDatabase(contact, sharedDbName);
                    console.log('✅ Updated contact data in shared database');
                } catch (updateError) {
                    console.log('⚠️ Could not update contact in shared database:', updateError.message);
                    // Continue anyway, the sharing was successful
                }
            } else {
                // Database doesn't exist, create it and share it
                console.log('📦 Creating new shared database:', sharedDbName);

                // First, create/open the shared database and add the contact
                await userbase.openDatabase({
                    databaseName: sharedDbName,
                    changeHandler: () => {} // Empty handler since this is just for creation
                });

                // Insert the contact into the shared database
                await userbase.insertItem({
                    databaseName: sharedDbName,
                    item: {
                        ...contact,
                        metadata: {
                            ...contact.metadata,
                            sharedAt: new Date().toISOString(),
                            sharedBy: this.currentUser?.username,
                            originalContactId: contact.contactId
                        }
                    },
                    itemId: contact.contactId
                });

                // Now share this specific database with the target user
                await userbase.shareDatabase({
                    databaseName: sharedDbName,
                    username: username.trim(),
                    readOnly,
                    resharingAllowed,
                    requireVerified: false
                });

                console.log('✅ New shared database created and shared with:', username);
            }

            console.log('✅ Individual contact shared successfully with:', username);

            // Log the sharing activity
            await this.logActivity({
                action: 'contact_shared',
                targetUser: username,
                details: {
                    contactId: contact.contactId,
                    contactName: contact.cardName,
                    databaseName: sharedDbName,
                    readOnly,
                    resharingAllowed
                }
            });

            this.eventBus.emit('contact:shared', { 
                contactId: contact.contactId,
                username, 
                readOnly, 
                resharingAllowed,
                sharedDbName
            });
            
            return { success: true, sharedDbName };
        } catch (error) {
            console.error('Share contact failed:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                name: error.name,
                stack: error.stack
            });
            
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update contact in shared database after editing - CRITICAL for cross-device updates
     * @param {Object} contact - Updated contact object
     * @param {string} sharedDbName - Name of the shared database
     * @returns {Promise<Object>} Update result
     */
    async updateSharedContactDatabase(contact, sharedDbName) {
        try {
            console.log('🔄 Updating contact in shared database:', sharedDbName);
            
            // Update the contact in the shared database to ensure recipients get updates
            await userbase.updateItem({
                databaseName: sharedDbName,
                item: {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        lastSharedUpdate: new Date().toISOString(),
                        sharedBy: this.currentUser?.username
                    }
                },
                itemId: contact.contactId
            });
            
            console.log('✅ Contact updated in shared database:', sharedDbName);
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to update contact in shared database:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Revoke user access to a specific contact's shared database
     * @param {string} contactId - The contact ID to revoke access to
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revocation result
     */
    async revokeContactAccess(contactId, username) {
        try {
            const sharedDbName = `shared-contact-${contactId}`;
            console.log(`🔒 Revoking access to shared database "${sharedDbName}" from user "${username}"`);
            
            // First check if the database exists and we own it
            let databaseExists = false;
            try {
                const databases = await userbase.getDatabases();
                const dbList = databases.databases || databases;
                databaseExists = dbList.some(db => 
                    db.databaseName === sharedDbName && db.isOwner
                );
                console.log('🔍 Database exists check for revocation:', sharedDbName, '→', databaseExists);
            } catch (checkError) {
                console.log('⚠️ Could not check database existence for revocation:', checkError.message);
                return { success: false, error: `Could not verify database ownership: ${checkError.message}` };
            }

            if (!databaseExists) {
                console.log('📝 Database does not exist or not owned, skipping revocation:', sharedDbName);
                return { success: true, message: 'Database not found or not owned' };
            }

            // Remove user from the shared database
            // Note: We'll try using shareDatabase with revoke parameter
            // If that doesn't work, we may need to delete and recreate the database
            try {
                await userbase.shareDatabase({
                    databaseName: sharedDbName,
                    username: username.trim(),
                    revoke: true
                });
                console.log(`✅ Successfully revoked access using shareDatabase revoke`);
            } catch (revokeError) {
                console.log(`⚠️ shareDatabase revoke failed, trying alternative approach:`, revokeError.message);
                
                // Alternative approach: If revoke isn't supported, we could delete and recreate
                // For now, we'll just log this limitation
                console.log(`❌ Cannot revoke access to "${sharedDbName}" from user "${username}" - Userbase may not support direct revocation`);
                return { 
                    success: false, 
                    error: `Access revocation not supported: ${revokeError.message}`,
                    suggestion: "User will retain access until database is recreated"
                };
            }
            
            console.log(`✅ Successfully revoked access to "${sharedDbName}" from user "${username}"`);

            // Log the revocation activity
            await this.logActivity({
                action: 'contact_access_revoked',
                targetUser: username,
                details: {
                    contactId: contactId,
                    databaseName: sharedDbName
                }
            });

            this.eventBus.emit('contact:access_revoked', { 
                contactId: contactId,
                username: username,
                sharedDbName: sharedDbName
            });
            
            return { success: true, sharedDbName };

        } catch (error) {
            console.error(`❌ Revoke contact access failed for contact ${contactId}, user ${username}:`, error);
            
            // Check if this is because the user wasn't shared with in the first place
            if (error.message && (
                error.message.includes('User does not exist') ||
                error.message.includes('User not found') ||
                error.message.includes('not permitted')
            )) {
                console.log('📝 User was not shared with this database, considering revocation successful');
                return { success: true, message: 'User was not shared with this contact' };
            }
            
            console.error('Revocation error details:', {
                message: error.message,
                code: error.code,
                name: error.name
            });
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Update an existing shared contact database with latest contact data
     * @param {Object} contact - The contact data to update
     * @param {string} sharedDbName - The shared database name
     * @returns {Promise<Object>} Update result
     */
    async updateSharedContactDatabase(contact, sharedDbName) {
        try {
            console.log(`📝 Updating existing shared contact in database: ${sharedDbName}`);
            
            // Open the shared database
            await userbase.openDatabase({
                databaseName: sharedDbName,
                changeHandler: (items) => {
                    console.log(`📄 Shared database ${sharedDbName} items:`, items);
                }
            });

            // Update the contact item in the shared database
            // Use contactId as itemId since that's how it was originally inserted
            await userbase.updateItem({
                databaseName: sharedDbName,
                itemId: contact.contactId,
                item: contact
            });

            console.log(`✅ Successfully updated contact in shared database: ${sharedDbName}`);
            return { success: true };

        } catch (error) {
            console.error(`❌ Error updating shared contact database ${sharedDbName}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all shared databases
     * @returns {Promise<Array>} Array of shared databases
     */
    /**
     * Get all shared contact databases (both owned and received) - CRITICAL for cross-device sharing
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabases() {
        try {
            const databases = await userbase.getDatabases();
            
            // Check if databases is an object with databases property or direct array
            let databasesArray;
            if (Array.isArray(databases)) {
                databasesArray = databases;
            } else if (databases && Array.isArray(databases.databases)) {
                databasesArray = databases.databases;
            } else {
                console.warn('⚠️ Unexpected databases format:', databases);
                return { success: true, ownedSharedDatabases: [], receivedSharedDatabases: [] };
            }
            
            // Filter for shared contact databases
            const sharedContactDatabases = databasesArray.filter(db => 
                db.databaseName.startsWith('shared-contact-')
            );
            
            // Separate owned vs received shared databases
            const ownedSharedDatabases = sharedContactDatabases.filter(db => db.isOwner);
            const receivedSharedDatabases = sharedContactDatabases.filter(db => !db.isOwner);
            
            return { 
                success: true, 
                ownedSharedDatabases,
                receivedSharedDatabases
            };
        } catch (error) {
            // Don't log "Not signed in" as an error since it's expected before authentication
            if (error.message !== 'Not signed in.') {
                console.error('Get all shared contact databases failed:', error);
            }
            return { 
                success: false, 
                error: error.message,
                ownedSharedDatabases: [],
                receivedSharedDatabases: []
            };
        }
    }

    async getSharedDatabases() {
        try {
            const databases = await userbase.getDatabases();
            console.log('🔍 Raw databases from getDatabases():', databases);
            
            // Check if databases is an object with databases property or direct array
            let databasesArray;
            if (Array.isArray(databases)) {
                databasesArray = databases;
            } else if (databases && Array.isArray(databases.databases)) {
                databasesArray = databases.databases;
            } else {
                console.warn('⚠️ Unexpected databases format:', databases);
                return { success: true, databases: [] };
            }
            
            const sharedDatabases = databasesArray.filter(db => !db.isOwner);
            
            return { success: true, databases: sharedDatabases };
        } catch (error) {
            console.error('Get shared databases failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save user settings
     * @param {Object} settings - Settings object
     * @returns {Promise<Object>} Save result
     */
    async saveSettings(settings) {
        try {
            const itemId = 'user-settings';
            
            await userbase.insertItem({
                databaseName: this.databases.settings,
                item: {
                    ...settings,
                    lastUpdated: new Date().toISOString()
                },
                itemId
            });

            this.eventBus.emit('settings:saved', { settings });
            return { success: true, itemId };
        } catch (error) {
            console.error('Save settings failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update user settings
     * @param {Object} settings - Updated settings object
     * @returns {Promise<Object>} Update result
     */
    /**
     * Log user activity
     * @param {Object} activity - Activity object
     * @returns {Promise<Object>} Log result
     */
    async logActivity(activity) {
        try {
            const itemId = this.generateItemId();
            
            await userbase.insertItem({
                databaseName: this.databases.activity,
                item: {
                    ...activity,
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser?.userId
                },
                itemId
            });

            return { success: true, itemId };
        } catch (error) {
            console.error('Log activity failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Perform database transaction
     * @param {Function} operations - Function containing database operations
     * @returns {Promise<Object>} Transaction result
     */
    async performTransaction(operations) {
        try {
            const results = await operations();
            return { success: true, results };
        } catch (error) {
            console.error('Database transaction failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Backup user data
     * @returns {Promise<Object>} Backup data
     */
    async backupData() {
        try {
            // This would need to be implemented based on Userbase's backup capabilities
            // For now, we'll return a placeholder
            const timestamp = new Date().toISOString();
            
            return {
                success: true,
                backup: {
                    timestamp,
                    user: this.currentUser?.username,
                    message: 'Backup functionality to be implemented based on Userbase capabilities'
                }
            };
        } catch (error) {
            console.error('Backup failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get database connection status
     * @returns {Object} Connection status
     */
    getConnectionStatus() {
        return {
            isInitialized: this.isInitialized,
            isAuthenticated: !!this.currentUser,
            currentUser: this.currentUser?.username,
            activeDatabases: Array.from(this.changeHandlers.keys())
        };
    }

    /**
     * Generate unique item ID using UUID v4
     * @returns {string} UUID v4 with item prefix
     */
    generateItemId() {
        // Use crypto.randomUUID if available (modern browsers)
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return `item_${crypto.randomUUID()}`;
        }
        
        // Fallback implementation for older browsers
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        return `item_${uuid}`;
    }

    /**
     * Close database connections
     */
    async closeDatabases() {
        try {
            // Stop monitoring
            if (this.sharedDatabaseMonitor) {
                clearInterval(this.sharedDatabaseMonitor);
                this.sharedDatabaseMonitor = null;
            }
            
            // Userbase handles this automatically, but we can clear our handlers
            this.changeHandlers.clear();
            this.eventBus.emit('database:closed', {});
        } catch (error) {
            console.error('Close databases failed:', error);
        }
    }

    /**
     * Start monitoring for new shared databases
     */
    startSharedDatabaseMonitoring() {
        // Check every 10 seconds for new shared databases
        this.sharedDatabaseMonitor = setInterval(async () => {
            try {
                await this.checkForNewSharedDatabases();
            } catch (error) {
                console.error('🔄 Error checking for new shared databases:', error);
            }
        }, 10000); // 10 seconds
    }

    /**
     * Check for new shared databases - ENHANCED for cross-device sharing
     */
    async checkForNewSharedDatabases() {
        try {
            // Get all databases and check for new shared contact databases
            const allDatabases = await this.getAllSharedContactDatabases();
            if (!allDatabases.success) {
                // Don't log "Not signed in" as an error since it's expected before authentication
                if (allDatabases.error !== 'Not signed in.') {
                    console.log('❌ Failed to check for new shared databases:', allDatabases.error);
                }
                return;
            }
            
            const { ownedSharedDatabases, receivedSharedDatabases } = allDatabases;
            const totalSharedCount = ownedSharedDatabases.length + receivedSharedDatabases.length;
            
            // Check if we have new shared databases
            const currentSharedCount = this.lastKnownSharedCount || 0;
            
            if (totalSharedCount > currentSharedCount) {
                console.log(`🔄 Detected new shared database(s)! Total: ${totalSharedCount}, Previous: ${currentSharedCount}`);
                console.log(`🔄 Owned: ${ownedSharedDatabases.length}, Received: ${receivedSharedDatabases.length}`);
                console.log('🔄 Re-setting up shared databases to include new ones...');
                
                // Re-setup all shared databases to include new ones
                await this.setupSharedDatabases();
                
                this.lastKnownSharedCount = totalSharedCount;
                
                console.log(`✅ Shared database monitoring updated. Now monitoring ${totalSharedCount} total shared databases.`);
            } else if (totalSharedCount < currentSharedCount) {
                // Handle case where shared databases were removed
                console.log(`🔄 Detected removed shared database(s). Total: ${totalSharedCount}, Previous: ${currentSharedCount}`);
                this.lastKnownSharedCount = totalSharedCount;
            }
            
        } catch (error) {
            console.error('🔄 Error checking for new shared databases:', error);
        }
    }

    /**
     * Get user settings including distribution lists
     * @returns {Promise<Object>} User settings object
     */
    async getSettings() {
        try {
            // Try to get existing settings from cache first
            if (this.settingsItems && this.settingsItems.length > 0) {
                const settings = this.settingsItems[0] || this.getDefaultSettings();
                return settings;
            }
            
            // FALLBACK: If cache is empty, fetch fresh data from database
            try {
                const freshItems = await new Promise((resolve, reject) => {
                    userbase.openDatabase({
                        databaseName: 'user-settings',
                        changeHandler: (items) => {
                            resolve(items);
                        }
                    }).catch(reject);
                });

                if (freshItems && freshItems.length > 0) {
                    const freshSettings = freshItems[0].item;  // Fix: need .item property
                    
                    // Update cache for future calls
                    this.settingsItems = freshItems;
                    
                    return freshSettings;
                } else {
                    return this.getDefaultSettings();
                }
            } catch (freshError) {
                console.error('💾 Fresh data fetch failed:', freshError);
                return this.getDefaultSettings();
            }
            
        } catch (error) {
            console.error('💾 Error getting settings:', error);
            return this.getDefaultSettings();
        }
    }

    /**
     * Update user settings
     * @param {Object} settings - Settings object to save
     * @returns {Promise<boolean>} Success status
     */
    async updateSettings(settings) {
        try {
            const settingsToSave = {
                ...this.getDefaultSettings(),
                ...settings,
                lastUpdated: new Date().toISOString()
            };

            // Initialize settingsItems if it's not set
            if (!this.settingsItems) {
                this.settingsItems = [];
            }

            if (this.settingsItems.length > 0 && this.settingsItems[0] && this.settingsItems[0].itemId) {
                // Update existing settings
                await userbase.updateItem({
                    databaseName: 'user-settings',
                    itemId: this.settingsItems[0].itemId,
                    item: settingsToSave
                });
                
                // Update local cache
                this.settingsItems[0] = { ...this.settingsItems[0], ...settingsToSave };
            } else {
                // Create new settings with fixed itemId (like in saveSettings method)
                const fixedItemId = 'user-settings';
                
                await userbase.insertItem({
                    databaseName: 'user-settings',
                    item: settingsToSave,
                    itemId: fixedItemId
                });
                
                // Update local cache
                this.settingsItems = [{ itemId: fixedItemId, ...settingsToSave }];
            }

            return true;
            
        } catch (error) {
            console.error('💾 Error updating settings:', error);
            return false;
        }
    }

    /**
     * Get default settings structure
     * @returns {Object} Default settings
     */
    getDefaultSettings() {
        return {
            distributionLists: {},
            theme: 'light',
            defaultSort: 'name',
            defaultViewMode: 'card',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
    }
}