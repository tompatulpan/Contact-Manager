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
            activity: 'activity-log'
        };
        this.changeHandlers = new Map();
        this.lastKnownSharedCount = 0;
        this.sharedDatabaseMonitor = null;
    }

    /**
     * Initialize Userbase connection
     * @param {string} appId - Userbase application ID
     */
    async initialize(appId) {
        try {
            // Check if Userbase SDK is available
            if (typeof window.userbase === 'undefined') {
                throw new Error('Userbase SDK not loaded. Make sure userbase.js is loaded before app.js');
            }

            this.appId = appId;
            console.log('🔗 Initializing Userbase with App ID:', appId);
            
            // Initialize Userbase - this can restore previous sessions
            const session = await window.userbase.init({ appId });
            
            // Handle restored session
            if (session.user) {
                console.log('🔄 Restored user session:', session.user.username);
                this.currentUser = session.user;
                await this.setupDatabases();
                this.eventBus.emit('database:authenticated', { user: this.currentUser });
            } else {
                console.log('📝 No existing session found');
            }
            
            this.isInitialized = true;
            console.log('✅ Userbase initialized successfully');
            
            this.eventBus.emit('database:initialized', { 
                appId,
                timestamp: new Date().toISOString() 
            });

            // Start periodic check for new shared databases
            this.startSharedDatabaseMonitoring();
            
        } catch (error) {
            console.error('Database initialization failed:', error);
            this.eventBus.emit('database:error', { 
                error: error.message,
                phase: 'initialization'
            });
            throw error;
        }
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

            console.log('🔍 SignUp result:', result);
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
     * @returns {Promise<Object>} Signin result
     */
    async signIn(username, password) {
        try {
            const result = await userbase.signIn({
                username,
                password
            });

            console.log('🔍 SignIn result:', result);
            // Userbase signIn returns the user object directly, not wrapped in { user: ... }
            this.currentUser = result.user || result; // Handle both wrapped and unwrapped formats
            await this.setupDatabases();
            
            console.log('🔍 About to emit database:authenticated with user:', this.currentUser);
            this.eventBus.emit('database:authenticated', { user: this.currentUser });
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.error('Sign in failed:', error);
            
            // Handle case where user is already signed in
            if (error.name === 'UserAlreadySignedIn') {
                console.log('🔄 User already signed in, using existing session...');
                
                // If currentUser is null but Userbase says user is signed in,
                // we need to restore from what Userbase already knows
                if (!this.currentUser) {
                    // Check if the app was already initialized with a user session
                    // The user should already be in this.currentUser from initialization
                    console.log('❌ currentUser is null but should have been set during init');
                    this.eventBus.emit('database:error', { error: 'Session state mismatch - please reload page' });
                    return { success: false, error: 'Session state error - please reload page' };
                }
                
                console.log('✅ Using existing session for user:', this.currentUser.username);
                await this.setupDatabases();
                console.log('🔍 About to emit database:authenticated with existing user:', this.currentUser);
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
            await userbase.signOut();
            this.currentUser = null;
            this.changeHandlers.clear();
            
            this.eventBus.emit('database:signedOut', {});
            return { success: true };
        } catch (error) {
            console.error('Sign out failed:', error);
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

            // Setup shared contact databases
            await this.setupSharedDatabases();

            // Setup settings database
            await this.openDatabase('user-settings', (items) => {
                this.eventBus.emit('settings:changed', { settings: items });
            });

            // Setup activity log database
            await this.openDatabase('activity-log', (items) => {
                this.eventBus.emit('activity:changed', { activities: items });
            });

        } catch (error) {
            console.error('Database setup failed:', error);
            throw error;
        }
    }

    /**
     * Setup shared contact databases
     */
    async setupSharedDatabases() {
        try {
            const sharedDbResult = await this.getSharedDatabases();
            if (!sharedDbResult.success) {
                console.log('📭 No shared databases found or error accessing them');
                return;
            }

            const contactDatabases = sharedDbResult.databases.filter(db => 
                db.databaseName === 'contacts'
            );

            console.log(`📬 Found ${contactDatabases.length} shared contact databases`);

            for (const db of contactDatabases) {
                try {
                    console.log(`🔄 Opening shared database from ${db.receivedFromUsername} with ID: ${db.databaseId}`);
                    await userbase.openDatabase({
                        databaseId: db.databaseId,  // Use only databaseId for shared databases
                        changeHandler: (items) => {
                            console.log(`📨 Received shared contacts from ${db.receivedFromUsername}:`, items.length);
                            console.log('🔍 Raw shared contact items:', items);
                            
                            // Log first contact structure for debugging
                            if (items.length > 0) {
                                console.log('🔍 First shared contact structure:', {
                                    item: items[0].item,
                                    itemId: items[0].itemId,
                                    keys: Object.keys(items[0].item || {}),
                                    hasVCard: !!(items[0].item && items[0].item.vcard),
                                    vCardLength: items[0].item && items[0].item.vcard ? items[0].item.vcard.length : 'N/A'
                                });
                            }
                            
                            // Transform Userbase items to contact format
                            const contacts = items.map(userbaseItem => {
                                const item = userbaseItem.item || {};
                                return {
                                    contactId: item.contactId || userbaseItem.itemId,
                                    cardName: item.cardName || 'Unnamed Contact',
                                    vcard: item.vcard || '',
                                    metadata: {
                                        ...item.metadata,
                                        isOwned: false,
                                        sharedBy: db.receivedFromUsername,
                                        databaseId: db.databaseId,
                                        lastUpdated: item.metadata?.lastUpdated || new Date().toISOString()
                                    }
                                };
                            });
                            
                            console.log('🔄 Transformed shared contacts:', contacts);
                            
                            this.eventBus.emit('contacts:changed', { 
                                contacts: contacts, 
                                isOwned: false,
                                sharedBy: db.receivedFromUsername,
                                databaseId: db.databaseId
                            });
                        }
                    });
                    console.log(`✅ Opened shared contacts database from: ${db.receivedFromUsername}`);
                } catch (error) {
                    console.error(`❌ Failed to open shared database from ${db.receivedFromUsername}:`, error);
                    console.error('❌ Error details:', {
                        message: error.message,
                        name: error.name,
                        code: error.code
                    });
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
                    const processedItems = items.map(item => ({
                        ...item.item,
                        itemId: item.itemId,
                        contactId: item.item.contactId || item.itemId // Ensure contactId is available
                    }));
                    
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
            const itemId = contact.contactId || this.generateItemId();
            
            await userbase.insertItem({
                databaseName: this.databases.contacts,
                item: {
                    ...contact,
                    itemId,
                    contactId: contact.contactId || itemId // Ensure contactId is always set
                },
                itemId
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

            this.eventBus.emit('contact:updated', { contact });
            return { success: true, itemId };
        } catch (error) {
            console.error('Update contact failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
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
     * Share contacts database with another user
     * @param {string} username - Target username
     * @param {boolean} readOnly - Whether sharing is read-only
     * @param {boolean} resharingAllowed - Whether resharing is allowed
     * @returns {Promise<Object>} Share result
     */
    async shareContacts(username, readOnly = true, resharingAllowed = false) {
        try {
            console.log('🔄 Attempting to share database:', this.databases.contacts, 'with user:', username);
            console.log('📊 Share params:', { readOnly, resharingAllowed });
            
            if (!username || username.trim() === '') {
                throw new Error('Username is required for sharing');
            }
            
            if (!this.databases.contacts) {
                throw new Error('No contacts database found to share');
            }
            
            await userbase.shareDatabase({
                databaseName: this.databases.contacts,
                username: username.trim(),
                readOnly,
                resharingAllowed,
                requireVerified: false  // Allow sharing with unverified users
            });

            console.log('✅ Database shared successfully with:', username);

            // Log the sharing activity
            await this.logActivity({
                action: 'database_shared',
                targetUser: username,
                details: {
                    databaseName: this.databases.contacts,
                    readOnly,
                    resharingAllowed
                }
            });

            this.eventBus.emit('contacts:shared', { username, readOnly, resharingAllowed });
            
            // Refresh shared databases to pick up any new shares
            setTimeout(() => {
                this.setupSharedDatabases();
            }, 1000);
            
            return { success: true };
        } catch (error) {
            console.error('Share contacts failed:', error);
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
     * Get all shared databases
     * @returns {Promise<Array>} Array of shared databases
     */
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
            console.log('📊 Found shared databases:', sharedDatabases.length);
            
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
    async updateSettings(settings) {
        try {
            const itemId = 'user-settings';
            
            await userbase.updateItem({
                databaseName: this.databases.settings,
                item: {
                    ...settings,
                    lastUpdated: new Date().toISOString()
                },
                itemId
            });

            this.eventBus.emit('settings:updated', { settings });
            return { success: true, itemId };
        } catch (error) {
            console.error('Update settings failed:', error);
            return { success: false, error: error.message };
        }
    }

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
     * Generate unique item ID
     * @returns {string} Unique ID
     */
    generateItemId() {
        return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

        console.log('🔄 Started shared database monitoring (checking every 10 seconds)');
    }

    /**
     * Check for new shared databases
     */
    async checkForNewSharedDatabases() {
        try {
            const allDatabases = await userbase.getDatabases();
            const sharedDatabases = allDatabases.databases.filter(db => !db.isOwner);
            
            // Check if we have new shared databases
            const currentSharedCount = this.lastKnownSharedCount || 0;
            const newSharedCount = sharedDatabases.length;
            
            if (newSharedCount > currentSharedCount) {
                console.log(`🔄 Detected ${newSharedCount - currentSharedCount} new shared database(s)!`);
                console.log('🔄 Re-setting up shared databases...');
                
                // Re-setup all shared databases to include new ones
                await this.setupSharedDatabases();
                
                this.lastKnownSharedCount = newSharedCount;
            }
            
        } catch (error) {
            console.error('🔄 Error checking for new shared databases:', error);
        }
    }
}