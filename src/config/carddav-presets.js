/**
 * CardDAV Server Configuration Presets
 * 
 * Pre-configured settings for popular CardDAV servers
 * Use these presets for quick setup in Contact Manager
 */

import { APP_CONFIG } from './app.config.js';

export const CARDDAV_PRESETS = {
    /**
     * iCloud Contacts
     * Apple's CardDAV service
     */
    icloud: {
        name: 'iCloud',
        displayName: 'iCloud Contacts',
        serverUrl: APP_CONFIG.iCloud.baseUrl,
        defaultAccountType: 'carddav',
        authMethod: 'Basic',
        vCardVersion: '3.0',
        
        // iCloud-specific features
        features: {
            supportsGroups: true,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: true
        },
        
        // Instructions for users
        setup: {
            usernameLabel: 'Apple ID Email',
            usernamePlaceholder: 'your-email@icloud.com',
            passwordLabel: 'App-Specific Password',
            passwordPlaceholder: 'xxxx-xxxx-xxxx-xxxx',
            helpUrl: 'https://appleid.apple.com/account/manage',
            instructions: [
                '1. Go to appleid.apple.com/account/manage',
                '2. Navigate to Security → App-Specific Passwords',
                '3. Generate password for "Contact Manager"',
                '4. Use that password here (NOT your Apple ID password)'
            ]
        },
        
        // Color scheme for UI
        ui: {
            icon: '🍎',
            color: '#007AFF',
            darkColor: '#0A84FF'
        }
    },

    /**
     * Baikal Server
     * Self-hosted CardDAV server
     */
    baikal: {
        name: 'baikal',
        displayName: 'Baïkal Server',
        serverUrl: 'https://your-server.com/dav.php',
        defaultAccountType: 'carddav',
        authMethod: 'Basic',
        vCardVersion: '3.0',
        
        features: {
            supportsGroups: true,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: false,
            selfHosted: true
        },
        
        setup: {
            usernameLabel: 'Username',
            usernamePlaceholder: 'your-username',
            passwordLabel: 'Password',
            passwordPlaceholder: 'your-password',
            serverUrlEditable: true,
            helpUrl: 'https://sabre.io/baikal/',
            instructions: [
                '1. Enter your Baïkal server URL (e.g., https://dav.example.com/dav.php)',
                '2. Use your Baïkal username and password',
                '3. Server URL typically ends with /dav.php'
            ]
        },
        
        ui: {
            icon: '🏠',
            color: '#4CAF50',
            darkColor: '#66BB6A'
        }
    },

    /**
     * Radicale Server
     * Lightweight self-hosted CardDAV server
     */
    radicale: {
        name: 'radicale',
        displayName: 'Radicale',
        serverUrl: 'http://localhost:5232',
        defaultAccountType: 'carddav',
        authMethod: 'Basic',
        vCardVersion: '3.0',
        
        features: {
            supportsGroups: false,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: false,
            selfHosted: true,
            lightweight: true
        },
        
        setup: {
            usernameLabel: 'Username',
            usernamePlaceholder: 'your-username',
            passwordLabel: 'Password',
            passwordPlaceholder: 'your-password',
            serverUrlEditable: true,
            helpUrl: 'https://radicale.org/',
            instructions: [
                '1. Enter your Radicale server URL',
                '2. Default: http://localhost:5232',
                '3. Use your configured username and password'
            ]
        },
        
        ui: {
            icon: '⚡',
            color: '#FF9800',
            darkColor: '#FFB74D'
        }
    },

    /**
     * Nextcloud Contacts
     * Nextcloud's built-in CardDAV
     */
    nextcloud: {
        name: 'nextcloud',
        displayName: 'Nextcloud',
        serverUrl: 'https://your-nextcloud.com/remote.php/dav',
        defaultAccountType: 'carddav',
        authMethod: 'Basic',
        vCardVersion: '3.0',
        
        features: {
            supportsGroups: true,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: true,
            selfHosted: true
        },
        
        setup: {
            usernameLabel: 'Nextcloud Username',
            usernamePlaceholder: 'your-username',
            passwordLabel: 'App Password',
            passwordPlaceholder: 'app-password',
            serverUrlEditable: true,
            helpUrl: 'https://docs.nextcloud.com/server/latest/user_manual/en/pim/contacts.html',
            instructions: [
                '1. Enter your Nextcloud URL (e.g., https://cloud.example.com)',
                '2. URL typically ends with /remote.php/dav',
                '3. Generate app password in Nextcloud settings',
                '4. Use app password, not your login password'
            ]
        },
        
        ui: {
            icon: '☁️',
            color: '#0082C9',
            darkColor: '#00A0E3'
        }
    },

    /**
     * Google Contacts
     * Google's CardDAV implementation
     */
    google: {
        name: 'google',
        displayName: 'Google Contacts',
        serverUrl: 'https://www.googleapis.com/.well-known/carddav',
        defaultAccountType: 'carddav',
        authMethod: 'OAuth2',
        vCardVersion: '3.0',
        
        features: {
            supportsGroups: true,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: true,
            requiresOAuth: true
        },
        
        setup: {
            usernameLabel: 'Google Email',
            usernamePlaceholder: 'your-email@gmail.com',
            passwordLabel: 'App Password',
            passwordPlaceholder: '16-character-app-password',
            helpUrl: 'https://support.google.com/accounts/answer/185833',
            instructions: [
                '1. Enable 2-Step Verification first',
                '2. Go to myaccount.google.com/apppasswords',
                '3. Generate app password for "Contact Manager"',
                '4. Use the 16-character password'
            ]
        },
        
        ui: {
            icon: '🔵',
            color: '#4285F4',
            darkColor: '#669DF6'
        }
    },

    /**
     * Custom Server
     * For any other CardDAV server
     */
    custom: {
        name: 'custom',
        displayName: 'Custom Server',
        serverUrl: '',
        defaultAccountType: 'carddav',
        authMethod: 'Basic',
        vCardVersion: '3.0',
        
        features: {
            supportsGroups: true,
            supportsPhotos: true,
            supportsNotes: true,
            requiresAppPassword: false
        },
        
        setup: {
            usernameLabel: 'Username',
            usernamePlaceholder: 'username',
            passwordLabel: 'Password',
            passwordPlaceholder: 'password',
            serverUrlEditable: true,
            serverUrlRequired: true,
            helpUrl: null,
            instructions: [
                '1. Enter your CardDAV server URL',
                '2. Include full path (e.g., https://dav.example.com/carddav/)',
                '3. Enter your credentials',
                '4. Test connection before saving'
            ]
        },
        
        ui: {
            icon: '⚙️',
            color: '#9E9E9E',
            darkColor: '#BDBDBD'
        }
    }
};

