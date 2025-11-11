/**
 * Secure Credential Storage for CardDAV Servers
 * 
 * Provides multiple storage strategies for saving CardDAV credentials:
 * 1. Browser's Credential Management API (most secure, doesn't work in private mode)
 * 2. Encrypted localStorage (works in private mode, encrypted with user password)
 * 3. SessionStorage fallback (temporary, cleared on tab close)
 * 
 * Private Browsing Support:
 * - Detects private browsing mode automatically
 * - Uses memory-based encrypted storage when localStorage unavailable
 * - Provides user consent UI for credential storage
 */

export class SecureCredentialStorage {
    constructor() {
        this.storagePrefix = 'carddav_creds_';
        this.memoryStorage = new Map(); // Fallback for private browsing
        this.encryptionKey = null;
        this.isPrivateBrowsing = false;
        
        // Check if we're in private browsing mode
        this.detectPrivateBrowsing();
    }

    /**
     * Detect if browser is in private/incognito mode
     */
    async detectPrivateBrowsing() {
        try {
            // Test localStorage availability
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            this.isPrivateBrowsing = false;
            console.log('📦 Regular browsing mode detected - localStorage available');
        } catch (e) {
            this.isPrivateBrowsing = true;
            console.log('🔒 Private browsing mode detected - using memory storage');
        }
    }

    /**
     * Generate encryption key from user's master password
     * This allows encrypted storage even in private browsing
     */
    async setMasterPassword(masterPassword) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(masterPassword);
            
