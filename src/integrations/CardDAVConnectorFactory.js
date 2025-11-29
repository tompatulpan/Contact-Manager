/**
 * CardDAVConnectorFactory - Unified CardDAV Connection Management
 * 
 * Factory for creating appropriate CardDAV connectors based on server type
 * Supports: Baikal, Radicale, Nextcloud, iCloud, Generic CardDAV servers
 */

import { BaikalConnector } from './BaikalConnector.js';
import { ICloudConnector } from './ICloudConnector.js';

export class CardDAVConnectorFactory {
    constructor(eventBus, proxyConfig = {}) {
        this.eventBus = eventBus;
        this.proxyConfig = proxyConfig;
        this.connectors = new Map(); // profileName → connector instance
    }

    /**
     * Create connector based on server type
     * @param {string} serverType - 'baikal', 'icloud', 'nextcloud', 'radicale', 'generic'
     * @param {string} profileName - Unique profile identifier
     * @returns {Object} Connector instance
     */
    createConnector(serverType, profileName) {
        const normalizedType = serverType.toLowerCase();
        
        let connector;
        
        switch (normalizedType) {
            case 'icloud':
                connector = new ICloudConnector(this.eventBus, this.proxyConfig);
                break;
                
            case 'baikal':
            case 'radicale':
            case 'nextcloud':
            case 'generic':
            default:
                connector = new BaikalConnector(this.eventBus, this.proxyConfig);
                break;
        }
        
        // Store connector instance
        this.connectors.set(profileName, {
            connector,
            serverType: normalizedType,
            profileName,
            createdAt: new Date().toISOString()
        });
        
        console.log(`🏭 Created ${normalizedType} connector for profile: ${profileName}`);
        
        return connector;
    }

    /**
     * Get existing connector by profile name
     * @param {string} profileName - Profile identifier
     * @returns {Object|null} Connector instance or null
     */
    getConnector(profileName) {
        const connectorData = this.connectors.get(profileName);
        return connectorData ? connectorData.connector : null;
    }

    /**
     * Remove connector
     * @param {string} profileName - Profile identifier
     * @returns {boolean} Success status
     */
    removeConnector(profileName) {
        const connectorData = this.connectors.get(profileName);
        
        if (connectorData) {
            // Disconnect if connected
            if (connectorData.connector.isConnected) {
                connectorData.connector.disconnect();
            }
            
            this.connectors.delete(profileName);
            console.log(`🗑️ Removed connector for profile: ${profileName}`);
            return true;
        }
        
        return false;
    }

    /**
     * Get all active connectors
     * @returns {Array} Array of connector info
     */
    getAllConnectors() {
        return Array.from(this.connectors.values()).map(data => ({
            profileName: data.profileName,
            serverType: data.serverType,
            isConnected: data.connector.isConnected,
            createdAt: data.createdAt,
            status: data.connector.getStatus ? data.connector.getStatus() : null
        }));
    }

    /**
     * Detect server type from URL
     * @param {string} serverUrl - CardDAV server URL
     * @returns {string} Detected server type
     */
    static detectServerType(serverUrl) {
        const url = serverUrl.toLowerCase();
        
        if (url.includes('icloud.com')) {
            return 'icloud';
        } else if (url.includes('baikal') || url.includes('dav.php')) {
            return 'baikal';
        } else if (url.includes('nextcloud') || url.includes('/remote.php/dav')) {
            return 'nextcloud';
        } else if (url.includes('radicale')) {
            return 'radicale';
        }
        
        return 'generic';
    }

    /**
     * Get server-specific configuration
     * @param {string} serverType - Server type
     * @returns {Object} Server configuration
     */
    static getServerConfig(serverType) {
        const configs = {
            icloud: {
                name: 'iCloud',
                icon: '🍎',
                requiresAppPassword: true,
                supportsMultipleAddressbooks: false,
                defaultSyncInterval: 300000, // 5 minutes
                features: ['two-way-sync', 'etag-support', 'auto-refresh']
            },
            baikal: {
                name: 'Baikal',
                icon: '📇',
                requiresAppPassword: false,
                supportsMultipleAddressbooks: true,
                defaultSyncInterval: 300000,
                features: ['two-way-sync', 'etag-support', 'read-only-addressbooks', 'acl-support']
            },
            nextcloud: {
                name: 'Nextcloud',
                icon: '☁️',
                requiresAppPassword: true,
                supportsMultipleAddressbooks: true,
                defaultSyncInterval: 300000,
                features: ['two-way-sync', 'etag-support', 'sharing', 'versioning']
            },
            radicale: {
                name: 'Radicale',
                icon: '🗂️',
                requiresAppPassword: false,
                supportsMultipleAddressbooks: true,
                defaultSyncInterval: 600000, // 10 minutes (Radicale slower)
                features: ['two-way-sync', 'lightweight', 'self-hosted']
            },
            generic: {
                name: 'Generic CardDAV',
                icon: '📋',
                requiresAppPassword: false,
                supportsMultipleAddressbooks: true,
                defaultSyncInterval: 300000,
                features: ['two-way-sync', 'rfc-6352-compliant']
            }
        };
        
        return configs[serverType] || configs.generic;
    }

    /**
     * Validate connection parameters for server type
     * @param {string} serverType - Server type
     * @param {Object} params - Connection parameters
     * @returns {Object} Validation result
     */
    static validateConnectionParams(serverType, params) {
        const errors = [];
        
        // Common validations
        if (!params.username || params.username.trim() === '') {
            errors.push('Username is required');
        }
        
        if (!params.password || params.password.trim() === '') {
            errors.push('Password is required');
        }
        
        // Server-specific validations
        if (serverType === 'icloud') {
            if (!params.username.includes('@')) {
                errors.push('iCloud requires full Apple ID email address');
            }
            
            if (params.password && !/^[a-zA-Z0-9\-]{19}$/.test(params.password)) {
                errors.push('iCloud requires app-specific password (xxxx-xxxx-xxxx-xxxx format)');
            }
        } else {
            if (!params.serverUrl || params.serverUrl.trim() === '') {
                errors.push('Server URL is required');
            }
            
            if (params.serverUrl && !params.serverUrl.startsWith('http')) {
                errors.push('Server URL must start with http:// or https://');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

export default CardDAVConnectorFactory;
