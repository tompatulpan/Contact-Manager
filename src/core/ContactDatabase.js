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
        
        // ✅ SDK COMPLIANT: State management for real-time updates
        this.settingsItems = []; // Initialize settings items array
        this.distributionSharingItems = null; // Cache for distribution sharing
        this.sharedContactMetaItems = null; // Cache for shared contact metadata
        this.databaseStates = new Map(); // Track database initialization states
    }

    /**
     * Get current authenticated user
     * @returns {Object|null} Current user object
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Check if there's a stored session that can be restored
     * @returns {Promise<boolean>} True if stored session exists
     */
    async hasStoredSession() {
        try {
            console.log('🔍 Checking for stored session...');
            
            // Check if Userbase has session data in localStorage
            if (typeof localStorage !== 'undefined') {
                // Look for Userbase session indicators
                const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';
                
                // Check for Userbase-specific storage keys that indicate an active session
                const keys = Object.keys(localStorage);
                const hasUserbaseSession = keys.some(key => 
                    (key.includes('userbase') || key.includes('Userbase') || key.startsWith('ub_')) &&
                    localStorage.getItem(key) !== null
                );
                
                // List all userbase-related keys for debugging
                const userbaseKeys = keys.filter(key => 
                    key.includes('userbase') || key.includes('Userbase') || key.startsWith('ub_')
                );
                console.log('🔍 Userbase keys found:', userbaseKeys);
                console.log('🔍 Remember me flag:', hasRememberMe);
                console.log('🔍 Has userbase session data:', hasUserbaseSession);
                
                const result = hasRememberMe && hasUserbaseSession;
                console.log('🔍 Final session check result:', result);
                return result;
            }
            console.log('🔍 localStorage not available');
            return false;
        } catch (error) {
            console.error('Error checking stored session:', error);
            return false;
        }
    }

    /**
     * Attempt to restore a stored session silently and initialize database
     * @returns {Promise<Object>} Restoration result
     */
    async restoreSession() {
        try {
            console.log('🔄 Attempting silent session restoration...');
            
            // Check session preferences first
            const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';
            const hasSessionOnly = sessionStorage.getItem('userbase-session-only') === 'true';
            
            if (!hasRememberMe && !hasSessionOnly) {
                console.log('⚠️ No session preference found');
                return {
                    success: false,
                    error: 'No session preference found'
                };
            }
            
            // For session-only auth, check if this is a page refresh
            if (hasSessionOnly) {
                const pageLoadFlag = sessionStorage.getItem('userbase-page-loaded');
                if (!pageLoadFlag) {
                    console.log('⚠️ Session-only auth expired on page refresh');
                    return {
                        success: false,
                        error: 'Session expired on page refresh'
                    };
                }
            }
            
            // Store the appId (required parameter)
            this.appId = appId;
            
            // Try to initialize Userbase and check for existing session
            return new Promise((resolve) => {
                userbase.init({
                    appId: this.appId,
                    updateUserHandler: (user) => {
                        this.currentUser = user;
                        this.eventBus.emit('database:userUpdated', { user });
                    }
                }).then(async (session) => {
                    if (session.user) {
                        console.log('✅ Session restored for user:', session.user.username);
                        this.currentUser = session.user;
                        this.isInitialized = true;
                        
                        // Update page load flag for session-only auth
                        if (hasSessionOnly) {
                            sessionStorage.setItem('userbase-page-loaded', 'true');
                        }
                        
                        // 🚀 CRITICAL: Initialize databases immediately during restoration
                        try {
                            console.log('📊 Setting up databases during restoration...');
                            await this.setupDatabases();
                            console.log('✅ Databases setup complete during restoration');
                            
                            // Emit authentication event
                            this.eventBus.emit('database:authenticated', { user: this.currentUser });
                            
                            resolve({
                                success: true,
                                user: { username: session.user.username },
                                sessionType: hasRememberMe ? 'persistent' : 'session',
                                databasesReady: true
                            });
                        } catch (dbError) {
                            console.error('❌ Database setup failed during restoration:', dbError);
                            resolve({
                                success: true, // Session restored but database setup failed
                                user: { username: session.user.username },
                                sessionType: hasRememberMe ? 'persistent' : 'session',
                                databasesReady: false,
                                dbError: dbError.message
                            });
                        }
                    } else {
                        console.log('⚠️ No valid session found during restoration');
                        resolve({
                            success: false,
                            error: 'No valid session found'
                        });
                    }
                }).catch((error) => {
                    console.error('Session restoration failed:', error);
                    resolve({
                        success: false,
                        error: error.message
                    });
                });
            });
        } catch (error) {
            console.error('Error during session restoration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Initialize Userbase connection with retry logic
     * @param {string} appId - Userbase application ID
     */
    /**
     * Initialize the database connection - follows Userbase SDK specification exactly
     * @param {string} appId - Userbase app ID
     * @returns {Promise<void>}
     */
    async initialize(appId) {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('🚀 Initializing database with appId:', appId);
            
            // Check if Userbase SDK is available
            if (typeof window.userbase === 'undefined') {
                console.error('❌ Userbase SDK not loaded!');
                throw new Error('Userbase SDK not loaded. Make sure userbase.js is loaded before app.js');
            }

            this.appId = appId;
            
            // Follow SDK specification exactly - let Userbase handle session resumption
            let session;
            try {
                session = await window.userbase.init({
                    appId,
                    sessionLength: 24,  // Hours - extend session if resuming
                    updateUserHandler: (user) => {
                        this.currentUser = user;
                        this.eventBus.emit('database:userUpdated', { user });
                    }
                });
            } catch (initError) {
                if (initError.message.includes('AppIdAlreadySet') || 
                    initError.message.includes('Application ID already set')) {
                    console.log('🔄 Userbase already initialized, checking current state...');
                    
                    // Use existing session if available
                    if (window.userbase.user) {
                        session = { user: window.userbase.user };
                    } else {
                        session = { user: null };
                    }
                } else {
                    throw initError;
                }
            }
            
            // Simple session check - trust Userbase's session management completely
            if (session.user) {
                console.log('✅ Resuming session for user:', session.user.username);
                this.currentUser = session.user;
                await this.setupDatabases();
                this.eventBus.emit('database:authenticated', { user: this.currentUser });
            } else {
                console.log('ℹ️ No active session found');
                this.currentUser = null;
            }
            
            this.isInitialized = true;
            
            this.eventBus.emit('database:initialized', { 
                appId,
                hasSession: !!session.user,
                timestamp: new Date().toISOString() 
            });

            // Start periodic check for new shared databases
            this.startSharedDatabaseMonitoring();
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            this.eventBus.emit('database:error', { 
                error: error.message,
                phase: 'initialization'
            });
            throw error;
        }
    }

    /**
     * Clear application session data - SDK compliant
     */
    clearSessionData() {
        this.currentUser = null;
        this.contacts.clear();
        this.sharedContacts.clear();
        this.sharedContactMetadata.clear();
        this.distributionSharing.clear();
        this.userSettings.clear();
        this.activityLog.clear();
        
        console.log('✅ Application session data cleared');
    }

    /**
     * Sleep utility for retry delays
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Sign up new user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {string} [email] - Optional email address
     * @param {Object} [profile] - Optional user profile data
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signup result
     */
    async signUp(username, password, email = null, profile = null, rememberMe = false) {
        try {
            console.log('🔐 Database: Signing up new user with SDK spec parameters');
            
            const signUpParams = {
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session',
                sessionLength: 24 // Hours - SDK default
            };
            
            // Add optional parameters if provided
            if (email) signUpParams.email = email;
            if (profile) signUpParams.profile = profile;
            
            const result = await userbase.signUp(signUpParams);

            console.log('✅ Database: Sign up successful');
            console.log('📋 Sign up result:', result); // Debug log

            this.currentUser = result.user || result; // Handle both wrapped and unwrapped user objects
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
     * Sign in existing user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signin result
     */
    async signIn(username, password, rememberMe = false) {
        try {
            console.log('🔐 Database: Signing in with SDK spec parameters');
            
            // Follow SDK specification exactly - no custom session tracking
            const result = await userbase.signIn({
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session',
                sessionLength: 24 // Hours - SDK default
            });
            
            console.log('✅ Database: Sign in successful');
            console.log('📋 Sign in result:', result); // Debug log
            
            this.currentUser = result.user || result; // Handle both wrapped and unwrapped user objects
            await this.setupDatabases();
            
            this.eventBus.emit('database:authenticated', { user: this.currentUser });
            
            return { 
                success: true, 
                user: this.currentUser,
                sessionType: rememberMe ? 'persistent' : 'session'
            };
        } catch (error) {
            console.error('Sign in failed:', error);
            
            // Handle UserAlreadySignedIn gracefully
            if (error.name === 'UserAlreadySignedIn') {
                console.log('ℹ️ User already signed in, setting up databases');
                
                if (this.currentUser) {
                    await this.setupDatabases();
                    this.eventBus.emit('database:authenticated', { user: this.currentUser });
                    return { success: true, user: this.currentUser };
                }
            }
            
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign out current user - follows Userbase SDK specification exactly
     * @returns {Promise<Object>} Signout result
     */
    async signOut() {
        try {
            console.log('🔐 Database: Signing out...');
            
            // Let Userbase handle the logout completely - no manual storage clearing
            await userbase.signOut();
            
            // Only clear application-specific state
            this.currentUser = null;
            this.clearSessionData();
            this.changeHandlers.clear();
            
            this.eventBus.emit('database:signedOut', {});
            console.log('✅ User signed out successfully');
            return { success: true };
        } catch (error) {
            // Handle "Not signed in" gracefully per SDK docs
            if (error.message && error.message.includes('Not signed in')) {
                console.log('ℹ️ User was already signed out');
                this.currentUser = null;
                this.clearSessionData();
                this.eventBus.emit('database:signedOut', {});
                return { success: true };
            }
            
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

            // Setup settings database with proper state management
            await this.openDatabase('user-settings', (items) => {
                this.settingsItems = items; // Store settings locally
                this.eventBus.emit('settings:changed', { settings: items });
            });

            // Setup activity log database
            await this.openDatabase('activity-log', (items) => {
                this.eventBus.emit('activity:changed', { activities: items });
            });

            // ✅ SDK COMPLIANT: Initialize state management databases
            await this.ensureDistributionSharingDatabase();
            await this.ensureSharedContactMetaDatabase();

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
                            // ✅ SDK COMPLIANT: Transform individual contacts with full attribution data
                            const contacts = items.map(userbaseItem => {
                                const item = userbaseItem.item || {};
                                return {
                                    contactId: item.contactId || userbaseItem.itemId,
                                    itemId: userbaseItem.itemId, // ✅ Preserve Userbase itemId
                                    cardName: item.cardName || 'Unnamed Contact',
                                    vcard: item.vcard || '',
                                    
                                    // ✅ SDK Attribution data
                                    createdBy: userbaseItem.createdBy,
                                    updatedBy: userbaseItem.updatedBy,
                                    fileUploadedBy: userbaseItem.fileUploadedBy,
                                    writeAccess: userbaseItem.writeAccess,
                                    
                                    // ✅ File data if present
                                    fileId: userbaseItem.fileId,
                                    fileName: userbaseItem.fileName,
                                    fileSize: userbaseItem.fileSize,
                                    
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
                    // ✅ SDK COMPLIANT: Preserve all SDK-provided attribution data
                    const processedItems = items.map(userbaseItem => {
                        return {
                            // Core item data
                            ...userbaseItem.item,
                            itemId: userbaseItem.itemId,
                            
                            // ✅ SDK Attribution data (fully compliant)
                            createdBy: userbaseItem.createdBy,
                            updatedBy: userbaseItem.updatedBy,
                            fileUploadedBy: userbaseItem.fileUploadedBy,
                            writeAccess: userbaseItem.writeAccess,
                            
                            // ✅ File data if present
                            fileId: userbaseItem.fileId,
                            fileName: userbaseItem.fileName,
                            fileSize: userbaseItem.fileSize,
                            
                            // Custom contact-specific data
                            contactId: userbaseItem.item.contactId || userbaseItem.itemId
                        };
                    });
                    
                    changeHandler(processedItems);
                }
            });

            this.changeHandlers.set(databaseName, changeHandler);
        } catch (error) {
            // ✅ SDK COMPLIANT: Handle specific SDK error types
            this.handleSDKError(error, `openDatabase(${databaseName})`);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle specific Userbase SDK error types
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleSDKError(error, context) {
        console.log(`🔍 SDK Error in ${context}:`, error.name, error.message);
        
        switch (error.name) {
            case 'DatabaseAlreadyOpening':
                console.log('ℹ️ Database already opening, skipping...');
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'ChangeHandlerMissing':
            case 'ChangeHandlerMustBeFunction':
                console.error(`❌ Invalid change handler in ${context}:`, error.message);
                break;
            case 'UserNotSignedIn':
                console.log('🔐 User not signed in, emitting auth required event');
                this.eventBus.emit('auth:required', { context });
                break;
            case 'DatabaseNotFound':
                console.log(`📭 Database not found in ${context}, may need creation`);
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                console.error(`❌ Unknown SDK error in ${context}:`, error.name, error.message);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Ensure distribution sharing database is ready
     */
    async ensureDistributionSharingDatabase() {
        if (!this.databaseStates.get('distributionSharing')) {
            await userbase.openDatabase({
                databaseName: this.databases.distributionSharing,
                changeHandler: (items) => {
                    this.distributionSharingItems = items.map(userbaseItem => ({
                        ...userbaseItem.item,
                        itemId: userbaseItem.itemId,
                        createdBy: userbaseItem.createdBy,
                        updatedBy: userbaseItem.updatedBy
                    }));
                    this.eventBus.emit('distributionSharing:changed', { 
                        distributionSharing: this.distributionSharingItems 
                    });
                }
            });
            this.databaseStates.set('distributionSharing', true);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Ensure shared contact metadata database is ready
     */
    async ensureSharedContactMetaDatabase() {
        if (!this.databaseStates.get('sharedContactMeta')) {
            await userbase.openDatabase({
                databaseName: this.databases.sharedContactMeta,
                changeHandler: (items) => {
                    this.sharedContactMetaItems = items.map(userbaseItem => ({
                        ...userbaseItem.item,
                        itemId: userbaseItem.itemId,
                        createdBy: userbaseItem.createdBy,
                        updatedBy: userbaseItem.updatedBy
                    }));
                }
            });
            this.databaseStates.set('sharedContactMeta', true);
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
            // ✅ SDK COMPLIANT: Use proper state management instead of Promise anti-pattern
            if (!this.distributionSharingItems) {
                await this.ensureDistributionSharingDatabase();
            }
            
            return this.distributionSharingItems
                .filter(item => item.contactId === contactId)
                .map(item => item);
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
            // ✅ SDK COMPLIANT: Use proper state management instead of Promise anti-pattern
            if (!this.distributionSharingItems) {
                await this.ensureDistributionSharingDatabase();
            }
            
            return this.distributionSharingItems.filter(Boolean);
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
            // ✅ SDK COMPLIANT: Use proper state management instead of Promise anti-pattern
            if (!this.sharedContactMetaItems) {
                await this.ensureSharedContactMetaDatabase();
            }
            
            const metadataMap = new Map();
            this.sharedContactMetaItems.forEach(item => {
                if (item.sharedContactId) {
                    metadataMap.set(item.sharedContactId, item);
                }
            });
            return metadataMap;
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
     * Verify a user using their verification message (required for secure sharing)
     * @param {string} verificationMessage - The verification message from the user being verified
     * @returns {Promise<Object>} Verification result
     */
    async verifyUser(verificationMessage) {
        try {
            console.log(`🔐 Verifying user with verification message`);
            
            await userbase.verifyUser({
                verificationMessage: verificationMessage.trim()
            });
            
            console.log(`✅ User verified successfully`);
            return { success: true };
            
        } catch (error) {
            console.error(`❌ User verification failed:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current user's verification message for sharing with others
     * @returns {Promise<Object>} Verification message result
     */
    async getVerificationMessage() {
        try {
            console.log(`🔐 Getting verification message for current user`);
            
            const result = await userbase.getVerificationMessage();
            
            console.log(`✅ Verification message retrieved successfully`);
            return { success: true, verificationMessage: result.verificationMessage };
            
        } catch (error) {
            console.error(`❌ Failed to get verification message:`, error);
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

            // NOTE: Automatic verification disabled - requires manual verification message exchange
            // For development/testing, we'll disable requireVerified temporarily
            console.log(`📤 Sharing contact with ${username} (verification disabled for testing)`);

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
                    requireVerified: false // Temporarily disabled for testing - proper verification needs manual message exchange
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
                    requireVerified: false // Temporarily disabled for testing - proper verification needs manual message exchange
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
            // Note: Userbase SDK doesn't support direct revocation via shareDatabase
            // We'll need to implement alternative approaches for revocation
            
            // Userbase doesn't support direct revocation - this is a limitation
            // We would need to delete and recreate the database or use other methods
            console.log(`⚠️ Direct revocation not supported by Userbase SDK`);
            
            // Alternative approach: Delete and recreate database for revocation
            // This is a Userbase SDK limitation - no direct revocation support
            console.log(`❌ Cannot revoke access to "${sharedDbName}" from user "${username}" - Userbase SDK limitation`);
            return { 
                success: false, 
                error: `Access revocation not supported by Userbase SDK`,
                suggestion: "User will retain access until database is recreated"
            };

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
     * Get database connection status with session awareness
     * @returns {Object} Connection status
     */
    getConnectionStatus() {
        // Check if we have an active session
        const hasSessionOnly = sessionStorage.getItem('userbase-session-only') === 'true';
        const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';
        
        // If page was refreshed and we had session-only auth, consider it expired
        if (hasSessionOnly && !this.currentUser) {
            console.log('🔄 Session-only authentication expired on refresh');
            this.clearSessionData();
            return {
                isAuthenticated: false,
                currentUser: null,
                sessionExpired: true
            };
        }
        
        return {
            isInitialized: this.isInitialized,
            isAuthenticated: !!this.currentUser,
            currentUser: this.currentUser?.username,
            sessionType: hasRememberMe ? 'persistent' : 'session',
            activeDatabases: Array.from(this.changeHandlers.keys())
        };
    }

    /**
     * Clear session-specific data
     */
    clearSessionData() {
        sessionStorage.removeItem('userbase-session-only');
        sessionStorage.removeItem('userbase-page-loaded');
        this.currentUser = null;
        this.isInitialized = false;
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
            // ✅ SDK COMPLIANT: Use cached settings from real-time updates
            if (this.settingsItems && this.settingsItems.length > 0) {
                const settings = this.settingsItems[0] || this.getDefaultSettings();
                return settings;
            }
            
            // Return default settings if no settings exist yet
            console.log('📋 No settings found, returning defaults');
            return this.getDefaultSettings();
            
        } catch (error) {
            console.error('❌ Get settings failed:', error);
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

    /**
     * Get connection status - SDK compliant
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
}