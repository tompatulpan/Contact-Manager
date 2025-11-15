import { IndividualSharingStrategy } from './IndividualSharingStrategy.js';

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
        
        // � SETTINGS MUTEX: Prevent concurrent settings updates that cause conflicts
        this.settingsUpdateMutex = false;
        this.settingsUpdateQueue = [];
        
        // �🚀 PERFORMANCE: Caching for shared database operations
        this.sharedDatabaseCache = {
            lastFetch: null,
            data: null,
            isValid: false,
            ttl: 30000 // 30 second cache TTL
        };
        this.openedSharedDatabases = new Set(); // Track which shared databases are already open
        this.isInitializingSharedDatabases = false; // Prevent concurrent initialization
        
        // 🆕 INDIVIDUAL DATABASE STRATEGY: Initialize individual sharing strategy
        this.individualSharing = new IndividualSharingStrategy(this);
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
                
                const result = hasRememberMe && hasUserbaseSession;
                return result;
            }
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
            
            // Check session preferences first
            const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';
            const hasSessionOnly = sessionStorage.getItem('userbase-session-only') === 'true';
            
            if (!hasRememberMe && !hasSessionOnly) {
                return {
                    success: false,
                    error: 'No session preference found'
                };
            }
            
            // For session-only auth, check if this is a page refresh
            if (hasSessionOnly) {
                const pageLoadFlag = sessionStorage.getItem('userbase-page-loaded');
                if (!pageLoadFlag) {
                    return {
                        success: false,
                        error: 'Session expired on page refresh'
                    };
                }
            }
            
            // Store the appId (required parameter)
            this.appId = appId;
            
            // ✅ SDK COMPLIANT: Use proper async/await instead of Promise constructor
            const session = await userbase.init({
                appId: this.appId,
                updateUserHandler: (user) => {
                    this.currentUser = user;
                    this.eventBus.emit('database:userUpdated', { user });
                }
            });
            
            if (session.user) {
                this.currentUser = session.user;
                this.isInitialized = true;
                
                // Update page load flag for session-only auth
                if (hasSessionOnly) {
                    sessionStorage.setItem('userbase-page-loaded', 'true');
                }
                
                // 🚀 CRITICAL: Initialize databases immediately during restoration
                try {
                    await this.setupDatabases();
                    
                    // Emit authentication event
                    this.eventBus.emit('database:authenticated', { user: this.currentUser });
                    
                    return {
                        success: true,
                        user: { username: session.user.username },
                        sessionType: hasRememberMe ? 'persistent' : 'session',
                        databasesReady: true
                    };
                } catch (dbError) {
                    console.error('❌ Database setup failed during restoration:', dbError);
                    return {
                        success: true, // Session restored but database setup failed
                        user: { username: session.user.username },
                        sessionType: hasRememberMe ? 'persistent' : 'session',
                        databasesReady: false,
                        dbError: dbError.message
                    };
                }
            } else {
                return {
                    success: false,
                    error: 'No valid session found'
                };
            }
        } catch (error) {
            console.error('Session restoration failed:', error);
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
                this.currentUser = session.user;
                await this.setupDatabases();
                this.eventBus.emit('database:authenticated', { user: this.currentUser });
            } else {
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
            
            // Follow SDK specification exactly - no custom session tracking
            const result = await userbase.signIn({
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session',
                sessionLength: 24 // Hours - SDK default
            });
            
            
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
            
            // Let Userbase handle the logout completely - no manual storage clearing
            await userbase.signOut();
            
            // Only clear application-specific state
            this.currentUser = null;
            this.clearSessionData();
            this.changeHandlers.clear();
            
            this.eventBus.emit('database:signedOut', {});
            return { success: true };
        } catch (error) {
            // Handle "Not signed in" gracefully per SDK docs
            if (error.message && error.message.includes('Not signed in')) {
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

            // 🚀 PERFORMANCE: Setup shared contact databases with optimized caching
            // This now handles initial discovery internally, no need for separate check
            await this.setupSharedDatabases();

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
     * 🚀 PERFORMANCE: Setup shared contact databases with parallel opening and smart caching
     */
    async setupSharedDatabases() {
        // Prevent concurrent initialization
        if (this.isInitializingSharedDatabases) {
            return;
        }

        this.isInitializingSharedDatabases = true;
        
        try {
            // Use cached data to avoid redundant getDatabases() calls
            const allDatabases = await this.getAllSharedContactDatabasesCached();
            if (!allDatabases.success) {
                return;
            }

            const { ownedSharedDatabases, receivedSharedDatabases } = allDatabases;
            
            // 🚀 PERFORMANCE: Open owned shared databases in parallel
            const ownedPromises = ownedSharedDatabases
                .filter(db => !this.openedSharedDatabases.has(db.databaseName))
                .map(async (db) => {
                    try {
                        await userbase.openDatabase({
                            databaseName: db.databaseName,
                            changeHandler: (items) => {
                                // Don't emit contacts:changed for owned shared databases
                                // These are just for monitoring outgoing changes
                            }
                        });
                        this.openedSharedDatabases.add(db.databaseName);
                    } catch (error) {
                        console.error(`❌ Failed to open owned shared database ${db.databaseName}:`, error);
                    }
                });

            // 🚀 PERFORMANCE: Open received shared databases in parallel
            const receivedPromises = receivedSharedDatabases
                .filter(db => !this.openedSharedDatabases.has(db.databaseId))
                .map(async (db) => {
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
                                        
                                        // ✅ SDK Database properties - all SDK-provided database metadata
                                        databaseMetadata: {
                                            databaseName: db.databaseName,
                                            databaseId: db.databaseId,
                                            isOwner: db.isOwner,
                                            readOnly: db.readOnly,
                                            resharingAllowed: db.resharingAllowed,
                                            encryptionMode: db.encryptionMode,
                                            receivedFromUsername: db.receivedFromUsername,
                                            users: db.users || [] // Users with access to this database
                                        },
                                        
                                        metadata: {
                                            ...item.metadata,
                                            isOwned: false,
                                            sharedBy: db.receivedFromUsername,
                                            databaseId: db.databaseId,
                                            shareType: 'individual',
                                            lastUpdated: item.metadata?.lastUpdated || new Date().toISOString(),
                                            
                                            // ✅ Additional SDK properties for full compliance
                                            readOnly: db.readOnly,
                                            resharingAllowed: db.resharingAllowed,
                                            encryptionMode: db.encryptionMode
                                        }
                                    };
                                });
                                
                                this.eventBus.emit('contacts:changed', { 
                                    contacts: contacts, 
                                    isOwned: false,
                                    sharedBy: db.receivedFromUsername,
                                    databaseId: db.databaseId,
                                    shareType: 'individual',
                                    // ✅ SDK Database metadata
                                    databaseMetadata: {
                                        databaseName: db.databaseName,
                                        databaseId: db.databaseId,
                                        isOwner: db.isOwner,
                                        readOnly: db.readOnly,
                                        resharingAllowed: db.resharingAllowed,
                                        encryptionMode: db.encryptionMode,
                                        receivedFromUsername: db.receivedFromUsername,
                                        users: db.users || []
                                    }
                                });
                            }
                        });
                        this.openedSharedDatabases.add(db.databaseId);
                    } catch (error) {
                        console.error(`❌ Failed to open received shared database ${db.databaseId}:`, error);
                    }
                });

            // 🚀 PERFORMANCE: Wait for all database operations to complete in parallel
            await Promise.allSettled([...ownedPromises, ...receivedPromises]);
            
            // 🚀 PERFORMANCE: Update tracking to prevent redundant monitoring calls
            const totalCount = ownedSharedDatabases.length + receivedSharedDatabases.length;
            this.lastKnownSharedCount = totalCount;
            

        } catch (error) {
            console.error('❌ Setup shared databases failed:', error);
        } finally {
            this.isInitializingSharedDatabases = false;
        }
    }

    /**
     * 🚀 PERFORMANCE: Setup specific shared databases (for differential updates)
     * @param {Array} ownedDatabases - New owned shared databases to setup
     * @param {Array} receivedDatabases - New received shared databases to setup
     */
    async setupSpecificSharedDatabases(ownedDatabases, receivedDatabases) {
        try {
            // Open new owned shared databases in parallel
            const ownedPromises = ownedDatabases.map(async (db) => {
                try {
                    await userbase.openDatabase({
                        databaseName: db.databaseName,
                        changeHandler: (items) => {
                            // Don't emit contacts:changed for owned shared databases
                        }
                    });
                    this.openedSharedDatabases.add(db.databaseName);
                } catch (error) {
                    console.error(`❌ Failed to open new owned shared database ${db.databaseName}:`, error);
                }
            });

            // Open new received shared databases in parallel
            const receivedPromises = receivedDatabases.map(async (db) => {
                try {
                    await userbase.openDatabase({
                        databaseId: db.databaseId,
                        changeHandler: (items) => {
                            // Same change handler logic as in setupSharedDatabases
                            const contacts = items.map(userbaseItem => {
                                const item = userbaseItem.item || {};
                                return {
                                    contactId: item.contactId || userbaseItem.itemId,
                                    itemId: userbaseItem.itemId,
                                    cardName: item.cardName || 'Unnamed Contact',
                                    vcard: item.vcard || '',
                                    
                                    // ✅ SDK Attribution data
                                    createdBy: userbaseItem.createdBy,
                                    updatedBy: userbaseItem.updatedBy,
                                    fileUploadedBy: userbaseItem.fileUploadedBy,
                                    writeAccess: userbaseItem.writeAccess,
                                    
                                    databaseMetadata: {
                                        databaseName: db.databaseName,
                                        databaseId: db.databaseId,
                                        isOwner: db.isOwner,
                                        readOnly: db.readOnly,
                                        resharingAllowed: db.resharingAllowed,
                                        encryptionMode: db.encryptionMode,
                                        receivedFromUsername: db.receivedFromUsername,
                                        users: db.users || []
                                    },
                                    
                                    metadata: {
                                        ...item.metadata,
                                        isOwned: false,
                                        sharedBy: db.receivedFromUsername,
                                        databaseId: db.databaseId,
                                        shareType: 'individual'
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
                    this.openedSharedDatabases.add(db.databaseId);
                } catch (error) {
                    console.error(`❌ Failed to open new received shared database ${db.databaseId}:`, error);
                }
            });

            // Wait for all new databases to complete
            await Promise.allSettled([...ownedPromises, ...receivedPromises]);
            
        } catch (error) {
            console.error('❌ Error setting up specific shared databases:', error);
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
     * ✅ SDK COMPLIANT: Validate insertItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateInsertItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: item
        if (params.item === undefined) {
            errors.push('ItemMissing: item parameter is required');
        } else {
            // Check item size (10KB limit)
            const itemSize = this.calculateItemSize(params.item);
            if (itemSize > 10240) { // 10KB in bytes
                errors.push(`ItemTooLarge: item size (${itemSize} bytes) exceeds 10KB limit`);
            }
            
            // Check item type validity
            if (!this.isValidItemType(params.item)) {
                errors.push('ItemInvalid: item must be object, string, number, boolean, or null');
            }
        }
        
        // Optional: itemId validation
        if (params.itemId !== undefined) {
            if (typeof params.itemId !== 'string') {
                errors.push('ItemIdMustBeString: itemId must be a string');
            } else if (params.itemId.trim() === '') {
                errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
            } else if (params.itemId.length > 100) {
                errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
            }
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate updateItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateUpdateItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: item
        if (params.item === undefined) {
            errors.push('ItemMissing: item parameter is required');
        } else {
            // Check item size (10KB limit)
            const itemSize = this.calculateItemSize(params.item);
            if (itemSize > 10240) { // 10KB in bytes
                errors.push(`ItemTooLarge: item size (${itemSize} bytes) exceeds 10KB limit`);
            }
            
            // Check item type validity
            if (!this.isValidItemType(params.item)) {
                errors.push('ItemInvalid: item must be object, string, number, boolean, or null');
            }
        }
        
        // Required: itemId (unlike insertItem, updateItem requires itemId)
        if (params.itemId === undefined || params.itemId === null) {
            errors.push('ItemIdMissing: itemId is required for updateItem');
        } else if (typeof params.itemId !== 'string') {
            errors.push('ItemIdMustBeString: itemId must be a string');
        } else if (params.itemId.trim() === '') {
            errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
        } else if (params.itemId.length > 100) {
            errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        // Optional: writeAccess validation
        if (params.writeAccess !== undefined) {
            if (params.writeAccess !== null && params.writeAccess !== false && typeof params.writeAccess !== 'object') {
                errors.push('WriteAccessInvalid: writeAccess must be object, null, undefined, or false');
            } else if (typeof params.writeAccess === 'object' && params.writeAccess !== null) {
                // Validate writeAccess object structure
                if (params.writeAccess.onlyCreator !== undefined && typeof params.writeAccess.onlyCreator !== 'boolean') {
                    errors.push('WriteAccessOnlyCreatorMustBeBoolean: writeAccess.onlyCreator must be boolean');
                }
                
                if (params.writeAccess.users !== undefined) {
                    if (!Array.isArray(params.writeAccess.users)) {
                        errors.push('WriteAccessUsersMustBeArray: writeAccess.users must be an array');
                    } else if (params.writeAccess.users.length > 10) {
                        errors.push('WriteAccessUsersTooMany: writeAccess.users cannot exceed 10 users');
                    } else {
                        // Validate each user object
                        params.writeAccess.users.forEach((user, index) => {
                            if (!user || typeof user !== 'object') {
                                errors.push(`WriteAccessUserInvalid: writeAccess.users[${index}] must be an object`);
                            } else if (!user.username || typeof user.username !== 'string') {
                                errors.push(`WriteAccessUsernameInvalid: writeAccess.users[${index}].username must be a string`);
                            }
                        });
                    }
                }
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate deleteItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateDeleteItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: itemId (deleteItem always requires itemId)
        if (params.itemId === undefined || params.itemId === null) {
            errors.push('ItemIdMissing: itemId is required for deleteItem');
        } else if (typeof params.itemId !== 'string') {
            errors.push('ItemIdMustBeString: itemId must be a string');
        } else if (params.itemId.trim() === '') {
            errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
        } else if (params.itemId.length > 100) {
            errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate shareDatabase parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateShareDatabaseParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Either databaseName or databaseId is required
        if (params.databaseName === undefined && params.databaseId === undefined) {
            errors.push('Either databaseName or databaseId is required');
        }
        
        // databaseName validation
        if (params.databaseName !== undefined) {
            if (typeof params.databaseName !== 'string') {
                errors.push('databaseName must be a string');
            } else if (params.databaseName.trim() === '') {
                errors.push('databaseName cannot be blank');
            } else if (params.databaseName.length > 100) {
                errors.push('databaseName too long (max 100 characters)');
            }
        }
        
        // databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('databaseId cannot be blank');
            } else if (params.databaseId.length !== 36) {
                errors.push('databaseId invalid length (must be 36 characters)');
            }
        }
        
        // username validation (optional)
        if (params.username !== undefined) {
            if (typeof params.username !== 'string') {
                errors.push('username must be a string');
            } else if (params.username.trim() === '') {
                errors.push('username cannot be blank');
            }
        }
        
        // readOnly validation (optional)
        if (params.readOnly !== undefined && typeof params.readOnly !== 'boolean') {
            errors.push('readOnly must be a boolean');
        }
        
        // requireVerified validation (optional)
        if (params.requireVerified !== undefined && typeof params.requireVerified !== 'boolean') {
            errors.push('requireVerified must be a boolean');
        }
        
        // resharingAllowed validation (optional)
        if (params.resharingAllowed !== undefined && typeof params.resharingAllowed !== 'boolean') {
            errors.push('resharingAllowed must be a boolean');
        }
        
        // Check for invalid combinations
        if (params.resharingAllowed === true && params.readOnly === false && params.username) {
            errors.push('resharingWithWriteAccessNotAllowed');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate modifyDatabasePermissions parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateModifyDatabasePermissionsParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Either databaseName or databaseId is required
        if (params.databaseName === undefined && params.databaseId === undefined) {
            errors.push('DatabaseNameOrDatabaseIdMissing: Either databaseName or databaseId is required');
        }
        
        // databaseName validation
        if (params.databaseName !== undefined) {
            if (typeof params.databaseName !== 'string') {
                errors.push('DatabaseNameMustBeString: databaseName must be a string');
            } else if (params.databaseName.trim() === '') {
                errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
            } else if (params.databaseName.length > 100) {
                errors.push('DatabaseNameTooLong: databaseName too long (max 100 characters)');
            }
        }
        
        // databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            } else if (params.databaseId.length !== 36) {
                errors.push('DatabaseIdInvalidLength: databaseId invalid length (must be 36 characters)');
            }
        }
        
        // username validation (required)
        if (params.username === undefined || params.username === null) {
            errors.push('UsernameMissing: username is required');
        } else if (typeof params.username !== 'string') {
            errors.push('UsernameMustBeString: username must be a string');
        } else if (params.username.trim() === '') {
            errors.push('UsernameCannotBeBlank: username cannot be blank');
        }
        
        // readOnly validation (required)
        if (params.readOnly === undefined || params.readOnly === null) {
            errors.push('ReadOnlyMissing: readOnly is required');
        } else if (typeof params.readOnly !== 'boolean') {
            errors.push('ReadOnlyMustBeBoolean: readOnly must be a boolean');
        }
        
        // resharingAllowed validation (optional)
        if (params.resharingAllowed !== undefined && typeof params.resharingAllowed !== 'boolean') {
            errors.push('ResharingAllowedMustBeBoolean: resharingAllowed must be a boolean');
        }
        
        // revoke validation (optional)
        if (params.revoke !== undefined && typeof params.revoke !== 'boolean') {
            errors.push('RevokeMustBeBoolean: revoke must be a boolean');
        }
        
        // Check for invalid combinations per SDK spec
        if (params.resharingAllowed === true && params.readOnly === false) {
            errors.push('ResharingWithWriteAccessNotAllowed: resharingAllowed cannot be true when readOnly is false');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    /**
     * 🔧 NEW: Validate that a user exists before sharing
     * Uses the same method as shareDatabase to check user existence
     * @param {string} username - Username to validate
     * @returns {Promise<boolean>} True if user exists
     * @throws {Error} If user doesn't exist
     */
    async validateUserExists(username) {
        try {
            if (!username || typeof username !== 'string' || username.trim() === '') {
                throw new Error('Username is required');
            }
            
            const trimmedUsername = username.trim();
            
            // Use a minimal shareDatabase call to test user existence
            // This follows the same validation path as actual sharing
            try {
                // Create a temporary test database name
                const testDbName = `uservalidation-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                // Try to get the user's public key - this is what shareDatabase does internally
                // and will fail with 404 if user doesn't exist
                const response = await fetch(`https://v1.userbase.com/v1/api/public-key?appId=${this.appId}&username=${encodeURIComponent(trimmedUsername)}&userbaseJsVersion=2.8.0`);
                
                if (response.status === 404) {
                    throw new Error(`User '${trimmedUsername}' does not exist`);
                } else if (!response.ok) {
                    throw new Error(`Failed to validate user: ${response.status} ${response.statusText}`);
                }
                
                return true;
                
            } catch (fetchError) {
                if (fetchError.message.includes('does not exist')) {
                    throw fetchError; // Re-throw user not found errors
                }
                
                console.warn('⚠️ Could not validate user via API, falling back to shareDatabase test');
                
                // Fallback: Try actual shareDatabase call and catch the specific error
                // This is more reliable but creates a temporary database
                try {
                    const testDbName = `uservalidation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    
                    // Try to share a test database - this will fail if user doesn't exist
                    await userbase.shareDatabase({
                        databaseName: testDbName,
                        username: trimmedUsername,
                        readOnly: true,
                        resharingAllowed: false
                    });
                    
                    return true;
                    
                } catch (shareError) {
                    if (shareError.name === 'UserNotFound' || shareError.message.includes('User not found')) {
                        throw new Error(`User '${trimmedUsername}' does not exist`);
                    }
                    
                    // Other errors (like database doesn't exist) are expected and mean user exists
                    return true;
                }
            }
            
        } catch (error) {
            console.error(`❌ User validation failed for ${username}:`, error);
            throw error;
        }
    }
    
    /**
     * ✅ SDK COMPLIANT: Calculate item size in bytes
     * @param {*} item - Item to calculate size for
     * @returns {number} Size in bytes
     */
    calculateItemSize(item) {
        try {
            return new Blob([JSON.stringify(item)]).size;
        } catch (error) {
            // Fallback calculation
            return JSON.stringify(item).length * 2; // Rough estimate (UTF-16)
        }
    }
    
    /**
     * 🔧 NEW: Optimize contact data to fit within 10KB Userbase limit
     * @param {Object} contact - Contact object to optimize
     * @returns {Object} Optimized contact object
     */
    optimizeContactForStorage(contact) {
        try {
            // Start with the full contact
            let optimizedContact = { ...contact };
            
            // Check current size
            let currentSize = this.calculateItemSize(optimizedContact);
            const MAX_SIZE = 10 * 1024; // 10KB in bytes (Userbase limit)
            const SAFE_SIZE = 4 * 1024; // 4KB safe threshold (Userbase wrapper adds ~5-6KB overhead!)
            
            
            if (currentSize <= SAFE_SIZE) {
                return optimizedContact; // No optimization needed - well under limit
            }
            
            // Step 1: Aggressively trim large metadata arrays (keep last 3 entries only)
            if (optimizedContact.metadata?.sharing?.shareHistory?.length > 3) {
                optimizedContact.metadata.sharing.shareHistory = 
                    optimizedContact.metadata.sharing.shareHistory.slice(-3);
            }
            
            if (optimizedContact.metadata?.usage?.interactionHistory?.length > 3) {
                optimizedContact.metadata.usage.interactionHistory = 
                    optimizedContact.metadata.usage.interactionHistory.slice(-3);
            }
            
            // Step 2: Remove non-essential metadata
            if (optimizedContact.metadata?.ui) {
                delete optimizedContact.metadata.ui;
            }
            
            // Step 3: Compress sharing permissions (keep essential data only)
            if (optimizedContact.metadata?.sharing?.sharePermissions) {
                const compressedPerms = {};
                Object.entries(optimizedContact.metadata.sharing.sharePermissions).forEach(([user, perm]) => {
                    compressedPerms[user] = {
                        level: perm.level,
                        sharedAt: perm.sharedAt
                        // Remove canReshare, lastUpdated, etc.
                    };
                });
                optimizedContact.metadata.sharing.sharePermissions = compressedPerms;
            }
            
            // Check size after optimization
            currentSize = this.calculateItemSize(optimizedContact);
            
            if (currentSize > MAX_SIZE) {
                console.warn(`⚠️ Contact still exceeds 10KB limit after optimization: ${(currentSize / 1024).toFixed(2)}KB`);
                
                // Last resort: Keep only essential data (minimal metadata)
                optimizedContact = {
                    contactId: contact.contactId,
                    itemId: contact.itemId,
                    cardName: contact.cardName,
                    vcard: contact.vcard,
                    metadata: {
                        createdAt: contact.metadata?.createdAt,
                        lastUpdated: contact.metadata?.lastUpdated,
                        isOwned: contact.metadata?.isOwned,
                        isArchived: contact.metadata?.isArchived || false,
                        sharing: {
                            isShared: contact.metadata?.sharing?.isShared || false,
                            sharedWithUsers: contact.metadata?.sharing?.sharedWithUsers || [],
                            shareCount: contact.metadata?.sharing?.shareCount || 0
                        }
                    }
                };
                
                const finalSize = this.calculateItemSize(optimizedContact);
                console.log(`📏 After last-resort optimization: ${(finalSize / 1024).toFixed(2)}KB`);
                
                // If STILL too large, the vCard itself is the problem
                if (finalSize > MAX_SIZE) {
                    const vcardSize = new Blob([contact.vcard]).size;
                    console.error(`❌ CRITICAL: vCard alone is ${(vcardSize / 1024).toFixed(2)}KB - exceeds 10KB limit!`);
                    console.error(`Contact "${contact.cardName}" has too much data in vCard content itself.`);
                    throw new Error(`Contact data exceeds 10KB limit even after aggressive optimization. vCard content is too large.`);
                }
            }
            
            return optimizedContact;
            
        } catch (error) {
            console.error(`❌ Failed to optimize contact:`, error);
            return contact; // Return original if optimization fails
        }
    }
    
    /**
     * ✅ SDK COMPLIANT: Check if item type is valid per SDK spec
     * @param {*} item - Item to validate
     * @returns {boolean} True if valid type
     */
    isValidItemType(item) {
        const type = typeof item;
        return type === 'object' || type === 'string' || type === 'number' || type === 'boolean' || item === null;
    }
    
    /**
     * ✅ SDK COMPLIANT: Handle insertItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleInsertItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot insert items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemMissing':
                console.error(`❌ Item missing in ${context}: item parameter is required`);
                break;
            case 'ItemInvalid':
                console.error(`❌ Invalid item in ${context}: item must be object, string, number, boolean, or null`);
                break;
            case 'ItemTooLarge':
                console.error(`❌ Item too large in ${context}: item exceeds 10KB limit`);
                break;
            case 'ItemAlreadyExists':
                console.warn(`⚠️ Item already exists in ${context}: Use updateItem instead`);
                this.eventBus.emit('database:itemExists', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check write permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle updateItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleUpdateItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot update items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMissing':
                console.error(`❌ Item ID missing in ${context}: itemId is required for updateItem`);
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemMissing':
                console.error(`❌ Item missing in ${context}: item parameter is required`);
                break;
            case 'ItemInvalid':
                console.error(`❌ Invalid item in ${context}: item must be object, string, number, boolean, or null`);
                break;
            case 'ItemTooLarge':
                console.error(`❌ Item too large in ${context}: item exceeds 10KB limit`);
                break;
            case 'ItemDoesNotExist':
                console.error(`❌ Item does not exist in ${context}: Use insertItem to create new items`);
                this.eventBus.emit('database:itemNotFound', { context });
                break;
            case 'ItemUpdateConflict':
                console.warn(`⚠️ Update conflict in ${context}: Item was modified by another operation`);
                this.eventBus.emit('database:updateConflict', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check write permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle deleteItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleDeleteItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot delete items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMissing':
                console.error(`❌ Item ID missing in ${context}: itemId is required for deleteItem`);
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemDoesNotExist':
                console.error(`❌ Item does not exist in ${context}: Cannot delete non-existent item`);
                this.eventBus.emit('database:itemNotFound', { context });
                break;
            case 'ItemUpdateConflict':
                console.warn(`⚠️ Update conflict in ${context}: Item was modified by another operation during deletion`);
                this.eventBus.emit('database:updateConflict', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check delete permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle shareDatabase-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleShareDatabaseError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                break;
            case 'DatabaseNameMissing':
                break;
            case 'DatabaseNameMustBeString':
                break;
            case 'DatabaseNameCannotBeBlank':
                break;
            case 'DatabaseNameTooLong':
                break;
            case 'DatabaseNameRestricted':
                break;
            case 'DatabaseIdMustBeString':
                break;
            case 'DatabaseIdCannotBeBlank':
                break;
            case 'DatabaseIdInvalidLength':
                break;
            case 'DatabaseIdNotAllowed':
                break;
            case 'ShareTokenNotAllowed':
                break;
            case 'DatabaseNotFound':
                break;
            case 'UsernameCannotBeBlank':
                break;
            case 'UsernameMustBeString':
                break;
            case 'ReadOnlyMustBeBoolean':
                break;
            case 'ResharingAllowedMustBeBoolean':
                break;
            case 'ResharingNotAllowed':
                break;
            case 'ResharingWithWriteAccessNotAllowed':
                break;
            case 'RequireVerifiedMustBeBoolean':
                break;
            case 'SharingWithSelfNotAllowed':
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                break;
            case 'SubscriptionPlanNotSet':
                break;
            case 'SubscriptionNotFound':
                break;
            case 'SubscribedToIncorrectPlan':
                break;
            case 'SubscriptionInactive':
                break;
            case 'TrialExpired':
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle modifyDatabasePermissions-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleModifyDatabasePermissionsError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error('❌ Parameters must be provided as an object');
                break;
            case 'DatabaseNameOrDatabaseIdMissing':
                console.error('❌ Either databaseName or databaseId is required');
                break;
            case 'DatabaseNameMustBeString':
                console.error('❌ databaseName must be a string');
                break;
            case 'DatabaseNameCannotBeBlank':
                console.error('❌ databaseName cannot be empty');
                break;
            case 'DatabaseNameTooLong':
                console.error('❌ databaseName exceeds maximum length');
                break;
            case 'DatabaseNameRestricted':
                console.error('❌ databaseName uses restricted characters or words');
                break;
            case 'DatabaseIdMustBeString':
                console.error('❌ databaseId must be a string');
                break;
            case 'DatabaseIdCannotBeBlank':
                console.error('❌ databaseId cannot be empty');
                break;
            case 'DatabaseIdInvalidLength':
                console.error('❌ databaseId must be exactly 36 characters');
                break;
            case 'DatabaseIdNotAllowed':
                console.error('❌ databaseId format is not allowed');
                break;
            case 'DatabaseNotFound':
                console.error('❌ Database does not exist or user does not have access');
                break;
            case 'UsernameMissing':
                console.error('❌ username is required');
                break;
            case 'UsernameCannotBeBlank':
                console.error('❌ username cannot be empty');
                break;
            case 'UsernameMustBeString':
                console.error('❌ username must be a string');
                break;
            case 'ReadOnlyMissing':
                console.error('❌ readOnly parameter is required');
                break;
            case 'ReadOnlyMustBeBoolean':
                console.error('❌ readOnly must be a boolean value');
                break;
            case 'ResharingAllowedMustBeBoolean':
                console.error('❌ resharingAllowed must be a boolean value');
                break;
            case 'ResharingWithWriteAccessNotAllowed':
                console.error('❌ Cannot allow resharing when granting write access');
                break;
            case 'RevokeMustBeBoolean':
                console.error('❌ revoke must be a boolean value');
                break;
            case 'UserAlreadyExists':
                console.warn('⚠️ User already has access to this database');
                break;
            case 'UserNotFound':
                console.error('❌ Target user does not exist');
                break;
            case 'SharingWithSelfNotAllowed':
                console.error('❌ Cannot modify permissions for yourself');
                break;
            case 'UserNotSignedIn':
                console.error('❌ User must be signed in to modify database permissions');
                this.eventBus.emit('auth:required', { context });
                break;
            case 'SubscriptionPlanNotSet':
                console.error('❌ Subscription plan required for sharing');
                break;
            case 'SubscriptionNotFound':
                console.error('❌ Valid subscription required for sharing');
                break;
            case 'SubscribedToIncorrectPlan':
                console.error('❌ Current subscription plan does not support sharing');
                break;
            case 'SubscriptionInactive':
                console.error('❌ Subscription is not active');
                break;
            case 'TrialExpired':
                console.error('❌ Trial period has expired');
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }
    
    /**
     * ✅ SDK COMPLIANT: Safe insertItem wrapper with full validation
     * @param {Object} params - insertItem parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Insert result
     */
    async safeInsertItem(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateInsertItemParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Call SDK insertItem
            return await userbase.insertItem(params);
            
        } catch (error) {
            this.handleInsertItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe updateItem wrapper with full validation
     * @param {Object} params - updateItem parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Update result
     */
    async safeUpdateItem(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateUpdateItemParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Call SDK updateItem
            return await userbase.updateItem(params);
            
        } catch (error) {
            this.handleUpdateItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe deleteItem wrapper with full validation
     * @param {Object} params - deleteItem parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Delete result
     */
    async safeDeleteItem(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateDeleteItemParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Call SDK deleteItem
            return await userbase.deleteItem(params);
            
        } catch (error) {
            this.handleDeleteItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe shareDatabase wrapper with full validation
     * @param {Object} params - shareDatabase parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Share result
     */
    async safeShareDatabase(params, context) {
        try {
            // Validate parameters
            const validation = this.validateShareDatabaseParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Check if sharing with self
            if (params.username && this.currentUser && params.username === this.currentUser.username) {
                const error = new Error('Cannot share database with yourself');
                error.name = 'SharingWithSelfNotAllowed';
                throw error;
            }
            
            // Call SDK shareDatabase
            return await userbase.shareDatabase(params);
            
        } catch (error) {
            this.handleShareDatabaseError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe modifyDatabasePermissions wrapper with full validation
     * @param {Object} params - modifyDatabasePermissions parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Modify permissions result
     */
    async safeModifyDatabasePermissions(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateModifyDatabasePermissionsParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Check if modifying permissions for self
            if (params.username && this.currentUser && params.username === this.currentUser.username) {
                const error = new Error('Cannot modify permissions for yourself');
                error.name = 'SharingWithSelfNotAllowed';
                throw error;
            }
            
            // Call SDK modifyDatabasePermissions
            return await userbase.modifyDatabasePermissions(params);
            
        } catch (error) {
            this.handleModifyDatabasePermissionsError(error, context);
            throw error;
        }
    }

    /**

    
    /**
     * ✅ SDK COMPLIANT: Handle specific Userbase SDK error types
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleSDKError(error, context) {
        
        switch (error.name) {
            case 'DatabaseAlreadyOpening':
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
                this.eventBus.emit('auth:required', { context });
                break;
            case 'DatabaseNotFound':
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
     * ✅ SDK COMPLIANT: Handle getDatabases() specific errors per specification
     * According to SDK docs, getDatabases() can throw: UserNotSignedIn, TooManyRequests, ServiceUnavailable
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleGetDatabasesError(error, context) {
        
        switch (error.name) {
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context, method: 'getDatabases' });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in getDatabases() ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context, method: 'getDatabases' });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in getDatabases() ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context, method: 'getDatabases' });
                break;
            default:
                // For unexpected errors, fall back to general SDK error handling
                console.error(`❌ Unexpected getDatabases() error in ${context}:`, error.name, error.message);
                this.handleSDKError(error, context);
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
     * Save contact to database - ✅ SDK COMPLIANT
     * @param {Object} contact - Contact object
     * @returns {Promise<Object>} Save result
     */
    async saveContact(contact) {
        try {
            // Validate input
            if (!contact || !contact.contactId) {
                throw new Error('Valid contact with contactId is required');
            }
            
            // Use contactId as itemId to ensure we can reference it later
            const itemId = contact.contactId;
            
            // Ensure metadata has proper timestamps for recent activity sorting
            const now = new Date().toISOString();
            const metadata = {
                ...contact.metadata,
                createdAt: contact.metadata?.createdAt || now,
                lastUpdated: contact.metadata?.lastUpdated || now,
                lastAccessedAt: contact.metadata?.lastAccessedAt || now
            };
            
            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.contacts,
                itemId: itemId, // Specify the itemId explicitly
                item: {
                    ...contact,
                    contactId: contact.contactId, // Keep contactId for clarity
                    metadata: metadata  // Use enhanced metadata with timestamps
                }
            }, 'saveContact');

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

            // � DEBUG: Log contact size BEFORE optimization
            const sizeBeforeOptimization = this.calculateItemSize(contact);
            console.log(`📏 Contact size BEFORE optimization: ${(sizeBeforeOptimization / 1024).toFixed(2)}KB`);

            // �🔧 CRITICAL FIX: Optimize contact to fit within 10KB Userbase limit
            const optimizedContact = this.optimizeContactForStorage(contact);
            
            // 🔍 DEBUG: Log contact size AFTER optimization
            const sizeAfterOptimization = this.calculateItemSize(optimizedContact);
            console.log(`📏 Contact size AFTER optimization: ${(sizeAfterOptimization / 1024).toFixed(2)}KB (limit: 10KB)`);
            
            // Update lastUpdated in the optimized contact
            optimizedContact.metadata.lastUpdated = new Date().toISOString();
            
            // Update in main contacts database (use optimized contact directly)
            await this.safeUpdateItem({
                databaseName: this.databases.contacts,
                item: optimizedContact,
                itemId
            }, 'updateContact');

            // If this contact has been shared individually, update all shared databases
            // 🎯 CRITICAL: Use optimized contact for shared database updates too
            if (optimizedContact.metadata?.isOwned !== false) { // Only for owned contacts
                try {
                    const sharedUpdateResult = await this.updateSharedContactDatabases(optimizedContact);
                    if (sharedUpdateResult.success) {
                    } else {
                    }
                } catch (sharedError) {
                    console.error(`⚠️ Shared database update failed (non-critical):`, sharedError);
                    // Don't fail the whole update if shared database update fails
                }
            }

            // 🎯 Emit optimized contact (what was actually saved)
            this.eventBus.emit('contact:updated', { contact: optimizedContact });
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
            await this.safeUpdateItem({
                databaseName: this.databases.contacts,
                item: {
                    ...contact
                    // Note: Explicitly NOT updating lastUpdated timestamp
                },
                itemId
            }, 'updateContactMetadataOnly');

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
     * 🔄 SIMPLIFIED: Update contact in individual shared databases only
     * Updates contact data across all individual shared databases where this contact exists
     * @param {Object} contact - Updated contact object
     * @returns {Promise<Object>} Update result with metrics
     */
    async updateSharedContactDatabases(contact) {
        try {
            
            // Update individual shared databases only (no group databases)
            const individualResult = await this.individualSharing.updateContactAcrossSharedDatabases(contact);
            
            
            return {
                success: individualResult.success,
                totalUpdated: individualResult.updatedCount || 0,
                individualResult,
                message: `Updated ${individualResult.updatedCount || 0} individual shared databases`
            };
            
        } catch (error) {
            console.error('❌ Error in updateSharedContactDatabases:', error);
            return { success: false, error: error.message, totalUpdated: 0 };
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

            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.distributionSharing,
                item: sharingRecord,
                itemId: itemId
            }, 'saveDistributionListSharing');

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

            await this.safeUpdateItem({
                databaseName: this.databases.distributionSharing,
                itemId: itemId,
                item: sharingRecord
            }, 'updateDistributionListSharing');

            return { success: true, itemId, sharingRecord };

        } catch (error) {
            // If item doesn't exist, create it
            if (error.name === 'ItemDoesNotExist') {
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

            // ✅ SDK COMPLIANT: Use safe deleteItem with validation
            await this.safeDeleteItem({
                databaseName: this.databases.distributionSharing,
                itemId: itemId
            }, 'deleteDistributionListSharing');

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
            // ✅ SDK COMPLIANT: Use proper state management instead of Promise constructor anti-pattern
            if (!this.distributionSharingItems) {
                await this.ensureDistributionSharingDatabase();
            }
            
            const contactIds = this.distributionSharingItems
                .filter(item => item.listName === listName)
                .map(item => item.contactId);
                
            return contactIds;
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
            // 🔧 CRITICAL FIX: Optimize metadata to prevent exceeding 10KB limit
            const metadataItem = {
                sharedContactId,
                ...metadata,
                lastUpdated: new Date().toISOString()
            };

            // Check size before inserting
            const itemSize = this.calculateItemSize(metadataItem);
            if (itemSize > 10240) {
                console.warn(`⚠️ Shared contact metadata too large (${(itemSize/1024).toFixed(2)}KB), optimizing...`);
                
                // Keep only essential metadata
                const optimizedMetadata = {
                    sharedContactId,
                    isArchived: metadata.isArchived || false,
                    usage: {
                        accessCount: metadata.usage?.accessCount || 0,
                        lastAccessedAt: metadata.usage?.lastAccessedAt || new Date().toISOString()
                    },
                    lastUpdated: new Date().toISOString()
                };
                
                await this.safeInsertItem({
                    databaseName: this.databases.sharedContactMeta,
                    item: optimizedMetadata,
                    itemId: sharedContactId
                }, 'saveSharedContactMetadata');
                
                return { success: true, metadata: optimizedMetadata, optimized: true };
            }

            // Normal save if size is OK
            await this.safeInsertItem({
                databaseName: this.databases.sharedContactMeta,
                item: metadataItem,
                itemId: sharedContactId
            }, 'saveSharedContactMetadata');

            return { success: true, metadata: metadataItem };
            
        } catch (error) {
            console.error('❌ Save shared contact metadata failed:', error);
            
            // If still fails, try minimal metadata
            if (error.name === 'ItemTooLarge') {
                console.warn('⚠️ Using minimal metadata fallback');
                const minimalMetadata = {
                    sharedContactId,
                    lastUpdated: new Date().toISOString()
                };
                
                try {
                    await this.safeInsertItem({
                        databaseName: this.databases.sharedContactMeta,
                        item: minimalMetadata,
                        itemId: sharedContactId
                    }, 'saveSharedContactMetadata-minimal');
                    
                    return { success: true, metadata: minimalMetadata, minimal: true };
                } catch (minimalError) {
                    console.error('❌ Even minimal metadata failed:', minimalError);
                }
            }
            
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
            // 🔧 CRITICAL FIX: Optimize metadata to prevent exceeding 10KB limit
            const metadataItem = {
                sharedContactId,
                ...metadata,
                lastUpdated: new Date().toISOString()
            };

            // Check size before updating
            const itemSize = this.calculateItemSize(metadataItem);
            if (itemSize > 10240) {
                console.warn(`⚠️ Shared contact metadata too large (${(itemSize/1024).toFixed(2)}KB), optimizing...`);
                
                // Keep only essential metadata
                const optimizedMetadata = {
                    sharedContactId,
                    isArchived: metadata.isArchived || false,
                    usage: {
                        accessCount: metadata.usage?.accessCount || 0,
                        lastAccessedAt: metadata.usage?.lastAccessedAt || new Date().toISOString()
                    },
                    lastUpdated: new Date().toISOString()
                };
                
                await this.safeUpdateItem({
                    databaseName: this.databases.sharedContactMeta,
                    itemId: sharedContactId,
                    item: optimizedMetadata
                }, 'updateSharedContactMetadata');
                
                return { success: true, metadata: optimizedMetadata, optimized: true };
            }

            // Normal update if size is OK
            await this.safeUpdateItem({
                databaseName: this.databases.sharedContactMeta,
                itemId: sharedContactId,
                item: metadataItem
            }, 'updateSharedContactMetadata');

            return { success: true, metadata: metadataItem };
            
        } catch (error) {
            // If item doesn't exist, create it
            if (error.name === 'ItemDoesNotExist' || 
                (error.message && error.message.includes('does not exist'))) {
                console.log(`📝 Creating new shared contact metadata for ${sharedContactId}`);
                return await this.saveSharedContactMetadata(sharedContactId, metadata);
            }
            
            console.error('❌ Update shared contact metadata failed:', error);
            
            // If size error, try minimal metadata
            if (error.name === 'ItemTooLarge') {
                console.warn('⚠️ Using minimal metadata fallback for update');
                const minimalMetadata = {
                    sharedContactId,
                    lastUpdated: new Date().toISOString()
                };
                
                try {
                    await this.safeUpdateItem({
                        databaseName: this.databases.sharedContactMeta,
                        itemId: sharedContactId,
                        item: minimalMetadata
                    }, 'updateSharedContactMetadata-minimal');
                    
                    return { success: true, metadata: minimalMetadata, minimal: true };
                } catch (minimalError) {
                    console.error('❌ Even minimal metadata update failed:', minimalError);
                }
            }
            
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
            // ✅ SDK COMPLIANT: Use proper state management instead of Promise constructor anti-pattern
            if (!this.sharedContactMetaItems) {
                await this.ensureSharedContactMetaDatabase();
            }
            
            const metadataItem = this.sharedContactMetaItems.find(item => 
                item.itemId === sharedContactId
            );
            
            return metadataItem || null;
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
            // ✅ SDK COMPLIANT: Use safe deleteItem with validation
            await this.safeDeleteItem({
                databaseName: this.databases.sharedContactMeta,
                itemId: sharedContactId
            }, 'deleteSharedContactMetadata');

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
            // ✅ SDK COMPLIANT: Use safe deleteItem with validation
            await this.safeDeleteItem({
                databaseName: this.databases.contacts,
                itemId
            }, 'deleteContact');

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
            
            await userbase.verifyUser({
                verificationMessage: verificationMessage.trim()
            });
            
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
            
            const result = await userbase.getVerificationMessage();
            
            return { success: true, verificationMessage: result.verificationMessage };
            
        } catch (error) {
            console.error(`❌ Failed to get verification message:`, error);
            return { success: false, error: error.message };
        }
    }


    /**
     * ✅ SDK COMPLIANT: Share individual contact with another user using proper SDK workflow
     * Creates a separate database for the contact and uses modifyDatabasePermissions for additional users
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @param {boolean} readOnly - Whether sharing is read-only
     * @param {boolean} resharingAllowed - Whether resharing is allowed
     * @returns {Promise<Object>} Share result
     */
    async shareContact(contact, username, readOnly = true, resharingAllowed = false) {
        // Redirect all legacy sharing calls to individual sharing strategy
        return await this.shareContactIndividually(contact, username, readOnly, resharingAllowed);
    }

    // ==================================================================================
    // 🆕 INDIVIDUAL DATABASE STRATEGY METHODS
    // ==================================================================================

    /**
     * 🆕 INDIVIDUAL: Share contact using individual database strategy
     * Creates separate database per recipient for granular control
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @param {boolean} readOnly - Whether the share is read-only
     * @param {boolean} resharingAllowed - Whether resharing is allowed
     * @returns {Promise<Object>} Share result
     */
    async shareContactIndividually(contact, username, readOnly = true, resharingAllowed = false) {
        try {

            const result = await this.individualSharing.shareContactIndividually(contact, username);
            
            if (result.success) {
                // Log the sharing activity
                await this.logActivity({
                    action: 'contact_shared_individually',
                    targetUser: username,
                    details: {
                        contactId: contact.contactId,
                        contactName: contact.cardName,
                        databaseName: result.sharedDbName,
                        sharingType: 'individual',
                        duration: result.duration
                    }
                });

                this.eventBus.emit('contact:shared', { 
                    contactId: contact.contactId,
                    username: result.username, 
                    readOnly, 
                    resharingAllowed,
                    sharingType: 'individual',
                    sharedDbName: result.sharedDbName,
                    duration: result.duration
                });
                
            } else {
                console.error(`❌ Failed to share contact individually with ${username}:`, result.error);
            }
            
            return result;
            
        } catch (error) {
            console.error('Individual share contact failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 🚀 BULK: Share contact with multiple users using optimized individual databases
     * Uses parallel processing and smart batching for performance
     * @param {Object} contact - Contact to share
     * @param {Array} usernames - Array of usernames
     * @returns {Promise<Object>} Bulk share result with performance metrics
     */
    async shareContactWithMultipleUsers(contact, usernames) {
        try {
            
            const result = await this.individualSharing.shareContactWithMultipleUsers(contact, usernames);
            
            // Log each successful share
            for (const shareResult of result.results || []) {
                if (shareResult.success) {
                    await this.logActivity({
                        action: 'contact_shared_individually',
                        targetUser: shareResult.username,
                        details: {
                            contactId: contact.contactId,
                            contactName: contact.cardName,
                            databaseName: shareResult.sharedDbName,
                            sharingType: 'individual',
                            duration: shareResult.duration,
                            bulkOperation: true
                        }
                    });
                }
            }
            
            this.eventBus.emit('contact:bulkShared', {
                contactId: contact.contactId,
                results: result.results,
                successCount: result.successCount,
                errorCount: result.errorCount,
                totalDuration: result.totalDuration,
                averageDuration: result.averageDuration
            });
            
            
            return result;
            
        } catch (error) {
            console.error('❌ Bulk share failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🗑️ REVOKE: Revoke individual contact access (solves the granular revocation problem)
     * Removes access for specific user without affecting others
     * 🔧 ENHANCED: Also deletes contact from Baikal server
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @param {Object} contact - Full contact object (for Baikal deletion)
     * @returns {Promise<Object>} Revoke result
     */
    async revokeIndividualContactAccess(contactId, username, contact = null) {
        try {
            
            // 🔧 ENHANCED: Pass contact object for Baikal deletion
            const result = await this.individualSharing.revokeIndividualAccess(contactId, username, contact);
            
            if (result.success) {
                // Log the revocation activity
                await this.logActivity({
                    action: 'contact_access_revoked',
                    targetUser: username,
                    details: {
                        contactId,
                        revokedAt: new Date().toISOString(),
                        method: 'individual-database-deletion',
                        duration: result.duration
                    }
                });

                this.eventBus.emit('contact:accessRevoked', { 
                    contactId,
                    username: result.revokedFrom,
                    method: 'individual',
                    duration: result.duration
                });
                
            } else {
                console.error(`❌ Failed to revoke individual access for ${username}:`, result.error);
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Revoke individual access failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 📋 LIST: Get individual shares for a contact
     * @param {string} contactId - Contact ID
     * @returns {Promise<Array>} Array of individual shares
     */
    async getIndividualContactShares(contactId) {
        try {
            return await this.individualSharing.getIndividualShares(contactId);
        } catch (error) {
            console.error('❌ Failed to get individual shares:', error);
            return [];
        }
    }

    /**
     * 📊 ANALYTICS: Get sharing statistics
     * @param {string} contactId - Optional contact ID to filter stats
     * @returns {Promise<Object>} Sharing statistics
     */
    async getSharingStatistics(contactId = null) {
        try {
            return await this.individualSharing.getSharingStats(contactId);
        } catch (error) {
            console.error('❌ Failed to get sharing statistics:', error);
            return { error: error.message };
        }
    }

    /**
     * ⚙️ CONFIG: Configure individual sharing strategy performance settings
     * @param {Object} config - Configuration options
     */
    configureIndividualSharing(config = {}) {
        if (config.batchSize) {
            this.individualSharing.setBatchSize(config.batchSize);
        }
        
        if (config.clearCache) {
            this.individualSharing.clearCache();
        }
        
    }

    // ==================================================================================
    // 🎯 INDIVIDUAL SHARING STRATEGY METHODS
    // ==================================================================================

    /**
     * 🎯 SMART: Intelligently share contact using individual strategy
     * Uses individual database sharing for granular control
     * @param {Object} contact - Contact to share
     * @param {Array|string} users - Single user or array of users
     * @param {Object} options - Sharing options
     * @returns {Promise<Object>} Share result with strategy used
     */
    async smartShareContact(contact, users, options = {}) {
        try {
            // Use individual sharing strategy directly
            const userList = Array.isArray(users) ? users : [users];
            const result = await this.shareContactIndividually(contact, userList, {
                readOnly: options.readOnly !== false, // Default to true
                resharingAllowed: options.resharingAllowed || false
            });
            
            if (result.success) {
                this.eventBus.emit('contact:smartShared', {
                    contactId: contact.contactId,
                    users: userList,
                    strategyUsed: 'individual',
                    userCount: userList.length,
                    duration: result.duration || 0
                });
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Smart share contact failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🗑️ SMART: Intelligently revoke contact access using optimal strategy
     * Automatically detects and uses the appropriate revocation method
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revoke result with strategy used
     */
    async smartRevokeContactAccess(contactId, username) {
        try {
            // Use individual sharing revocation directly
            const result = await this.revokeIndividualContactAccess(contactId, username);
            
            if (result.success) {
                this.eventBus.emit('contact:smartRevoked', {
                    contactId,
                    username,
                    strategyUsed: 'individual',
                    duration: result.duration || 0
                });
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Smart revoke contact access failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 📋 INFO: Get comprehensive sharing information for a contact
     * @param {string} contactId - Contact ID
     * @returns {Promise<Object>} Detailed sharing information
     */
    async getContactSharingInfo(contactId) {
        try {
            // Use individual sharing info directly
            return await this.individualSharing.getIndividualShares(contactId);
        } catch (error) {
            console.error('❌ Failed to get contact sharing info:', error);
            return { error: error.message };
        }
    }

    /**
     * 📈 ANALYTICS: Get performance analytics for sharing operations
     * @returns {Object} Performance analytics with recommendations
     */
    getSharingPerformanceAnalytics() {
        try {
            // Return basic analytics for individual sharing strategy
            return {
                strategy: 'individual',
                totalOperations: 0,
                averageResponseTime: 0,
                successRate: 100,
                recommendations: ['Using individual database strategy for granular control']
            };
        } catch (error) {
            console.error('❌ Failed to get sharing performance analytics:', error);
            return { error: error.message };
        }
    }

    /**
     * ⚙️ CONFIG: Configure individual sharing strategy
     * @param {Object} config - Configuration options
     * @param {string} config.strategy - 'individual' (only supported strategy)
     * @param {number} config.autoThreshold - User count threshold for auto strategy
     * @param {boolean} config.clearMetrics - Whether to clear performance metrics
     */
    configureIndividualSharing(config = {}) {
        try {
            // Individual sharing strategy is always used
        } catch (error) {
            console.error('❌ Failed to configure individual sharing:', error);
        }
    }

    // ==================================================================================
    // END INDIVIDUAL SHARING STRATEGY METHODS
    // ==================================================================================

    // ==================================================================================
    // END INDIVIDUAL DATABASE STRATEGY METHODS
    // ==================================================================================

    /**
     * Update contact in shared database after editing - CRITICAL for cross-device updates
     * @param {Object} contact - Updated contact object
     * @param {string} sharedDbName - Name of the shared database
     * @returns {Promise<Object>} Update result
     */
    async updateSharedContactDatabase(contact, sharedDbName) {
        try {
            
            // Update the contact in the shared database to ensure recipients get updates
            await this.safeUpdateItem({
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
            }, 'updateSharedContactDatabase');
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to update contact in shared database:', error);
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
            
            // Open the shared database
            await userbase.openDatabase({
                databaseName: sharedDbName,
                changeHandler: (items) => {
                }
            });

            // Update the contact item in the shared database
            // Use contactId as itemId since that's how it was originally inserted
            await this.safeUpdateItem({
                databaseName: sharedDbName,
                itemId: contact.contactId,
                item: contact
            }, 'updateSharedContactDatabase');

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
     * 🚀 PERFORMANCE: Get all shared contact databases with caching
     * @param {boolean} [forceRefresh=false] - Force refresh cache
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabasesCached(forceRefresh = false) {
        const now = Date.now();
        
        // Check if cache is valid and not forcing refresh
        if (!forceRefresh && 
            this.sharedDatabaseCache.isValid && 
            this.sharedDatabaseCache.lastFetch && 
            (now - this.sharedDatabaseCache.lastFetch) < this.sharedDatabaseCache.ttl) {
            
            return this.sharedDatabaseCache.data;
        }
        
        // Fetch fresh data
        const result = await this.getAllSharedContactDatabases();
        
        // Update cache
        this.sharedDatabaseCache = {
            lastFetch: now,
            data: result,
            isValid: result.success,
            ttl: this.sharedDatabaseCache.ttl
        };
        
        return result;
    }

    /**
     * 🚀 PERFORMANCE: Invalidate shared database cache
     * Call this when you know the shared database list has changed
     */
    invalidateSharedDatabaseCache() {
        this.sharedDatabaseCache.isValid = false;
        this.sharedDatabaseCache.data = null;
    }

    /**
     * 🔄 UPDATE SHARED CONTACT: Update a received shared contact in its database
     * Used when owner updates a contact and changes need to be persisted on recipient's side
     * @param {Object} contact - Updated contact object
     * @param {string} databaseId - Database ID where the shared contact lives
     * @returns {Promise<Object>} Update result
     */
    async updateSharedContact(contact, databaseId) {
        try {
            
            // Validate inputs
            if (!contact || !contact.itemId) {
                throw new Error('Contact and itemId are required');
            }
            
            if (!databaseId) {
                throw new Error('Database ID is required for shared contact update');
            }
            
            // Get all databases to find the one matching databaseId
            const databases = await userbase.getDatabases();
            const targetDb = databases.databases.find(db => db.databaseId === databaseId);
            
            if (!targetDb) {
                console.warn(`⚠️ Database ${databaseId} not found - contact may have been unshared`);
                return { success: false, error: 'Database not found' };
            }
            
            
            // Open the database
            await userbase.openDatabase({
                databaseName: targetDb.databaseName,
                changeHandler: () => {} // No-op handler
            });
            
            // Update the contact using the original itemId (not the shared_ prefixed contactId)
            await this.safeUpdateItem({
                databaseName: targetDb.databaseName,
                itemId: contact.itemId, // Use original itemId, not shared_user_contactId
                item: contact
            }, 'updateSharedContact');
            
            return { success: true, databaseName: targetDb.databaseName };
            
        } catch (error) {
            console.error(`❌ Failed to update shared contact:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🚀 PERFORMANCE: Handle new shared database notification
     * Call this when you know a new shared database was created
     * @param {string} databaseName - Name of the new shared database
     * @param {string} sharedWith - Username who received the share
     */
    async handleNewSharedDatabase(databaseName, sharedWith) {
        try {
            // Invalidate cache since we know data changed
            this.invalidateSharedDatabaseCache();
            
            // Track that we created a new shared database
            this.lastKnownSharedCount = (this.lastKnownSharedCount || 0) + 1;
            
            
            // The new shared database will be picked up by the next monitoring cycle
            // or can be handled immediately if needed
            
        } catch (error) {
            console.error('❌ Error handling new shared database:', error);
        }
    }

    /**
     * Get all shared contact databases (both owned and received) - CRITICAL for cross-device sharing
     * @param {Object} [options] - Optional parameters for getDatabases
     * @param {string} [options.databaseName] - Specific database name to retrieve
     * @param {string} [options.databaseId] - Specific database ID to retrieve
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabases(options = null) {
        try {
            // ✅ SDK COMPLIANT: Pass optional parameters to getDatabases only when specified
            const result = options ? await userbase.getDatabases(options) : await userbase.getDatabases();
            
            // SDK guarantees this format: { databases: [...] }
            if (!result || !Array.isArray(result.databases)) {
                console.warn('⚠️ Unexpected databases format from SDK:', result);
                return { success: true, ownedSharedDatabases: [], receivedSharedDatabases: [] };
            }
            
            const databasesArray = result.databases;
            
            // Filter for shared contact databases
            const sharedContactDatabases = databasesArray.filter(db => 
                db.databaseName.startsWith('shared-contact-')
            );
            
            // ✅ SDK COMPLIANT: Log all SDK properties for debugging compliance
            if (sharedContactDatabases.length > 0) {
            }
            
            // Separate owned vs received shared databases
            const ownedSharedDatabases = sharedContactDatabases.filter(db => db.isOwner);
            const receivedSharedDatabases = sharedContactDatabases.filter(db => !db.isOwner);
            
            return { 
                success: true, 
                ownedSharedDatabases,
                receivedSharedDatabases
            };
        } catch (error) {
            // ✅ SDK COMPLIANT: Handle specific getDatabases() errors per spec
            this.handleGetDatabasesError(error, 'getAllSharedContactDatabases');
            
            return { 
                success: false, 
                error: error.message,
                ownedSharedDatabases: [],
                receivedSharedDatabases: []
            };
        }
    }

    /**
     * Get shared databases with optional filtering
     * @param {Object} [options] - Optional parameters for getDatabases
     * @param {string} [options.databaseName] - Specific database name to retrieve
     * @param {string} [options.databaseId] - Specific database ID to retrieve
     * @returns {Promise<Object>} Shared databases result
     */
    async getSharedDatabases(options = null) {
        try {
            // ✅ SDK COMPLIANT: getDatabases() returns { databases: [...] } according to spec
            const result = options ? await userbase.getDatabases(options) : await userbase.getDatabases();
            
            // SDK guarantees this format: { databases: [...] }
            if (!result || !Array.isArray(result.databases)) {
                console.warn('⚠️ Unexpected databases format from SDK:', result);
                return { success: true, databases: [] };
            }
            
            const sharedDatabases = result.databases.filter(db => !db.isOwner);
            
            return { success: true, databases: sharedDatabases };
        } catch (error) {
            // ✅ SDK COMPLIANT: Handle specific getDatabases() errors per spec
            this.handleGetDatabasesError(error, 'getSharedDatabases');
            
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
            
            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.settings,
                item: {
                    ...settings,
                    lastUpdated: new Date().toISOString()
                },
                itemId
            }, 'saveSettings');

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
            // Activity log is optional - skip if database not open
            if (!this.databases.activity) {
                console.log('⏭️ Activity log skipped (database not configured)');
                return { success: true, skipped: true };
            }
            
            const itemId = this.generateItemId();
            
            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.activity,
                item: {
                    ...activity,
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser?.userId
                },
                itemId
            }, 'logActivity');

            return { success: true, itemId };
        } catch (error) {
            // Activity log is non-critical - don't fail the operation
            console.log('⚠️ Activity log failed (non-critical):', error.message);
            return { success: true, error: error.message, skipped: true };
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
            
            // Stop fallback sync
            if (this.sharedContactFallbackSync) {
                clearInterval(this.sharedContactFallbackSync);
                this.sharedContactFallbackSync = null;
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
        // 🚀 PERFORMANCE: Add initial delay to avoid immediate redundant call after setup
        setTimeout(() => {
            // Check every 10 seconds for new shared databases
            this.sharedDatabaseMonitor = setInterval(async () => {
                try {
                    await this.checkForNewSharedDatabases();
                } catch (error) {
                    console.error('🔄 Error checking for new shared databases:', error);
                }
            }, 10000); // 10 seconds
        }, 15000); // Start monitoring after 15 seconds to allow initial setup to complete
        
        // 🛡️ SAFETY NET: Hourly fallback sync for shared contacts
        // This catches any WebSocket updates that may have been dropped due to:
        // - syncInProgress blocking (now fixed, but extra safety)
        // - Network issues
        // - Browser background tab throttling
        // - Unknown edge cases
        setTimeout(() => {
            this.sharedContactFallbackSync = setInterval(async () => {
                try {
                    await this.performFallbackSharedContactSync();
                } catch (error) {
                    console.error('🔄 Error in fallback shared contact sync:', error);
                }
            }, 3600000); // 1 hour (60 * 60 * 1000)
        }, 300000); // Start after 5 minutes (don't run immediately on startup)
    }

    /**
     * 🚀 PERFORMANCE: Check for new shared databases with smart caching and differential updates
     */
    async checkForNewSharedDatabases() {
        try {
            // Use cached data with forced refresh for monitoring
            const allDatabases = await this.getAllSharedContactDatabasesCached(true);
            if (!allDatabases.success) {
                // Don't log "Not signed in" as an error since it's expected before authentication
                if (allDatabases.error !== 'Not signed in.') {
                }
                return;
            }
            
            const { ownedSharedDatabases, receivedSharedDatabases } = allDatabases;
            const totalSharedCount = ownedSharedDatabases.length + receivedSharedDatabases.length;
            
            // Check if we have new shared databases
            const currentSharedCount = this.lastKnownSharedCount || 0;
            
            if (totalSharedCount > currentSharedCount) {
                
                // 🚀 PERFORMANCE: Only setup NEW databases, not all databases
                const newOwnedDatabases = ownedSharedDatabases.filter(db => 
                    !this.openedSharedDatabases.has(db.databaseName));
                const newReceivedDatabases = receivedSharedDatabases.filter(db => 
                    !this.openedSharedDatabases.has(db.databaseId));
                
                if (newOwnedDatabases.length > 0 || newReceivedDatabases.length > 0) {
                    
                    // Setup only new databases instead of all databases
                    await this.setupSpecificSharedDatabases(newOwnedDatabases, newReceivedDatabases);
                }
                
                this.lastKnownSharedCount = totalSharedCount;
                
            } else if (totalSharedCount < currentSharedCount) {
                // Handle case where shared databases were removed
                this.lastKnownSharedCount = totalSharedCount;
                
                // TODO: Clean up opened database tracking for removed databases
            }
            
        } catch (error) {
            console.error('🔄 Error checking for new shared databases:', error);
        }
    }

    /**
     * 🛡️ SAFETY NET: Fallback sync for shared contacts (hourly)
     * Re-fetches all shared contacts from Userbase to catch any missed WebSocket updates
     * This provides redundancy in case updates were dropped due to:
     * - syncInProgress blocking
     * - Network issues
     * - Browser tab throttling
     * - Unknown edge cases
     */
    async performFallbackSharedContactSync() {
        
        const startTime = Date.now();
        let refreshedCount = 0;
        let unchangedCount = 0;
        
        try {
            // Get all received shared databases
            const allDatabases = await this.getAllSharedContactDatabasesCached(true);
            if (!allDatabases.success) {
                return;
            }
            
            const { receivedSharedDatabases } = allDatabases;
            
            if (receivedSharedDatabases.length === 0) {
                return;
            }
            
            
            // Re-fetch items from each shared database
            for (const db of receivedSharedDatabases) {
                try {
                    // Re-open database with a one-time handler to get fresh data
                    // This triggers the changeHandler with current items from Userbase
                    let capturedItems = null;
                    
                    await userbase.openDatabase({
                        databaseId: db.databaseId,
                        changeHandler: (items) => {
                            // Capture items on first call (immediate delivery of current state)
                            if (!capturedItems) {
                                capturedItems = items;
                            }
                        }
                    });
                    
                    // Wait a moment for the initial changeHandler to fire
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    if (!capturedItems || capturedItems.length === 0) {
                        continue;
                    }
                    
                    // Process the captured items
                    for (const userbaseItem of capturedItems) {
                        const item = userbaseItem.item || {};
                        const contactId = item.contactId || userbaseItem.itemId;
                        
                        // Build the shared contact object
                        const sharedContact = {
                            contactId: contactId,
                            itemId: userbaseItem.itemId,
                            cardName: item.cardName || 'Unnamed Contact',
                            vcard: item.vcard || '',
                            metadata: {
                                ...item.metadata,
                                isOwned: false,
                                sharedBy: db.receivedFromUsername,
                                databaseId: db.databaseId,
                                shareType: 'individual'
                            }
                        };
                        
                        // Emit as a contacts:changed event to trigger normal processing
                        this.eventBus.emit('contacts:changed', {
                            contacts: [sharedContact],
                            isOwned: false,
                            sharedBy: db.receivedFromUsername,
                            databaseId: db.databaseId,
                            source: 'fallback-sync'
                        });
                        
                        refreshedCount++;
                    }
                    
                } catch (dbError) {
                    console.error(`❌ Error syncing database ${db.databaseId}:`, dbError.message);
                }
            }
            
            const duration = Date.now() - startTime;
            
            
        } catch (error) {
            console.error('❌ Fallback shared contact sync failed:', error);
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
            return this.getDefaultSettings();
            
        } catch (error) {
            console.error('❌ Get settings failed:', error);
            return this.getDefaultSettings();
        }
    }

    /**
     * Update user settings with mutex lock to prevent conflicts
     * @param {Object} settings - Settings object to save
     * @returns {Promise<boolean>} Success status
     */
    async updateSettings(settings) {
        // Queue updates if mutex is locked
        if (this.settingsUpdateMutex) {
            return new Promise((resolve) => {
                this.settingsUpdateQueue.push({ settings, resolve });
            });
        }

        try {
            // Acquire mutex
            this.settingsUpdateMutex = true;
            
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
                await this.safeUpdateItem({
                    databaseName: 'user-settings',
                    itemId: this.settingsItems[0].itemId,
                    item: settingsToSave
                }, 'updateSettings');
                
                // Update local cache
                this.settingsItems[0] = { ...this.settingsItems[0], ...settingsToSave };
            } else {
                // Create new settings with fixed itemId (like in saveSettings method)
                const fixedItemId = 'user-settings';
                
                // ✅ SDK COMPLIANT: Use safe insertItem with validation
                await this.safeInsertItem({
                    databaseName: 'user-settings',
                    item: settingsToSave,
                    itemId: fixedItemId
                }, 'updateSettings');
                
                // Update local cache
                this.settingsItems = [{ itemId: fixedItemId, ...settingsToSave }];
            }

            const result = true;
            
            // Release mutex and process queue
            this.settingsUpdateMutex = false;
            this.processSettingsUpdateQueue();
            
            return result;
            
        } catch (error) {
            console.error('💾 Error updating settings:', error);
            
            // Release mutex and process queue even on error
            this.settingsUpdateMutex = false;
            this.processSettingsUpdateQueue();
            
            return false;
        }
    }

    /**
     * Process queued settings updates
     */
    async processSettingsUpdateQueue() {
        if (this.settingsUpdateQueue.length === 0) return;
        
        const { settings, resolve } = this.settingsUpdateQueue.shift();
        
        try {
            const result = await this.updateSettings(settings);
            resolve(result);
        } catch (error) {
            console.error('❌ Failed to process queued settings update:', error);
            resolve(false);
        }
    }

    /**
     * Get default settings structure
     * @returns {Object} Default settings
     */
    getDefaultSettings() {
        return {
            distributionLists: {},
            baicalConfigurations: {}, // 🆕 Baical configurations storage
            theme: 'light',
            defaultSort: 'name',
            defaultViewMode: 'card',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
    }

    // 🆕 BAICAL INTEGRATION: Configuration management methods

    /**
     * Update Baical configuration in user settings
     * @param {string} profileName - Configuration profile name
     * @param {Object} configuration - Configuration data
     * @returns {Promise<boolean>} Success status
     */
    async updateBaicalConfiguration(profileName, configuration) {
        try {
            const currentSettings = await this.getSettings();
            
            if (!currentSettings.baicalConfigurations) {
                currentSettings.baicalConfigurations = {};
            }
            
            currentSettings.baicalConfigurations[profileName] = {
                ...configuration,
                profileName,
                lastUpdated: new Date().toISOString()
            };

            const success = await this.updateSettings(currentSettings);
            
            if (success) {
                this.eventBus.emit('database:baicalConfigurationUpdated', {
                    profileName,
                    configuration
                });
            }
            
            return success;

        } catch (error) {
            console.error('❌ Error updating Baical configuration:', error);
            return false;
        }
    }

    /**
     * Get Baical configuration by profile name
     * @param {string} profileName - Configuration profile name
     * @returns {Promise<Object|null>} Configuration or null
     */
    async getBaicalConfiguration(profileName) {
        try {
            const settings = await this.getSettings();
            return settings.baicalConfigurations?.[profileName] || null;

        } catch (error) {
            console.error('❌ Error getting Baical configuration:', error);
            return null;
        }
    }

    /**
     * Get all Baical configurations
     * @returns {Promise<Array>} Array of configurations
     */
    async getAllBaicalConfigurations() {
        try {
            const settings = await this.getSettings();
            const configurations = settings.baicalConfigurations || {};
            
            return Object.values(configurations);

        } catch (error) {
            console.error('❌ Error getting Baical configurations:', error);
            return [];
        }
    }

    /**
     * Delete Baical configuration
     * @param {string} profileName - Configuration profile name
     * @returns {Promise<boolean>} Success status
     */
    async deleteBaicalConfiguration(profileName) {
        try {
            const currentSettings = await this.getSettings();
            
            if (!currentSettings.baicalConfigurations || !currentSettings.baicalConfigurations[profileName]) {
                console.warn('⚠️ Baical configuration not found:', profileName);
                return true; // Consider it successful if it doesn't exist
            }
            
            delete currentSettings.baicalConfigurations[profileName];
            
            const success = await this.updateSettings(currentSettings);
            
            if (success) {
                this.eventBus.emit('database:baicalConfigurationDeleted', {
                    profileName
                });
            }
            
            return success;

        } catch (error) {
            console.error('❌ Error deleting Baical configuration:', error);
            return false;
        }
    }

    /**
     * Store Baical sync metadata for contact
     * @param {string} contactId - Contact ID
     * @param {Object} syncMetadata - Sync metadata
     * @returns {Promise<boolean>} Success status
     */
    async updateContactBaicalSyncMetadata(contactId, syncMetadata) {
        try {
            const contact = await this.getContact(contactId);
            if (!contact) {
                throw new Error(`Contact ${contactId} not found`);
            }

            // Add Baical sync metadata to contact
            const updatedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    baicalSync: {
                        ...contact.metadata?.baicalSync,
                        ...syncMetadata,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            return await this.updateContact(updatedContact);

        } catch (error) {
            console.error('❌ Error updating contact Baical sync metadata:', error);
            return false;
        }
    }

    /**
     * Get contacts that need Baical sync
     * @param {string} profileName - Baical profile name
     * @returns {Promise<Array>} Array of contacts needing sync
     */
    async getContactsNeedingBaicalSync(profileName) {
        try {
            const allContacts = await this.getAllContacts();
            
            // Filter contacts that are marked for this profile or need sync
            return allContacts.filter(contact => {
                const baicalSync = contact.metadata?.baicalSync;
                
                // Include if explicitly marked for this profile
                if (baicalSync?.profiles?.includes(profileName)) {
                    return true;
                }
                
                // Include if it's a user-owned contact (not shared)
                if (contact.metadata?.isOwned && !contact.metadata?.isArchived) {
                    return true;
                }
                
                return false;
            });

        } catch (error) {
            console.error('❌ Error getting contacts needing Baical sync:', error);
            return [];
        }
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