/**
 * Userbase Connection Fix
 * Handles XML parsing errors and connection issues
 */

class UserbaseConnectionFix {
    constructor() {
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
        this.originalFetch = window.fetch;
        this.setupErrorHandling();
    }

    setupErrorHandling() {
        // Override window.onerror to catch XML parsing errors
        const originalErrorHandler = window.onerror;
        window.onerror = (message, source, lineno, colno, error) => {
            if (message.includes('XML Parsing Error') || message.includes('no root element found')) {
                this.handleXMLParsingError(error);
                return true; // Prevent default error handling
            }
            
            if (originalErrorHandler) {
                return originalErrorHandler(message, source, lineno, colno, error);
            }
        };

        // Override unhandledrejection for Promise errors
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.message && 
                event.reason.message.includes('XML Parsing Error')) {
                this.handleXMLParsingError(event.reason);
                event.preventDefault(); // Prevent default rejection handling
            }
        });
    }

    async handleXMLParsingError(error) {
        
        if (this.retryCount >= this.maxRetries) {
            console.error('❌ Max retries reached for Userbase connection');
            this.showUserMessage('Connection issue detected. Please refresh the page and try again.');
            return;
        }

        this.retryCount++;

        // Strategy 1: Clear Userbase-related storage
        this.clearUserbaseStorage();

        // Strategy 2: Wait and retry
        await this.sleep(this.retryDelay);

        // Strategy 3: Force reload Userbase SDK if needed
        if (this.retryCount === 2) {
            await this.reloadUserbaseSDK();
        }

        // Strategy 4: Show user-friendly message
        if (this.retryCount >= this.maxRetries) {
            this.showRefreshMessage();
        }
    }

    clearUserbaseStorage() {
        try {
            
            // Clear localStorage items related to Userbase
            if (typeof localStorage !== 'undefined') {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.includes('userbase') || key.includes('Userbase')) {
                        localStorage.removeItem(key);
                    }
                });
            }

            // Clear sessionStorage items related to Userbase
            if (typeof sessionStorage !== 'undefined') {
                const keys = Object.keys(sessionStorage);
                keys.forEach(key => {
                    if (key.includes('userbase') || key.includes('Userbase')) {
                        sessionStorage.removeItem(key);
                    }
                });
            }

        } catch (error) {
            console.error('❌ Error clearing storage:', error);
        }
    }

    async reloadUserbaseSDK() {
        try {
            
            // Remove existing Userbase script
            const existingScript = document.querySelector('script[src*="userbase"]');
            if (existingScript) {
                existingScript.remove();
            }

            // Clear window.userbase
            if (window.userbase) {
                delete window.userbase;
            }

            // Wait a moment
            await this.sleep(1000);

            // Reload Userbase script
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'lib/userbase.js';
                script.onload = () => {
                    resolve();
                };
                script.onerror = () => {
                    console.error('❌ Failed to reload Userbase SDK');
                    reject(new Error('Failed to reload Userbase SDK'));
                };
                document.head.appendChild(script);
            });

        } catch (error) {
            console.error('❌ Error reloading Userbase SDK:', error);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showUserMessage(message) {
        // Try to show in app toast if available
        if (window.contactApp && window.contactApp.showToast) {
            window.contactApp.showToast(message, 'warning');
            return;
        }

        // Fallback to browser alert
        console.warn('⚠️ User message:', message);
    }

    showRefreshMessage() {
        const message = `Connection issue detected. Please:
1. Refresh the page (Ctrl+F5)
2. Clear browser cache
3. Check your internet connection

If the problem persists, the Userbase service may be temporarily unavailable.`;

        // Try to show in a modal or toast
        if (document.getElementById('error-toast')) {
            const errorToast = document.getElementById('error-toast');
            const errorMessage = document.getElementById('error-message');
            if (errorMessage) {
                errorMessage.textContent = message;
                errorToast.classList.remove('hidden');
            }
        } else {
            // Fallback to console and browser notification
            console.error('❌ Connection Error:', message);
            
            // Show a simple modal
            this.showSimpleModal('Connection Issue', message);
        }
    }

    showSimpleModal(title, message) {
        // Create a simple modal if none exists
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 400px;
            margin: 20px;
            text-align: center;
        `;

        content.innerHTML = `
            <h3 style="color: #dc3545; margin-bottom: 15px;">${title}</h3>
            <p style="white-space: pre-line; margin-bottom: 20px;">${message}</p>
            <button onclick="location.reload()" style="
                background: #007bff;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
            ">Refresh Page</button>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }, 10000);
    }

    // Network request interceptor for debugging
    setupNetworkDebugging() {
        const originalFetch = window.fetch;
        window.fetch = async (url, options) => {
            try {
                const response = await originalFetch(url, options);
                
                if (!response.ok) {
                    console.warn(`⚠️ Network response not OK: ${response.status} ${response.statusText} for ${url}`);
                }

                return response;
            } catch (error) {
                console.error('❌ Network request failed:', url, error);
                throw error;
            }
        };
    }

    // Initialize fix on page load
    static initialize() {
        const fix = new UserbaseConnectionFix();
        fix.setupNetworkDebugging();
        return fix;
    }
}

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UserbaseConnectionFix.initialize);
} else {
    UserbaseConnectionFix.initialize();
}

// Export for manual use
window.UserbaseConnectionFix = UserbaseConnectionFix;