/**
 * Contact Management System - Main Application Entry Point
 * Initializes the application with all modules and coordinates the system startup
 */

import { eventBus } from './utils/EventBus.js';
import { ContactDatabase } from './core/ContactDatabase.js';
import { VCardStandard } from './core/VCardStandard.js';
import { ContactValidator } from './core/ContactValidator.js';
import { ContactManager } from './core/ContactManager.js';
import { ContactUIController } from './ui/ContactUIController.js';

/**
 * Main Application Class
 * Coordinates system initialization and manages the application lifecycle
 */
class ContactManagementApp {
    constructor() {
        this.eventBus = eventBus;
        this.isInitialized = false;
        this.modules = {};
        
        // Application configuration
        this.config = {
            userbaseAppId: '77e5016f-285d-4678-a31a-3718479a638a', // Replace with your actual Userbase App ID
            enableDebugMode: false,
            autoSaveInterval: 30000, // 30 seconds
            maxCacheSize: 1000
        };

        // Bind methods
        this.initialize = this.initialize.bind(this);
        this.shutdown = this.shutdown.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleWindowUnload = this.handleWindowUnload.bind(this);
    }

    /**
     * Initialize the application
     * Sets up all modules and starts the system
     */
    async initialize() {
        try {
            console.log('🚀 Initializing Contact Management System...');
            
            // Show loading state
            this.showLoadingState();

            // Initialize core modules in dependency order
            await this.initializeCoreModules();
            
            // Initialize UI
            await this.initializeUI();
            
            // Setup global event handlers
            this.setupGlobalEventHandlers();
            
            // Start background services
            this.startBackgroundServices();
            
            this.isInitialized = true;
            
            // Hide loading state and show application
            this.hideLoadingState();
            
            console.log('✅ Contact Management System initialized successfully');
            
            // Emit application ready event
            this.eventBus.emit('app:ready', {
                version: '1.0.0',
                modules: Object.keys(this.modules),
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            this.handleError(error, 'initialization');
            this.showErrorState(error);
        }
    }

    /**
     * Initialize core business logic modules
     */
    async initializeCoreModules() {
        console.log('📦 Initializing core modules...');

        // Initialize VCard standard handler
        this.modules.vCardStandard = new VCardStandard();
        
        // Initialize validator with VCard standard
        this.modules.validator = new ContactValidator(this.modules.vCardStandard);
        
        // Initialize database
        this.modules.database = new ContactDatabase(this.eventBus);
        await this.modules.database.initialize(this.config.userbaseAppId);
        
        // Initialize contact manager
        this.modules.contactManager = new ContactManager(
            this.eventBus,
            this.modules.database,
            this.modules.vCardStandard,
            this.modules.validator
        );

        console.log('✅ Core modules initialized');
    }

    /**
     * Initialize user interface
     */
    async initializeUI() {
        console.log('🎨 Initializing user interface...');

        // Initialize UI controller
        this.modules.uiController = new ContactUIController(
            this.eventBus,
            this.modules.contactManager
        );

        await this.modules.uiController.initialize();

        console.log('✅ User interface initialized');
    }

    /**
     * Setup global application event handlers
     */
    setupGlobalEventHandlers() {
        // Handle application errors
        this.eventBus.on('app:error', this.handleError);
        
        // Handle database connection status
        this.eventBus.on('database:error', (data) => {
            console.error('Database error:', data.error);
            this.showToast('Database connection issue. Please try again.', 'error');
        });

        // Handle authentication events
        this.eventBus.on('database:authenticated', (data) => {
            console.log('User authenticated:', data.user?.username);
            this.showToast(`Welcome back, ${data.user?.username}!`, 'success');
        });

        this.eventBus.on('database:signedOut', () => {
            console.log('User signed out');
            this.showToast('Signed out successfully', 'info');
        });

        // Handle contact operations
        this.eventBus.on('contact:created', (data) => {
            console.log('Contact created:', data.contact?.cardName);
            this.showToast('Contact created successfully', 'success');
        });

        this.eventBus.on('contact:updated', (data) => {
            console.log('Contact updated:', data.contact?.cardName);
            this.showToast('Contact updated successfully', 'success');
        });

        this.eventBus.on('contact:deleted', (data) => {
            console.log('Contact deleted:', data.contactId);
            this.showToast('Contact deleted successfully', 'success');
        });

        // Handle contact manager initialization
        this.eventBus.on('contactManager:initialized', (data) => {
            console.log(`Contact manager ready with ${data.contactCount} contacts`);
        });

        // Handle window events
        window.addEventListener('beforeunload', this.handleWindowUnload);
        window.addEventListener('unload', this.shutdown);
        
        // Handle online/offline status
        window.addEventListener('online', () => {
            this.showToast('Connection restored', 'success');
        });
        
        window.addEventListener('offline', () => {
            this.showToast('Working offline', 'warning');
        });

        // Handle visibility changes (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Application hidden');
            } else {
                console.log('Application visible');
                // Could trigger data refresh here
            }
        });
    }

    /**
     * Start background services
     */
    startBackgroundServices() {
        // Auto-save service (if needed)
        if (this.config.autoSaveInterval > 0) {
            setInterval(() => {
                // Auto-save could be implemented here if needed
                // For now, Userbase handles real-time sync
            }, this.config.autoSaveInterval);
        }

        // Periodic cleanup service
        setInterval(() => {
            this.performMaintenance();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Perform periodic maintenance tasks
     */
    performMaintenance() {
        try {
            // Clear old cached data
            if (this.modules.contactManager) {
                this.modules.contactManager.clearSearchCache();
            }

            // Log maintenance
            console.log('🧹 Maintenance tasks completed');
        } catch (error) {
            console.error('Maintenance task failed:', error);
        }
    }

    /**
     * Show loading state during initialization
     */
    showLoadingState() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        // Update loading status
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus) {
            loadingStatus.textContent = 'Initializing application...';
        }
    }

    /**
     * Hide loading state after successful initialization
     */
    hideLoadingState() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }

        const appContainer = document.getElementById('app');
        if (appContainer) {
            appContainer.style.display = 'block';
        }
    }

    /**
     * Show error state when initialization fails
     */
    showErrorState(error) {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingStatus = document.getElementById('loading-status');
        
        if (loadingStatus) {
            loadingStatus.innerHTML = `
                <div class="error-state">
                    <h3>❌ Application failed to start</h3>
                    <p>${error.message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">
                        Reload Application
                    </button>
                </div>
            `;
        }
    }

    /**
     * Show toast notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, warning, info)
     */
    showToast(message, type = 'info') {
        this.eventBus.emit('ui:showToast', { message, type });
    }

    /**
     * Handle application errors
     * @param {Object} errorData - Error event data
     * @param {string} context - Error context
     */
    handleError(errorData, context = 'unknown') {
        const error = errorData.error || errorData;
        
        console.error(`Application error in ${context}:`, error);
        
        // Show user-friendly error message
        let userMessage = 'An unexpected error occurred.';
        
        if (context === 'initialization') {
            userMessage = 'Failed to start the application. Please refresh the page.';
        } else if (context === 'database') {
            userMessage = 'Database connection issue. Please check your internet connection.';
        } else if (context === 'validation') {
            userMessage = 'Please check your input and try again.';
        }
        
        this.showToast(userMessage, 'error');
        
        // Could send error reports to monitoring service here
        this.reportError(error, context);
    }

    /**
     * Report error to monitoring service (placeholder)
     * @param {Error} error - Error object
     * @param {string} context - Error context
     */
    reportError(error, context) {
        // This would integrate with error monitoring services like Sentry
        console.log('Error reported:', { error: error.message, context, timestamp: new Date().toISOString() });
    }

    /**
     * Handle window unload event
     * @param {Event} event - Unload event
     */
    handleWindowUnload(event) {
        // Perform any necessary cleanup before page unload
        if (this.hasUnsavedChanges()) {
            event.preventDefault();
            event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    }

    /**
     * Check if there are unsaved changes
     * @returns {boolean} Has unsaved changes
     */
    hasUnsavedChanges() {
        // With Userbase, changes are saved automatically
        // This could be used for draft contact forms or settings
        return false;
    }

    /**
     * Shutdown the application
     */
    async shutdown() {
        try {
            console.log('🛑 Shutting down application...');
            
            // Close database connections
            if (this.modules.database) {
                await this.modules.database.closeDatabases();
            }
            
            // Clear event listeners
            this.eventBus.clear();
            
            // Remove window event listeners
            window.removeEventListener('beforeunload', this.handleWindowUnload);
            window.removeEventListener('unload', this.shutdown);
            
            this.isInitialized = false;
            console.log('✅ Application shutdown complete');
            
        } catch (error) {
            console.error('Error during shutdown:', error);
        }
    }

    /**
     * Get application status
     * @returns {Object} Application status
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            modules: Object.keys(this.modules),
            version: '1.0.0',
            database: this.modules.database?.getConnectionStatus() || null,
            contactCount: this.modules.contactManager?.contacts?.size || 0
        };
    }

    /**
     * Enable debug mode
     */
    enableDebugMode() {
        this.config.enableDebugMode = true;
        console.log('🐛 Debug mode enabled');
        
        // Add debug information to window for console access
        window.contactApp = this;
        
        // Enable verbose logging
        this.eventBus.on('*', (eventName, data) => {
            console.log(`Debug: ${eventName}`, data);
        });
    }
}