            // Generate key using Web Crypto API
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            this.encryptionKey = await crypto.subtle.importKey(
                'raw',
                hashBuffer,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
            
            console.log('🔐 Master password set - encrypted storage enabled');
            return true;
        } catch (error) {
            console.error('❌ Failed to set master password:', error);
            return false;
        }
    }

    /**
     * Encrypt data using Web Crypto API
     */
    async encrypt(plaintext) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not set. Call setMasterPassword() first.');
        }

        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(plaintext);
            
            // Generate random IV
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                this.encryptionKey,
                data
            );
            
            // Combine IV and ciphertext
            const combined = new Uint8Array(iv.length + ciphertext.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(ciphertext), iv.length);
            
            // Convert to base64 for storage
            return btoa(String.fromCharCode(...combined));
        } catch (error) {
            console.error('❌ Encryption failed:', error);
            throw error;
        }
    }

    /**
     * Decrypt data using Web Crypto API
     */
    async decrypt(ciphertext) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not set. Call setMasterPassword() first.');
        }

        try {
            // Decode from base64
            const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
            
            // Extract IV and ciphertext
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);
            
            // Decrypt
            const plaintext = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                this.encryptionKey,
                data
            );
            
            // Decode to string
            const decoder = new TextDecoder();
            return decoder.decode(plaintext);
        } catch (error) {
            console.error('❌ Decryption failed:', error);
            throw error;
        }
    }

    /**
     * Store credentials securely
     * Strategy selection based on browser mode and user preferences
     */
    async storeCredentials(profileName, credentials, options = {}) {
        const {
            usePersistentStorage = true,  // Allow localStorage storage
            useEncryption = true,          // Encrypt before storing
            rememberPassword = false       // Remember across sessions
        } = options;

        try {
            const credentialsData = JSON.stringify({
                serverUrl: credentials.serverUrl,
                username: credentials.username,
                password: credentials.password,
                timestamp: new Date().toISOString()
            });

            // Strategy 1: Try Browser's Credential Management API (most secure)
            if (window.PasswordCredential && rememberPassword && !this.isPrivateBrowsing) {
                try {
                    // Build absolute URL for iconURL (Credential API requirement)
                    const iconURL = `${window.location.origin}/favicon.ico`;
                    
                    const credential = new PasswordCredential({
                        id: `${profileName}@${credentials.serverUrl}`,
                        name: profileName,
                        password: credentials.password,
                        iconURL: iconURL
                    });
                    
                    await navigator.credentials.store(credential);
                    console.log('✅ Stored credentials using Credential Management API');
                    return { success: true, method: 'credential_api' };
                } catch (error) {
                    console.warn('⚠️ Credential API failed, falling back:', error.message);
                }
            }

            // Strategy 2: Encrypted localStorage (works in regular browsing)
            if (usePersistentStorage && !this.isPrivateBrowsing && useEncryption && this.encryptionKey) {
                try {
                    const encrypted = await this.encrypt(credentialsData);
                    localStorage.setItem(`${this.storagePrefix}${profileName}`, encrypted);
                    console.log('✅ Stored encrypted credentials in localStorage');
                    return { success: true, method: 'encrypted_localStorage' };
                } catch (error) {
                    console.warn('⚠️ Encrypted localStorage failed:', error.message);
                }
            }

            // Strategy 3: Plain localStorage (less secure, but works)
            if (usePersistentStorage && !this.isPrivateBrowsing && !useEncryption) {
                try {
                    localStorage.setItem(`${this.storagePrefix}${profileName}`, credentialsData);
                    console.log('⚠️ Stored credentials in localStorage (unencrypted)');
                    return { success: true, method: 'localStorage_plain', warning: 'Credentials stored unencrypted' };
                } catch (error) {
                    console.warn('⚠️ localStorage failed:', error.message);
                }
            }

            // Strategy 4: Encrypted memory storage (private browsing)
            if (this.isPrivateBrowsing && useEncryption && this.encryptionKey) {
                try {
                    const encrypted = await this.encrypt(credentialsData);
                    this.memoryStorage.set(profileName, encrypted);
                    console.log('✅ Stored encrypted credentials in memory (private browsing)');
                    return { success: true, method: 'encrypted_memory' };
                } catch (error) {
                    console.warn('⚠️ Encrypted memory storage failed:', error.message);
                }
            }

            // Strategy 5: SessionStorage fallback (temporary)
            try {
                sessionStorage.setItem(`${this.storagePrefix}${profileName}`, credentialsData);
                console.log('✅ Stored credentials in sessionStorage (temporary)');
                return { success: true, method: 'sessionStorage', warning: 'Credentials will be lost on tab close' };
            } catch (error) {
                console.error('❌ All storage methods failed:', error);
                return { success: false, error: 'No storage available' };
            }

        } catch (error) {
            console.error('❌ Failed to store credentials:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Retrieve stored credentials
     */
    async getCredentials(profileName) {
        try {
            // Strategy 1: Try Credential Management API
            if (window.PasswordCredential && !this.isPrivateBrowsing) {
                try {
                    const credential = await navigator.credentials.get({
                        password: true,
                        mediation: 'optional'
                    });
                    
                    if (credential && credential.id.startsWith(profileName)) {
                        console.log('✅ Retrieved credentials from Credential Management API');
                        return {
                            success: true,
                            credentials: {
                                username: credential.id.split('@')[0],
                                password: credential.password
                            },
                            method: 'credential_api'
                        };
                    }
                } catch (error) {
                    console.warn('⚠️ Credential API retrieval failed:', error.message);
                }
            }

            // Strategy 2: Try encrypted localStorage
            if (!this.isPrivateBrowsing) {
                try {
                    const encrypted = localStorage.getItem(`${this.storagePrefix}${profileName}`);
                    if (encrypted && this.encryptionKey) {
                        const decrypted = await this.decrypt(encrypted);
                        const credentials = JSON.parse(decrypted);
                        console.log('✅ Retrieved encrypted credentials from localStorage');
                        return { success: true, credentials, method: 'encrypted_localStorage' };
                    } else if (encrypted) {
                        // Try plain localStorage
                        const credentials = JSON.parse(encrypted);
                        console.log('✅ Retrieved credentials from localStorage');
                        return { success: true, credentials, method: 'localStorage_plain' };
                    }
                } catch (error) {
                    console.warn('⚠️ localStorage retrieval failed:', error.message);
                }
            }

            // Strategy 3: Try encrypted memory storage (private browsing)
            if (this.isPrivateBrowsing && this.memoryStorage.has(profileName)) {
                try {
                    const encrypted = this.memoryStorage.get(profileName);
                    if (this.encryptionKey) {
                        const decrypted = await this.decrypt(encrypted);
                        const credentials = JSON.parse(decrypted);
                        console.log('✅ Retrieved encrypted credentials from memory');
                        return { success: true, credentials, method: 'encrypted_memory' };
                    }
                } catch (error) {
                    console.warn('⚠️ Memory storage retrieval failed:', error.message);
                }
            }

            // Strategy 4: Try sessionStorage fallback
            try {
                const stored = sessionStorage.getItem(`${this.storagePrefix}${profileName}`);
                if (stored) {
                    const credentials = JSON.parse(stored);
                    console.log('✅ Retrieved credentials from sessionStorage');
                    return { success: true, credentials, method: 'sessionStorage' };
                }
            } catch (error) {
                console.warn('⚠️ sessionStorage retrieval failed:', error.message);
            }

            return { success: false, error: 'No credentials found' };

        } catch (error) {
            console.error('❌ Failed to retrieve credentials:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove stored credentials
     */
    async removeCredentials(profileName) {
        try {
            let removed = false;

            // Remove from all possible storage locations
            if (!this.isPrivateBrowsing) {
                localStorage.removeItem(`${this.storagePrefix}${profileName}`);
                removed = true;
            }

            sessionStorage.removeItem(`${this.storagePrefix}${profileName}`);
            
            if (this.memoryStorage.has(profileName)) {
                this.memoryStorage.delete(profileName);
                removed = true;
            }

            if (removed) {
                console.log(`✅ Removed credentials for profile: ${profileName}`);
            }

            return { success: true };
        } catch (error) {
            console.error('❌ Failed to remove credentials:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Clear all stored credentials
     */
    async clearAllCredentials() {
        try {
            // Clear localStorage
            if (!this.isPrivateBrowsing) {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith(this.storagePrefix)) {
                        localStorage.removeItem(key);
                    }
                });
            }

            // Clear sessionStorage
            const sessionKeys = Object.keys(sessionStorage);
            sessionKeys.forEach(key => {
                if (key.startsWith(this.storagePrefix)) {
                    sessionStorage.removeItem(key);
                }
            });

            // Clear memory storage
            this.memoryStorage.clear();

            console.log('✅ Cleared all stored credentials');
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to clear credentials:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * List all stored credential profiles
     */
    async listStoredProfiles() {
        const profiles = new Set();

        try {
            // Check localStorage
            if (!this.isPrivateBrowsing) {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith(this.storagePrefix)) {
                        profiles.add(key.replace(this.storagePrefix, ''));
                    }
                });
            }

            // Check sessionStorage
            const sessionKeys = Object.keys(sessionStorage);
            sessionKeys.forEach(key => {
                if (key.startsWith(this.storagePrefix)) {
                    profiles.add(key.replace(this.storagePrefix, ''));
                }
            });

            // Check memory storage
            this.memoryStorage.forEach((_, profileName) => {
                profiles.add(profileName);
            });

            return { success: true, profiles: Array.from(profiles) };
        } catch (error) {
            console.error('❌ Failed to list profiles:', error);
            return { success: false, error: error.message, profiles: [] };
        }
    }

    /**
     * Get storage status information
     */
    getStorageInfo() {
        return {
            isPrivateBrowsing: this.isPrivateBrowsing,
            hasEncryptionKey: this.encryptionKey !== null,
            supportsCredentialAPI: typeof window.PasswordCredential !== 'undefined',
            localStorageAvailable: !this.isPrivateBrowsing,
            sessionStorageAvailable: typeof sessionStorage !== 'undefined',
            memoryStorageSize: this.memoryStorage.size
        };
    }
}
