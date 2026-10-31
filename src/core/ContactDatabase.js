import { IndividualSharingStrategy } from './IndividualSharingStrategy.js';
import { UserbaseSDKWrapper } from './UserbaseSDKWrapper.js';
import { UserbaseAuth } from './UserbaseAuth.js';
import { SharedDatabaseDiscovery } from './SharedDatabaseDiscovery.js';
import { PERFORMANCE_CONFIG, USERBASE_CONFIG } from '../config/app.config.js';

/**
 * ContactDatabase - Userbase integration for encrypted contact storage
 * Handles all database operations with real-time synchronization
 */
export class ContactDatabase {
    constructor(eventBus) {
        this.eventBus = eventBus;
        // SDK wrapper layer: item/sharing/permission calls with validation,
        // error handling and retries (see UserbaseSDKWrapper)
        this.sdk = new UserbaseSDKWrapper(eventBus, () => this.currentUser);
        this.isInitialized = false;
        this.currentUser = null;
        this.databases = {
            contacts: 'contacts',
            settings: 'user-settings',
            activity: 'activity-log',
            sharedContactMeta: 'shared-contact-metadata'  // Store user's metadata for shared contacts
        };
        this.changeHandlers = new Map();
        this.lastKnownSharedCount = 0;
        this.sharedDatabaseMonitor = null;
        
        // ✅ SDK COMPLIANT: State management for real-time updates
        this.settingsItems = []; // Initialize settings items array
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

        // ✅ SYNC READINESS: resolved once the user's own contacts database
        // and every received shared database has delivered its first snapshot
        // via a change handler. The iCloud sync waits on this before pulling,
        // so a pull that wins the startup race cannot import the iCloud
        // mirror of a shared contact as an owned/imported duplicate.
        this.contactsInitialLoadDeferred = null;
        this.sharedInitialLoadDeferreds = new Set();
        // vCard UIDs currently present in each received shared database
        // (keyed by databaseId). Lets the sync pull skip re-importing the
        // iCloud mirror of a contact that is (or was) shared with this user.
        this.sharedDbUidsByDatabase = new Map();
        
        // 🆕 INDIVIDUAL DATABASE STRATEGY: Initialize individual sharing strategy
        this.individualSharing = new IndividualSharingStrategy(this);

        // Auth layer (see UserbaseAuth): owns the auth-flow SDK calls and
        // the session-preference storage keys. Auth state (currentUser,
        // isInitialized, appId) stays on this instance — the module reads
        // and writes it through the injected accessors.
        this.auth = new UserbaseAuth({
            eventBus,
            getUser: () => this.currentUser,
            setUser: (user) => { this.currentUser = user; },
            getInitialized: () => this.isInitialized,
            setInitialized: (v) => { this.isInitialized = v; },
            getAppId: () => this.appId,
            setAppId: (id) => { this.appId = id; },
            setupDatabases: () => this.setupDatabases(),
            clearSessionData: () => this.clearSessionData(),
            clearChangeHandlers: () => this.changeHandlers.clear(),
            startSharedDatabaseMonitoring: () => this.startSharedDatabaseMonitoring(),
            getActiveDatabases: () => Array.from(this.changeHandlers.keys())
        });

        // Discovery layer (see SharedDatabaseDiscovery): listing, TTL cache
        // and periodic monitoring of shared contact databases. Its state
        // (sharedDatabaseCache, lastKnownSharedCount, openedSharedDatabases,
        // timer ids) stays on this instance via the injected accessors.
        this.discovery = new SharedDatabaseDiscovery({
            safeGetDatabases: (options, context) => this.sdk.safeGetDatabases(options, context),
            getCache: () => this.sharedDatabaseCache,
            setCache: (cache) => { this.sharedDatabaseCache = cache; },
            getLastKnownCount: () => this.lastKnownSharedCount,
            setLastKnownCount: (count) => { this.lastKnownSharedCount = count; },
            getOpenedSharedDatabases: () => this.openedSharedDatabases,
            setMonitorTimer: (id) => { this.sharedDatabaseMonitor = id; },
            setFallbackTimer: (id) => { this.sharedContactFallbackSync = id; },
            onNewDatabases: async (owned, received) => { await this.setupSpecificSharedDatabases(owned, received); },
            performFallbackSharedContactSync: async () => { await this.performFallbackSharedContactSync(); }
        });
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
    async hasStoredSession() { return await this.auth.hasStoredSession(); }

    /**
     * Attempt to restore a stored session silently and initialize database
     * @returns {Promise<Object>} Restoration result
     */
    async restoreSession() { return await this.auth.restoreSession(); }

    /**
     * Initialize the database connection - follows Userbase SDK specification exactly
     * @param {string} appId - Userbase app ID
     * @returns {Promise<void>}
     */
    async initialize(appId) { return await this.auth.initialize(appId); }

    sleep(ms) { return this.sdk.sleep(ms); }

    isTransientError(error) { return this.sdk.isTransientError(error); }

    async retryTransientError(operation, context, maxRetries = 3, baseDelayMs = 1000) { return this.sdk.retryTransientError(operation, context, maxRetries, baseDelayMs); }

    /**
     * Sign up new user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {string} [email] - Optional email address
     * @param {Object} [profile] - Optional user profile data
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signup result
     */
    async signUp(username, password, email = null, profile = null, rememberMe = false) { return await this.auth.signUp(username, password, email, profile, rememberMe); }

    /**
     * Sign in existing user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signin result
     */
    async signIn(username, password, rememberMe = false) { return await this.auth.signIn(username, password, rememberMe); }

    /**
     * Sign out current user - follows Userbase SDK specification exactly
     * @returns {Promise<Object>} Signout result
     */
    async signOut() { return await this.auth.signOut(); }

    /**
     * Setup user databases with change handlers
     */
    async setupDatabases() {
        try {
            // Fresh readiness deferred per setup: the change handler resolves
            // it with the first snapshot (see waitForContactDataReady)
            const contactsInitialLoad = this._createInitialLoadDeferred();
            this.contactsInitialLoadDeferred = contactsInitialLoad;

            // Setup own contacts database with real-time updates
            await this.openDatabase('contacts', (items) => {
                contactsInitialLoad.resolve();
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
            await this.ensureSharedContactMetaDatabase();

        } catch (error) {
            console.error('❌ Database setup failed:', error);
            throw error;
        }
    }

    /**
     * Create a deferred promise used to signal "first change-handler snapshot
     * delivered" for a database. Resolved exactly once by the owner of the
     * change handler; never rejects (waiters use allSettled + timeout).
     * @returns {{promise: Promise, resolve: Function}} Deferred
     */
    _createInitialLoadDeferred() {
        let resolve;
        const promise = new Promise((res) => { resolve = res; });
        return { promise, resolve };
    }

    /**
     * Cache the vCard UIDs of the contacts currently held in one received
     * shared database. Called on every snapshot so a revoke (item deleted
     * from the shared database) is reflected immediately.
     * @param {string} databaseId - Received shared database ID
     * @param {Array} items - Userbase items from the change handler
     */
    _cacheSharedDbUids(databaseId, items) {
        const uids = new Set();
        for (const userbaseItem of items || []) {
            const vcard = userbaseItem?.item?.vcard;
            // Same extraction as ContactIdentifier.extractUIDFromVCard
            const uid = vcard?.match(/^UID:(.+)$/m)?.[1]?.trim();
            if (uid) uids.add(uid);
        }
        this.sharedDbUidsByDatabase.set(databaseId, uids);
    }

    /**
     * Wait until local contact data is ready for a sync pull: the user's
     * own contacts database and every received shared database must have
     * delivered their first snapshot (or the timeout elapses, so a hung
     * database never blocks syncing entirely).
     * @param {number} timeoutMs - Fallback timeout in milliseconds
     */
    async waitForContactDataReady(timeoutMs = 15000) {
        const pending = [];
        if (this.contactsInitialLoadDeferred) {
            pending.push(this.contactsInitialLoadDeferred.promise);
        }
        for (const deferred of this.sharedInitialLoadDeferreds) {
            pending.push(deferred.promise);
        }
        if (pending.length === 0) return;

        await Promise.race([
            Promise.allSettled(pending),
            new Promise(resolve => setTimeout(resolve, timeoutMs))
        ]);
    }

    /**
     * Whether a contact with this vCard UID currently lives in one of the
     * databases shared with this user. The iCloud sync pull uses this to
     * avoid re-importing the iCloud mirror of a shared contact as an
     * owned/imported (orange) duplicate.
     * @param {string} uid - vCard UID
     * @returns {boolean} True if a received shared database holds this UID
     */
    isSharedContactUID(uid) {
        if (!uid) return false;
        for (const uids of this.sharedDbUidsByDatabase.values()) {
            if (uids.has(uid)) return true;
        }
        return false;
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
                        const initialLoad = this._createInitialLoadDeferred();
                        this.sharedInitialLoadDeferreds.add(initialLoad);

                        await userbase.openDatabase({
                            databaseId: db.databaseId,
                            changeHandler: (items) => {
                                initialLoad.resolve();
                                this._cacheSharedDbUids(db.databaseId, items);

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
                    const initialLoad = this._createInitialLoadDeferred();
                    this.sharedInitialLoadDeferreds.add(initialLoad);

                    await userbase.openDatabase({
                        databaseId: db.databaseId,
                        changeHandler: (items) => {
                            initialLoad.resolve();
                            this._cacheSharedDbUids(db.databaseId, items);

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

    validateInsertItemParams(params) { return this.sdk.validateInsertItemParams(params); }

    validateUpdateItemParams(params) { return this.sdk.validateUpdateItemParams(params); }

    validateDeleteItemParams(params) { return this.sdk.validateDeleteItemParams(params); }

    validateShareDatabaseParams(params) { return this.sdk.validateShareDatabaseParams(params); }

    validateModifyDatabasePermissionsParams(params) { return this.sdk.validateModifyDatabasePermissionsParams(params); }
    
    calculateItemSize(item) { return this.sdk.calculateItemSize(item); }
    
    /**
     * 🔧 OPTIMIZED: Optimize contact data to fit within 10KB Userbase limit
     * Multi-stage optimization with progressive data reduction
     * @param {Object} contact - Contact object to optimize
     * @returns {Object} Optimized contact object
     * @throws {Error} If contact cannot be optimized below limit
     */
    optimizeContactForStorage(contact) {
        // Input validation
        if (!contact || typeof contact !== 'object') {
            throw new Error('Invalid contact object for optimization');
        }

        try {
            // Start with shallow copy to avoid mutating original
            let optimizedContact = { ...contact };
            
            // Size thresholds
            const MAX_SIZE = 10 * 1024; // 10KB Userbase hard limit
            const SAFE_SIZE = 4 * 1024; // 4KB safe threshold (Userbase overhead ~5-6KB)
            const WARN_SIZE = 3 * 1024; // 3KB - start warning
            
            // Check initial size
            let currentSize = this.calculateItemSize(optimizedContact);
            
            // Fast path: No optimization needed
            if (currentSize <= SAFE_SIZE) {
                return optimizedContact;
            }

            console.log(`🔧 Optimizing contact (current: ${(currentSize / 1024).toFixed(2)}KB, target: <${(SAFE_SIZE / 1024).toFixed(2)}KB)`);
            
            // STAGE 1: Trim history arrays (most common optimization)
            if (optimizedContact.metadata?.sharing?.shareHistory?.length > 3) {
                optimizedContact.metadata.sharing.shareHistory = 
                    optimizedContact.metadata.sharing.shareHistory.slice(-3);
            }
            
            if (optimizedContact.metadata?.usage?.interactionHistory?.length > 3) {
                optimizedContact.metadata.usage.interactionHistory = 
                    optimizedContact.metadata.usage.interactionHistory
                        .slice(-3)
                        .map(entry => ({
                            action: entry.action,
                            timestamp: entry.timestamp
                            // Remove userId, duration for space
                        }));
            }

            if (optimizedContact.metadata?.carddav?.pushHistory?.length > 5) {
                optimizedContact.metadata.carddav.pushHistory = 
                    optimizedContact.metadata.carddav.pushHistory.slice(-5);
            }
            
            // STAGE 2: Remove non-essential metadata
            if (optimizedContact.metadata?.ui) {
                delete optimizedContact.metadata.ui;
            }
            
            // STAGE 3: Compress sharing permissions
            if (optimizedContact.metadata?.sharing?.sharePermissions) {
                const compressedPerms = {};
                for (const [user, perm] of Object.entries(optimizedContact.metadata.sharing.sharePermissions)) {
                    compressedPerms[user] = {
                        level: perm.level,
                        sharedAt: perm.sharedAt
                        // Remove canReshare, hasViewed, lastAccessedAt
                    };
                }
                optimizedContact.metadata.sharing.sharePermissions = compressedPerms;
            }
            
            // Check size after basic optimization
            currentSize = this.calculateItemSize(optimizedContact);

            // STAGE 4: Emergency optimization if still too large
            if (currentSize > SAFE_SIZE) {
                console.warn(`⚠️ Contact still large after Stage 3: ${(currentSize / 1024).toFixed(2)}KB - applying emergency optimization`);
                
                // Remove all history completely
                if (optimizedContact.metadata?.usage?.interactionHistory) {
                    delete optimizedContact.metadata.usage.interactionHistory;
                }
                if (optimizedContact.metadata?.sharing?.shareHistory) {
                    delete optimizedContact.metadata.sharing.shareHistory;
                }
                if (optimizedContact.metadata?.carddav?.pushHistory) {
                    delete optimizedContact.metadata.carddav.pushHistory;
                }
                
                currentSize = this.calculateItemSize(optimizedContact);
            }
            
            // STAGE 5: Last resort - minimal metadata only
            if (currentSize > MAX_SIZE) {
                console.error(`❌ Contact STILL exceeds limit: ${(currentSize / 1024).toFixed(2)}KB - using minimal structure`);
                
                optimizedContact = {
                    contactId: contact.contactId,
                    itemId: contact.itemId,
                    cardName: contact.cardName,
                    vcard: contact.vcard, // Keep vCard (essential data)
                    metadata: {
                        createdAt: contact.metadata?.createdAt,
                        lastUpdated: contact.metadata?.lastUpdated,
                        isOwned: contact.metadata?.isOwned || false,
                        isImported: contact.metadata?.isImported || false,
                        isArchived: contact.metadata?.isArchived || false,
                        // Minimal sharing info (essential for functionality)
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
    
    isValidItemType(item) { return this.sdk.isValidItemType(item); }
    
    handleInsertItemError(error, context) { return this.sdk.handleInsertItemError(error, context); }

    handleUpdateItemError(error, context) { return this.sdk.handleUpdateItemError(error, context); }

    handleDeleteItemError(error, context) { return this.sdk.handleDeleteItemError(error, context); }

    handleShareDatabaseError(error, context) { return this.sdk.handleShareDatabaseError(error, context); }

    handleModifyDatabasePermissionsError(error, context) { return this.sdk.handleModifyDatabasePermissionsError(error, context); }
    
    async safeInsertItem(params, context) { return this.sdk.safeInsertItem(params, context); }

    async safeUpdateItem(params, context) { return this.sdk.safeUpdateItem(params, context); }

    async safeDeleteItem(params, context, maxRetries = 3) { return this.sdk.safeDeleteItem(params, context, maxRetries); }

    /**
     * Permanently remove a contact item from the 'contacts' database.
     * Used by sync services after the remote copy has been deleted; goes
     * through safeDeleteItem so raw SDK calls stay in this layer (IS-05).
     * @param {string} contactId - itemId of the contact to remove
     * @returns {Promise<Object>} Delete result
     */
    async hardDeleteContact(contactId) {
        return this.safeDeleteItem({
            databaseName: 'contacts',
            itemId: contactId
        }, 'hardDeleteContact');
    }

    async safeShareDatabase(params, context) { return this.sdk.safeShareDatabase(params, context); }

    async safeModifyDatabasePermissions(params, context) { return this.sdk.safeModifyDatabasePermissions(params, context); }

    handleSDKError(error, context) { return this.sdk.handleSDKError(error, context); }

    handleGetDatabasesError(error, context) { return this.sdk.handleGetDatabasesError(error, context); }

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
            
            // ⚠️ CRITICAL: Only update lastUpdated if not already set (or if it's a genuine user edit)
            // Sync operations should preserve the existing lastUpdated timestamp to avoid triggering false auto-pushes
            if (!optimizedContact.metadata.lastUpdated) {
                optimizedContact.metadata.lastUpdated = new Date().toISOString();
            }
            // else: Preserve existing lastUpdated from sync or user edit
            
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
    async verifyUser(verificationMessage) { return await this.auth.verifyUser(verificationMessage); }

    /**
     * Get current user's verification message for sharing with others
     * @returns {Promise<Object>} Verification message result
     */
    async getVerificationMessage() { return await this.auth.getVerificationMessage(); }


    /**
     * ✅ SDK COMPLIANT: Share individual contact with another user using proper SDK workflow
     * Creates a separate database for the contact and uses modifyDatabasePermissions for additional users
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @returns {Promise<Object>} Share result
     */
    async shareContact(contact, username) {
        // Redirect all legacy sharing calls to individual sharing strategy
        return await this.shareContactIndividually(contact, username);
    }

    // ==================================================================================
    // 🆕 INDIVIDUAL DATABASE STRATEGY METHODS
    // ==================================================================================

    /**
     * 🆕 INDIVIDUAL: Share contact using individual database strategy
     * Creates separate database per recipient for granular control
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @returns {Promise<Object>} Share result
     */
    async shareContactIndividually(contact, username) {
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
                    readOnly: true,
                    resharingAllowed: false,
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
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revoke result
     */
    async revokeIndividualContactAccess(contactId, username) {
        try {
            const result = await this.individualSharing.revokeIndividualAccess(contactId, username);
            
            if (result.success) {
                // Log the revocation activity
                await this.logActivity({
                    action: 'contact_access_revoked',
                    targetUser: username,
                    details: {
                        contactId,
                        revokedAt: new Date().toISOString(),
                        method: 'delete-item-and-revoke-permission',
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
     * 🚀 PERFORMANCE: Get all shared contact databases with caching
     * @param {boolean} [forceRefresh=false] - Force refresh cache
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabasesCached(forceRefresh = false) { return await this.discovery.getAllSharedContactDatabasesCached(forceRefresh); }

    /**
     * 🚀 PERFORMANCE: Invalidate shared database cache
     * Call this when you know the shared database list has changed
     */
    invalidateSharedDatabaseCache() { return this.discovery.invalidateSharedDatabaseCache(); }

    /**
     * Get all shared contact databases (both owned and received) - CRITICAL for cross-device sharing
     * @param {Object} [options] - Optional parameters for getDatabases
     * @param {string} [options.databaseName] - Specific database name to retrieve
     * @param {string} [options.databaseId] - Specific database ID to retrieve
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabases(options = null) { return await this.discovery.getAllSharedContactDatabases(options); }

    /**
     * Update user settings
     * @param {Object} settings - Updated settings object
     * @returns {Promise<Object>} Update result
     */
    /**
     * Log user activity (non-critical operation)
     * Gracefully handles failures without blocking main operations
     * @param {Object} activity - Activity object with action, contactId, etc.
     * @returns {Promise<Object>} Log result (always succeeds, may skip)
     */
    async logActivity(activity) {
        // Input validation
        if (!activity || typeof activity !== 'object') {
            console.debug('⏭️ Activity log skipped (invalid activity object)');
            return { success: true, skipped: true, reason: 'invalid_input' };
        }

        try {
            // Check if activity logging is enabled and database is configured
            if (!this.databases.activity) {
                console.debug('⏭️ Activity log skipped (database not configured)');
                return { success: true, skipped: true, reason: 'not_configured' };
            }

            // Validate essential activity properties
            if (!activity.action) {
                console.debug('⏭️ Activity log skipped (missing action)');
                return { success: true, skipped: true, reason: 'missing_action' };
            }
            
            const itemId = this.generateItemId();
            
            // Create minimal activity entry (memory optimization)
            const activityEntry = {
                action: activity.action,
                timestamp: new Date().toISOString()
            };

            // Add optional fields only if present
            if (this.currentUser?.userId) {
                activityEntry.userId = this.currentUser.userId;
            }
            if (activity.contactId) {
                activityEntry.contactId = activity.contactId;
            }
            if (activity.targetUser) {
                activityEntry.targetUser = activity.targetUser;
            }
            if (activity.details && Object.keys(activity.details).length > 0) {
                activityEntry.details = activity.details;
            }
            
            // ✅ SDK COMPLIANT: Use safe insertItem with validation
            await this.safeInsertItem({
                databaseName: this.databases.activity,
                item: activityEntry,
                itemId
            }, 'logActivity');

            return { success: true, itemId };
            
        } catch (error) {
            // Activity log is non-critical - never throw, just log
            console.debug('⚠️ Activity log failed (non-critical):', error.message);
            return { 
                success: true, 
                skipped: true, 
                error: error.message,
                reason: 'database_error'
            };
        }
    }

    /**
     * Get database connection status with session awareness
     * @returns {Object} Connection status
     */


    /**
     * Clear session-specific data
     *
     * Single consolidated definition. (An older duplicate near the top of
     * the class was dead code — later class methods override earlier ones,
     * and its body referenced fields that no longer exist — so it was
     * removed. This one is the method all call sites execute.)
     */
    clearSessionData() {
        // Browser session keys
        localStorage.removeItem('userbase-remember-me');
        sessionStorage.removeItem('userbase-session-only');
        sessionStorage.removeItem('userbase-page-loaded');

        // Auth state
        this.currentUser = null;
        this.isInitialized = false;

        // In-memory session state: the previous user's data must not leak
        // into the next session (sharedDatabaseCache serves stale database
        // lists for up to its 30s TTL, openedSharedDatabases would skip
        // reopening databases with a colliding name)
        this.settingsItems = [];
        this.sharedContactMetaItems = null;
        this.databaseStates.clear();
        this.openedSharedDatabases.clear();
        this.lastKnownSharedCount = 0;
        this.sharedDatabaseCache.isValid = false;
        this.sharedDatabaseCache.data = null;

        // Reset sync-readiness state so a new session rebuilds it
        this.contactsInitialLoadDeferred = null;
        this.sharedInitialLoadDeferreds.clear();
        this.sharedDbUidsByDatabase.clear();
    }

    /**
     * Reject a session-only login on a fresh page load.
     *
     * "Keep me signed in" was unchecked, so the login must not survive a
     * page refresh. The flag alone cannot distinguish "just logged in"
     * from "page refreshed" (it stays 'true' in sessionStorage for the
     * whole tab lifetime), so this acts only when no session is live in
     * memory (`this.currentUser` is null) — i.e. exactly once, at app
     * startup, before the SDK can restore the session from storage.
     *
     * Clears the preference flag, the Userbase SDK session record from
     * both storages (the SDK would otherwise resume it) and the in-memory
     * state. Callers can then treat the user as signed out.
     *
     * @returns {Promise<boolean>} true when a session-only login was rejected
     */
    async rejectSessionOnlyLogin() { return await this.auth.rejectSessionOnlyLogin(); }

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
    startSharedDatabaseMonitoring() { return this.discovery.startSharedDatabaseMonitoring(); }

    /**
     * 🚀 PERFORMANCE: Check for new shared databases with smart caching and differential updates
     */
    async checkForNewSharedDatabases() { return await this.discovery.checkForNewSharedDatabases(); }

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
            theme: 'light',
            defaultSort: 'name',
            defaultViewMode: 'card',
            installInfoDismissed: false, // Install-on-iPhone info modal dismissed
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Check if the install info modal has been dismissed by the user
     * @returns {Promise<boolean>} True if the user chose "never show again"
     */
    async isInstallInfoDismissed() {
        try {
            const settings = await this.getSettings();
            return settings.installInfoDismissed === true;
        } catch (error) {
            console.error('❌ Error checking install info dismissed state:', error);
            return false;
        }
    }

    /**
     * Mark the install info modal as dismissed so it is never shown again
     * @returns {Promise<boolean>} Success status
     */
    async dismissInstallInfo() {
        try {
            const currentSettings = await this.getSettings();

            if (currentSettings.installInfoDismissed === true) {
                return true;
            }

            currentSettings.installInfoDismissed = true;
            return await this.updateSettings(currentSettings);
        } catch (error) {
            console.error('❌ Error dismissing install info:', error);
            return false;
        }
    }

    /**
     * Get database connection status.
     *
     * Pure status getter — no side effects, no sign-out, no storage writes.
     * The "reject session-only on page refresh" cleanup happens once at
     * app startup via rejectSessionOnlyLogin(); this method must stay
     * side-effect free because it is called during a live session
     * (app.getStatus(), handleAuthenticated recovery) where a destructive
     * branch would sign the user out.
     *
     * @returns {Object} Connection status
     */
    getConnectionStatus() { return this.auth.getConnectionStatus(); }
}