/**
 * Get preset by name
 * @param {string} presetName - Name of preset (e.g., 'icloud', 'baikal')
 * @returns {Object|null} Preset configuration or null
 */
export function getPreset(presetName) {
    return CARDDAV_PRESETS[presetName] || null;
}

/**
 * Get all preset names
 * @returns {Array<string>} Array of preset names
 */
export function getPresetNames() {
    return Object.keys(CARDDAV_PRESETS);
}

/**
 * Get presets for UI selector
 * @returns {Array<Object>} Array of {name, displayName, icon, description}
 */
export function getPresetsForUI() {
    return Object.entries(CARDDAV_PRESETS).map(([key, preset]) => ({
        id: key,
        name: preset.displayName,
        icon: preset.ui.icon,
        description: preset.setup.instructions[0],
        color: preset.ui.color,
        requiresAppPassword: preset.features.requiresAppPassword
    }));
}

/**
 * Validate preset configuration
 * @param {Object} config - Configuration to validate
 * @param {string} presetName - Preset name for validation rules
 * @returns {Object} {valid: boolean, errors: Array<string>}
 */
export function validatePresetConfig(config, presetName) {
    const errors = [];
    const preset = getPreset(presetName);
    
    if (!preset) {
        errors.push('Invalid preset name');
        return { valid: false, errors };
    }
    
    // Required fields
    if (!config.username || config.username.trim() === '') {
        errors.push('Username is required');
    }
    
    if (!config.password || config.password.trim() === '') {
        errors.push('Password is required');
    }
    
    if (preset.setup.serverUrlRequired && (!config.serverUrl || config.serverUrl.trim() === '')) {
        errors.push('Server URL is required');
    }
    
    // Format validation
    if (config.username && presetName === 'icloud' && !config.username.includes('@')) {
        errors.push('iCloud requires full Apple ID email');
    }
    
    if (config.serverUrl) {
        try {
            new URL(config.serverUrl);
        } catch {
            errors.push('Invalid server URL format');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

export default CARDDAV_PRESETS;