/**
 * Wait for Userbase SDK to be available with retry logic
 * @returns {Promise} Resolves when Userbase is loaded
 */
function waitForUserbase() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // 10 seconds max wait time
        
        const checkUserbase = () => {
            attempts++;
            
            if (typeof window.userbase !== 'undefined') {
                console.log('✅ Userbase SDK loaded successfully');
                
                // Verify Userbase has required methods
                const requiredMethods = ['init', 'signUp', 'signIn', 'signOut', 'openDatabase', 'insertItem'];
                const missingMethods = requiredMethods.filter(method => typeof window.userbase[method] !== 'function');
                
                if (missingMethods.length > 0) {
                    console.error('❌ Userbase SDK incomplete, missing methods:', missingMethods);
                    reject(new Error(`Userbase SDK incomplete. Missing methods: ${missingMethods.join(', ')}`));
                    return;
                }
                
                console.log('✅ Userbase SDK fully loaded and verified');
                resolve();
            } else if (attempts >= maxAttempts) {
                console.error('❌ Userbase SDK failed to load within timeout');
                
                // Try to reload the script as a last resort
                console.log('🔄 Attempting to reload Userbase script...');
                this.reloadUserbaseScript()
                    .then(() => {
                        console.log('✅ Userbase script reloaded, checking again...');
                        setTimeout(() => {
                            if (typeof window.userbase !== 'undefined') {
                                resolve();
                            } else {
                                reject(new Error('Userbase SDK failed to load even after script reload'));
                            }
                        }, 1000);
                    })
                    .catch(error => {
                        reject(new Error(`Userbase SDK failed to load: ${error.message}`));
                    });
            } else {
                setTimeout(checkUserbase, 100); // Check every 100ms
            }
        };
        
        checkUserbase();
    });
}

