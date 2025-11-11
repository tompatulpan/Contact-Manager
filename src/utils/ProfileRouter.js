/**
 * Profile Router - Handles URL routing for profile sharing links
 * Detects and parses URLs in the format: domain.tld/#/username
 */
class ProfileRouter {
    constructor() {
        this.currentProfile = null;
        this.isProfileLink = false;
    }

    /**
     * Initialize the profile router and parse current URL
     * @returns {Object} Profile information if detected
     */
    initialize() {
        this.parseCurrentURL();
        return this.getProfileInfo();
    }

    /**
     * Parse the current URL to detect profile links
     * Format: https://domain.tld/#/username
     */
    parseCurrentURL() {
        const hash = window.location.hash;
        
        // Reset state
        this.currentProfile = null;
        this.isProfileLink = false;

        // Check if hash starts with #/ followed by username
        if (hash && hash.startsWith('#/')) {
            const username = hash.substring(2); // Remove '#/'
            
            if (username && this.isValidUsername(username)) {
                this.currentProfile = username;
                this.isProfileLink = true;
                
            }
        }
    }

    /**
     * Validate username format
     * @param {string} username - Username to validate
     * @returns {boolean} Is valid username
     */
    isValidUsername(username) {
        // Basic username validation - alphanumeric, underscore, hyphen, 3-30 chars
        const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
        return usernameRegex.test(username);
    }

    /**
     * Get current profile information
     * @returns {Object|null} Profile information or null
     */
    getProfileInfo() {
        if (!this.isProfileLink || !this.currentProfile) {
            return null;
        }

        return {
            username: this.currentProfile,
            isProfileLink: true,
            shareURL: window.location.href,
            baseURL: window.location.origin
        };
    }

    /**
     * Generate a profile sharing URL for a username
     * @param {string} username - Username to create share URL for
     * @returns {string} Share URL
     */
    generateProfileURL(username) {
        if (!username || !this.isValidUsername(username)) {
            throw new Error('Invalid username for profile URL');
        }

        const baseURL = window.location.origin;
        const profileURL = `${baseURL}/#/${username}`;
        
        return profileURL;
    }

    /**
     * Clear profile state and return to normal URL
     */
    clearProfileState() {
        this.currentProfile = null;
        this.isProfileLink = false;
        
        // Remove hash from URL without page reload
        const url = window.location.origin + window.location.pathname;
        window.history.replaceState(null, null, url);
    }

    /**
     * Check if current URL is a profile link
     * @returns {boolean} Is profile link
     */
    hasProfileLink() {
        return this.isProfileLink && this.currentProfile !== null;
    }

    /**
     * Get the profile username
     * @returns {string|null} Username or null
     */
    getProfileUsername() {
        return this.hasProfileLink() ? this.currentProfile : null;
    }

    /**
     * Listen for URL hash changes (back/forward buttons)
     * @param {Function} callback - Callback function when URL changes
     */
    onURLChange(callback) {
        window.addEventListener('hashchange', () => {
            const oldProfile = this.currentProfile;
            this.parseCurrentURL();
            const newProfile = this.currentProfile;
            
            if (oldProfile !== newProfile) {
                callback(this.getProfileInfo());
            }
        });
    }

    /**
     * Generate shareable text for a profile
     * @param {string} username - Username to share
     * @returns {string} Shareable text
     */
    generateShareText(username) {
        const profileURL = this.generateProfileURL(username);
        
        return `Hi! I'd like to connect with you on Contact Manager. ` +
               `You can view my profile and sign up using this link: ${profileURL}`;
    }

    /**
     * Copy profile URL to clipboard
     * @param {string} username - Username to copy URL for
     * @returns {Promise<boolean>} Success status
     */
    async copyProfileURL(username) {
        try {
            const profileURL = this.generateProfileURL(username);
            await navigator.clipboard.writeText(profileURL);
            return true;
        } catch (error) {
            console.error('Failed to copy profile URL:', error);
            return false;
        }
    }

    /**
     * Get profile link metadata for display
     * @param {string} username - Username
     * @returns {Object} Profile metadata
     */
    getProfileMetadata(username) {
        return {
            username: username,
            shareURL: this.generateProfileURL(username),
            shareText: this.generateShareText(username),
            qrCodeData: this.generateProfileURL(username),
            title: `Connect with ${username} on Contact Manager`,
            description: `Visit this link to connect with ${username} and access the secure contact management system.`
        };
    }
}

// Export singleton instance
export const profileRouter = new ProfileRouter();
export default ProfileRouter;