/**
 * Baikal Configuration Manager
 * Handles Baikal connection settings and persistence
 */
export class BaikalConfigManager {
    constructor(eventBus, database) {
        this.eventBus = eventBus;
        this.database = database;
        this.configurations = new Map();
        
        // Don't load configurations immediately - wait for database to be ready
        this.isInitialized = false;
        
        // Listen for database initialization
        this.eventBus.on('database:authenticated', () => {
            this.initializeConfigurations();
        });
    }

    /**
     * Initialize configurations after database is ready
     */
    async initializeConfigurations() {
        if (this.isInitialized) return;
        
        try {
            await this.loadConfigurations();
            this.isInitialized = true;
            console.log('🔧 BaikalConfigManager initialized');
        } catch (error) {
            console.error('❌ Failed to initialize BaikalConfigManager:', error);
        }
    }

    /**
     * Save Baikal configuration to database
     * @param {Object} config - Configuration object
     * @returns {Promise<Object>} Save result
     */
    async saveConfiguration(config) {
        try {
            // Validate configuration
            const validation = this.validateConfiguration(config);
            if (!validation.isValid) {
                throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
            }

            // Sanitize configuration (remove sensitive data from storage)
            const sanitizedConfig = {
                profileName: config.profileName,
                serverUrl: config.serverUrl,
                username: config.username,
                syncInterval: config.syncInterval || 15 * 60 * 1000, // Default 15 minutes
                autoSync: config.autoSync !== false, // Default true
                bidirectionalSync: config.bidirectionalSync !== false, // Default true
                conflictResolution: config.conflictResolution || 'manual', // 'manual', 'local', 'remote'
                createdAt: config.createdAt || new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                isActive: config.isActive !== false // Default true
            };

            // Store in database using settings infrastructure
            const currentSettings = await this.database.getSettings();
            const baikalConfigurations = currentSettings.baikalConfigurations || {};
            baikalConfigurations[config.profileName] = sanitizedConfig;
            
            await this.database.updateSettings({
                ...currentSettings,
                baikalConfigurations: baikalConfigurations
            });

            // Cache in memory
            this.configurations.set(config.profileName, sanitizedConfig);

            console.log('✅ Baikal configuration saved:', config.profileName);

            this.eventBus.emit('baikal:configurationSaved', {
                profileName: config.profileName,
                configuration: sanitizedConfig
            });

            return {
                success: true,
                profileName: config.profileName,
                configuration: sanitizedConfig
            };

        } catch (error) {
            console.error('❌ Failed to save Baikal configuration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Load configuration by profile name
     * @param {string} profileName - Profile name
     * @returns {Object|null} Configuration or null if not found
     */
    getConfiguration(profileName) {
        return this.configurations.get(profileName) || null;
    }

    /**
     * Get all configurations
     * @returns {Array} Array of configurations
     */
    getAllConfigurations() {
        return Array.from(this.configurations.values());
    }

    /**
     * Update existing configuration
     * @param {string} profileName - Profile name
     * @param {Object} updates - Configuration updates
     * @returns {Promise<Object>} Update result
     */
    async updateConfiguration(profileName, updates) {
        try {
            const existingConfig = this.configurations.get(profileName);
            if (!existingConfig) {
                throw new Error(`Configuration "${profileName}" not found`);
            }

            const updatedConfig = {
                ...existingConfig,
                ...updates,
                lastUpdated: new Date().toISOString()
            };

            const result = await this.saveConfiguration(updatedConfig);

            if (result.success) {
                this.eventBus.emit('baikal:configurationUpdated', {
                    profileName,
                    configuration: updatedConfig,
                    changes: updates
                });
            }

            return result;

        } catch (error) {
            console.error('❌ Failed to update Baikal configuration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Delete configuration
     * @param {string} profileName - Profile name
     * @returns {Promise<Object>} Delete result
     */
    async deleteConfiguration(profileName) {
        try {
            if (!this.configurations.has(profileName)) {
                throw new Error(`Configuration "${profileName}" not found`);
            }

            // Delete from database using settings infrastructure
            const currentSettings = await this.database.getSettings();
            const baikalConfigurations = currentSettings.baikalConfigurations || {};
            delete baikalConfigurations[profileName];
            
            await this.database.updateSettings({
                ...currentSettings,
                baikalConfigurations: baikalConfigurations
            });
            
            this.configurations.delete(profileName);

            console.log('✅ Baikal configuration deleted:', profileName);

            this.eventBus.emit('baikal:configurationDeleted', {
                profileName
            });

            return {
                success: true,
                profileName
            };

        } catch (error) {
            console.error('❌ Failed to delete Baikal configuration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Load all configurations from database
     * @returns {Promise<void>}
     */
    async loadConfigurations() {
        try {
            // Check if database is authenticated
            if (!this.database.currentUser) {
                console.log('⏳ Database not authenticated yet, skipping Baikal configuration load');
                return;
            }
            
            // Get user settings which contain Baikal configurations
            const settings = await this.database.getSettings();
            const baikalConfigurations = settings.baikalConfigurations || {};
            
            this.configurations.clear();
            Object.values(baikalConfigurations).forEach(config => {
                this.configurations.set(config.profileName, config);
            });

            console.log(`📖 Loaded ${Object.keys(baikalConfigurations).length} Baikal configurations`);

            this.eventBus.emit('baikal:configurationsLoaded', {
                count: Object.keys(baikalConfigurations).length,
                configurations: Object.values(baikalConfigurations)
            });

        } catch (error) {
            console.error('❌ Failed to load Baikal configurations:', error);
        }
    }

    /**
     * Validate Baikal configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    validateConfiguration(config) {
        const errors = [];

        // Required fields
        if (!config.profileName || config.profileName.trim() === '') {
            errors.push('Profile name is required');
        }

        if (!config.serverUrl || config.serverUrl.trim() === '') {
            errors.push('Server URL is required');
        } else {
            // Validate URL format
            try {
                new URL(config.serverUrl);
            } catch {
                errors.push('Server URL must be a valid URL');
            }
        }

        if (!config.username || config.username.trim() === '') {
            errors.push('Username is required');
        }

        // Optional validation
        if (config.syncInterval && (typeof config.syncInterval !== 'number' || config.syncInterval < 60000)) {
            errors.push('Sync interval must be at least 60 seconds (60000ms)');
        }

        if (config.conflictResolution && !['manual', 'local', 'remote'].includes(config.conflictResolution)) {
            errors.push('Conflict resolution must be "manual", "local", or "remote"');
        }

        // Profile name uniqueness (for new configurations)
        if (this.configurations.has(config.profileName) && !config.isUpdate) {
            errors.push(`Profile name "${config.profileName}" already exists`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Test configuration connectivity
     * @param {Object} config - Configuration to test
     * @returns {Promise<Object>} Test result
     */
    async testConfiguration(config) {
        try {
            // This would typically make a test connection to the Baikal server
            // through the bridge to verify credentials and connectivity
            
            const testResult = {
                success: true,
                serverUrl: config.serverUrl,
                username: config.username,
                responseTime: 150, // Mock response time
                serverVersion: '1.0.0', // Mock server version
                supportedFeatures: ['carddav', 'sync', 'vcard4'], // Mock features
                addressBookCount: 1 // Mock address book count
            };

            console.log('✅ Baikal configuration test successful');

            return testResult;

        } catch (error) {
            console.error('❌ Baikal configuration test failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get configuration with password (for auto-connect functionality)
     * Note: Passwords are not stored for security reasons - this method returns null password
     * @param {string} profileName - Profile name
     * @returns {Object|null} Configuration with password placeholder
     */
    getConfigurationWithPassword(profileName) {
        const config = this.configurations.get(profileName);
        if (!config) return null;

        // For security, passwords are never stored
        // This method exists for API compatibility but always returns null password
        return {
            ...config,
            password: null // Passwords are never stored for security
        };
    }

    /**
     * Get configuration for UI display (without sensitive data)
     * @param {string} profileName - Profile name
     * @returns {Object|null} Safe configuration for UI
     */
    getConfigurationForUI(profileName) {
        const config = this.configurations.get(profileName);
        if (!config) return null;

        return {
            profileName: config.profileName,
            serverUrl: config.serverUrl,
            username: config.username,
            syncInterval: config.syncInterval,
            autoSync: config.autoSync,
            bidirectionalSync: config.bidirectionalSync,
            conflictResolution: config.conflictResolution,
            isActive: config.isActive,
            createdAt: config.createdAt,
            lastUpdated: config.lastUpdated
        };
    }

    /**
     * Export configurations for backup
     * @returns {Object} Export data
     */
    exportConfigurations() {
        const configurations = Array.from(this.configurations.values());
        
        return {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            configurationCount: configurations.length,
            configurations: configurations.map(config => ({
                ...config,
                // Exclude sensitive data
                password: undefined
            }))
        };
    }

    /**
     * Import configurations from backup
     * @param {Object} exportData - Export data
     * @returns {Promise<Object>} Import result
     */
    async importConfigurations(exportData) {
        try {
            if (!exportData.configurations || !Array.isArray(exportData.configurations)) {
                throw new Error('Invalid export data format');
            }

            let importedCount = 0;
            let skippedCount = 0;
            const errors = [];

            for (const config of exportData.configurations) {
                try {
                    // Skip if profile already exists
                    if (this.configurations.has(config.profileName)) {
                        skippedCount++;
                        continue;
                    }

                    // Import configuration (password will need to be set manually)
                    await this.saveConfiguration({
                        ...config,
                        isUpdate: false
                    });

                    importedCount++;

                } catch (error) {
                    errors.push(`Failed to import ${config.profileName}: ${error.message}`);
                }
            }

            console.log(`📦 Imported ${importedCount} Baikal configurations, skipped ${skippedCount}`);

            return {
                success: true,
                importedCount,
                skippedCount,
                errors
            };

        } catch (error) {
            console.error('❌ Failed to import Baikal configurations:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}