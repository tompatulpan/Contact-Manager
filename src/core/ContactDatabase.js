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
            
            // ✅ SDK COMPLIANT: Use proper async/await instead of Promise constructor
            const session = await userbase.init({
                appId: this.appId,
                updateUserHandler: (user) => {
                    this.currentUser = user;
                    this.eventBus.emit('database:userUpdated', { user });
                }
            });
            
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
                console.log('⚠️ No valid session found during restoration');
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
        console.log(`🔍 insertItem Error in ${context}:`, error.name, error.message);
        
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
                console.log('🔐 User not signed in, emitting auth required event');
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
        console.log(`🔍 updateItem Error in ${context}:`, error.name, error.message);
        
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
                console.log('🔐 User not signed in, emitting auth required event');
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
        console.log(`🔍 deleteItem Error in ${context}:`, error.name, error.message);
        
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
                console.log('🔐 User not signed in, emitting auth required event');
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
        console.log(`🔍 shareDatabase Error in ${context}:`, error.name, error.message);
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.log('❌ Parameters must be provided as an object');
                break;
            case 'DatabaseNameMissing':
                console.log('❌ databaseName is required when databaseId is not provided');
                break;
            case 'DatabaseNameMustBeString':
                console.log('❌ databaseName must be a string');
                break;
            case 'DatabaseNameCannotBeBlank':
                console.log('❌ databaseName cannot be empty');
                break;
            case 'DatabaseNameTooLong':
                console.log('❌ databaseName exceeds maximum length');
                break;
            case 'DatabaseNameRestricted':
                console.log('❌ databaseName uses restricted characters or words');
                break;
            case 'DatabaseIdMustBeString':
                console.log('❌ databaseId must be a string');
                break;
            case 'DatabaseIdCannotBeBlank':
                console.log('❌ databaseId cannot be empty');
                break;
            case 'DatabaseIdInvalidLength':
                console.log('❌ databaseId must be exactly 36 characters');
                break;
            case 'DatabaseIdNotAllowed':
                console.log('❌ databaseId format is not allowed');
                break;
            case 'ShareTokenNotAllowed':
                console.log('❌ shareToken parameter not allowed in this context');
                break;
            case 'DatabaseNotFound':
                console.log('❌ Database does not exist or user does not have access');
                break;
            case 'UsernameCannotBeBlank':
                console.log('❌ username cannot be empty when provided');
                break;
            case 'UsernameMustBeString':
                console.log('❌ username must be a string');
                break;
            case 'ReadOnlyMustBeBoolean':
                console.log('❌ readOnly must be a boolean value');
                break;
            case 'ResharingAllowedMustBeBoolean':
                console.log('❌ resharingAllowed must be a boolean value');
                break;
            case 'ResharingNotAllowed':
                console.log('❌ Resharing is not allowed for this database');
                break;
            case 'ResharingWithWriteAccessNotAllowed':
                console.log('❌ Cannot allow resharing when granting write access');
                break;
            case 'RequireVerifiedMustBeBoolean':
                console.log('❌ requireVerified must be a boolean value');
                break;
            case 'SharingWithSelfNotAllowed':
                console.log('❌ Cannot share database with yourself');
                break;
            case 'UserNotSignedIn':
                console.log('❌ User must be signed in to share databases');
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.log('❌ Target user does not exist');
                break;
            case 'SubscriptionPlanNotSet':
                console.log('❌ Subscription plan required for sharing');
                break;
            case 'SubscriptionNotFound':
                console.log('❌ Valid subscription required for sharing');
                break;
            case 'SubscribedToIncorrectPlan':
                console.log('❌ Current subscription plan does not support sharing');
                break;
            case 'SubscriptionInactive':
                console.log('❌ Subscription is not active');
                break;
            case 'TrialExpired':
                console.log('❌ Trial period has expired');
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
        console.log(`🔍 modifyDatabasePermissions Error in ${context}:`, error.name, error.message);
        
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
            
            // Log the permission modification attempt
            console.log(`🔧 Modifying database permissions with validated parameters:`, {
                databaseName: params.databaseName,
                databaseId: params.databaseId,
                username: params.username,
                readOnly: params.readOnly,
                resharingAllowed: params.resharingAllowed,
                revoke: params.revoke
            });
            
            // Call SDK modifyDatabasePermissions
            return await userbase.modifyDatabasePermissions(params);
            
        } catch (error) {
            this.handleModifyDatabasePermissionsError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Modify contact sharing permissions for a user
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to modify permissions for
     * @param {boolean} readOnly - Whether access should be read-only
     * @param {boolean} [resharingAllowed=false] - Whether resharing is allowed
     * @param {boolean} [revoke=false] - Whether to revoke access entirely
     * @returns {Promise<Object>} Modify permissions result
     */
    async modifyContactPermissions(contactId, username, readOnly, resharingAllowed = false, revoke = false) {
        try {
            if (!contactId || !username) {
                throw new Error('Contact ID and username are required');
            }

            const sharedDbName = `shared-contact-${contactId}`;
            
            console.log(`🔧 Modifying permissions for contact ${contactId}, user ${username}`);
            console.log(`🔧 Parameters: readOnly=${readOnly}, resharingAllowed=${resharingAllowed}, revoke=${revoke}`);
            
            // ✅ SDK COMPLIANT: Use safe modifyDatabasePermissions wrapper
            await this.safeModifyDatabasePermissions({
                databaseName: sharedDbName,
                username: username.trim(),
                readOnly,
                resharingAllowed,
                revoke
            }, 'modifyContactPermissions');

            const action = revoke ? 'revoked' : 'modified';
            console.log(`✅ Successfully ${action} permissions for ${username} on contact ${contactId}`);

            // Log the activity
            await this.logActivity({
                action: `contact_permissions_${action}`,
                targetUser: username,
                details: {
                    contactId,
                    databaseName: sharedDbName,
                    readOnly,
                    resharingAllowed,
                    revoke
                }
            });

            this.eventBus.emit('contact:permissionsModified', { 
                contactId,
                username, 
                readOnly, 
                resharingAllowed,
                revoke,
                sharedDbName
            });
            
            return { success: true, action, sharedDbName };
            
        } catch (error) {
            console.error(`❌ Modify contact permissions failed for contact ${contactId}, user ${username}:`, error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * ✅ SDK COMPLIANT: Grant write access to a contact for a user
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to grant write access to
     * @returns {Promise<Object>} Grant write access result
     */
    async grantContactWriteAccess(contactId, username) {
        return await this.modifyContactPermissions(contactId, username, false, false, false);
    }

    /**
     * ✅ SDK COMPLIANT: Change contact access from write to read-only
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to change to read-only
     * @returns {Promise<Object>} Change to read-only result
     */
    async makeContactReadOnly(contactId, username) {
        return await this.modifyContactPermissions(contactId, username, true, false, false);
    }

    /**
     * ✅ SDK COMPLIANT: Enable resharing for a contact (only works with readOnly=true)
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to enable resharing for
     * @returns {Promise<Object>} Enable resharing result
     */
    async enableContactResharing(contactId, username) {
        return await this.modifyContactPermissions(contactId, username, true, true, false);
    }

    /**
     * ✅ SDK COMPLIANT: Disable resharing for a contact
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to disable resharing for
     * @returns {Promise<Object>} Disable resharing result
     */
    async disableContactResharing(contactId, username) {
        return await this.modifyContactPermissions(contactId, username, true, false, false);
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
     * ✅ SDK COMPLIANT: Handle getDatabases() specific errors per specification
     * According to SDK docs, getDatabases() can throw: UserNotSignedIn, TooManyRequests, ServiceUnavailable
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleGetDatabasesError(error, context) {
        console.log(`🔍 getDatabases() Error in ${context}:`, error.name, error.message);
        
        switch (error.name) {
            case 'UserNotSignedIn':
                console.log('🔐 User not signed in for getDatabases(), emitting auth required event');
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
            
            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.contacts,
                itemId: itemId, // Specify the itemId explicitly
                item: {
                    ...contact,
                    contactId: contact.contactId // Keep contactId for clarity
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
            
            // Update in main contacts database
            await this.safeUpdateItem({
                databaseName: this.databases.contacts,
                item: {
                    ...contact,
                    metadata: {
                        ...contact.metadata,
                        lastUpdated: new Date().toISOString()
                    }
                },
                itemId
            }, 'updateContact');

            // If this contact has been shared individually, update all shared databases
            if (contact.metadata?.isOwned !== false) { // Only for owned contacts
                try {
                    const sharedUpdateResult = await this.updateSharedContactDatabases(contact);
                    if (sharedUpdateResult.success) {
                        console.log(`✅ Shared database update successful for contact ${contact.contactId}`);
                    } else {
                        console.log(`ℹ️ Shared database update info: ${sharedUpdateResult.message || sharedUpdateResult.error}`);
                    }
                } catch (sharedError) {
                    console.error(`⚠️ Shared database update failed (non-critical):`, sharedError);
                    // Don't fail the whole update if shared database update fails
                }
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
     * Update contact in all shared databases (for real-time sync)
     * @param {Object} contact - Updated contact object
     */
    async updateSharedContactDatabases(contact) {
        try {
            const sharedDbName = `shared-contact-${contact.contactId}`;
            
            console.log(`🔄 Checking if shared database exists: ${sharedDbName}`);
            
            // Check if we have this shared database in our owned databases
            let databaseExists = false;
            try {
                // ✅ SDK COMPLIANT: getDatabases() returns { databases: [...] }
                const result = await userbase.getDatabases();
                const dbList = result.databases;
                const existingDb = dbList.find(db => 
                    db.databaseName === sharedDbName && db.isOwner
                );
                
                if (existingDb) {
                    databaseExists = true;
                    console.log(`📋 Found owned shared database: ${sharedDbName}`);
                } else {
                    console.log(`📋 No owned shared database found: ${sharedDbName} - skipping update`);
                    return { success: true, message: 'No shared database to update' };
                }
            } catch (checkError) {
                console.log('⚠️ Could not check database existence:', checkError.message);
                return { success: false, error: checkError.message };
            }
            
            if (!databaseExists) {
                return { success: true, message: 'Shared database does not exist' };
            }
            
            // Ensure the database is open before updating
            try {
                console.log(`🔓 Ensuring shared database is open: ${sharedDbName}`);
                await userbase.openDatabase({
                    databaseName: sharedDbName,
                    changeHandler: () => {} // Minimal handler for updates
                });
                console.log(`✅ Shared database opened: ${sharedDbName}`);
            } catch (openError) {
                if (openError.name === 'DatabaseAlreadyOpening' || openError.name === 'DatabaseAlreadyOpen') {
                    console.log(`ℹ️ Database already open: ${sharedDbName}`);
                } else {
                    console.error(`❌ Failed to open shared database ${sharedDbName}:`, openError);
                    return { success: false, error: openError.message };
                }
            }
            
            // Now try to update the shared database
            try {
                await this.safeUpdateItem({
                    databaseName: sharedDbName,
                    itemId: contact.contactId,
                    item: {
                        ...contact,
                        metadata: {
                            ...contact.metadata,
                            lastUpdated: new Date().toISOString(),
                            lastSharedUpdate: new Date().toISOString(),
                            sharedAt: contact.metadata?.sharedAt, // Preserve original sharing timestamp
                            sharedBy: contact.metadata?.sharedBy, // Preserve sharing info
                            originalContactId: contact.contactId
                        }
                    }
                }, 'updateSharedContactDatabases');
                
                console.log(`✅ Successfully updated shared database: ${sharedDbName}`);
                return { success: true, sharedDbName };
                
            } catch (updateError) {
                console.error(`❌ Failed to update shared database ${sharedDbName}:`, updateError);
                return { success: false, error: updateError.message };
            }
            
        } catch (error) {
            console.error('❌ Error in updateSharedContactDatabases:', error);
            return { success: false, error: error.message };
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
            const metadataItem = {
                sharedContactId,
                ...metadata,
                lastUpdated: new Date().toISOString()
            };

            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.sharedContactMeta,
                item: metadataItem,
                itemId: sharedContactId // Use shared contact ID as the item ID
            }, 'saveSharedContactMetadata');

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

            await this.safeUpdateItem({
                databaseName: this.databases.sharedContactMeta,
                itemId: sharedContactId,
                item: metadataItem
            }, 'updateSharedContactMetadata');

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
     * ✅ SDK COMPLIANT: Generate share token for contact database
     * @param {Object} contact - Contact to generate share token for
     * @param {boolean} readOnly - Whether token grants read-only access
     * @returns {Promise<Object>} Share token result
     */
    async generateContactShareToken(contact, readOnly = true) {
        try {
            if (!contact || !contact.contactId) {
                throw new Error('Valid contact is required for share token generation');
            }

            // Create a unique database name for this shared contact
            const sharedDbName = `shared-contact-${contact.contactId}`;
            
            console.log('🎫 Generating share token for contact database:', sharedDbName);

            // Check if the shared database already exists
            let databaseExists = false;
            try {
                const result = await userbase.getDatabases();
                const dbList = result.databases;
                databaseExists = dbList.some(db => 
                    db.databaseName === sharedDbName && db.isOwner
                );
            } catch (checkError) {
                console.log('⚠️ Could not check database existence, proceeding with creation:', checkError.message);
            }

            if (!databaseExists) {
                // Database doesn't exist, create it and add the contact
                console.log('📦 Creating database for share token:', sharedDbName);

                await userbase.openDatabase({
                    databaseName: sharedDbName,
                    changeHandler: () => {} // Empty handler since this is just for creation
                });

                // Insert the contact into the shared database
                await this.safeInsertItem({
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
                }, 'generateContactShareToken');
            }

            // Generate share token for the database
            const tokenResult = await this.safeShareDatabase({
                databaseName: sharedDbName,
                readOnly
            }, 'generateContactShareToken');

            console.log('✅ Share token generated successfully');

            // Log the activity
            await this.logActivity({
                action: 'share_token_generated',
                details: {
                    contactId: contact.contactId,
                    contactName: contact.cardName,
                    databaseName: sharedDbName,
                    readOnly
                }
            });

            this.eventBus.emit('contact:shareTokenGenerated', { 
                contactId: contact.contactId,
                shareToken: tokenResult.shareToken,
                readOnly
            });
            
            return { 
                success: true, 
                shareToken: tokenResult.shareToken,
                databaseName: sharedDbName,
                readOnly
            };
            
        } catch (error) {
            console.error('Generate share token failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
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
        try {
            if (!username || username.trim() === '') {
                throw new Error('Username is required for sharing');
            }
            
            if (!contact || !contact.contactId) {
                throw new Error('Valid contact is required for sharing');
            }

            console.log(`📤 Sharing contact with ${username} (SDK compliant workflow)`);

            // Create a unique database name for this shared contact
            const sharedDbName = `shared-contact-${contact.contactId}`;
            
            console.log('📦 Preparing to share contact database:', sharedDbName);

            // Check if the shared database already exists
            let databaseExists = false;
            let databaseUsers = [];
            
            try {
                // ✅ SDK COMPLIANT: getDatabases() returns { databases: [...] }
                const result = await userbase.getDatabases();
                const dbList = result.databases;
                const existingDb = dbList.find(db => 
                    db.databaseName === sharedDbName && db.isOwner
                );
                
                if (existingDb) {
                    databaseExists = true;
                    databaseUsers = existingDb.users || [];
                    console.log('🔍 Database exists with users:', databaseUsers.map(u => u.username));
                }
            } catch (checkError) {
                console.log('⚠️ Could not check database existence, proceeding with creation:', checkError.message);
            }

            // Check if user is already shared with
            const userAlreadyShared = databaseUsers.some(user => user.username === username.trim());
            
            if (userAlreadyShared) {
                console.log('👤 User already has access, modifying permissions instead');
                
                // Use modifyDatabasePermissions to change existing permissions
                return await this.modifyContactPermissions(contact.contactId, username, readOnly, resharingAllowed, false);
                
            } else if (databaseExists) {
                console.log('📤 Adding new user to existing shared database using modifyDatabasePermissions');
                
                // Database exists but user doesn't have access - use modifyDatabasePermissions to add them
                await this.safeModifyDatabasePermissions({
                    databaseName: sharedDbName,
                    username: username.trim(),
                    readOnly,
                    resharingAllowed
                }, 'shareContact-addUser');
                
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
                console.log('📦 Creating new shared database and sharing with first user');

                // Database doesn't exist, create it using shareDatabase (for first user)
                await userbase.openDatabase({
                    databaseName: sharedDbName,
                    changeHandler: () => {} // Empty handler since this is just for creation
                });

                // Insert the contact into the shared database
                await this.safeInsertItem({
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
                }, 'shareContact');

                // Use shareDatabase for the first user (initial sharing)
                await this.safeShareDatabase({
                    databaseName: sharedDbName,
                    username: username.trim(),
                    readOnly,
                    resharingAllowed,
                    requireVerified: false // Temporarily disabled for testing
                }, 'shareContact-initial');

                console.log('✅ New shared database created and shared with first user:', username);
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
            
            console.log('✅ Contact updated in shared database:', sharedDbName);
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to update contact in shared database:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * ✅ SDK COMPLIANT: Revoke user access to a specific contact's shared database
     * @param {string} contactId - The contact ID to revoke access to
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revocation result
     */
    async revokeContactAccess(contactId, username) {
        return await this.modifyContactPermissions(contactId, username, true, false, true);
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
            await this.safeUpdateItem({
                databaseName: sharedDbName,
                itemId: contact.contactId,
                item: contact
            }, 'updateSharedContactDatabase');

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
                console.log('🔍 SDK Database Properties Sample:', sharedContactDatabases[0]);
                console.log('🔍 Available SDK properties:', Object.keys(sharedContactDatabases[0]));
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
            console.log('🔍 Raw result from getDatabases():', result);
            
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