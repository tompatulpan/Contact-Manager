/**
 * SessionManager - Centralized session state management for Userbase
 * Handles all session-related storage, cleanup, and state queries
 */

export class SessionManager {
    /**
     * Storage keys used by Userbase and application
     */
    static STORAGE_KEYS = {
        REMEMBER_ME: 'userbase-remember-me',
        CURRENT_SESSION: 'userbaseCurrentSession',
        SESSION_ONLY: 'userbase-session-only',
        PAGE_LOADED: 'userbase-page-loaded'
    };
    
    /**
     * Session types
     */
    static SESSION_TYPES = {
        PERSISTENT: 'persistent',
        SESSION: 'session',
        NONE: null
    };
    
    /**
     * Check if a stored session exists
     * @returns {boolean} True if stored session exists
     */
    static hasStoredSession() {
        const hasRememberMe = localStorage.getItem(this.STORAGE_KEYS.REMEMBER_ME) === 'true';
        const hasSessionOnly = sessionStorage.getItem(this.STORAGE_KEYS.SESSION_ONLY) === 'true';
        return hasRememberMe || hasSessionOnly;
    }
    
    /**
     * Get the current session type
     * @returns {string|null} 'persistent', 'session', or null
     */
    static getSessionType() {
        if (localStorage.getItem(this.STORAGE_KEYS.REMEMBER_ME) === 'true') {
            return this.SESSION_TYPES.PERSISTENT;
        }
        if (sessionStorage.getItem(this.STORAGE_KEYS.SESSION_ONLY) === 'true') {
            return this.SESSION_TYPES.SESSION;
        }
        return this.SESSION_TYPES.NONE;
    }
    
    /**
     * Set session preference
     * @param {boolean} rememberMe - Whether to persist session
     */
    static setSessionPreference(rememberMe) {
        if (rememberMe) {
            localStorage.setItem(this.STORAGE_KEYS.REMEMBER_ME, 'true');
            sessionStorage.removeItem(this.STORAGE_KEYS.SESSION_ONLY);
            sessionStorage.removeItem(this.STORAGE_KEYS.PAGE_LOADED);
        } else {
            localStorage.removeItem(this.STORAGE_KEYS.REMEMBER_ME);
            sessionStorage.setItem(this.STORAGE_KEYS.SESSION_ONLY, 'true');
        }
    }
    
    /**
     * Mark page as loaded (for session-only auth)
     */
    static markPageLoaded() {
        sessionStorage.setItem(this.STORAGE_KEYS.PAGE_LOADED, 'true');
    }
    
    /**
     * Check if page was loaded in this session
     * @returns {boolean}
     */
    static isPageLoaded() {
        return sessionStorage.getItem(this.STORAGE_KEYS.PAGE_LOADED) === 'true';
    }
    
    /**
     * Clear all session data from both localStorage and sessionStorage
     */
    static clearAllSessionData() {
        Object.values(this.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
        });
    }
    
    /**
     * Clear Userbase-specific session data
     * Called during sign out to prevent stale session resumption
     */
    static clearUserbaseSession() {
        sessionStorage.removeItem(this.STORAGE_KEYS.CURRENT_SESSION);
        localStorage.removeItem(this.STORAGE_KEYS.CURRENT_SESSION);
    }
    
    /**
     * Clear legacy plaintext passwords from older app versions
     * SECURITY: Prevents XSS from accessing legacy credentials
     */
    static clearLegacyPasswords() {
        try {
            Object.keys(localStorage)
                .filter(k => k.startsWith('baikal_password_'))
                .forEach(k => localStorage.removeItem(k));
        } catch (e) {
            // localStorage unavailable (private browsing) - nothing to clean
        }
    }
    
    /**
     * Clear URL parameters on app startup for security
     * SECURITY: Prevents credential exposure in browser history
     */
    static clearURLParameters() {
        const currentUrl = new URL(window.location);
        const hasParams = currentUrl.search || currentUrl.hash.includes('?');
        
        if (hasParams) {
            const cleanUrl = `${currentUrl.origin}${currentUrl.pathname}${currentUrl.hash.split('?')[0]}`;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }
}

export default SessionManager;
