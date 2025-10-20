/**
 * Baical CardDAV Bridge Connector
 * Handles communication with the Baical bridge server for CardDAV sync
 */
export class BaicalConnector {
    constructor(bridgeUrl = 'http://localhost:3001/api') {
        this.bridgeUrl = bridgeUrl;
        this.connections = new Map(); // Store multiple connection profiles
        this.syncIntervals = new Map(); // Store sync timers
        this.isConnected = false;
        this.lastSyncStatus = null;
        
        // 🔧 Debug: Log the configured bridge URL
        console.log('🔧 BaicalConnector initialized with bridge URL:', this.bridgeUrl);
        
        // Event callbacks
        this.onStatusChange = null;
        this.onContactsReceived = null;
        this.onError = null;
    }

    /**
     * Connect to a Baical CardDAV server through the bridge
     * @param {Object} config - Connection configuration
     * @returns {Promise<Object>} Connection result with contacts
     */
    async connectToServer(config) {
        try {
            console.log('🔗 Connecting to Baical server:', config.serverUrl);
            console.log('🌐 Bridge URL configured as:', this.bridgeUrl);
            console.log('📡 Full request URL:', `${this.bridgeUrl}/connect`);
            
            const response = await fetch(`${this.bridgeUrl}/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    serverUrl: config.serverUrl,
                    username: config.username,
                    password: config.password,
                    profileName: config.profileName
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Connection failed');
            }

            // Store connection configuration
            this.connections.set(config.profileName, {
                ...config,
                connected: true,
                lastSync: new Date().toISOString()
            });

            // Set up automatic sync if interval specified
            if (config.syncInterval && config.syncInterval > 0) {
                this.setupAutoSync(config.profileName, config.syncInterval);
            }

            this.isConnected = true;
            this.notifyStatusChange('connected', config.profileName);

            console.log('✅ Baical connection successful:', result);

            return {
                success: true,
                profileName: config.profileName,
                contactCount: result.contacts?.length || 0,
                contacts: result.contacts || [],
                serverInfo: result.serverInfo
            };

        } catch (error) {
            console.error('❌ Baical connection failed:', error);
            this.notifyError(error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test sync with existing connection
     * @param {string} profileName - Connection profile name
     * @returns {Promise<Object>} Sync result
     */
    async testSync(profileName) {
        try {
            if (!this.connections.has(profileName)) {
                throw new Error(`Profile "${profileName}" not found`);
            }

            console.log('🔄 Testing Baical sync for profile:', profileName);

            const response = await fetch(`${this.bridgeUrl}/sync/${profileName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Sync failed');
            }

            // Update connection info
            const connection = this.connections.get(profileName);
            connection.lastSync = new Date().toISOString();
            this.connections.set(profileName, connection);

            // Extract contacts from syncResult or direct result
            const contacts = result.syncResult?.contacts || result.contacts || [];
            const syncResult = result.syncResult || result;

            this.lastSyncStatus = {
                profileName,
                timestamp: new Date().toISOString(),
                contactCount: contacts.length,
                success: true
            };

            console.log(`✅ Baical sync successful: Found ${contacts.length} contacts`, syncResult);

            return {
                success: true,
                profile: profileName,
                contacts: contacts,
                changes: syncResult.changes || {},
                syncResult: syncResult,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Baical sync failed:', error);
            this.lastSyncStatus = {
                profileName,
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message
            };
            this.notifyError(error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Push contact to Baical server
     * @param {string} profileName - Connection profile name
     * @param {Object} contact - Contact data in vCard format
     * @returns {Promise<Object>} Push result
     */
    async pushContactToBaical(profileName, contact) {
        try {
            if (!this.connections.has(profileName)) {
                throw new Error(`Profile "${profileName}" not found`);
            }

            console.log('📤 Pushing contact to Baical:', contact.contactId);

            const response = await fetch(`${this.bridgeUrl}/push/${profileName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contact: {
                        uid: contact.contactId,
                        vcard: contact.vcard,
                        name: contact.cardName
                    }
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Push failed');
            }

            console.log('✅ Contact pushed to Baical successfully');

            return {
                success: true,
                contactId: contact.contactId,
                profileName
            };

        } catch (error) {
            console.error('❌ Push to Baical failed:', error);
            this.notifyError(error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Disconnect from Baical server
     * @param {string} profileName - Connection profile name
     * @returns {Promise<Object>} Disconnect result
     */
    async disconnect(profileName) {
        try {
            console.log('🔌 Disconnecting from Baical profile:', profileName);

            // Stop auto sync
            this.stopAutoSync(profileName);

            // Remove connection
            if (this.connections.has(profileName)) {
                const connection = this.connections.get(profileName);
                connection.connected = false;
                this.connections.set(profileName, connection);
            }

            // Call bridge disconnect endpoint
            const response = await fetch(`${this.bridgeUrl}/disconnect/${profileName}`, {
                method: 'POST'
            });

            if (response.ok) {
                console.log('✅ Disconnected from Baical successfully');
            }

            // Update connection status
            this.isConnected = this.connections.size > 0 && 
                Array.from(this.connections.values()).some(conn => conn.connected);

            this.notifyStatusChange('disconnected', profileName);

            return { success: true };

        } catch (error) {
            console.error('❌ Baical disconnect failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get all connection profiles
     * @returns {Array} Array of connection profiles
     */
    getConnections() {
        return Array.from(this.connections.entries()).map(([name, config]) => ({
            profileName: name,
            serverUrl: config.serverUrl,
            username: config.username,
            connected: config.connected || false,
            lastSync: config.lastSync,
            syncInterval: config.syncInterval
        }));
    }

    /**
     * Get connection status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            connectionCount: this.connections.size,
            lastSyncStatus: this.lastSyncStatus,
            connections: this.getConnections()
        };
    }

    /**
     * Setup automatic sync for a profile
     * @param {string} profileName - Profile name
     * @param {number} intervalMs - Sync interval in milliseconds
     */
    setupAutoSync(profileName, intervalMs) {
        // Clear existing interval
        this.stopAutoSync(profileName);

        // Set up new interval
        const intervalId = setInterval(async () => {
            console.log(`⏰ Auto-syncing Baical profile: ${profileName}`);
            const result = await this.testSync(profileName);
            
            if (result.success && this.onContactsReceived) {
                this.onContactsReceived(result.contacts, profileName);
            }
        }, intervalMs);

        this.syncIntervals.set(profileName, intervalId);
        console.log(`⏰ Auto-sync setup for ${profileName}: every ${intervalMs}ms`);
    }

    /**
     * Stop automatic sync for a profile
     * @param {string} profileName - Profile name
     */
    stopAutoSync(profileName) {
        if (this.syncIntervals.has(profileName)) {
            clearInterval(this.syncIntervals.get(profileName));
            this.syncIntervals.delete(profileName);
            console.log(`⏹️ Auto-sync stopped for ${profileName}`);
        }
    }

    /**
     * Test bridge server connectivity
     * @returns {Promise<Object>} Health check result
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.bridgeUrl}/health`);
            const result = await response.json();

            return {
                success: response.ok,
                bridgeUrl: this.bridgeUrl,
                status: result.status || 'unknown',
                version: result.version || 'unknown'
            };

        } catch (error) {
            return {
                success: false,
                bridgeUrl: this.bridgeUrl,
                error: error.message
            };
        }
    }

    /**
     * Notify status change to callback
     */
    notifyStatusChange(status, profileName) {
        if (this.onStatusChange) {
            this.onStatusChange({
                status,
                profileName,
                timestamp: new Date().toISOString(),
                isConnected: this.isConnected
            });
        }
    }

    /**
     * Notify error to callback
     */
    notifyError(error) {
        if (this.onError) {
            this.onError({
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        // Stop all auto-sync intervals
        for (const profileName of this.syncIntervals.keys()) {
            this.stopAutoSync(profileName);
        }

        // Clear connections
        this.connections.clear();
        this.isConnected = false;
    }
}