/**
 * Reload Userbase script if initial load failed
 * @returns {Promise} Resolves when script is reloaded
 */
function reloadUserbaseScript() {
    return new Promise((resolve, reject) => {
        // Remove existing script
        const existingScript = document.querySelector('script[src*="userbase"]');
        if (existingScript) {
            existingScript.remove();
            console.log('🗑️ Removed existing Userbase script');
        }

        // Clear window.userbase
        if (window.userbase) {
            delete window.userbase;
            console.log('🗑️ Cleared window.userbase');
        }

        // Add new script
        const script = document.createElement('script');
        script.src = 'lib/userbase.js';
        script.onload = () => {
            console.log('✅ Userbase script reloaded successfully');
            resolve();
        };
        script.onerror = () => {
            console.error('❌ Failed to reload Userbase script');
            reject(new Error('Failed to reload Userbase script'));
        };
        
        document.head.appendChild(script);
    });
}

/**
 * Initialize the application when DOM and Userbase are ready
 */
async function initializeApp() {
    try {
        console.log('⏳ Waiting for dependencies...');
        
        // Wait for Userbase SDK to load
        await waitForUserbase();
        
        console.log('🚀 Starting application initialization...');
        
        const app = new ContactManagementApp();
        
        // Make app globally accessible for debugging
        window.contactApp = app;
        
        // Start the application
        await app.initialize();
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        
        // Show error in UI
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus) {
            loadingStatus.innerHTML = `
                <div class="error-state">
                    <h3>❌ Failed to load application</h3>
                    <p>${error.message}</p>
                    <button onclick="location.reload()" class="btn btn-primary">
                        Reload Page
                    </button>
                </div>
            `;
        }
    }
}

/**
 * Start the application
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Export for testing
export default ContactManagementApp;