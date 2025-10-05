/**
 * ContactUIController - Main UI coordinator
 * Manages all UI components and handles user interactions
 */
import { MobileNavigation } from './MobileNavigation.js';
import { profileRouter } from '../utils/ProfileRouter.js';
import { ContactUIHelpers } from './ContactUIHelpers.js';
import { ContactRenderer } from './ContactRenderer.js';
import { USERBASE_CONFIG, AUTH_CONFIG } from '../config/app.config.js';
import { authPerformanceTracker } from '../utils/AuthPerformanceTracker.js';

export class ContactUIController {
    constructor(eventBus, contactManager) {
        this.eventBus = eventBus;
        this.contactManager = contactManager;
        
        // Initialize profile router
        this.profileRouter = profileRouter;
        this.currentProfileInfo = null;
        
        // Debug mode - set to false for production
        this.debugMode = false; // Production mode - minimal logging
        
        // UI state
        this.currentUser = null;
        this.selectedContactId = null;
        this.currentView = 'contacts'; // contacts, archived, shared
        this.viewMode = this.getDefaultViewMode(); // Responsive default: list for mobile, card for desktop
        this.searchQuery = '';
        this.activeFilters = {
            includeArchived: false,  // Don't show archived contacts by default
            includeDeleted: false,   // Don't show deleted contacts by default
            distributionList: null   // Current selected distribution list filter
        };
        
        // DOM elements cache
        this.elements = {};
        
        // Component instances (to be created)
        this.components = {};
        
        // UI configuration
        this.config = {
            itemsPerPage: 50,
            debounceDelay: 300,
            animationDuration: 300
        };

        // Bind methods
        this.handleSearchInput = this.debounce(this.handleSearchInput.bind(this), this.config.debounceDelay);
        this.handleWindowResize = this.debounce(this.handleWindowResize.bind(this), 250);
    }

    // ========== UTILITY METHODS ==========

    /**
     * Log messages only in debug mode
     */
    log(message, data = null) {
        if (this.debugMode) {
            if (data) {
                console.log(message, data);
            } else {
                console.log(message);
            }
        }
    }

    /**
     * Log errors (always shown)
     */
    logError(message, error = null) {
        if (error) {
            console.error(message, error);
        } else {
            console.error(message);
        }
    }

    /**
     * Simplified error handling wrapper
     */
    async handleAsync(operation, errorMessage = 'Operation failed') {
        try {
            return await operation();
        } catch (error) {
            this.logError(`❌ ${errorMessage}:`, error);
            this.showToast({ 
                message: `${errorMessage}: ${error.message}`, 
                type: 'error' 
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Safe element operations
     */
    safeQuerySelector(selector, context = document) {
        const element = context.querySelector(selector);
        if (!element && this.debugMode) {
            console.warn(`⚠️ Element not found: ${selector}`);
        }
        return element;
    }

    /**
     * Safe event listener addition
     */
    safeAddEventListener(element, event, handler) {
        if (element && typeof handler === 'function') {
            element.addEventListener(event, handler);
            return true;
        }
        if (this.debugMode) {
            console.warn(`⚠️ Failed to add event listener: ${event}`, element);
        }
        return false;
    }

    // ========== INITIALIZATION ==========

    /**
     * Initialize the UI controller
     */
    async initialize() {
        return this.handleAsync(async () => {
            // SECURITY: Clear any URL parameters on page load to prevent credential exposure
            this.clearURLParameters();
            
            this.log('Initializing UI Controller...');
            
            // Initialize profile router and check for profile links
            this.currentProfileInfo = this.profileRouter.initialize();
            if (this.currentProfileInfo) {
                this.log('🔗 Profile link detected:', this.currentProfileInfo);
            }
            
            // Cache DOM elements
            this.cacheElements();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // ⭐ OPTIMIZED: Check authentication immediately and efficiently
            await this.optimizedAuthenticationCheck();
            
            // Setup UI components
            this.setupComponents();
            
            // Initialize responsive behavior
            this.initializeResponsiveDesign();
            
            // Initialize mobile navigation
            this.mobileNavigation = new MobileNavigation(this.eventBus);
            
            // Clear contact detail to remove static welcome message
            this.clearContactDetail();

            return { success: true };
        }, 'UI Controller initialization failed');
    }

    /**
     * Optimized authentication check with fast path for existing sessions
     */
    async optimizedAuthenticationCheck() {
        authPerformanceTracker.start('optimized-auth-check');
        
        try {
            this.log('🚀 Starting optimized authentication check...');
            
            // Step 0: FIRST check if userbase is even available
            if (typeof window.userbase === 'undefined') {
                this.log(`⚠️ ${AUTH_CONFIG.ERRORS.SDK_NOT_LOADED}, showing auth modal`);
                this.showAuthenticationModal();
                authPerformanceTracker.end(false, { error: 'sdk-not-loaded' });
                return;
            }

            // Step 1: Try to detect existing userbase session WITHOUT initializing database
            // This is the fastest possible check - directly call userbase
            const existingSessionResult = await this.tryExistingSession();
            if (existingSessionResult.success) {
                authPerformanceTracker.end(true, { 
                    method: AUTH_CONFIG.METHODS.EXISTING_SESSION,
                    databases: existingSessionResult.databases 
                });
                return;
            }
            
            // Step 2: Try database initialization to check for sessions
            const databaseInitResult = await this.tryDatabaseInit();
            if (databaseInitResult.success) {
                authPerformanceTracker.end(true, { 
                    method: AUTH_CONFIG.METHODS.DATABASE_INIT,
                    user: databaseInitResult.user 
                });
                return;
            }
            
            // Step 3: Try manual session restoration
            const sessionRestoreResult = await this.trySessionRestore();
            if (sessionRestoreResult.success) {
                authPerformanceTracker.end(true, { 
                    method: AUTH_CONFIG.METHODS.SESSION_RESTORE,
                    user: sessionRestoreResult.user 
                });
                return;
            }
            
            // Step 4: No valid session found - show auth modal
            this.log('🔐 No valid session found, showing authentication modal');
            this.showAuthenticationModal();
            authPerformanceTracker.end(false, { 
                method: AUTH_CONFIG.METHODS.MANUAL_LOGIN,
                reason: 'no-session-found' 
            });
            
        } catch (error) {
            this.logError('Error during authentication check:', error);
            this.showAuthenticationModal();
            authPerformanceTracker.end(false, { error: error.message });
        }
    }

    /**
     * Try existing userbase session detection - SDK compliant
     * @returns {Object} Result object with success flag
     */
    async tryExistingSession() {
        try {
            this.log('⚡ Checking current authentication status...');
            
            // Check if user is already authenticated
            const status = this.contactManager.database.getConnectionStatus();
            
            if (status.isAuthenticated && status.currentUser) {
                this.log(`✅ Fast Path: User already authenticated: ${status.currentUser}`);
                this.currentUser = this.contactManager.database.currentUser;
                
                // Initialize ContactManager with existing session
                const result = await this.contactManager.initializeWithExistingSession(this.currentUser);
                
                if (result.success) {
                    this.log('✅ Fast authentication complete');
                    
                    // Show main app immediately
                    this.hideAuthenticationModal();
                    this.updateUserInterface();
                    this.showMainApplication();
                    this.refreshContactsList();
                    
                    return { success: true, user: status.currentUser, method: 'existing-session' };
                }
            } else {
                this.log('📝 No authenticated user found');
            }
            
            return { success: false, error: 'no-session-found' };
            
        } catch (sessionError) {
            const errorMessage = sessionError.message || sessionError.toString();
            this.log(`🔍 Session check failed with error: "${errorMessage}"`);
            
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Try database initialization path
     * @returns {Object} Result object with success flag
     */
    async tryDatabaseInit() {
        try {
            this.log('📊 Trying database initialization...');
            await this.contactManager.database.initialize(USERBASE_CONFIG.appId);
            
            const connectionStatus = this.contactManager.database.getConnectionStatus();
            if (connectionStatus.isAuthenticated) {
                this.log('⚡ User authenticated during database init:', connectionStatus.currentUser);
                this.currentUser = { username: connectionStatus.currentUser };
                
                // Show main app immediately - database is already ready
                this.hideAuthenticationModal();
                this.updateUserInterface();
                this.showMainApplication();
                
                // Initialize ContactManager since database is ready
                this.contactManager.initialize().then(() => {
                    this.log('🎉 ContactManager ready, contacts should be loading!');
                    this.refreshContactsList();
                }).catch(error => {
                    this.logError('Error initializing ContactManager:', error);
                });
                
                return { success: true, user: connectionStatus.currentUser };
            }
            
            return { success: false, error: 'not-authenticated' };
            
        } catch (dbError) {
            this.log('⚠️ Database initialization failed:', dbError.message);
            return { success: false, error: dbError.message };
        }
    }

    /**
     * Try session restoration path
     * @returns {Object} Result object with success flag
     */
    async trySessionRestore() {
        try {
            const hasStoredSession = await this.contactManager.database.hasStoredSession();
            
            if (!hasStoredSession) {
                return { success: false, error: 'no-stored-session' };
            }

            this.log('⚡ Found stored session, attempting restoration...');
            this.showSilentLoadingIndicator();
            
            const restoreResult = await this.contactManager.database.restoreSession();
            
            if (restoreResult.success) {
                this.log('✅ Session restored for:', restoreResult.user.username);
                this.currentUser = restoreResult.user;
                
                // Show the main app immediately
                this.hideAuthenticationModal();
                this.updateUserInterface();
                this.showMainApplication();
                this.hideSilentLoadingIndicator();
                
                // Handle ContactManager initialization based on database state
                if (restoreResult.databasesReady) {
                    this.log('🎉 Databases already initialized during restoration!');
                } else {
                    this.log('📊 Initializing ContactManager...');
                    this.contactManager.initialize().then(() => {
                        this.log('🎉 Contacts loaded and ready!');
                        this.refreshContactsList();
                    }).catch(error => {
                        this.logError('Error loading contacts:', error);
                    });
                }
                
                return { success: true, user: restoreResult.user };
            } else {
                this.log('⚠️ Session restoration failed:', restoreResult.error);
                this.hideSilentLoadingIndicator();
                return { success: false, error: restoreResult.error };
            }
            
        } catch (error) {
            this.logError('⚠️ Session restoration error:', error);
            this.hideSilentLoadingIndicator();
            return { success: false, error: error.message };
        }
    }

    /**
     * Show subtle loading indicator for silent authentication
     */
    showSilentLoadingIndicator() {
        // Create or show a minimal loading indicator
        let indicator = document.getElementById('silent-auth-loading');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'silent-auth-loading';
            indicator.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--primary-color, #007bff);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                transition: opacity 0.3s ease;
                max-width: 300px;
            `;
            indicator.innerHTML = `
                <div class="spinner" style="
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top: 2px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <span id="loading-text">Restoring session...</span>
            `;
            document.body.appendChild(indicator);
            
            // Add spinner animation if not already defined
            if (!document.getElementById('spinner-styles')) {
                const style = document.createElement('style');
                style.id = 'spinner-styles';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
        indicator.style.display = 'flex';
        indicator.style.opacity = '1';
        
        // Update the text to show what's happening
        const textEl = indicator.querySelector('#loading-text');
        if (textEl) textEl.textContent = 'Restoring session...';
    }

    /**
     * Update the loading indicator text
     */
    updateSilentLoadingText(text) {
        const indicator = document.getElementById('silent-auth-loading');
        const textEl = indicator?.querySelector('#loading-text');
        if (textEl) {
            textEl.textContent = text;
        }
    }

    /**
     * Hide silent loading indicator
     */
    hideSilentLoadingIndicator() {
        const indicator = document.getElementById('silent-auth-loading');
        if (indicator) {
            indicator.style.opacity = '0';
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.style.display = 'none';
                }
            }, 300); // Wait for transition
        }
    }

    /**
     * Cache frequently used DOM elements
     */
    cacheElements() {
        
        this.elements = {
            // Authentication elements
            authModal: document.getElementById('auth-modal'),
            authForm: document.getElementById('auth-form'),
            authToggle: document.getElementById('toggle-auth-mode'),
            authError: document.getElementById('auth-error'),
            authSubmit: document.getElementById('auth-submit'),
            authError: document.getElementById('auth-error'),
            
            // Main app elements
            app: document.getElementById('app'),
            header: document.querySelector('.header'),
            sidebar: document.querySelector('.sidebar'),
            contactList: document.getElementById('contact-list'), // Use the correct ID from HTML
            contactDetail: document.getElementById('contact-detail-content'), // Use the correct ID from HTML
            
            // Navigation elements
            navItems: document.querySelectorAll('.nav-item'),
            viewToggle: document.getElementById('view-toggle'),
            
            // Search and filter elements
            searchInput: document.getElementById('search-input'),
            searchClear: document.getElementById('search-clear'),
            sortSelect: document.getElementById('sort-select'),
            
            // View toggle elements
            viewCardBtn: document.getElementById('view-card'),
            viewListBtn: document.getElementById('view-list'),
            
            // Distribution list elements
            distributionListsContainer: document.getElementById('distribution-lists'),
            createListBtn: document.getElementById('create-list-btn'),
            
            // Contact elements
            contactCards: document.getElementById('contact-list'), // Use the correct ID from HTML
            contactForm: document.getElementById('contact-form'),
            contactModal: document.getElementById('contact-modal'),
            
            // Share modal elements
            shareModal: document.getElementById('share-modal'),
            shareForm: document.getElementById('share-form'),
            shareContactPreview: document.getElementById('share-contact-preview'),
            shareUsernameInput: document.getElementById('share-username'),
            shareReadonlyCheckbox: document.getElementById('share-readonly'),
            verifyUserBtn: document.getElementById('verify-user-btn'),
            getVerificationBtn: document.getElementById('get-verification-btn'),
            verificationMessageInput: document.getElementById('verification-message'),
            verificationStatus: document.getElementById('verification-status'),
            shareLoading: document.getElementById('share-loading'),
            shareSuccess: document.getElementById('share-success'),
            shareDistributionListSelect: document.getElementById('share-distribution-list'),
            distributionListPreview: document.getElementById('distribution-list-preview'),
            shareInfoText: document.getElementById('share-info-text'),
            shareSubmitText: document.getElementById('share-submit-text'),
            sharedWithUser: document.getElementById('shared-with-user'),
            
            // Share with list elements
            shareWithListSelect: document.getElementById('share-with-distribution-list'),
            shareListPreview: document.getElementById('share-list-preview'),
            shareListUsers: document.getElementById('share-list-users'),
            shareWithListContactPreview: document.getElementById('share-with-list-contact-preview'),
            
            // Username management modal elements
            usernameModal: document.getElementById('username-modal'),
            usernameModalTitle: document.getElementById('username-modal-title'),
            newUsernameInput: document.getElementById('new-username'),
            addUsernameBtn: document.getElementById('add-username-btn'),
            usernamesList: document.getElementById('usernames-list'),
            
            // Create List Modal elements
            createListModal: document.getElementById('create-list-modal'),
            createListForm: document.getElementById('create-list-form'),
            
            // UI controls
            newContactBtn: document.getElementById('new-contact-btn'),
            shareProfileBtn: document.getElementById('share-profile-btn'),
            importContactsBtn: document.getElementById('import-contacts-btn'),
            exportContactsBtn: document.getElementById('export-contacts-btn'),
            currentUserDisplay: document.getElementById('current-user'),
            logoutBtn: document.getElementById('logout-btn'),
            
            // Import/Export modal elements
            importModal: document.getElementById('import-modal'),
            importForm: document.getElementById('import-form'),
            importFile: document.getElementById('import-file'),
            importCardName: document.getElementById('import-card-name'),
            markAsImported: document.getElementById('mark-as-imported'),
            importLoading: document.getElementById('import-loading'),
            importSuccess: document.getElementById('import-success'),
            importResults: document.getElementById('import-results'),
            importSuccessMessage: document.getElementById('import-success-message'),
            
            exportModal: document.getElementById('export-modal'),
            exportForm: document.getElementById('export-form'),
            exportFilename: document.getElementById('export-filename'),
            exportPreview: document.getElementById('export-preview'),
            exportContactCount: document.getElementById('export-contact-count'),
            
            // Toast notifications
            toastContainer: document.getElementById('toast-container'),
            
            // Loading states
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingSpinner: document.querySelector('.loading-spinner'),
            
            // Profile sharing modal elements
            profileShareModal: document.getElementById('profile-share-modal'),
            profileUsernameDisplay: document.getElementById('profile-username-display'),
            profileShareUrl: document.getElementById('profile-share-url'),
            copyProfileUrlBtn: document.getElementById('copy-profile-url-btn'),
            shareViaEmail: document.getElementById('share-via-email'),
            
            // Stats elements
            contactCount: document.getElementById('contact-count'),
            statsTotal: document.getElementById('stat-total'),
            statsShared: document.getElementById('stat-shared'),
            statsRecent: document.getElementById('stat-recent'),
            statsImported: document.getElementById('stat-imported'),
            statsContainer: document.querySelector('.stats-grid'),
            
            // Mobile action buttons
            mobileShareProfile: document.getElementById('mobile-share-profile'),
            mobileLogout: document.getElementById('mobile-logout')
        };
        
        // Cache DOM elements complete
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // EventBus listeners
        this.setupEventBusListeners();
        
        // DOM event listeners
        this.setupDOMEventListeners();
        
        // Window event listeners
        this.setupWindowEventListeners();
    }

    /**
     * Setup EventBus event listeners
     */
    setupEventBusListeners() {
        // Authentication events
        this.eventBus.on('database:authenticated', this.handleAuthenticated.bind(this));
        this.eventBus.on('database:signedOut', this.handleSignedOut.bind(this));
        this.eventBus.on('database:error', this.handleDatabaseError.bind(this));
        
        // IMPORTANT: Do NOT check authentication status here to avoid triggering database init
        // The optimizedAuthenticationCheck() method will handle this properly
        this.log('✅ Event listeners registered, waiting for authentication check...');
        
        // Contact events
        this.eventBus.on('contactManager:contactsUpdated', this.handleContactsUpdated.bind(this));
        this.eventBus.on('contact:created', this.handleContactCreated.bind(this));
        this.eventBus.on('contact:updated', this.handleContactUpdated.bind(this));
        this.eventBus.on('contact:deleted', this.handleContactDeleted.bind(this));
        this.eventBus.on('contact:restored', this.handleContactRestored.bind(this));
        this.eventBus.on('contacts:changed', this.handleContactsUpdated.bind(this));
        
        // UI events
        this.eventBus.on('ui:showToast', this.showToast.bind(this));
        this.eventBus.on('ui:showModal', this.showModal.bind(this));
        this.eventBus.on('ui:hideModal', this.hideModal.bind(this));
        this.eventBus.on('ui:updateStats', this.updateStats.bind(this));
        this.eventBus.on('ui:show-contact-form', this.handleShowContactForm.bind(this));
    }

    /**
     * Setup DOM event listeners
     */
    setupDOMEventListeners() {
        // Authentication
        if (this.elements.authForm) {
            this.elements.authForm.addEventListener('submit', this.handleAuthSubmit.bind(this));
        }
        
        if (this.elements.authToggle) {
            this.elements.authToggle.addEventListener('click', this.toggleAuthMode.bind(this));
        }
        
        // Search and filter
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', this.handleSearchInput);
        }
        
        // Search clear button
        if (this.elements.searchClear) {
            this.elements.searchClear.addEventListener('click', this.clearSearch.bind(this));
        }
        
        // Filter checkboxes
        const filterOwned = document.getElementById('filter-owned');
        const filterShared = document.getElementById('filter-shared');
        const filterImported = document.getElementById('filter-imported');
        const filterRecent = document.getElementById('filter-recent');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterOwned) {
            filterOwned.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterShared) {
            filterShared.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterImported) {
            filterImported.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterRecent) {
            filterRecent.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterArchived) {
            filterArchived.addEventListener('change', this.handleFilterChange.bind(this));
        }

        // View toggle buttons
        if (this.elements.viewCardBtn) {
            this.elements.viewCardBtn.addEventListener('click', () => {
                try {
                    this.setViewMode('card');
                } catch (error) {
                    console.error('❌ Error calling setViewMode("card"):', error);
                }
            });
        } else {
            console.log('❌ Card view button not found!');
        }
        if (this.elements.viewListBtn) {
            this.elements.viewListBtn.addEventListener('click', () => {
                try {
                    this.setViewMode('list');
                } catch (error) {
                    console.error('❌ Error calling setViewMode("list"):', error);
                }
            });
        } else {
            console.log('❌ List view button not found!');
        }
        
        if (this.elements.sortSelect) {
            this.elements.sortSelect.addEventListener('change', this.handleSortChange.bind(this));
        }
        
        // Distribution list events
        if (this.elements.createListBtn) {
            this.elements.createListBtn.addEventListener('click', this.showCreateListModal.bind(this));
        } else {
            console.log('⚠️ Create List button not found');
        }
        
        // Navigation
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', this.handleNavigation.bind(this));
        });
        
        // Contact actions
        if (this.elements.newContactBtn) {
            this.elements.newContactBtn.addEventListener('click', this.showNewContactModal.bind(this));
        }
        
        // Profile sharing
        if (this.elements.shareProfileBtn) {
            this.elements.shareProfileBtn.addEventListener('click', this.showProfileShareModal.bind(this));
        }
        
        // Mobile share profile button
        if (this.elements.mobileShareProfile) {
            this.elements.mobileShareProfile.addEventListener('click', this.showProfileShareModal.bind(this));
        }
        
        // Import/Export actions
        if (this.elements.importContactsBtn) {
            this.elements.importContactsBtn.addEventListener('click', this.showImportModal.bind(this));
        }
        
        if (this.elements.exportContactsBtn) {
            this.elements.exportContactsBtn.addEventListener('click', this.showExportModal.bind(this));
        }
        
        if (this.elements.logoutBtn) {
            this.elements.logoutBtn.addEventListener('click', this.handleSignOut.bind(this));
        } else {
            console.error('🔧 Logout button not found during setup');
        }
        
        // Mobile logout button
        if (this.elements.mobileLogout) {
            this.elements.mobileLogout.addEventListener('click', this.handleMobileSignOut.bind(this));
        }
        
        // Contact form
        if (this.elements.contactForm) {
            this.elements.contactForm.addEventListener('submit', this.handleContactSubmit.bind(this));
        }
        
        // Share form
        if (this.elements.shareForm) {
            this.elements.shareForm.addEventListener('submit', this.handleShareSubmit.bind(this));
        }
        
        // Verify user button
        const verifyUserBtn = document.getElementById('verify-user-btn');
        if (verifyUserBtn) {
            verifyUserBtn.addEventListener('click', this.handleVerifyUser.bind(this));
        }
        
        // Get verification message button
        const getVerificationBtn = document.getElementById('get-verification-btn');
        if (getVerificationBtn) {
            getVerificationBtn.addEventListener('click', this.handleGetVerificationMessage.bind(this));
        }
        
        // Share type tabs
        const shareTypeTabs = document.querySelectorAll('.share-type-tab');
        shareTypeTabs.forEach(tab => {
            tab.addEventListener('click', this.handleShareTypeChange.bind(this));
        });
        
        // Distribution list select change
        if (this.elements.shareDistributionListSelect) {
            this.elements.shareDistributionListSelect.addEventListener('change', this.handleDistributionListSelectChange.bind(this));
        }
        
        // Share with list select change
        if (this.elements.shareWithListSelect) {
            this.elements.shareWithListSelect.addEventListener('change', (e) => {
                this.showShareListPreview(e.target.value);
            });
        }
        
        // Create list form
        if (this.elements.createListForm) {
            this.elements.createListForm.addEventListener('submit', this.handleCreateListSubmit.bind(this));
        }
        
        // Import/Export forms
        if (this.elements.importForm) {
            this.elements.importForm.addEventListener('submit', this.handleImportSubmit.bind(this));
        }
        
        if (this.elements.exportForm) {
            this.elements.exportForm.addEventListener('submit', this.handleExportSubmit.bind(this));
        }
        
        // Export form radio changes to update preview
        if (this.elements.exportForm) {
            const exportRadios = this.elements.exportForm.querySelectorAll('input[name="exportType"], input[name="exportFormat"]');
            exportRadios.forEach(radio => {
                radio.addEventListener('change', this.updateExportPreview.bind(this));
            });
        }
        
        // Multi-field component listeners
        this.setupMultiFieldListeners();
        
        // Modal close buttons
        const modalCloseButtons = document.querySelectorAll('[data-dismiss="modal"]');
        modalCloseButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const modal = event.target.closest('.modal');
                if (modal) {
                    this.hideModal({ modalId: modal.id });
                }
            });
        });

        // Retry share buttons (Share More / Try Again)
        const retryShareButtons = document.querySelectorAll('[data-action="retry-share"]');
        retryShareButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                console.log('🔄 Retry share button clicked');
                this.setShareModalState('form');
            });
        });
        
        // ESC key to close modals
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const visibleModal = document.querySelector('.modal[style*="block"]');
                if (visibleModal) {
                    this.hideModal({ modalId: visibleModal.id });
                }
            }
        });
        
        // Modal backdrop clicks
        document.addEventListener('click', this.handleModalBackdropClick.bind(this));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
        
        // Distribution list management (event delegation)
        document.addEventListener('click', this.handleDistributionListActions.bind(this));
        
        // Username management modal
        if (this.elements.addUsernameBtn) {
            this.elements.addUsernameBtn.addEventListener('click', this.handleAddUsername.bind(this));
        }
        
        if (this.elements.newUsernameInput) {
            this.elements.newUsernameInput.addEventListener('keypress', this.handleUsernameInputKeypress.bind(this));
        }

        // Close username modal
        const closeUsernameModal = document.getElementById('close-username-modal');
        if (closeUsernameModal) {
            closeUsernameModal.addEventListener('click', () => {
                this.hideModal({ modalId: 'username-modal' });
            });
        }

        // Handle manage list button clicks
        document.addEventListener('click', (event) => {
            if (event.target.matches('.manage-list-btn')) {
                const listName = event.target.dataset.listName;
                this.openUsernameManagementModal(listName);
            }
        });

        // Quick stats click handlers for filtering
        this.setupStatsClickHandlers();
    }

    /**
     * Setup click handlers for quick stats to enable filtering
     */
    setupStatsClickHandlers() {
        // Shared contacts filter
        const sharedStatItem = this.elements.statsShared?.closest('.stat-item');
        if (sharedStatItem) {
            sharedStatItem.style.cursor = 'pointer';
            sharedStatItem.title = 'Click to filter shared contacts';
            sharedStatItem.addEventListener('click', () => {
                this.filterBySharedContacts();
            });
        }

        // Recent contacts filter
        const recentStatItem = this.elements.statsRecent?.closest('.stat-item');
        if (recentStatItem) {
            recentStatItem.style.cursor = 'pointer';
            recentStatItem.title = 'Click to filter recently accessed contacts';
            recentStatItem.addEventListener('click', () => {
                this.filterByRecentContacts();
            });
        }

        // Imported contacts filter
        const importedStatItem = this.elements.statsImported?.closest('.stat-item');
        if (importedStatItem) {
            importedStatItem.style.cursor = 'pointer';
            importedStatItem.title = 'Click to filter imported contacts';
            importedStatItem.addEventListener('click', () => {
                this.filterByImportedContacts();
            });
        }

        // Total contacts (clear filters)
        const totalStatItem = this.elements.statsTotal?.closest('.stat-item');
        if (totalStatItem) {
            totalStatItem.style.cursor = 'pointer';
            totalStatItem.title = 'Click to show all contacts';
            totalStatItem.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
    }

    /**
     * Filter contacts to show only shared contacts
     */
    filterBySharedContacts() {
        // Clear other filters and set shared filter
        const filterShared = document.getElementById('filter-shared');
        const filterOwned = document.getElementById('filter-owned');
        const filterImported = document.getElementById('filter-imported');
        const filterRecent = document.getElementById('filter-recent');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterShared) filterShared.checked = true;
        if (filterOwned) filterOwned.checked = false;
        if (filterImported) filterImported.checked = false;
        if (filterRecent) filterRecent.checked = false;
        if (filterArchived) filterArchived.checked = false;
        
        // Clear search
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
            this.searchQuery = '';
        }
        
        // Apply filters using the standard handleFilterChange method
        this.handleFilterChange();
        
        // Show feedback
        this.showStatusMessage('Showing shared contacts');
    }

    /**
     * Filter contacts to show all contacts sorted by most recent activity (accessed/updated)
     */
    filterByRecentContacts() {
        // Clear other filters
        const filterShared = document.getElementById('filter-shared');
        const filterOwned = document.getElementById('filter-owned');
        const filterImported = document.getElementById('filter-imported');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterShared) filterShared.checked = false;
        if (filterOwned) filterOwned.checked = false;
        if (filterImported) filterImported.checked = false;
        if (filterArchived) filterArchived.checked = false;
        
        // Check the Recent filter
        const filterRecent = document.getElementById('filter-recent');
        if (filterRecent) filterRecent.checked = true;
        
        // Clear search
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
            this.searchQuery = '';
        }
        
        // Apply filters using the standard handleFilterChange method
        this.handleFilterChange();
        
        // Show feedback
        this.showStatusMessage('Showing all contacts sorted by most recent activity');
    }

    /**
     * Filter contacts to show only imported contacts
     */
    filterByImportedContacts() {
        // Clear other filters and set imported filter
        const filterShared = document.getElementById('filter-shared');
        const filterOwned = document.getElementById('filter-owned');
        const filterImported = document.getElementById('filter-imported');
        const filterRecent = document.getElementById('filter-recent');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterShared) filterShared.checked = false;
        if (filterOwned) filterOwned.checked = false;
        if (filterImported) filterImported.checked = true;
        if (filterRecent) filterRecent.checked = false;
        if (filterArchived) filterArchived.checked = false;
        
        // Clear search
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
            this.searchQuery = '';
        }
        
        // Apply filters using the standard handleFilterChange method
        this.handleFilterChange();
        
        // Show feedback
        this.showStatusMessage('Showing imported contacts');
    }

    /**
     * Clear all filters and show all contacts
     */
    clearAllFilters() {
        // Clear all filter checkboxes
        const filterShared = document.getElementById('filter-shared');
        const filterOwned = document.getElementById('filter-owned');
        const filterImported = document.getElementById('filter-imported');
        const filterRecent = document.getElementById('filter-recent');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterShared) filterShared.checked = false;
        if (filterOwned) filterOwned.checked = false;
        if (filterImported) filterImported.checked = false;
        if (filterRecent) filterRecent.checked = false;
        if (filterArchived) filterArchived.checked = false;
        
        // Clear search
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
            this.searchQuery = '';
        }
        
        // Apply filters using the standard handleFilterChange method
        this.handleFilterChange();
        
        // Show feedback
        this.showStatusMessage('Showing all contacts');
    }

    /**
     * Show status message to user
     */
    showStatusMessage(message) {
        // Create or update status message element
        let statusEl = document.getElementById('filter-status-message');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'filter-status-message';
            statusEl.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--primary-color, #007bff);
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                z-index: 1000;
                font-size: 14px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;
            document.body.appendChild(statusEl);
        }
        
        statusEl.textContent = message;
        statusEl.style.display = 'block';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (statusEl) {
                statusEl.style.display = 'none';
            }
        }, 3000);
    }

    /**
     * Setup window event listeners
     */
    setupWindowEventListeners() {
        window.addEventListener('resize', this.handleWindowResize);
        window.addEventListener('popstate', this.handlePopState.bind(this));
    }

    /**
     * Setup UI components
     */
    setupComponents() {
        // Components will be created when UI components are implemented
        // This is a placeholder for component initialization
        console.log('Setting up UI components...');
        
        // Initialize default view mode
        this.initializeViewMode();
    }
    
    /**
     * Initialize the default view mode
     */
    initializeViewMode() {
        // Set initial view mode and update UI accordingly
        const container = this.elements.contactCards;
        
        if (container) {
            container.classList.remove('card-view', 'list-view');
            container.classList.add(this.viewMode + '-view');
            
            // Update button states
            if (this.elements.viewCardBtn) {
                this.elements.viewCardBtn.classList.toggle('active', this.viewMode === 'card');
            }
            if (this.elements.viewListBtn) {
                this.elements.viewListBtn.classList.toggle('active', this.viewMode === 'list');
            }
            
            this.log(`Initialized view mode: ${this.viewMode}`);
        } else {
            console.error('No container found - cannot initialize view mode');
        }
    }

    /**
     * Initialize responsive design behavior
     */
    initializeResponsiveDesign() {
        this.updateResponsiveLayout();
    }

    /**
     * Handle user authentication
     */
    async handleAuthSubmit(event) {
        event.preventDefault();
        
        // SECURITY: Ensure we never expose credentials in URL
        this.clearURLParameters();
        
        const formData = new FormData(event.target);
        const username = formData.get('username')?.trim();
        const password = formData.get('password');
        const keepSignedIn = formData.get('keepSignedIn') === 'on'; // Checkbox value
        const isSignUp = event.target.dataset.mode === 'signup';
        
        // SECURITY: Validate that this is a proper form submission
        if (!username || !password) {
            this.showAuthError('Please enter both username and password');
            return;
        }
        
        console.log('📝 Form submission data:', { username, keepSignedIn, isSignUp });
        
        // Show loading state
        this.showAuthLoading(true);
        this.clearAuthError();
        
        try {
            let result;
            if (isSignUp) {
                // Pass rememberMe parameter to signUp for SDK compliance
                result = await this.contactManager.database.signUp(username, password, null, null, keepSignedIn);
            } else {
                result = await this.contactManager.database.signIn(username, password, keepSignedIn);
            }
            
            if (result.success) {
                this.currentUser = result.user;
                await this.contactManager.initialize();
                this.hideAuthenticationModal();
                this.showMainApplication();
            } else {
                this.showAuthError(result.error);
            }
            
        } catch (error) {
            this.showAuthError(error.message);
        }
        
        this.showAuthLoading(false);
    }

    /**
     * Handle authentication success
     */
    handleAuthenticated(data) {
        console.log('🔐 Authentication event received:', data);
        console.log('📋 User data structure:', data?.user); // Debug log
        
        // More robust user data validation
        const user = data?.user;
        if (user && (user.username || user.userId)) {
            this.currentUser = user;
            const displayName = user.username || user.userId || 'Unknown User';
            this.log(`✅ User authenticated: ${displayName}`);
            this.updateUserInterface();
            this.hideAuthenticationModal();
            this.showMainApplication();
        } else {
            console.error('Invalid user data in authentication event:', data);
            console.error('Expected user object with username or userId, got:', user);
            
            // Try to recover by checking database connection status
            const status = this.contactManager?.database?.getConnectionStatus();
            if (status?.isAuthenticated && status?.currentUser) {
                console.log('🔄 Recovering from database connection status');
                this.currentUser = { username: status.currentUser };
                this.updateUserInterface();
                this.hideAuthenticationModal();
                this.showMainApplication();
            } else {
                this.showAuthError('Authentication failed - invalid user data');
            }
        }
    }

    /**
     * Handle mobile sign out with confirmation
     */
    async handleMobileSignOut() {
        // Check if user is already signed out
        if (!this.currentUser) {
            console.log('ℹ️ User already signed out, skipping mobile logout');
            return;
        }

        // Show confirmation dialog for mobile logout
        const confirmed = confirm('Sign Out\n\nAre you sure you want to sign out?\n\nYou will need to sign in again to access your contacts.');
        
        if (confirmed) {
            await this.handleSignOut();
        }
    }

    /**
     * Handle sign out
     */
    async handleSignOut() {
        try {
            // Check if user is already signed out
            if (!this.currentUser) {
                console.log('ℹ️ User already signed out, skipping logout process');
                return;
            }

            // Show loading state
            this.showToast({ message: 'Signing out...', type: 'info' });
            
            const result = await this.contactManager.database.signOut();
            if (result.success) {
                // Clear UI state
                this.currentUser = null;
                this.selectedContactId = null;
                this.searchQuery = '';
                
                // Clear authentication form completely
                this.clearAuthenticationForm();
                
                // Reset UI
                this.showAuthenticationModal();
                this.hideMainApplication();
                this.clearContactDetail();
                this.clearDistributionLists(); // Clear sharing lists on logout
                
                // Show success message
                this.showToast({ message: 'Signed out successfully', type: 'success' });
            } else {
                // Handle case where user is already signed out
                if (result.error && result.error.includes('Not signed in')) {
                    console.log('ℹ️ User was already signed out, updating UI state');
                    this.currentUser = null;
                    this.showAuthenticationModal();
                    this.hideMainApplication();
                    this.clearDistributionLists();
                } else {
                    this.showToast({ message: `Sign out failed: ${result.error}`, type: 'error' });
                }
            }
        } catch (error) {
            console.error('Sign out error:', error);
            // Handle "Not signed in" error gracefully
            if (error.message && error.message.includes('Not signed in')) {
                console.log('ℹ️ User was already signed out, updating UI state');
                this.currentUser = null;
                this.showAuthenticationModal();
                this.hideMainApplication();
                this.clearDistributionLists();
            } else {
                this.showToast({ message: 'Sign out failed', type: 'error' });
            }
        }
    }

    /**
     * Handle signed out event
     */
    handleSignedOut(data) {
        // Clear user state
        this.currentUser = null;
        
        // Clear contact-related UI state
        this.selectedContactId = null;
        this.searchQuery = '';
        
        // Clear any form data
        this.resetContactForm();
        this.clearAuthenticationForm();
        
        // Clear current filter state
        this.currentFilter = 'all';
        
        // Update UI to show "no contacts" state
        const contactList = document.getElementById('contact-list');
        if (contactList) {
            contactList.innerHTML = '<div class="no-contacts">No contacts available. Sign in to view your contacts.</div>';
        }
        
        // Clear search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // Reset filter buttons
        const filterButtons = document.querySelectorAll('.filter-button');
        filterButtons.forEach(btn => btn.classList.remove('active'));
        const allButton = document.querySelector('[data-filter="all"]');
        if (allButton) allButton.classList.add('active');
        
        // Show authentication modal and hide main app
        this.showAuthenticationModal();
        this.hideMainApplication();
        this.clearDistributionLists(); // Clear sharing lists on sign out
        this.updateLogoutButtonState(); // Update logout button state
    }

    /**
     * Handle database errors
     */
    handleDatabaseError(data) {
        this.showToast({ message: data.error, type: 'error' });
    }

    /**
     * Handle search input
     */
    handleSearchInput(event) {
        const query = event.target.value;
        this.searchQuery = query;
        
        // Toggle clear button visibility
        if (this.elements.searchClear) {
            if (query.length > 0) {
                this.elements.searchClear.classList.add('visible');
            } else {
                this.elements.searchClear.classList.remove('visible');
            }
        }
        
        this.performSearch();
    }

    /**
     * Clear search input and hide clear button
     */
    clearSearch() {
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
            this.searchQuery = '';
            
            if (this.elements.searchClear) {
                this.elements.searchClear.classList.remove('visible');
            }
            
            this.performSearch();
        }
    }

    /**
     * Handle filter checkbox changes
     */
    handleFilterChange() {
        const filterOwned = document.getElementById('filter-owned');
        const filterShared = document.getElementById('filter-shared');
        const filterImported = document.getElementById('filter-imported');
        const filterRecent = document.getElementById('filter-recent');
        const filterArchived = document.getElementById('filter-archived');
        
        const ownedChecked = filterOwned?.checked || false;
        const sharedChecked = filterShared?.checked || false;
        const importedChecked = filterImported?.checked || false;
        const recentChecked = filterRecent?.checked || false;
        const archivedChecked = filterArchived?.checked || false;
        
        // If only "Recent Activity" is checked, show all contacts sorted by recent activity
        if (recentChecked && !ownedChecked && !sharedChecked && !importedChecked && !archivedChecked) {
            this.activeFilters = {
                includeArchived: false,
                includeDeleted: false,
                recentOnly: true, // Special flag for recent-only view
                sortBy: 'recent-activity', // Sort by recent activity
                sortDirection: 'desc',
                distributionList: this.activeFilters.distributionList
            };
        }
        // If only "Archived" is checked, show only archived contacts
        else if (archivedChecked && !ownedChecked && !sharedChecked && !importedChecked && !recentChecked) {
            this.activeFilters = {
                includeArchived: true,
                includeDeleted: false,
                archiveOnly: true, // Special flag for archive-only view
                distributionList: this.activeFilters.distributionList
            };
        } 
        // If only "Imported Files" is checked, show only imported contacts
        else if (importedChecked && !ownedChecked && !sharedChecked && !archivedChecked && !recentChecked) {
            this.activeFilters = {
                includeArchived: false,
                includeDeleted: false,
                importedOnly: true, // Special flag for imported-only view
                distributionList: this.activeFilters.distributionList
            };
        }
        // If "Archived" + other filters are checked, show all types including archived
        else if (archivedChecked && (ownedChecked || sharedChecked || importedChecked || recentChecked)) {
            const filters = {
                includeArchived: true,
                includeDeleted: false,
                distributionList: this.activeFilters.distributionList
            };
            
            // Handle ownership and import filtering when archived is also included
            this.setOwnershipAndImportFilters(filters, ownedChecked, sharedChecked, importedChecked);
            
            this.activeFilters = filters;
        }
        // If only ownership/import/recent filters are checked (no archived), show active contacts only
        else if (!archivedChecked && (ownedChecked || sharedChecked || importedChecked || recentChecked)) {
            const filters = {
                includeArchived: false,
                includeDeleted: false,
                distributionList: this.activeFilters.distributionList
            };
            
            // Handle ownership and import filtering
            this.setOwnershipAndImportFilters(filters, ownedChecked, sharedChecked, importedChecked);
            
            // Handle recent filtering
            if (recentChecked) {
                filters.sortBy = 'recent-activity';
                filters.sortDirection = 'desc';
            }
            
            this.activeFilters = filters;
        }
        // If no filters are checked, show active contacts (My contacts + Shared with me)
        else {
            this.activeFilters = {
                includeArchived: false,
                includeDeleted: false,
                // Don't filter by ownership - show all active contacts
                distributionList: this.activeFilters.distributionList
            };
        }
        
        // Update mobile title if mobile navigation is active
        if (this.mobileNavigation && window.innerWidth <= 768) {
            this.mobileNavigation.updateMobileTitle();
        }
        
        this.performSearch();
    }

    /**
     * Helper method to set ownership and import filters
     */
    setOwnershipAndImportFilters(filters, ownedChecked, sharedChecked, importedChecked) {
        const filterTypes = [];
        
        if (ownedChecked) filterTypes.push('owned');
        if (sharedChecked) filterTypes.push('shared');
        if (importedChecked) filterTypes.push('imported');
        
        // If only one type is selected, set specific filter
        if (filterTypes.length === 1) {
            if (filterTypes[0] === 'imported') {
                filters.importedOnly = true;
            } else {
                filters.ownership = filterTypes[0];
            }
        }
        // If multiple types selected, set combination flags
        else if (filterTypes.length > 1) {
            if (filterTypes.includes('imported')) {
                filters.includeImported = true;
            }
            
            // Handle ownership combinations
            const ownershipTypes = filterTypes.filter(t => t !== 'imported');
            if (ownershipTypes.length === 1) {
                filters.ownership = ownershipTypes[0];
            }
            // If both owned and shared are selected, don't set ownership filter (show all)
        }
    }

    /**
     * Perform contact search
     */
    performSearch() {
        const results = this.contactManager.searchContacts(this.searchQuery, this.activeFilters);
        
        // Handle Recent filter sorting
        let sortedResults;
        if (this.activeFilters.recentOnly || this.activeFilters.sortBy === 'recent-activity') {
            // Sort by recent activity descending
            sortedResults = this.contactManager.sortContacts(results, 'recent-activity', 'desc');
        } else {
            // Use current sort setting
            sortedResults = this.contactManager.sortContacts(results, this.getCurrentSort());
        }
        
        this.displayContactList(sortedResults);
        this.updateStats();
    }

    /**
     * Refresh the contacts list by performing a new search
     */
    refreshContactsList() {
        this.performSearch();
    }

    /**
     * Handle sort change
     */
    handleSortChange(event) {
        const sortBy = event.target.value;
        this.performSearch(); // Re-search with new sort
    }

    /**
     * Handle navigation between views
     */
    handleNavigation(event) {
        event.preventDefault();
        
        const navItem = event.currentTarget;
        const view = navItem.dataset.view;
        
        if (view && view !== this.currentView) {
            this.switchView(view);
        }
    }

    /**
     * Switch between different views
     */
    switchView(view) {
        // Update active navigation
        this.elements.navItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === view) {
                item.classList.add('active');
            }
        });
        
        this.currentView = view;
        
        // Update filters based on view
        switch (view) {
            case 'contacts':
                this.activeFilters = { includeArchived: false, includeDeleted: false };
                break;
            case 'archived':
                this.activeFilters = { includeArchived: true, includeDeleted: false };
                break;
            case 'shared':
                this.activeFilters = { ownership: 'shared', includeArchived: false, includeDeleted: false };
                break;
        }
        
        this.performSearch();
    }

    /**
     * Handle contact list updates
     */
    handleContactsUpdated(data) {
        // Debounce rapid updates to prevent flickering
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        
        this.updateTimeout = setTimeout(() => {
            this.renderDistributionLists(); // Update distribution lists when contacts change
            this.performSearch();
            this.updateStats();
        }, 100); // 100ms debounce
    }

    /**
     * Handle contact creation
     */
    handleContactCreated(data) {
        this.hideContactModal();
        this.performSearch();
        // Select the contact but don't track access since it was just created
        this.selectContactWithoutTracking(data.contact.contactId);
    }

    /**
     * Handle contact updates
     */
    handleContactUpdated(data) {
        this.hideContactModal();
        this.performSearch();
        if (this.selectedContactId === data.contact.contactId) {
            // Always fetch fresh contact data to avoid stale data issues
            const freshContact = this.contactManager.getContact(data.contact.contactId);
            if (freshContact) {
                this.displayContactDetail(freshContact);
            } else {
                console.warn('⚠️ Could not fetch fresh contact data, using event data as fallback');
                this.displayContactDetail(data.contact);
            }
        }
    }

    /**
     * Handle contact deletion
     */
    handleContactDeleted(data) {
        if (this.selectedContactId === data.contactId) {
            this.clearContactDetail();
        }
        this.performSearch();
    }

    /**
     * Handle contact restoration
     */
    handleContactRestored(data) {
        this.performSearch();
        if (this.selectedContactId === data.contact.contactId) {
            // Always fetch fresh contact data to avoid stale data issues
            const freshContact = this.contactManager.getContact(data.contact.contactId);
            if (freshContact) {
                this.displayContactDetail(freshContact);
            } else {
                console.warn('⚠️ Could not fetch fresh contact data, using event data as fallback');
                this.displayContactDetail(data.contact);
            }
        }
    }

    /**
     * Render distribution lists in the sidebar
     */
    async renderDistributionLists() {
        if (!this.elements.distributionListsContainer) {
            console.log('❌ UI: distributionListsContainer not found');
            return;
        }

        // Don't render distribution lists if user is not authenticated
        if (!this.currentUser) {
            this.clearDistributionLists();
            return;
        }

        try {
            const distributionLists = await this.contactManager.getDistributionLists();
            
            if (distributionLists.length === 0) {
                this.elements.distributionListsContainer.innerHTML = `
                    <div class="no-lists-message">
                        <p style="margin-top: 10px; opacity: 0.7;">No sharing lists yet</p>
                    </div>
                `;
                return;
            }

            // Add sharing lists section header
            const sharingListsHeader = distributionLists.length > 0 ? `
                <div class="sharing-lists-header">
                    <h4 style="margin: 16px 0 8px 0; font-size: 0.875rem; font-weight: 600; color: var(--text-primary);">
                        <i class="fas fa-users" style="margin-right: 8px;"></i>Sharing Lists
                    </h4>
                </div>
            ` : '';
            
            const listItems = distributionLists.map(list => {
                const userCount = list.usernames ? list.usernames.length : 0;
                return `
                    <div class="distribution-list-item" data-list-name="${ContactUIHelpers.escapeHtml(list.name)}">
                        <div class="list-item-content" data-list-name="${ContactUIHelpers.escapeHtml(list.name)}">
                            <span class="distribution-list-name" style="color: ${list.color || '#007bff'}" data-list-name="${ContactUIHelpers.escapeHtml(list.name)}">${ContactUIHelpers.escapeHtml(list.name)}</span>
                            <span class="distribution-list-count">${userCount}</span>
                        </div>
                        <div class="distribution-list-users">
                            <span class="user-count">${userCount} user${userCount !== 1 ? 's' : ''}</span>
                            <div class="distribution-list-actions">
                                <button class="manage-list-btn" data-list-name="${this.escapeHtml(list.name)}" title="Manage users in this list">
                                    <i class="fas fa-users"></i> Manage
                                </button>
                                <button class="delete-list-btn" data-list-name="${this.escapeHtml(list.name)}" title="Delete this sharing list">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Combine sharing lists header + sharing lists
            this.elements.distributionListsContainer.innerHTML = sharingListsHeader + listItems;

            // Add click listeners for manage buttons
            const manageButtons = this.elements.distributionListsContainer.querySelectorAll('.manage-list-btn');
            manageButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering the list item click
                    const listName = button.dataset.listName;
                    this.openUsernameManagementModal(listName);
                });
            });

            // Add click listeners for delete buttons
            const deleteButtons = this.elements.distributionListsContainer.querySelectorAll('.delete-list-btn');
            deleteButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering the list item click
                    const listName = button.dataset.listName;
                    this.confirmDeleteDistributionList(listName);
                });
            });

        } catch (error) {
            console.error('Error rendering distribution lists:', error);
            this.elements.distributionListsContainer.innerHTML = `
                <div class="error-message">
                    <p>Error loading lists</p>
                </div>
            `;
        }
    }

    /**
     * Handle distribution list selection
     */
    handleDistributionListClick(event) {
        const listName = event.currentTarget.dataset.listName;
        
        // Update active filter
        this.activeFilters.distributionList = listName || null;
        
        // Update UI to show selected state
        const allListItems = this.elements.distributionListsContainer.querySelectorAll('.distribution-list-item');
        allListItems.forEach(item => item.classList.remove('active'));
        event.currentTarget.classList.add('active');
        
        // Update the contact list
        this.performSearch();
    }

    /**
     * Show create list modal (placeholder for Phase 2)
     */
    showCreateListModal() {
        console.log('📋 Create List button clicked');
        this.showModal({ modalId: 'create-list-modal' });
        this.resetCreateListForm();
    }

    /**
     * Show new contact modal
     */
    showNewContactModal() {
        this.showModal({ modalId: 'contact-modal', mode: 'create' });
        this.resetContactForm();
        
        // 🔧 CRITICAL: Explicitly set form to create mode after reset
        const form = document.getElementById('contact-form');
        if (form) {
            form.dataset.mode = 'create';
            // Ensure no contactId is set for new contacts
            delete form.dataset.contactId;
        }
    }

    /**
     * Show edit contact modal
     */
    showEditContactModal(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (contact) {
            this.showModal({ modalId: 'contact-modal', mode: 'edit' });
            this.populateContactForm(contact);
        }
    }

    /**
     * Handle show contact form event (for mobile navigation)
     */
    handleShowContactForm(data) {
        if (data && data.isEdit && data.contactId) {
            this.showEditContactModal(data.contactId);
        } else {
            this.showNewContactModal();
        }
    }

    /**
     * Handle contact form submission
     */
    async handleContactSubmit(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const isEdit = event.target.dataset.mode === 'edit';
        const contactId = event.target.dataset.contactId;
        
        // 🔍 Debug: Log form submission details
        console.log('📝 Form submission details:', {
            mode: event.target.dataset.mode,
            isEdit: isEdit,
            contactId: contactId,
            hasContactId: !!contactId
        });
        
        // Convert form data to contact data object
        const contactData = this.formDataToContactData(formData);
        
        // Show loading state
        this.showFormLoading(true);
        
        try {
            let result;
            if (isEdit && contactId) {
                console.log('🔄 Updating existing contact:', contactId);
                result = await this.contactManager.updateContact(contactId, contactData);
            } else {
                console.log('✨ Creating new contact');
                result = await this.contactManager.createContact(contactData);
            }
            
            if (!result.success) {
                console.log('❌ Form submission failed:', result.error);
                this.showFormError(result.error);
                if (result.validationErrors) {
                    this.highlightFormErrors(result.validationErrors);
                }
                // Don't close modal on validation errors - let user fix them
            } else {
                console.log('✅ Form submission successful');
                // Success is handled by event listeners which will close the modal
            }
            
        } catch (error) {
            console.error('❌ Form submission error:', error);
            this.showFormError(error.message);
            // Don't close modal on errors
        }
        
        this.showFormLoading(false);
    }

    /**
     * Get default view mode based on screen size
     * Mobile: list view (more compact)
     * Desktop: card view (more visual)
     */
    getDefaultViewMode() {
        const isMobile = window.innerWidth <= 768;
        return isMobile ? 'list' : 'card';
    }

    /**
     * Set view mode (card or list)
     */
    setViewMode(mode) {
        this.viewMode = mode;
        
        // Update button states
        if (this.elements.viewCardBtn) {
            this.elements.viewCardBtn.classList.toggle('active', mode === 'card');
        }
        if (this.elements.viewListBtn) {
            this.elements.viewListBtn.classList.toggle('active', mode === 'list');
        }
        
        // Update container class
        const container = this.elements.contactCards;
        if (container) {
            container.classList.remove('card-view', 'list-view');
            container.classList.add(mode + '-view');
        } else {
            this.logError('❌ Container not found in setViewMode');
        }
        
        // Re-render current contacts with new view mode
        if (this.contactManager) {
            this.performSearch();
        } else {
            this.log('❌ setViewMode: ContactManager not available, cannot refresh view');
        }
    }

    /**
     * Display contact list
     */
    displayContactList(contacts) {
        const container = this.elements.contactCards;
        
        if (!container) {
            this.logError('❌ Contact cards container not found!');
            return;
        }
        
        // Hide loading indicator
        const loadingElement = document.getElementById('loading-indicator');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        // Clear existing contacts
        container.innerHTML = '';
        
        if (contacts.length === 0) {
            // Show the existing empty state element from HTML
            const emptyStateElement = document.getElementById('empty-state');
            if (emptyStateElement) {
                emptyStateElement.classList.remove('hidden');
            }
            return;
        } else {
            // Hide empty state when we have contacts
            const emptyStateElement = document.getElementById('empty-state');
            if (emptyStateElement) {
                emptyStateElement.classList.add('hidden');
            }
        }
        
        // Set container view mode class
        container.classList.remove('card-view', 'list-view');
        
        // Force list view on mobile, otherwise use current view mode
        const isMobile = window.innerWidth <= 768;
        const actualViewMode = isMobile ? 'list' : this.viewMode;
        container.classList.add(actualViewMode + '-view');
        
        // Create contact items based on view mode
        contacts.forEach((contact, index) => {
            
            let contactElement;
            if (actualViewMode === 'list') {
                contactElement = this.createContactListItem(contact);
            } else {
                contactElement = this.createContactCard(contact);
            }
            
            if (contactElement) {
                container.appendChild(contactElement);
            }
        });
        
        // Update contact count
        this.updateContactCount(contacts.length);
    }

    /**
     * Create contact card element
     */
    createContactCard(contact) {
        try {
            if (!contact.vcard) {
                console.warn('⚠️ Contact has no vCard data, creating fallback card');
                return this.createFallbackContactCard(contact);
            }
            
            const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
            
            const card = document.createElement('div');
            card.className = 'contact-card';
            card.dataset.contactId = contact.contactId;
            card.dataset.archived = contact.metadata.isArchived ? 'true' : 'false';
            
            card.innerHTML = `
                <div class="contact-avatar">
                    <span class="avatar-initial">${displayData.fullName.charAt(0).toUpperCase()}</span>
                </div>
                <div class="contact-info">
                    <h3 class="contact-name">${ContactUIHelpers.escapeHtml(displayData.fullName)}</h3>
                    ${contact.cardName ? `<p class="contact-card-name">${ContactUIHelpers.escapeHtml(contact.cardName)}</p>` : ''}
                    <div class="contact-details">
                        ${displayData.phones.length > 0 ? `
                            <div class="contact-phone">
                                <i class="fas fa-phone"></i>
                                <span>${this.escapeHtml(displayData.phones[0].value)}</span>
                            </div>
                        ` : ''}
                        ${displayData.emails.length > 0 ? `
                            <div class="contact-email">
                                <i class="fas fa-envelope"></i>
                                <span>${this.escapeHtml(displayData.emails[0].value)}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${!contact.metadata.isOwned ? `
                        <div class="contact-meta">
                            <span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span>
                        </div>
                    ` : ''}
                </div>
            `;
            
            // Attach event listeners to the card buttons
            this.attachContactCardListeners(card, contact);
            
            return card;
            
        } catch (error) {
            console.error('❌ Error creating contact card:', error);
            console.error('❌ Contact data that failed:', contact);
            return this.createFallbackContactCard(contact);
        }
    }

    /**
     * Create fallback contact card for contacts with invalid data
     */
    createFallbackContactCard(contact) {
        const card = document.createElement('div');
        card.className = 'contact-card contact-card-error';
        card.dataset.contactId = contact.contactId || 'unknown';
        
        const contactName = contact.cardName || contact.contactId || 'Unknown Contact';
        const sharedInfo = contact.metadata && !contact.metadata.isOwned ? 
            `<div class="contact-meta"><span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span></div>` : '';
        
        card.innerHTML = `
            <div class="contact-avatar">
                <span class="avatar-initial">?</span>
            </div>
            <div class="contact-info">
                <h3 class="contact-name">${ContactUIHelpers.escapeHtml(contactName)}</h3>
                <p class="contact-error">Invalid contact data</p>
                ${sharedInfo}
            </div>
        `;
        
        // Attach click listener for selection
        card.addEventListener('click', (event) => {
            console.log('🎯 Fallback card clicked for:', contact.contactId);
            this.selectContact(contact.contactId);
        });
        
        return card;
    }

    /**
     * Attach event listeners to contact card buttons
     */
    attachContactCardListeners(card, contact) {
        
        // Click on card to select
        card.addEventListener('click', (event) => {
            console.log('🎯 Card clicked for:', contact.contactId);
            this.selectContact(contact.contactId);
        });
    }

    /**
     * Create contact list item for list view
     */
    createContactListItem(contact) {
        
        const vCardData = this.contactManager.vCardStandard.parseVCard(contact.vcard);
        const fullName = vCardData.properties.get('FN') || 'Unnamed Contact';
        
        const listItem = document.createElement('div');
        listItem.className = 'contact-list-item';
        listItem.dataset.contactId = contact.contactId;
        
        // Add ownership indicator class
        if (contact.metadata?.isOwned) {
            listItem.classList.add('owned-contact');
        } else {
            listItem.classList.add('shared-contact');
        }
        
        // Structure with name and shared indicator for non-owned contacts
        listItem.innerHTML = `
            <div class="contact-name">${this.escapeHtml(fullName)}</div>
            ${!contact.metadata.isOwned ? `
                <div class="contact-meta">
                    <span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span>
                </div>
            ` : ''}
        `;
        
        this.attachContactListItemListeners(listItem, contact);
        return listItem;
    }

    /**
     * Attach event listeners to contact list item buttons
     */
    attachContactListItemListeners(listItem, contact) {
        
        // Click on list item to select
        listItem.addEventListener('click', (event) => {
            console.log('🎯 List item clicked for:', contact.contactId);
            this.selectContact(contact.contactId);
        });
    }

    /**
     * Select a contact without tracking access (used for newly created contacts)
     */
    selectContactWithoutTracking(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) return;
        
        // Update selected state in UI
        this.elements.contactCards?.querySelectorAll('.contact-card').forEach(card => {
            card.classList.remove('selected');
            if (card.dataset.contactId === contactId) {
                card.classList.add('selected');
            }
        });
        
        this.selectedContactId = contactId;
        this.displayContactDetail(contact);
        
        // No access tracking for newly created contacts
        console.log('📝 Contact selected without access tracking:', contactId);
    }

    /**
     * Select and display contact details
     */
    async selectContact(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) return;
        
        // Update selected state in UI for both card and list views
        this.elements.contactCards?.querySelectorAll('.contact-card, .contact-list-item').forEach(item => {
            item.classList.remove('selected');
            if (item.dataset.contactId === contactId) {
                item.classList.add('selected');
            }
        });
        
        this.selectedContactId = contactId;
        this.displayContactDetail(contact);
        
        // Track access
        await this.contactManager.trackContactAccess(contactId);
    }

    /**
     * Display contact details
     */
    displayContactDetail(contact) {
        
        // Essential logging for contact display debugging
        if (this.debugMode) {
            console.log(`� Displaying contact: ${contact.contactId}`, {
                isShared: contact.metadata?.sharing?.isShared,
                shareCount: contact.metadata?.sharing?.shareCount
            });
        }
        
        const container = this.elements.contactDetail;
        if (!container) {
            console.error('❌ No contact detail container found!');
            return;
        }
        
        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
        console.log('🎯 Extracted display data:', displayData);
        
        container.innerHTML = `
            <div class="contact-detail-header">
                <div class="contact-avatar-large">
                    <span class="avatar-initial">${displayData.fullName.charAt(0).toUpperCase()}</span>
                </div>
                <div class="contact-info">
                    <h2 class="contact-name">${this.escapeHtml(displayData.fullName)}</h2>
                    <p class="contact-organization">${this.escapeHtml(displayData.organization)}</p>
                    <p class="contact-title">${this.escapeHtml(displayData.title)}</p>
                </div>
                <div class="contact-detail-actions">
                    ${contact.metadata.isArchived ? `
                        <button class="btn-icon restore-contact" data-contact-id="${contact.contactId}" title="Restore from archive">
                            <i class="fas fa-undo"></i>
                        </button>
                    ` : `
                        ${contact.metadata.isOwned ? `
                            <button class="btn-icon edit-contact" data-contact-id="${contact.contactId}" title="Edit contact">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon share-contact" data-contact-id="${contact.contactId}" title="Share contact">
                                <i class="fas fa-share"></i>
                            </button>
                            <button class="btn-icon archive-contact" data-contact-id="${contact.contactId}" title="Archive contact">
                                <i class="fas fa-archive"></i>
                            </button>
                            <button class="btn-icon delete-contact" data-contact-id="${contact.contactId}" title="Delete contact">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : `
                            <button class="btn-icon archive-contact" data-contact-id="${contact.contactId}" title="Archive shared contact">
                                <i class="fas fa-archive"></i>
                            </button>
                        `}
                    `}
                    <button class="btn-icon export-contact" data-contact-id="${contact.contactId}" title="Export contact">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
            
            <div class="contact-detail-body">
                ${this.renderContactFields(displayData)}
                ${this.renderContactMetadata(contact)}
            </div>
        `;
        
        console.log('🎯 Contact detail content populated, length:', container.innerHTML.length, 'chars');
        
        // Add event listeners for detail actions
        this.setupContactDetailListeners(container, contact.contactId);
        
        // Populate distribution list selects
        setTimeout(() => this.populateDistributionListSelects(), 100);
        
        // Emit event for mobile navigation AFTER content is rendered
        console.log('🎯 Emitting contact:selected event for mobile navigation');
        this.eventBus.emit('contact:selected', { contact });
    }

    /**
     * Render contact fields using ContactRenderer helper
     */
    renderContactFields(displayData) {
        let html = '';
        
        // Use ContactRenderer helper for individual field types
        if (displayData.phones.length > 0) {
            html += ContactRenderer.renderContactFields('phone', displayData.phones);
        }
        
        if (displayData.emails.length > 0) {
            html += ContactRenderer.renderContactFields('email', displayData.emails);
        }
        
        if (displayData.urls.length > 0) {
            html += ContactRenderer.renderContactFields('url', displayData.urls);
        }
        
        // Keep address rendering for now (more complex structure)
        if (displayData.addresses && Array.isArray(displayData.addresses) && displayData.addresses.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-map-marker-alt"></i> Addresses</h4>
                    ${displayData.addresses.map((address, index) => {
                        return `
                        <div class="field-item address-item">
                            <div class="address-content">
                                ${address.street ? `<div class="address-line">${ContactUIHelpers.escapeHtml(address.street)}</div>` : ''}
                                <div class="address-line">
                                    ${[address.city, address.state, address.postalCode].filter(Boolean).map(part => ContactUIHelpers.escapeHtml(part)).join(', ')}
                                </div>
                                ${address.country ? `<div class="address-line">${ContactUIHelpers.escapeHtml(address.country)}</div>` : ''}
                            </div>
                            <div class="address-meta">
                                <span class="field-type">${address.type || 'other'}</span>
                                ${address.primary ? '<span class="field-primary">Primary</span>' : ''}
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `;
        }
        
        // Notes
        if (displayData.notes && displayData.notes.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-sticky-note"></i> Notes</h4>
                    ${displayData.notes.map(note => `
                        <div class="field-item">
                            <p class="field-value">${ContactUIHelpers.escapeHtml(note)}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        return html;
    }

    /**
     * Render contact metadata using ContactRenderer helper
     */
    renderContactMetadata(contact) {
        // Use ContactRenderer helper for basic metadata
        let html = ContactRenderer.renderContactMetadata(contact.metadata);
        
        // Add sharing info (custom to this app)
        const sharingInfo = this.renderSharingInfo(contact);
        if (sharingInfo) {
            html = html.replace('</div>\n            </div>', sharingInfo + '\n                </div>\n            </div>');
        }
        
        return html;
    }

    /**
     * Render sharing information for a contact
     */
    renderSharingInfo(contact) {
        const sharing = contact.metadata?.sharing;
        
        // 🔍 DEBUG: Log sharing info rendering
        console.log(`🔍 renderSharingInfo called for ${contact.contactId}:`, {
            isOwned: contact.metadata?.isOwned,
            isShared: sharing?.isShared,
            sharedWithUsers: sharing?.sharedWithUsers,
            sharedUsersLength: sharing?.sharedWithUsers?.length
        });
        
        // Only show sharing info for owned contacts that are shared
        if (!contact.metadata?.isOwned || !sharing?.isShared || !sharing?.sharedWithUsers?.length) {
            console.log(`🔍 Hiding sharing info - conditions not met`);
            return '';
        }
        
        const sharedUsers = sharing.sharedWithUsers || [];
        const sharePermissions = sharing.sharePermissions || {};
        
        // Deduplicate users and create a clean user list
        const uniqueUsers = [...new Set(sharedUsers)];
        
        // If no unique users after deduplication, don't show sharing info
        if (uniqueUsers.length === 0) {
            console.log(`🔍 Hiding sharing info - no unique users after deduplication`);
            return '';
        }
        
        console.log(`🔍 Showing sharing info for ${uniqueUsers.length} users:`, uniqueUsers);
        
        // Create user list with permissions and revoke buttons
        const userList = uniqueUsers.map(username => {
            const permissions = sharePermissions[username];
            const permissionText = permissions?.level === 'write' ? 'Can edit' : 'Read only';
            const sharedDate = permissions?.sharedAt ? 
                new Date(permissions.sharedAt).toLocaleDateString() : 
                'Unknown date';
            
            return `
                <div class="shared-user-item">
                    <div class="shared-user-main">
                        <span class="shared-username">${this.escapeHtml(username)}</span>
                        <span class="shared-permission">${permissionText}</span>
                        <button class="btn-revoke" 
                                data-contact-id="${contact.contactId}" 
                                data-username="${this.escapeHtml(username)}"
                                title="Revoke sharing from ${this.escapeHtml(username)}">
                            <i class="fas fa-times"></i> Revoke
                        </button>
                    </div>
                    <div class="shared-date">Shared: ${sharedDate}</div>
                    </div>
                </div>
            `;
        }).join('');
        
        return `
            <div class="metadata-item metadata-sharing">
                <div class="metadata-label">
                    <i class="fas fa-share"></i> Shared with:
                </div>
                <div class="metadata-value">
                    <div class="shared-users-list">
                        ${userList}
                    </div>
                    <div class="share-summary">
                        ${uniqueUsers.length} user${uniqueUsers.length !== 1 ? 's' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render contact's distribution lists
     */
    renderContactDistributionLists(contact) {
        const lists = contact.metadata?.distributionLists || [];
        
        if (lists.length === 0) {
            return '<span class="no-lists">Not assigned to any lists</span>';
        }
        
        return lists.map(listName => 
            `<span class="distribution-list-tag" data-list="${listName}">${listName}</span>`
        ).join('');
    }

    /**
     * Show authentication modal
     */
    showAuthenticationModal() {
        const modal = this.elements.authModal;
        if (modal) {
            modal.style.display = 'flex';
            
            // Update modal content with profile information if available
            this.updateAuthModalWithProfileInfo();
            
            // Ensure "Keep me signed in" checkbox is visible for sign-in mode
            const keepSignedInContainer = document.getElementById('keep-signed-in-group');
            const form = this.elements.authForm;
            if (keepSignedInContainer && form) {
                const isSignIn = form.dataset.mode === 'signin';
                keepSignedInContainer.style.display = isSignIn ? 'block' : 'none';
            }
        } else {
            console.warn('⚠️ Authentication modal not found');
        }
    }

    /**
     * Update authentication modal with profile information when accessed via profile link
     */
    updateAuthModalWithProfileInfo() {
        const welcomeSection = document.querySelector('#auth-modal .auth-welcome');
        
        if (this.currentProfileInfo && welcomeSection) {
            // Show profile-specific welcome message
            welcomeSection.innerHTML = `
                <div class="profile-info">
                    <div class="profile-icon">
                        <i class="fas fa-user-circle"></i>
                    </div>
                    <h3>Connect with ${this.currentProfileInfo.username}</h3>
                    <p>You've been invited to connect with <strong>${this.currentProfileInfo.username}</strong> on Contact Manager.</p>
                    
                    <div class="profile-instructions">
                        <div class="info-box">
                            <i class="fas fa-info-circle"></i>
                            <div>
                                <p><strong>New user?</strong> Sign up to share your contact information with ${this.currentProfileInfo.username} and manage your contacts securely.</p>
                                <p><strong>Existing user?</strong> Sign in to access contacts shared by ${this.currentProfileInfo.username} or share your own contacts with ${this.currentProfileInfo.username}.</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (!this.currentProfileInfo && welcomeSection) {
            // Show regular welcome message
            welcomeSection.innerHTML = `
                <h3>Welcome!</h3>
                <p>Your contacts are protected with secure, end-to-end encryption.</p>
            `;
        }
    }

    /**
     * Hide authentication modal
     */
    hideAuthenticationModal() {
        const modal = this.elements.authModal;
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /**
     * Show main application
     */
    showMainApplication() {
        const app = this.elements.app;
        if (app) {
            app.classList.add('authenticated');
        }
        this.updateUserInterface();
        this.updateLogoutButtonState();
        
        // Initialize responsive view mode
        this.setViewMode(this.viewMode);
        
        this.renderDistributionLists(); // Render distribution lists on app start
        this.performSearch();
    }

    /**
     * Hide main application
     */
    hideMainApplication() {
        const app = this.elements.app;
        if (app) {
            app.classList.remove('authenticated');
        }
        this.updateLogoutButtonState();
    }

    /**
     * Update logout button state based on authentication
     */
    updateLogoutButtonState() {
        const logoutBtn = this.elements.logoutBtn;
        const mobileLogout = this.elements.mobileLogout;
        
        const isAuthenticated = this.currentUser !== null;
        
        if (logoutBtn) {
            logoutBtn.disabled = !isAuthenticated;
            logoutBtn.style.opacity = isAuthenticated ? '1' : '0.5';
        }
        
        if (mobileLogout) {
            mobileLogout.disabled = !isAuthenticated;
            mobileLogout.style.opacity = isAuthenticated ? '1' : '0.5';
        }
    }

    /**
     * Update user interface with current user
     */
    updateUserInterface() {
        if (this.currentUser && this.elements.currentUserDisplay) {
            this.elements.currentUserDisplay.textContent = this.currentUser.username;
        } else if (this.currentUser && !this.elements.currentUserDisplay) {
            console.warn('⚠️ Current user display element not found');
        }
    }

    /**
     * Show toast notification
     */
    showToast(data) {
        const { message, type = 'info' } = data;
        
        // Use existing toast elements from HTML
        let toastElement, messageElement, dismissBtn;
        
        if (type === 'error') {
            toastElement = document.getElementById('error-toast');
            messageElement = document.getElementById('error-message');
            dismissBtn = document.getElementById('dismiss-error');
        } else {
            // Use success toast for info, success, and other types
            toastElement = document.getElementById('success-toast');
            messageElement = document.getElementById('success-message');
            dismissBtn = document.getElementById('dismiss-success');
        }
        
        if (!toastElement || !messageElement) return;
        
        // Set the message
        messageElement.textContent = message;
        
        // Show the toast
        toastElement.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            toastElement.classList.add('hidden');
        }, 5000);
        
        // Handle dismiss button if it exists
        if (dismissBtn) {
            const dismissHandler = () => {
                toastElement.classList.add('hidden');
                dismissBtn.removeEventListener('click', dismissHandler);
            };
            dismissBtn.addEventListener('click', dismissHandler);
        }
    }

    /**
     * Remove toast notification
     */
    removeToast(toast) {
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    /**
     * Utility methods
     */
    
    escapeHtml(text) {
        // Delegate to ContactUIHelpers
        return ContactUIHelpers.escapeHtml(text);
    }

    debounce(func, wait) {
        // Delegate to ContactUIHelpers
        return ContactUIHelpers.debounce(func, wait);
    }

    getCurrentSort() {
        return this.elements.sortSelect?.value || 'name';
    }

    updateContactCount(count) {
        if (this.elements.contactCount) {
            this.elements.contactCount.textContent = count;
        }
    }

    updateStats() {
        const stats = this.contactManager.getContactStatistics();
        
        // Update individual stat elements
        if (this.elements.statsTotal) {
            this.elements.statsTotal.textContent = stats.total;
        }
        if (this.elements.statsShared) {
            this.elements.statsShared.textContent = stats.shared;
        }
        if (this.elements.statsRecent) {
            this.elements.statsRecent.textContent = stats.recent;
        }
        if (this.elements.statsImported) {
            this.elements.statsImported.textContent = stats.imported;
        }
    }

    showEmptyState() {
        // Use the existing empty state element from HTML
        const emptyStateElement = document.getElementById('empty-state');
        if (emptyStateElement) {
            emptyStateElement.classList.remove('hidden');
        }
        
        // Hide loading indicator if visible
        const loadingElement = document.getElementById('loading-indicator');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
    }

    clearContactDetail() {
        if (this.elements.contactDetail) {
            this.elements.contactDetail.innerHTML = `
                <div class="welcome-state">
                    <i class="fas fa-hand-wave"></i>
                    <h3>Welcome to Contact Manager</h3>
                    <p>Select a contact to view details, or create a new contact to get started.</p>
                    <button id="welcome-new-contact" class="btn btn-primary">
                        <i class="fas fa-plus"></i>
                        Create New Contact
                    </button>
                </div>
            `;
            
            // Add event listener for the welcome button
            const welcomeBtn = this.elements.contactDetail.querySelector('#welcome-new-contact');
            if (welcomeBtn) {
                welcomeBtn.addEventListener('click', () => {
                    this.showNewContactModal();
                });
            }
        }
        this.selectedContactId = null;
    }

    /**
     * Clear distribution lists UI - called during logout
     */
    clearDistributionLists() {
        if (this.elements.distributionListsContainer) {
            this.elements.distributionListsContainer.innerHTML = `
                <div class="no-lists-message">
                    <p style="margin-top: 10px; opacity: 0.7;">No sharing lists</p>
                </div>
            `;
        }
    }

    // Placeholder methods - to be implemented with specific components
    showModal(data) {
        const modalId = data?.modalId || 'contact-modal';
        const modal = document.getElementById(modalId);
        
        if (modal) {
            modal.style.display = 'block';
            
            // Set modal mode and title
            if (data?.mode) {
                modal.dataset.mode = data.mode;
                
                // Update modal title
                const titleElement = modal.querySelector('h2');
                if (titleElement) {
                    titleElement.textContent = data.mode === 'edit' ? 'Edit Contact' : 'New Contact';
                }
            }
            
            console.log(`✅ Modal opened: ${modalId} (mode: ${data?.mode || 'default'})`);
            
            // Focus first input field after a short delay
            setTimeout(() => {
                const firstInput = modal.querySelector('input:not([type="hidden"])');
                if (firstInput) {
                    firstInput.focus();
                }
            }, 100);
        } else {
            console.warn(`⚠️ Modal not found: ${modalId}`);
        }
    }

    hideModal(data) {
        const modalId = data?.modalId || 'contact-modal';
        const modal = document.getElementById(modalId);
        
        if (modal) {
            modal.style.display = 'none';
            console.log(`✅ Modal closed: ${modalId}`);
        } else {
            console.warn(`⚠️ Modal not found: ${modalId}`);
        }
        
        // Clear any form data or errors
        this.resetContactForm();
    }

    hideContactModal() {
        this.hideModal({ modalId: 'contact-modal' });
    }

    // ========== SHARING MODAL METHODS ==========

    /**
     * Show share contact modal
     */
    async showShareContactModal(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) {
            console.error('Contact not found:', contactId);
            return;
        }

        if (!contact.metadata.isOwned) {
            this.showToast('You can only share contacts you own', 'error');
            return;
        }

        // Store current contact for sharing
        this.currentShareContact = contact;
        
        // Populate contact preview in both sections
        this.populateShareContactPreview(contact);
        this.populateShareWithListContactPreview(contact);
        
        // Populate distribution list dropdown
        await this.populateShareWithListDropdown();
        
        // Reset form state
        this.resetShareForm();
        
        // Show modal
        this.showModal({ modalId: 'share-modal' });
        
        // Focus username input
        setTimeout(() => {
            if (this.elements.shareUsernameInput) {
                this.elements.shareUsernameInput.focus();
            }
        }, 100);
        
        console.log('✅ Share modal opened for contact:', contact.cardName);
    }

    /**
     * Populate contact preview in share-with-list section
     */
    populateShareWithListContactPreview(contact) {
        if (!this.elements.shareWithListContactPreview) return;
        
        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
        
        this.elements.shareWithListContactPreview.innerHTML = `
            <div class="contact-name">${this.escapeHtml(displayData.fullName)}</div>
            ${displayData.organization ? `
                <div class="contact-detail">
                    <i class="fas fa-building"></i>
                    <span>${this.escapeHtml(displayData.organization)}</span>
                </div>
            ` : ''}
            ${displayData.title ? `
                <div class="contact-detail">
                    <i class="fas fa-briefcase"></i>
                    <span>${this.escapeHtml(displayData.title)}</span>
                </div>
            ` : ''}
            ${displayData.phones.length > 0 ? `
                <div class="contact-detail">
                    <i class="fas fa-phone"></i>
                    <span>${this.escapeHtml(displayData.phones[0].value)}</span>
                </div>
            ` : ''}
            ${displayData.emails.length > 0 ? `
                <div class="contact-detail">
                    <i class="fas fa-envelope"></i>
                    <span>${this.escapeHtml(displayData.emails[0].value)}</span>
                </div>
            ` : ''}
        `;
    }

    /**
     * Populate the share-with-list dropdown
     */
    async populateShareWithListDropdown() {
        if (!this.elements.shareWithListSelect) {
            return;
        }
        
        try {
            const distributionLists = await this.contactManager.getDistributionLists();
            
            // Clear existing options (except the first placeholder)
            this.elements.shareWithListSelect.innerHTML = '<option value="">Choose a sharing list...</option>';
            
            if (distributionLists.length === 0) {
                this.elements.shareWithListSelect.innerHTML += '<option value="" disabled>No sharing lists created yet</option>';
                return;
            }
            
            // Add distribution list options
            distributionLists.forEach((list, index) => {
                const option = document.createElement('option');
                option.value = list.name;
                option.textContent = `${list.name} (${list.userCount} users)`;
                this.elements.shareWithListSelect.appendChild(option);
            });
            
            // NOTE: Event listener is already attached in setupDOMEventListeners() 
            // to avoid duplicate listeners being added each time modal opens
            
        } catch (error) {
            console.error('Error populating share dropdown:', error);
            this.elements.shareWithListSelect.innerHTML = '<option value="">Error loading lists</option>';
        }
    }

    /**
     * Show preview of users in selected sharing list
     */
    async showShareListPreview(listName) {
        if (!this.elements.shareListPreview || !this.elements.shareListUsers) return;
        
        if (!listName || listName === '') {
            this.elements.shareListPreview.style.display = 'none';
            this.elements.shareListUsers.innerHTML = '';
            return;
        }
        
        try {
            const usernames = await this.contactManager.getUsernamesInDistributionList(listName);
            
            if (usernames.length === 0) {
                this.elements.shareListUsers.innerHTML = '<div class="no-users">This list has no users yet.</div>';
            } else {
                const usersHtml = usernames.map(username => `
                    <div class="distribution-list-contact-item">
                        <div class="contact-avatar-small">
                            <span class="avatar-initial">${username.charAt(0).toUpperCase()}</span>
                        </div>
                        <div class="contact-name">${this.escapeHtml(username)}</div>
                    </div>
                `).join('');
                
                this.elements.shareListUsers.innerHTML = usersHtml;
            }
            
            this.elements.shareListPreview.style.display = 'block';
            
        } catch (error) {
            console.error('Error showing share list preview:', error);
            this.elements.shareListUsers.innerHTML = '<div class="error">Error loading users</div>';
            this.elements.shareListPreview.style.display = 'block';
        }
    }

    /**
     * Populate contact preview in share modal (existing method)
     */
    populateShareContactPreview(contact) {
        if (!this.elements.shareContactPreview) return;
        
        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
        
        this.elements.shareContactPreview.innerHTML = `
            <div class="contact-name">${this.escapeHtml(displayData.fullName)}</div>
            ${displayData.organization ? `
                <div class="contact-detail">
                    <i class="fas fa-building"></i>
                    <span>${this.escapeHtml(displayData.organization)}</span>
                </div>
            ` : ''}
            ${displayData.title ? `
                <div class="contact-detail">
                    <i class="fas fa-briefcase"></i>
                    <span>${this.escapeHtml(displayData.title)}</span>
                </div>
            ` : ''}
            ${displayData.phones.length > 0 ? `
                <div class="contact-detail">
                    <i class="fas fa-phone"></i>
                    <span>${this.escapeHtml(displayData.phones[0].value)}</span>
                </div>
            ` : ''}
            ${displayData.emails.length > 0 ? `
                <div class="contact-detail">
                    <i class="fas fa-envelope"></i>
                    <span>${this.escapeHtml(displayData.emails[0].value)}</span>
                </div>
            ` : ''}
        `;
    }

    /**
     * Reset share form
     */
    resetShareForm() {
        if (this.elements.shareForm) {
            this.elements.shareForm.reset();
        }
        
        // Reset to form view
        this.setShareModalState('form');
        
        // Clear any errors
        this.clearShareFormErrors();
        
        // Reset share tabs to default (contact tab)
        const contactTab = document.querySelector('.share-type-tab[data-type="contact"]');
        const shareWithListTab = document.querySelector('.share-type-tab[data-type="share-with-list"]');
        
        if (contactTab && shareWithListTab) {
            // Reset tab states
            document.querySelectorAll('.share-type-tab').forEach(tab => tab.classList.remove('active'));
            contactTab.classList.add('active');
            
            // Reset section visibility
            document.querySelectorAll('.share-section').forEach(section => section.classList.remove('active'));
            const contactSection = document.getElementById('contact-share-section');
            if (contactSection) {
                contactSection.classList.add('active');
            }
        }
        
        // Clear share list preview
        if (this.elements.shareListPreview) {
            this.elements.shareListPreview.style.display = 'none';
        }
        
        if (this.elements.shareListUsers) {
            this.elements.shareListUsers.innerHTML = '';
        }
        
        // Reset dropdown selection
        if (this.elements.shareWithListSelect) {
            this.elements.shareWithListSelect.value = '';
        }
        
        // Clear username input
        if (this.elements.shareUsernameInput) {
            this.elements.shareUsernameInput.value = '';
        }
    }

    /**
     * Set share modal state
     */
    setShareModalState(state, messageData = null) {
        const formContainer = document.getElementById('share-form-container');
        const loadingContainer = this.elements.shareLoading;
        const successContainer = this.elements.shareSuccess;
        const errorContainer = document.getElementById('share-error-container');
        const warningContainer = document.getElementById('share-warning-container');
        
        // Hide all states
        if (formContainer) formContainer.style.display = 'none';
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (successContainer) successContainer.style.display = 'none';
        if (errorContainer) errorContainer.style.display = 'none';
        if (warningContainer) warningContainer.style.display = 'none';
        
        // Show requested state
        switch (state) {
            case 'form':
                if (formContainer) formContainer.style.display = 'block';
                break;
            case 'loading':
                if (loadingContainer) loadingContainer.style.display = 'block';
                break;
            case 'success':
                if (successContainer) successContainer.style.display = 'block';
                
                // Handle success message data
                if (messageData) {
                    const titleElement = document.getElementById('share-success-title');
                    const messageElement = document.getElementById('share-success-message');
                    const detailsElement = document.getElementById('share-success-details');
                    
                    if (titleElement) titleElement.textContent = messageData.title || 'Contact Shared Successfully!';
                    if (messageElement) messageElement.textContent = messageData.message || 'The contact has been shared.';
                    if (detailsElement && messageData.details) {
                        detailsElement.textContent = messageData.details;
                        detailsElement.style.display = 'block';
                    }
                }
                break;
            case 'error':
                if (errorContainer) {
                    errorContainer.style.display = 'block';
                    
                    // Handle error message data
                    if (messageData) {
                        const titleElement = document.getElementById('share-error-title');
                        const messageElement = document.getElementById('share-error-message');
                        const detailsElement = document.getElementById('share-error-details');
                        
                        if (titleElement) titleElement.textContent = messageData.title || 'Sharing Failed';
                        if (messageElement) messageElement.textContent = messageData.message || 'An error occurred while sharing.';
                        if (detailsElement && messageData.details) {
                            detailsElement.textContent = messageData.details;
                            detailsElement.style.display = 'block';
                        }
                    }
                }
                break;
            case 'warning':
                if (warningContainer) {
                    warningContainer.style.display = 'block';
                    
                    // Handle warning message data
                    if (messageData) {
                        const titleElement = document.getElementById('share-warning-title');
                        const messageElement = document.getElementById('share-warning-message');
                        const detailsElement = document.getElementById('share-warning-details');
                        
                        if (titleElement) titleElement.textContent = messageData.title || 'Partially Shared';
                        if (messageElement) messageElement.textContent = messageData.message || 'Some sharing operations failed.';
                        if (detailsElement && messageData.details) {
                            detailsElement.textContent = messageData.details;
                            detailsElement.style.display = 'block';
                        }
                    }
                }
                break;
        }
    }

    /**
     * Handle share form submission
     */
    async handleShareSubmit(event) {
        event.preventDefault();
        
        // Determine share type
        const activeTab = document.querySelector('.share-type-tab.active');
        const shareType = activeTab?.dataset.type || 'contact';
        
        if (shareType === 'contact') {
            // Get form data for single user sharing
            const formData = new FormData(event.target);
            const username = formData.get('username')?.trim();
            const isReadOnly = formData.get('readonly') === 'on';
            
            // Validate input
            if (!username) {
                this.showFieldError('share-username', 'Username is required');
                return;
            }
            
            await this.handleContactShare(username, isReadOnly);
            
        } else if (shareType === 'share-with-list') {
            // Get form data for list sharing
            const formData = new FormData(event.target);
            const listName = formData.get('shareWithList');
            const isReadOnly = formData.get('readonly') === 'on';
            
            // Validate input
            if (!listName) {
                this.showFieldError('share-with-distribution-list', 'Please select a sharing list');
                return;
            }
            
            await this.handleShareWithDistributionList(listName, isReadOnly);
        }
    }

    /**
     * Handle sharing contact with all users in a distribution list
     */
    async handleShareWithDistributionList(listName, isReadOnly) {
        if (!this.currentShareContact) {
            console.error('No contact selected for sharing');
            return;
        }
        
        // Clear previous errors
        this.clearShareFormErrors();
        
        console.log(`🔄 Sharing contact "${this.currentShareContact.cardName}" with distribution list "${listName}"`);
        
        // Show loading state
        this.setShareModalState('loading');
        
        try {
            // Use the new centralized method for distribution list sharing
            const result = await this.contactManager.shareContactWithDistributionList(
                this.currentShareContact.contactId, 
                listName, 
                isReadOnly
            );
            
            if (!result.success) {
                this.setShareModalState('error', {
                    title: 'Sharing Failed',
                    message: result.error,
                    details: ''
                });
                return;
            }
            
            const { successCount, alreadySharedCount, errorCount, errors } = result;
            const totalProcessed = successCount + alreadySharedCount;
            
            // Show results with improved messaging
            if (totalProcessed > 0 && errorCount === 0) {
                // Complete success (including already shared)
                let message = '';
                
                if (successCount > 0 && alreadySharedCount > 0) {
                    message = `Newly shared with ${successCount} users and ${alreadySharedCount} users already had access in "${listName}".`;
                } else if (successCount > 0) {
                    message = `Your contact was shared with all ${successCount} users in "${listName}".`;
                } else if (alreadySharedCount > 0) {
                    message = `All ${alreadySharedCount} users in "${listName}" already have access to this contact.`;
                }
                
                this.setShareModalState('success', {
                    title: 'Contact Sharing Complete!',
                    message: message,
                    details: result.results.map(r => `${r.success ? '✅' : '❌'} ${r.username}`).join('\n')
                });
                
            } else if (totalProcessed > 0 && errorCount > 0) {
                // Partial success - enhance error messaging
                const enhancedErrors = this.enhanceDistributionListErrors(result.results || []);
                this.setShareModalState('warning', {
                    title: 'Partially Shared',
                    message: `✅ Successfully shared with ${totalProcessed} users, but ${errorCount} failed.`,
                    details: enhancedErrors
                });
                
            } else {
                // Complete failure - enhance error messaging
                const enhancedErrors = this.enhanceDistributionListErrors(result.results || []);
                this.setShareModalState('error', {
                    title: 'Sharing Failed',
                    message: `❌ Could not share with any users in "${listName}".`,
                    details: enhancedErrors
                });
            }
            
        } catch (error) {
            console.error('❌ Error in handleShareWithDistributionList:', error);
            this.setShareModalState('error', {
                title: 'Sharing Error',
                message: 'An unexpected error occurred while sharing.',
                details: error.message
            });
        }
    }

    /**
     * Handle verify user button click
     */
    async handleVerifyUser() {
        const verificationMessageInput = document.getElementById('verification-message');
        const verifyBtn = document.getElementById('verify-user-btn');
        
        const verificationMessage = verificationMessageInput?.value?.trim();
        if (!verificationMessage) {
            this.showVerificationStatus('error', 'Please enter a verification message first');
            return;
        }
        
        // Show loading state
        this.showVerificationStatus('loading', 'Verifying user...');
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        
        try {
            const result = await this.contactManager.verifyUser(verificationMessage);
            
            if (result.success) {
                this.showVerificationStatus('success', 'User verified successfully! You can now share securely.');
            } else {
                this.showVerificationStatus('error', result.error || 'Failed to verify user');
            }
            
        } catch (error) {
            console.error('❌ User verification failed:', error);
            
            let errorMessage = 'Failed to verify user';
            if (error.message && error.message.includes('VerificationMessageInvalid')) {
                errorMessage = 'Invalid verification message. Please check and try again.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            this.showVerificationStatus('error', errorMessage);
        } finally {
            // Reset button state
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fas fa-shield-check"></i> Verify';
        }
    }

    /**
     * Handle get verification message button click
     */
    async handleGetVerificationMessage() {
        const getBtn = document.getElementById('get-verification-btn');
        
        // Show loading state
        this.showVerificationStatus('loading', 'Getting your verification message...');
        getBtn.disabled = true;
        getBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting...';
        
        try {
            const result = await this.contactManager.getVerificationMessage();
            
            if (result.success) {
                // Show the verification message in a copyable format
                const message = `Your verification message: <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-family: monospace; word-break: break-all;">${result.verificationMessage}</code><br><small>Share this with others so they can verify you before sharing contacts.</small>`;
                this.showVerificationStatus('success', message);
                
                // Also copy to clipboard if possible
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(result.verificationMessage);
                    console.log('✅ Verification message copied to clipboard');
                }
            } else {
                this.showVerificationStatus('error', result.error || 'Failed to get verification message');
            }
            
        } catch (error) {
            console.error('❌ Get verification message failed:', error);
            this.showVerificationStatus('error', 'Failed to get verification message');
        } finally {
            // Reset button state
            getBtn.disabled = false;
            getBtn.innerHTML = '<i class="fas fa-key"></i> Get My Code';
        }
    }

    /**
     * Show verification status message
     */
    showVerificationStatus(type, message) {
        const verificationStatus = document.getElementById('verification-status');
        if (!verificationStatus) return;
        
        verificationStatus.style.display = 'block';
        verificationStatus.className = `verification-status ${type}`;
        
        let icon = '';
        switch (type) {
            case 'success':
                icon = '<i class="fas fa-check-circle"></i>';
                break;
            case 'error':
                icon = '<i class="fas fa-exclamation-circle"></i>';
                break;
            case 'loading':
                icon = '<i class="fas fa-spinner fa-spin"></i>';
                break;
        }
        
        verificationStatus.innerHTML = `${icon} <span>${message}</span>`;
    }

    /**
     * Handle individual contact sharing (existing method)
     */
    async handleContactShare(username, isReadOnly) {
        if (!this.currentShareContact) {
            console.error('No contact selected for sharing');
            return;
        }
        
        // Clear previous errors
        this.clearShareFormErrors();
        
        // Prevent sharing with self
        if (username === this.contactManager.database.currentUser?.username) {
            this.showShareFormError('share-username', 'You cannot share a contact with yourself');
            return;
        }
        
        console.log('🔄 Sharing individual contact with:', username, 'readonly:', isReadOnly);
        console.log('ℹ️  Note: Now sharing individual contacts instead of entire database');
        
        // Show loading state
        this.setShareModalState('loading');
        
        try {
            // Share individual contact via ContactManager
            const result = await this.contactManager.shareContact(this.currentShareContact.contactId, username, isReadOnly, false);
            
            if (result.success) {
                // Show success state with proper message
                this.setShareModalState('success');
                const sharedWithUserElement = document.getElementById('shared-with-user');
                if (sharedWithUserElement) {
                    sharedWithUserElement.textContent = username;
                }
                
                // Refresh contacts list to show sharing indicators
                this.refreshContactsList();
                
                console.log('✅ Individual contact shared successfully with:', username);
                
                // Auto-close after 3 seconds
                setTimeout(() => {
                    this.hideModal({ modalId: 'share-modal' });
                }, 3000);
                
            } else {
                const errorMessage = result.error || 'Failed to share contact';
                console.error('❌ Share failed with error:', errorMessage);
                throw new Error(errorMessage);
            }
            
        } catch (error) {
            console.error('❌ Share failed:', error);
            console.error('❌ Error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            
            // Return to form and show error
            this.setShareModalState('form');
            
            // Enhanced error categorization with specific user feedback
            let errorMessage = this.categorizeAndFormatSharingError(error, username);
            
            this.showShareFormError('share-username', errorMessage);
        }
    }

    /**
     * Enhance distribution list error messages with user-friendly explanations
     * @param {Array} results - Array of sharing results
     * @returns {string} Formatted error details
     */
    enhanceDistributionListErrors(results) {
        if (!Array.isArray(results) || results.length === 0) {
            return 'No detailed error information available.';
        }
        
        const errorsByType = {
            userNotFound: [],
            subscription: [],
            network: [],
            permission: [],
            other: []
        };
        
        // Categorize errors by type
        results.forEach(result => {
            if (!result.success && result.error) {
                const username = result.username || 'Unknown';
                const error = result.error.toLowerCase();
                
                if (error.includes('user not found') || error.includes('usernotfound')) {
                    errorsByType.userNotFound.push(username);
                } else if (error.includes('subscription') || error.includes('trial') || error.includes('plan')) {
                    errorsByType.subscription.push(username);
                } else if (error.includes('network') || error.includes('connection') || error.includes('timeout')) {
                    errorsByType.network.push(username);
                } else if (error.includes('permission') || error.includes('not allowed')) {
                    errorsByType.permission.push(username);
                } else {
                    errorsByType.other.push(`${username}: ${result.error}`);
                }
            }
        });
        
        // Build user-friendly error summary
        const errorMessages = [];
        
        if (errorsByType.userNotFound.length > 0) {
            const users = errorsByType.userNotFound.join(', ');
            errorMessages.push(`👤 Users not found: ${users}\n   → These users don't have accounts yet. Ask them to sign up first.`);
        }
        
        if (errorsByType.subscription.length > 0) {
            const users = errorsByType.subscription.join(', ');
            errorMessages.push(`💳 Subscription required for: ${users}\n   → Check your account subscription status.`);
        }
        
        if (errorsByType.network.length > 0) {
            const users = errorsByType.network.join(', ');
            errorMessages.push(`🌐 Network errors for: ${users}\n   → Check your internet connection and try again.`);
        }
        
        if (errorsByType.permission.length > 0) {
            const users = errorsByType.permission.join(', ');
            errorMessages.push(`🔒 Permission denied for: ${users}\n   → You may not have sharing permissions.`);
        }
        
        if (errorsByType.other.length > 0) {
            errorMessages.push(`❓ Other errors:\n${errorsByType.other.map(err => `   → ${err}`).join('\n')}`);
        }
        
        return errorMessages.length > 0 ? errorMessages.join('\n\n') : 'Unknown sharing errors occurred.';
    }

    /**
     * Categorize sharing errors and provide user-friendly messages
     * @param {Error} error - The error object
     * @param {string} username - The username that failed
     * @returns {string} User-friendly error message
     */
    categorizeAndFormatSharingError(error, username) {
        const errorName = error.name || '';
        const errorMessage = error.message || '';
        
        // Handle specific Userbase error types
        switch (errorName) {
            case 'UserNotFound':
                return `❌ User "${username}" does not exist in the system. Please verify the username is correct and that the user has created an account.`;
            
            case 'UserNotSignedIn':
                return `❌ You must be signed in to share contacts. Please sign in and try again.`;
            
            case 'SharingWithSelfNotAllowed':
                return `❌ You cannot share a contact with yourself.`;
            
            case 'SubscriptionPlanNotSet':
            case 'SubscriptionNotFound':
            case 'SubscribedToIncorrectPlan':
            case 'SubscriptionInactive':
            case 'TrialExpired':
                return `❌ A valid subscription is required to share contacts. Please check your account settings.`;
            
            case 'TooManyRequests':
                return `⚠️ Too many sharing requests. Please wait a moment and try again.`;
            
            case 'ServiceUnavailable':
                return `🚫 The sharing service is temporarily unavailable. Please try again in a few minutes.`;
            
            case 'DatabaseNotFound':
                return `❌ Unable to access sharing database. Please try refreshing the page.`;
            
            default:
                break;
        }
        
        // Handle message-based error detection (for cases where error.name isn't set)
        if (errorMessage.toLowerCase().includes('user not found')) {
            return `❌ User "${username}" does not exist. Please check the username spelling and ensure the user has an account.`;
        }
        
        if (errorMessage.toLowerCase().includes('usernotverified') || errorMessage.toLowerCase().includes('unverified user')) {
            return `❌ User "${username}" needs to verify their account before you can share contacts with them.`;
        }
        
        if (errorMessage.toLowerCase().includes('sharing not allowed') || errorMessage.toLowerCase().includes('permission denied')) {
            return `❌ You don't have permission to share this contact with "${username}".`;
        }
        
        if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('connection')) {
            return `🌐 Network error occurred. Please check your internet connection and try again.`;
        }
        
        if (errorMessage.toLowerCase().includes('timeout')) {
            return `⏱️ The request timed out. Please try again.`;
        }
        
        // Generic error with more helpful context
        if (errorMessage) {
            return `❌ Failed to share with "${username}": ${errorMessage}`;
        }
        
        return `❌ Unable to share contact with "${username}". Please try again or contact support if the problem persists.`;
    }

    /**
     * Update contact sharing metadata after successful share
     */
    async updateContactSharingMetadata(contactId, username, isReadOnly) {
        try {
            const contact = this.contactManager.getContact(contactId);
            if (!contact) return;
            
            // Update sharing metadata
            const updatedMetadata = {
                ...contact.metadata,
                sharing: {
                    ...contact.metadata.sharing,
                    isShared: true,
                    shareCount: (contact.metadata.sharing?.shareCount || 0) + 1,
                    sharedWithUsers: [
                        ...(contact.metadata.sharing?.sharedWithUsers || []),
                        username
                    ],
                    sharePermissions: {
                        ...contact.metadata.sharing?.sharePermissions,
                        [username]: {
                            level: isReadOnly ? 'readOnly' : 'write',
                            sharedAt: new Date().toISOString(),
                            sharedBy: this.contactManager.database.currentUser?.username,
                            canReshare: false,
                            hasViewed: false
                        }
                    },
                    shareHistory: [
                        ...(contact.metadata.sharing?.shareHistory || []),
                        {
                            action: 'shared',
                            targetUser: username,
                            timestamp: new Date().toISOString(),
                            permission: isReadOnly ? 'readOnly' : 'write',
                            sharedBy: this.contactManager.database.currentUser?.username
                        }
                    ]
                }
            };
            
            // Update contact
            await this.contactManager.updateContactMetadata(contactId, { metadata: updatedMetadata });
            
        } catch (error) {
            console.error('Failed to update sharing metadata:', error);
        }
    }

    /**
     * Handle distribution list sharing
     */
    async handleDistributionListShare(username, listName, isReadOnly) {
        // Clear previous errors
        this.clearShareFormErrors();
        
        // Prevent sharing with self
        if (username === this.contactManager.database.currentUser?.username) {
            this.showShareFormError('share-username', 'You cannot share contacts with yourself');
            return;
        }
        
        // Get contacts in the distribution list
        const contacts = this.contactManager.getContactsByDistributionList(listName);
        
        if (contacts.length === 0) {
            this.showShareFormError('share-distribution-list', 'This distribution list has no contacts to share');
            return;
        }
        
        console.log(`🔄 Sharing ${contacts.length} contacts from "${listName}" with:`, username, 'readonly:', isReadOnly);
        
        // Show loading state
        this.setShareModalState('loading');
        
        try {
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            // Share each contact individually
            for (const contact of contacts) {
                try {
                    // Share individual contact via ContactManager
                    const result = await this.contactManager.shareContact(contact.contactId, username, isReadOnly, false);
                    
                    if (result.success) {
                        successCount++;
                        console.log('✅ Individual contact shared:', contact.cardName);
                    } else {
                        errorCount++;
                        errors.push(`${contact.cardName}: ${result.error}`);
                    }
                } catch (error) {
                    errorCount++;
                    errors.push(`${contact.cardName}: ${error.message}`);
                }
            }
            
            if (successCount > 0) {
                // Show success state
                this.setShareModalState('success');
                if (this.elements.sharedWithUser) {
                    this.elements.sharedWithUser.textContent = username;
                }
                
                // Update success message for bulk share
                const successElement = document.querySelector('#share-success .success-message');
                if (successElement) {
                    successElement.innerHTML = `
                        <i class="fas fa-check-circle"></i>
                        Successfully shared ${successCount} contact${successCount !== 1 ? 's' : ''} from "${listName}" with ${username}!
                        ${errorCount > 0 ? `<br><small>${errorCount} contact${errorCount !== 1 ? 's' : ''} failed to share.</small>` : ''}
                    `;
                }
                
                // Refresh contacts list to show sharing indicators
                this.refreshContactsList();
                
                console.log(`✅ Distribution list shared: ${successCount} success, ${errorCount} errors`);
                
                // Auto-close after 5 seconds (longer for bulk operations)
                setTimeout(() => {
                    this.hideModal({ modalId: 'share-modal' });
                }, 5000);
                
            } else {
                throw new Error(`Failed to share any contacts from "${listName}". ${errors.join(', ')}`);
            }
            
        } catch (error) {
            console.error('❌ Distribution list share failed:', error);
            
            // Return to form and show error
            this.setShareModalState('form');
            this.showShareFormError('share-distribution-list', error.message || 'Failed to share distribution list');
        }
    }

    /**
     * Show share form error
     */
    /**
     * Show error for share form field with enhanced styling and categorization
     * @param {string} fieldName - Field name for error display
     * @param {string} message - Error message to display
     */
    showShareFormError(fieldName, message) {
        // First try the new error element pattern
        const errorElement = document.getElementById(`${fieldName}-error`);
        if (errorElement) {
            errorElement.innerHTML = message; // Use innerHTML to support emoji
            errorElement.style.display = 'block';
            
            // Add error type class for styling
            errorElement.className = 'field-error';
            if (message.includes('does not exist') || message.includes('not found')) {
                errorElement.className += ' error-user-not-found';
            } else if (message.includes('subscription') || message.includes('trial')) {
                errorElement.className += ' error-subscription';
            } else if (message.includes('network') || message.includes('connection')) {
                errorElement.className += ' error-network';
            }
            return;
        }
        
        // Fallback to field-based error handling
        const field = document.getElementById(fieldName);
        if (field) {
            field.classList.add('error');
            
            // Remove existing error message
            const existingError = field.parentNode.querySelector('.field-error');
            if (existingError) {
                existingError.remove();
            }
            
            // Add new error message with enhanced styling
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            if (message.includes('does not exist') || message.includes('not found')) {
                errorDiv.className += ' error-user-not-found';
            } else if (message.includes('subscription') || message.includes('trial')) {
                errorDiv.className += ' error-subscription';
            } else if (message.includes('network') || message.includes('connection')) {
                errorDiv.className += ' error-network';
            }
            
            errorDiv.innerHTML = message; // Use innerHTML to support emoji and formatting
            field.parentNode.appendChild(errorDiv);
            
            // Auto-focus on the field for better UX
            if (fieldName === 'share-username') {
                setTimeout(() => field.focus(), 100);
            }
        }
    }

    /**
     * Clear share form errors
     */
    clearShareFormErrors() {
        const errorElements = this.elements.shareForm?.querySelectorAll('.field-error');
        errorElements?.forEach(element => {
            element.style.display = 'none';
            element.textContent = '';
        });
    }

    /**
     * Handle share type tab change
     */
    handleShareTypeChange(event) {
        const tab = event.target.closest('.share-type-tab');
        const shareType = tab.dataset.type;
        
        // Update tab visual state
        document.querySelectorAll('.share-type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show/hide appropriate sections
        document.querySelectorAll('.share-section').forEach(section => {
            section.classList.remove('active');
        });
        
        if (shareType === 'contact') {
            document.getElementById('contact-share-section').classList.add('active');
            this.elements.shareInfoText.textContent = 'The recipient will receive this contact in their "Shared with Me" section and can view all contact details. They cannot share it further with others.';
            this.elements.shareSubmitText.textContent = 'Share Contact';
            
            // Make username field required for single user sharing
            if (this.elements.shareUsernameInput) {
                this.elements.shareUsernameInput.setAttribute('required', 'required');
            }
            
        } else if (shareType === 'share-with-list') {
            document.getElementById('share-with-list-section').classList.add('active');
            this.elements.shareInfoText.textContent = 'This contact will be shared with ALL users in the selected sharing list simultaneously.';
            this.elements.shareSubmitText.textContent = 'Share with List';
            
            // Remove required attribute from username field for list sharing
            if (this.elements.shareUsernameInput) {
                this.elements.shareUsernameInput.removeAttribute('required');
            }
            
        } else if (shareType === 'distribution-list') {
            // Legacy support - can be removed later
            document.getElementById('distribution-list-share-section').classList.add('active');
            this.elements.shareInfoText.textContent = 'The recipient will receive ALL contacts from this distribution list. They will appear in their "Shared with Me" section and cannot be shared further.';
            this.elements.shareSubmitText.textContent = 'Share Distribution List';
            this.populateDistributionListSelect();
        }
    }

    /**
     * Handle distribution list selection change
     */
    async handleDistributionListSelectChange(event) {
        const listName = event.target.value;
        
        if (!listName) {
            this.elements.distributionListPreview.innerHTML = '';
            return;
        }
        
        await this.updateDistributionListPreview(listName);
    }

    /**
     * Populate distribution list select options
     */
    async populateDistributionListSelect() {
        const distributionLists = await this.contactManager.getDistributionLists();
        const select = this.elements.shareDistributionListSelect;
        
        // Clear existing options (except the first placeholder)
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }
        
        // Add distribution list options
        distributionLists.forEach(list => {
            const option = document.createElement('option');
            option.value = list.name;
            option.textContent = `${list.name} (${list.contactCount} contacts)`;
            select.appendChild(option);
        });
        
        // Disable if no lists available
        select.disabled = distributionLists.length === 0;
        
        if (distributionLists.length === 0) {
            this.elements.distributionListPreview.innerHTML = `
                <div class="distribution-list-summary">
                    <i class="fas fa-info-circle"></i>
                    No distribution lists available. Create a distribution list and assign contacts to it first.
                </div>
            `;
        }
    }

    /**
     * Update distribution list preview
     */
    async updateDistributionListPreview(listName) {
        // Get usernames in the distribution list instead of contacts
        const usernames = await this.contactManager.getUsernamesInDistributionList(listName);
        const distributionLists = await this.contactManager.getDistributionLists();
        const listInfo = distributionLists.find(list => list.name === listName);
        
        if (!listInfo) return;
        
        let html = `
            <div class="distribution-list-summary">
                <i class="fas fa-users" style="color: ${listInfo.color || '#007bff'}"></i>
                You will share your profile with ${usernames.length} user${usernames.length !== 1 ? 's' : ''} in "${listName}"
            </div>
        `;
        
        if (usernames.length > 0) {
            html += `
                <h4><i class="fas fa-list"></i> Users who will receive your profile:</h4>
                <div class="distribution-list-users">
                    ${usernames.slice(0, 5).map(username => `
                        <div class="distribution-list-user-item">
                            <div class="user-avatar-small">
                                <i class="fas fa-user"></i>
                            </div>
                            <div class="username">${this.escapeHtml(username)}</div>
                        </div>
                    `).join('')}
                    ${usernames.length > 5 ? `<div class="more-users">... and ${usernames.length - 5} more users</div>` : ''}
                </div>
            `;
        } else {
            html += `
                <div class="empty-list-message">
                    <i class="fas fa-info-circle"></i>
                    This distribution list doesn't have any users yet. 
                    <button class="btn btn-link manage-list-btn" data-list-name="${listName}">
                        Manage "${listName}"
                    </button>
                </div>
            `;
        }
        
        this.elements.distributionListPreview.innerHTML = html;
    }

    /**
     * Hide share modal
     */
    hideShareModal() {
        this.hideModal({ modalId: 'share-modal' });
        this.currentShareContact = null;
    }

    resetContactForm() {
        const form = document.getElementById('contact-form');
        if (form) {
            form.reset();
            
            // 🔧 CRITICAL: Clear form dataset attributes to prevent wrong mode detection
            delete form.dataset.mode;
            delete form.dataset.contactId;
            
            // Reset multi-field components
            this.resetMultiFieldComponent('phone');
            this.resetMultiFieldComponent('email');
            this.resetMultiFieldComponent('url');
            
            // Clear any error messages
            const errorElements = form.querySelectorAll('.field-error');
            errorElements.forEach(el => el.style.display = 'none');
            
            // Remove error classes from form fields
            const fieldElements = form.querySelectorAll('.field-error-highlight');
            fieldElements.forEach(el => el.classList.remove('field-error-highlight'));
            
            console.log('✅ Contact form reset');
        }
    }

    /**
     * Reset a multi-field component to single empty field
     */
    resetMultiFieldComponent(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (container) {
            // Clear all items
            container.innerHTML = '';
            
            // Add one empty field
            const fieldItem = this.createMultiFieldItem(fieldType);
            container.appendChild(fieldItem);
            
            // Setup events
            this.setupMultiFieldEvents(fieldType);
        }
    }

    /**
     * Reset create list form
     */
    resetCreateListForm() {
        const form = document.getElementById('create-list-form');
        if (form) {
            form.reset();
            
            // Set default color
            const colorInput = document.getElementById('list-color');
            if (colorInput) {
                colorInput.value = '#007bff';
            }
            
            // Clear any error messages
            const errorElements = form.querySelectorAll('.field-error');
            errorElements.forEach(el => {
                el.style.display = 'none';
                el.textContent = '';
            });
            
            // Remove error classes from form fields
            const fieldElements = form.querySelectorAll('.field-error-highlight');
            fieldElements.forEach(el => el.classList.remove('field-error-highlight'));
            
            console.log('✅ Create list form reset');
        }
    }

    /**
     * Handle create list form submission
     */
    async handleCreateListSubmit(event) {
        event.preventDefault();
        console.log('📋 Create list form submitted');
        
        const formData = new FormData(event.target);
        const listData = {
            name: formData.get('listName')?.trim(),
            description: formData.get('description')?.trim() || '',
            color: formData.get('color') || '#007bff'
        };
        
        console.log('📋 Creating list with data:', listData);
        
        // Validate form data
        const validation = this.validateCreateListForm(listData);
        if (!validation.isValid) {
            this.displayCreateListErrors(validation.errors);
            return;
        }
        
        try {
            // Create the distribution list
            const result = await this.contactManager.createDistributionList(listData);
            
            if (result.success) {
                console.log('✅ Distribution list created successfully:', result.list);
                this.hideModal({ modalId: 'create-list-modal' });
                this.showToast({ 
                    message: `Distribution list "${listData.name}" created successfully!`, 
                    type: 'success' 
                });
                
                // Refresh the distribution lists display
                this.renderDistributionLists();
            } else {
                console.error('❌ Failed to create distribution list:', result.error);
                this.showToast({ 
                    message: result.error || 'Failed to create distribution list', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('❌ Error creating distribution list:', error);
            this.showToast({ 
                message: 'An error occurred while creating the list', 
                type: 'error' 
            });
        }
    }

    /**
     * Validate create list form data
     */
    validateCreateListForm(listData) {
        const errors = {};
        
        // Validate name
        if (!listData.name || listData.name.length === 0) {
            errors.listName = 'List name is required';
        } else if (listData.name.length > 50) {
            errors.listName = 'List name must be 50 characters or less';
        } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(listData.name)) {
            errors.listName = 'List name can only contain letters, numbers, spaces, hyphens, and underscores';
        }
        
        // Validate description
        if (listData.description && listData.description.length > 200) {
            errors.description = 'Description must be 200 characters or less';
        }
        
        // Validate color
        if (!listData.color || !/^#[0-9A-Fa-f]{6}$/.test(listData.color)) {
            errors.color = 'Please select a valid color';
        }
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    /**
     * Display create list form errors
     */
    displayCreateListErrors(errors) {
        // Clear previous errors
        const errorElements = document.querySelectorAll('#create-list-form .field-error');
        errorElements.forEach(el => {
            el.style.display = 'none';
            el.textContent = '';
        });
        
        // Remove error highlighting
        const fieldElements = document.querySelectorAll('#create-list-form .field-error-highlight');
        fieldElements.forEach(el => el.classList.remove('field-error-highlight'));
        
        // Display new errors
        Object.entries(errors).forEach(([field, message]) => {
            const errorElement = document.getElementById(`${field}-error`);
            const inputElement = document.getElementById(field === 'listName' ? 'list-name' : field);
            
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.style.display = 'block';
            }
            
            if (inputElement) {
                inputElement.classList.add('field-error-highlight');
            }
        });
    }

    populateContactForm(contact) {
        console.log('Populate contact form:', contact);
        
        const form = document.getElementById('contact-form');
        if (!form) {
            console.error('Contact form not found');
            return;
        }

        // Set form mode to edit
        form.dataset.mode = 'edit';
        form.dataset.contactId = contact.contactId;

        try {
            // Extract display data from vCard
            const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
            
            // Populate basic fields
            this.setFormFieldValue('fullName', displayData.fullName);
            this.setFormFieldValue('cardName', contact.cardName);
            this.setFormFieldValue('organization', displayData.organization);
            this.setFormFieldValue('title', displayData.title);

            // Populate multi-field data
            this.populateMultiFieldData('phone', displayData.phones);
            this.populateMultiFieldData('email', displayData.emails);
            this.populateMultiFieldData('url', displayData.urls);
            
            this.populateMultiFieldData('address', displayData.addresses);
            this.populateNotesData(displayData.notes);

            // Clear any previous errors
            this.clearFormErrors(form);
            
            console.log('✅ Contact form populated successfully');

        } catch (error) {
            console.error('Failed to populate contact form:', error);
            this.showFormError('Failed to load contact data');
        }
    }

    /**
     * Set form field value safely
     * @param {string} fieldName - Field name
     * @param {string} value - Field value
     */
    setFormFieldValue(fieldName, value) {
        const field = document.getElementById(fieldName);
        if (field) {
            field.value = value || '';
        } else {
            console.warn(`Form field not found: ${fieldName}`);
        }
    }

    /**
     * Clear form errors
     * @param {HTMLFormElement} form - Form element
     */
    clearFormErrors(form) {
        const errorElements = form.querySelectorAll('.field-error');
        errorElements.forEach(el => {
            el.style.display = 'none';
            el.textContent = '';
        });
        
        const fieldElements = form.querySelectorAll('.field-error-highlight');
        fieldElements.forEach(el => el.classList.remove('field-error-highlight'));
    }

    formDataToContactData(formData) {
        // Convert form data to contact data format expected by ContactManager
        const contactData = {
            fn: formData.get('fullName') || '',
            cardName: formData.get('cardName') || formData.get('fullName') || 'Unnamed Contact'
        };

        // Handle organization
        const organization = formData.get('organization');
        if (organization && organization.trim()) {
            contactData.organization = organization.trim();
        }

        // Handle title
        const title = formData.get('title');
        if (title && title.trim()) {
            contactData.title = title.trim();
        }

        // Handle multi-field data
        contactData.phones = this.extractMultiFieldData(formData, 'phone');
        contactData.emails = this.extractMultiFieldData(formData, 'email');
        contactData.urls = this.extractMultiFieldData(formData, 'url');
        contactData.addresses = this.extractMultiFieldData(formData, 'address');
        contactData.notes = this.extractNotesData(formData);

        // Fallback to single field data if multi-field is empty
        if (contactData.phones.length === 0) {
            const phone = formData.get('phone');
            if (phone && phone.trim()) {
                contactData.phones = [{
                    value: phone.trim(),
                    type: 'other',
                    primary: true
                }];
            }
        }

        if (contactData.emails.length === 0) {
            const email = formData.get('email');
            if (email && email.trim()) {
                contactData.emails = [{
                    value: email.trim(),
                    type: 'other',
                    primary: true
                }];
            }
        }

        return contactData;
    }

    showFormLoading(show) {
        const form = document.getElementById('contact-form');
        const submitButton = form?.querySelector('button[type="submit"]');
        const cancelButton = form?.querySelector('button[data-dismiss="modal"]');
        
        if (submitButton) {
            submitButton.disabled = show;
            submitButton.innerHTML = show 
                ? '<i class="fas fa-spinner fa-spin"></i> Saving...' 
                : 'Save Contact';
        }
        
        if (cancelButton) {
            cancelButton.disabled = show;
        }
        
        console.log('Show form loading:', show);
    }

    showFormError(error) {
        // Show error in a toast or form error area
        this.showToast({ message: error, type: 'error' });
        console.log('Show form error:', error);
    }

    highlightFormErrors(errors) {
        if (!errors || !Array.isArray(errors)) return;
        
        const form = document.getElementById('contact-form');
        if (!form) return;
        
        // Clear previous error highlights
        this.clearFormErrors(form);
        
        console.log('🔍 Processing form errors:', errors);
        
        // Highlight fields with errors
        errors.forEach(errorMessage => {
            console.log('🔍 Processing error:', errorMessage);
            
            // Try to map error messages to form fields
            if (errorMessage.toLowerCase().includes('phone')) {
                const field = form.querySelector('[name="phone"]');
                const errorElement = form.querySelector('#phone-error');
                
                if (field) {
                    field.classList.add('field-error-highlight');
                }
                
                if (errorElement) {
                    errorElement.textContent = errorMessage;
                    errorElement.style.display = 'block';
                }
            } else if (errorMessage.toLowerCase().includes('email')) {
                const field = form.querySelector('[name="email"]');
                const errorElement = form.querySelector('#email-error');
                
                if (field) {
                    field.classList.add('field-error-highlight');
                }
                
                if (errorElement) {
                    errorElement.textContent = errorMessage;
                    errorElement.style.display = 'block';
                }
            } else if (errorMessage.toLowerCase().includes('full name') || errorMessage.toLowerCase().includes('name')) {
                const field = form.querySelector('[name="fullName"]');
                const errorElement = form.querySelector('#fullName-error');
                
                if (field) {
                    field.classList.add('field-error-highlight');
                }
                
                if (errorElement) {
                    errorElement.textContent = errorMessage;
                    errorElement.style.display = 'block';
                }
            } else {
                // Generic error - show in a general error area
                console.log('🔍 Generic error message:', errorMessage);
            }
        });
        
        console.log('Highlight form errors:', errors);
    }

    /**
     * Clear URL parameters to prevent credential exposure
     * SECURITY: Ensures no sensitive data appears in browser history
     */
    clearURLParameters() {
        const currentUrl = new URL(window.location);
        const hasParams = currentUrl.search || currentUrl.hash.includes('?');
        
        if (hasParams) {
            // Clear all URL parameters and hash parameters
            const cleanUrl = `${currentUrl.origin}${currentUrl.pathname}${currentUrl.hash.split('?')[0]}`;
            window.history.replaceState({}, document.title, cleanUrl);
            console.log('🧹 Cleared URL parameters for security');
        }
    }

    /**
     * Clear authentication form completely
     */
    clearAuthenticationForm() {
        if (this.elements.authForm) {
            // Reset the entire form
            this.elements.authForm.reset();
            
            // Specifically clear username and password fields
            const usernameField = this.elements.authForm.querySelector('input[name="username"]');
            const passwordField = this.elements.authForm.querySelector('input[name="password"]');
            const keepSignedInField = this.elements.authForm.querySelector('input[name="keepSignedIn"]');
            
            if (usernameField) {
                usernameField.value = '';
                usernameField.removeAttribute('value');
            }
            
            if (passwordField) {
                passwordField.value = '';
                passwordField.removeAttribute('value');
            }
            
            // Uncheck "Keep me signed in"
            if (keepSignedInField) {
                keepSignedInField.checked = false;
            }
            
            // Clear any form errors
            this.clearAuthError();
            
            // Reset to login mode (not signup)
            const authTitle = document.getElementById('auth-title');
            const authSubmit = document.getElementById('auth-submit');
            const authToggleText = document.getElementById('auth-toggle-text');
            const authToggle = document.getElementById('toggle-auth-mode');
            
            if (authTitle) authTitle.textContent = 'Sign In';
            if (authSubmit) authSubmit.textContent = 'Sign In';
            if (authToggleText) authToggleText.textContent = "Don't have an account?";
            if (authToggle) authToggle.textContent = 'Create Account';
            
            // Reset form mode
            if (this.elements.authForm) {
                this.elements.authForm.dataset.mode = 'signin';
            }
        }
    }

    clearAuthError() {
        if (this.elements.authError) {
            this.elements.authError.style.display = 'none';
        }
    }

    showAuthError(error) {
        if (this.elements.authError) {
            this.elements.authError.textContent = error;
            this.elements.authError.style.display = 'block';
        } else {
            console.error('Auth Error:', error);
        }
    }

    showAuthLoading(show) {
        const submitButton = document.querySelector('#auth-form button[type="submit"]');
        const submitText = document.getElementById('auth-submit-text');
        
        if (submitButton && submitText) {
            if (show) {
                submitButton.disabled = true;
                submitText.textContent = 'Loading...';
            } else {
                submitButton.disabled = false;
                submitText.textContent = submitButton.dataset.mode === 'signup' ? 'Sign Up' : 'Sign In';
            }
        }
    }

    toggleAuthMode() {
        const form = this.elements.authForm;
        const submitText = document.getElementById('auth-submit-text');
        const toggleText = document.getElementById('auth-toggle-text');
        const keepSignedInContainer = document.getElementById('keep-signed-in-group');
        
        if (form && submitText && toggleText) {
            const isSignUp = form.dataset.mode === 'signup';
            
            if (isSignUp) {
                // Switch to sign in
                form.dataset.mode = 'signin';
                submitText.textContent = 'Sign In';
                toggleText.textContent = 'Need an account? Sign Up';
                
                // Show "Keep me signed in" checkbox for sign-in
                if (keepSignedInContainer) {
                    keepSignedInContainer.style.display = 'block';
                }
            } else {
                // Switch to sign up
                form.dataset.mode = 'signup';
                submitText.textContent = 'Sign Up';
                toggleText.textContent = 'Already have an account? Sign In';
                
                // Hide "Keep me signed in" checkbox for sign-up
                if (keepSignedInContainer) {
                    keepSignedInContainer.style.display = 'none';
                }
            }
        }
    }

    confirmDeleteContact(contactId) {
        if (confirm('Are you sure you want to delete this contact?')) {
            this.contactManager.deleteContact(contactId);
        }
    }

    setupContactDetailListeners(container, contactId) {
        // Setup listeners for contact detail actions
        console.log('🔗 Setting up contact detail listeners for:', contactId);
        
        // Edit contact button
        const editBtn = container.querySelector('.edit-contact');
        if (editBtn) {
            editBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('✏️ Edit button clicked in detail view for:', contactId);
                this.showEditContactModal(contactId);
            });
        }

        // Share contact button
        const shareBtn = container.querySelector('.share-contact');
        if (shareBtn) {
            shareBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('📤 Share button clicked in detail view for:', contactId);
                this.showShareContactModal(contactId);
            });
        }

        // Delete contact button
        const deleteBtn = container.querySelector('.delete-contact');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('🗑️ Delete button clicked in detail view for:', contactId);
                this.showDeleteConfirmModal(contactId);
            });
        }

        // Export contact button
        const exportBtn = container.querySelector('.export-contact');
        if (exportBtn) {
            exportBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('📄 Export button clicked in detail view for:', contactId);
                this.exportContact(contactId);
            });
        }

        // Archive contact button
        const archiveBtn = container.querySelector('.archive-contact');
        if (archiveBtn) {
            archiveBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('📦 Archive button clicked in detail view for:', contactId);
                this.archiveContact(contactId);
            });
        }

        // Restore contact button
        const restoreBtn = container.querySelector('.restore-contact');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('🔄 Restore button clicked in detail view for:', contactId);
                this.restoreContact(contactId);
            });
        }
        
        // Revoke sharing buttons
        const revokeButtons = container.querySelectorAll('.btn-revoke');
        revokeButtons.forEach(button => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                
                const contactId = button.dataset.contactId;
                const username = button.dataset.username;
                
                console.log('🚫 Revoke button clicked for:', { contactId, username });
                
                if (contactId && username) {
                    await this.handleRevokeSharing(contactId, username);
                }
            });
        });
    }

    handleModalBackdropClick(event) {
        // Close modal when clicking on backdrop (not on modal content)
        if (event.target.classList.contains('modal')) {
            const modalId = event.target.id;
            this.hideModal({ modalId });
        }
        
        // Close filter dropdown when clicking outside
        if (this.elements.filterDropdown && 
            this.elements.filterDropdown.style.display === 'block') {
            
            const filterButton = this.elements.filterBtn;
            const filterDropdown = this.elements.filterDropdown;
            
            // Check if click is outside filter button and dropdown
            if (!filterButton?.contains(event.target) && 
                !filterDropdown?.contains(event.target)) {
                this.elements.filterDropdown.style.display = 'none';
            }
        }
    }

    handleKeyboardShortcuts(event) {
        // Handle keyboard shortcuts
        if (event.ctrlKey || event.metaKey) {
            switch (event.key) {
                case 'n':
                    event.preventDefault();
                    this.showNewContactModal();
                    break;
                case 'f':
                    event.preventDefault();
                    if (this.elements.searchInput) {
                        this.elements.searchInput.focus();
                    }
                    break;
            }
        }
    }

    handleWindowResize() {
        this.updateResponsiveLayout();
    }

    handlePopState(event) {
        // Handle browser back/forward buttons
    }

    updateResponsiveLayout() {
        // Update layout based on screen size
        const isMobile = window.innerWidth < 768;
        const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;
        
        document.body.classList.toggle('mobile', isMobile);
        document.body.classList.toggle('tablet', isTablet);
        
        // Update view mode based on screen size
        const optimalViewMode = this.getDefaultViewMode();
        if (this.viewMode !== optimalViewMode) {
            console.log(`🔄 Responsive view mode change: ${this.viewMode} → ${optimalViewMode}`);
            this.setViewMode(optimalViewMode);
        }
    }

    /**
     * Show delete confirmation modal
     */
    async showDeleteConfirmModal(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) return;

        const confirmed = confirm(`Are you sure you want to delete "${contact.cardName}"?\n\nThis action cannot be undone.`);
        if (confirmed) {
            try {
                await this.contactManager.deleteContact(contactId);
                console.log('✅ Contact deleted successfully:', contactId);
            } catch (error) {
                console.error('❌ Failed to delete contact:', error);
                alert('Failed to delete contact. Please try again.');
            }
        }
    }

    /**
     * Archive contact (both owned and shared) with confirmation
     */
    async archiveContact(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) return;

        // Show confirmation dialog
        const confirmed = confirm(`Are you sure you want to archive "${contact.cardName}"?\n\nArchived contacts will be hidden from the main view but can be restored later.`);
        if (!confirmed) {
            console.log('📦 Archive cancelled by user for:', contactId);
            return;
        }

        try {
            const result = await this.contactManager.archiveContact(contactId);
            if (result.success) {
                console.log('✅ Contact archived successfully:', contactId);
                this.showToast({ 
                    message: 'Contact archived successfully', 
                    type: 'success' 
                });
                
                // Update the detail view to show the new archived state
                if (this.selectedContactId === contactId) {
                    const updatedContact = this.contactManager.getContact(contactId);
                    if (updatedContact) {
                        this.displayContactDetail(updatedContact);
                    }
                }
            } else {
                console.error('❌ Failed to archive contact:', result.error);
                this.showToast({ 
                    message: `Failed to archive contact: ${result.error}`, 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('❌ Failed to archive contact:', error);
            this.showToast({ 
                message: 'Failed to archive contact. Please try again.', 
                type: 'error' 
            });
        }
    }

    /**
     * Restore contact from archive with confirmation
     */
    async restoreContact(contactId) {
        const contact = this.contactManager.getContact(contactId);
        if (!contact) return;

        // Show confirmation dialog
        const confirmed = confirm(`Are you sure you want to restore "${contact.cardName}" from archive?\n\nThe contact will be moved back to your active contacts.`);
        if (!confirmed) {
            console.log('🔄 Restore cancelled by user for:', contactId);
            return;
        }

        try {
            const result = await this.contactManager.restoreContact(contactId);
            if (result.success) {
                console.log('✅ Contact restored successfully:', contactId);
                this.showToast({ 
                    message: 'Contact restored successfully', 
                    type: 'success' 
                });
                
                // Update the detail view to show the new restored state
                if (this.selectedContactId === contactId) {
                    const updatedContact = this.contactManager.getContact(contactId);
                    if (updatedContact) {
                        this.displayContactDetail(updatedContact);
                    }
                }
                
                // Refresh the contact list to update the UI
                this.performSearch();
            } else {
                console.error('❌ Failed to restore contact:', result.error);
                this.showToast({ 
                    message: `Failed to restore contact: ${result.error}`, 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('❌ Failed to restore contact:', error);
            this.showToast({ 
                message: 'Failed to restore contact. Please try again.', 
                type: 'error' 
            });
        }
    }

    /**
     * Handle distribution list actions (event delegation)
     */
    async handleDistributionListActions(event) {
        // Handle sharing distribution list
        if (event.target.matches('.share-list-btn, .share-list-btn *')) {
            event.preventDefault();
            event.stopPropagation(); // Prevent triggering list selection
            const shareBtn = event.target.closest('.share-list-btn');
            const listName = shareBtn?.dataset.listName;
            
            if (listName) {
                this.openShareModalForDistributionList(listName);
            }
            return;
        }
        
        // Handle adding contact to distribution list
        if (event.target.matches('.add-to-list-btn')) {
            event.preventDefault();
            const contactId = event.target.dataset.contactId;
            const select = document.querySelector(`.distribution-list-select[data-contact-id="${contactId}"]`);
            const listName = select?.value;
            
            if (!listName) {
                this.showToast({ message: 'Please select a distribution list', type: 'warning' });
                return;
            }
            
            await this.addContactToList(contactId, listName);
            return;
        }
        
        // Handle removing contact from distribution list
        if (event.target.matches('.distribution-list-tag')) {
            event.preventDefault();
            const listName = event.target.dataset.list;
            const contactCard = event.target.closest('.contact-card');
            const contactId = contactCard?.dataset.contactId;
            
            if (contactId && listName) {
                await this.removeContactFromList(contactId, listName);
            }
            return;
        }
        
        // Handle distribution list sidebar clicks
        if (event.target.matches('.distribution-list-item, .distribution-list-item *')) {
            // Skip if clicking on action buttons
            if (event.target.matches('.manage-list-btn, .delete-list-btn, .manage-list-btn *, .delete-list-btn *')) {
                return;
            }
            
            const listItem = event.target.closest('.distribution-list-item');
            const listName = listItem?.dataset.listName;
            
            console.log('🎯 Distribution list clicked:', listName);
            console.log('🎯 Event target:', event.target);
            
            // Regular distribution list clicked - no automatic filtering
            console.log('🎯 Regular distribution list clicked - no automatic filtering');
            // Don't auto-filter for regular distribution lists
            // User must use a different method to filter (like a separate filter button)
            
            return;
        }
    }

    /**
     * Add contact to distribution list
     */
    async addContactToList(contactId, listName) {
        try {
            const result = await this.contactManager.addContactToDistributionList(contactId, listName);
            
            if (result.success) {
                this.showToast({ 
                    message: `Contact added to "${listName}" list`, 
                    type: 'success' 
                });
                
                // Refresh the contact display and distribution lists
                await this.refreshContactsList();
                await this.renderDistributionLists();
                
            } else {
                this.showToast({ 
                    message: result.error || 'Failed to add contact to list', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('❌ Error adding contact to list:', error);
            this.showToast({ 
                message: 'Failed to add contact to list', 
                type: 'error' 
            });
        }
    }

    /**
     * Remove contact from distribution list
     */
    async removeContactFromList(contactId, listName) {
        if (!confirm(`Remove this contact from "${listName}" list?`)) {
            return;
        }
        
        try {
            const result = await this.contactManager.removeContactFromDistributionList(contactId, listName);
            
            if (result.success) {
                this.showToast({ 
                    message: `Contact removed from "${listName}" list`, 
                    type: 'success' 
                });
                
                // Refresh the contact display and distribution lists
                await this.refreshContactsList();
                await this.renderDistributionLists();
                
            } else {
                this.showToast({ 
                    message: result.error || 'Failed to remove contact from list', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('❌ Error removing contact from list:', error);
            this.showToast({ 
                message: 'Failed to remove contact from list', 
                type: 'error' 
            });
        }
    }

    /**
     * Filter contacts by distribution list
     */
    /**
     * Populate distribution list select options
     */
    async populateDistributionListSelects() {
        const distributionLists = await this.contactManager.getDistributionLists();
        const selects = document.querySelectorAll('.distribution-list-select');
        
        selects.forEach(select => {
            const contactId = select.dataset.contactId;
            const contact = this.contactManager.contacts.get(contactId);
            const assignedLists = contact?.metadata?.distributionLists || [];
            
            // Clear existing options (except the first "Choose a list..." option)
            while (select.children.length > 1) {
                select.removeChild(select.lastChild);
            }
            
            // Add available lists (exclude already assigned ones)
            distributionLists.forEach(list => {
                if (!assignedLists.includes(list.name)) {
                    const option = document.createElement('option');
                    option.value = list.name;
                    option.textContent = list.name;
                    select.appendChild(option);
                }
            });
            
            // Disable if no lists available
            select.disabled = distributionLists.filter(list => 
                !assignedLists.includes(list.name)
            ).length === 0;
        });
    }

    /**
     * Open share modal pre-configured for distribution list sharing
     */
    openShareModalForDistributionList(listName) {
        // Show the share modal
        this.elements.shareModal.style.display = 'block';
        
        // Switch to distribution list tab
        const distributionTab = this.elements.shareModal.querySelector('[data-share-type="distribution-list"]');
        const individualTab = this.elements.shareModal.querySelector('[data-share-type="individual"]');
        
        if (distributionTab && individualTab) {
            individualTab.classList.remove('active');
            distributionTab.classList.add('active');
            
            // Show distribution list content, hide individual content
            const individualContent = this.elements.shareModal.querySelector('#individual-share-content');
            const distributionContent = this.elements.shareModal.querySelector('#distribution-list-share-content');
            
            if (individualContent) individualContent.style.display = 'none';
            if (distributionContent) distributionContent.style.display = 'block';
            
            // Pre-select the distribution list
            const distributionSelect = this.elements.shareModal.querySelector('#distribution-list-select');
            if (distributionSelect) {
                distributionSelect.value = listName;
                // Trigger the change event to update preview
                distributionSelect.dispatchEvent(new Event('change'));
            }
        }
        
        // Clear any previous share state
        const usernameInput = this.elements.shareModal.querySelector('#share-username');
        if (usernameInput) {
            usernameInput.value = '';
        }
        
        // Update modal title
        const modalTitle = this.elements.shareModal.querySelector('h2');
        if (modalTitle) {
            modalTitle.textContent = `Share My Profile with "${listName}"`;
        }
        
        // Update instruction text
        const instructionText = this.elements.shareModal.querySelector('.share-instruction');
        if (instructionText) {
            instructionText.textContent = 'Select which of your contact profiles to share with this distribution list.';
        }
    }

    /**
     * Open username management modal
     */
    openUsernameManagementModal(listName) {
        this.currentDistributionList = listName;
        this.elements.usernameModalTitle.textContent = `Manage "${listName}" Users`;
        this.elements.usernameModal.style.display = 'block';
        this.elements.newUsernameInput.value = '';
        this.loadUsernamesForList(listName);
    }

    /**
     * Load usernames for the current distribution list
     */
    async loadUsernamesForList(listName) {
        try {
            const usernames = await this.contactManager.getUsernamesInDistributionList(listName);
            this.renderUsernamesList(usernames);
        } catch (error) {
            console.error('Error loading usernames:', error);
            this.showToast({ message: 'Failed to load usernames', type: 'error' });
        }
    }

    /**
     * Render the usernames list
     */
    renderUsernamesList(usernames) {
        if (!this.elements.usernamesList) return;

        if (usernames.length === 0) {
            this.elements.usernamesList.innerHTML = `
                <div class="empty-usernames">
                    <i class="fas fa-info-circle"></i>
                    No users in this distribution list yet.
                </div>
            `;
            return;
        }

        const html = usernames.map(username => `
            <div class="username-item">
                <div class="username">${this.escapeHtml(username)}</div>
                <button class="remove-username-btn" data-username="${this.escapeHtml(username)}">
                    <i class="fas fa-times"></i> Remove
                </button>
            </div>
        `).join('');

        this.elements.usernamesList.innerHTML = html;

        // Add event listeners for remove buttons
        this.elements.usernamesList.querySelectorAll('.remove-username-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const username = e.target.dataset.username;
                this.handleRemoveUsername(username);
            });
        });
    }

    /**
     * Handle add username button click
     */
    async handleAddUsername() {
        const username = this.elements.newUsernameInput.value.trim();
        
        if (!username) {
            this.showToast({ message: 'Please enter a username', type: 'warning' });
            return;
        }

        if (!this.currentDistributionList) {
            this.showToast({ message: 'No distribution list selected', type: 'error' });
            return;
        }

        try {
            const result = await this.contactManager.addUsernameToDistributionList(
                this.currentDistributionList, 
                username
            );

            if (result.success) {
                this.elements.newUsernameInput.value = '';
                this.loadUsernamesForList(this.currentDistributionList);
                
                // Enhanced feedback for retroactive sharing
                let message = `Added "${username}" to distribution list`;
                let toastType = 'success';
                
                if (result.retroactiveSharing && result.retroactiveSharing.contactsFound > 0) {
                    const { contactsFound, successfulShares, alreadyShared, failedShares } = result.retroactiveSharing;
                    
                    if (successfulShares > 0) {
                        message += ` and automatically shared ${successfulShares} existing contact${successfulShares === 1 ? '' : 's'}`;
                        if (alreadyShared > 0) {
                            message += ` (${alreadyShared} already shared)`;
                        }
                    } else if (alreadyShared > 0) {
                        message += ` (${alreadyShared} existing contact${alreadyShared === 1 ? ' was' : 's were'} already shared)`;
                    }
                    
                    if (failedShares > 0) {
                        message += ` (${failedShares} failed to share)`;
                        toastType = 'warning';
                    }
                }
                
                this.showToast({ 
                    message: message, 
                    type: toastType 
                });
                
                // Refresh distribution lists in sidebar
                this.renderDistributionLists();
            } else {
                // 🆕 Enhanced error feedback for username validation
                let errorMessage = result.error || 'Failed to add username';
                let errorIcon = '❌';
                
                if (result.errorType === 'userNotFound') {
                    errorIcon = '👤';
                } else if (result.errorType === 'subscription') {
                    errorIcon = '💳';
                } else if (result.errorType === 'network') {
                    errorIcon = '🌐';
                }
                
                this.showToast({ 
                    message: `${errorIcon} ${errorMessage}`, 
                    type: 'error',
                    duration: 5000  // Show longer for error messages
                });
            }
        } catch (error) {
            console.error('Error adding username:', error);
            this.showToast({ message: 'Failed to add username', type: 'error' });
        }
    }

    /**
     * Handle remove username
     */
    async handleRemoveUsername(username) {
        if (!this.currentDistributionList) return;

        try {
            const result = await this.contactManager.removeUsernameFromDistributionList(
                this.currentDistributionList, 
                username
            );

            if (result.success) {
                this.loadUsernamesForList(this.currentDistributionList);
                this.showToast({ 
                    message: `Removed "${username}" from distribution list`, 
                    type: 'success' 
                });
                
                // Refresh distribution lists in sidebar
                this.renderDistributionLists();
            } else {
                this.showToast({ 
                    message: result.error || 'Failed to remove username', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('Error removing username:', error);
            this.showToast({ message: 'Failed to remove username', type: 'error' });
        }
    }

    /**
     * Handle keypress in username input (Enter to add)
     */
    handleUsernameInputKeypress(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.handleAddUsername();
        }
    }

    /**
     * Confirm deletion of a distribution list
     */
    confirmDeleteDistributionList(listName) {
        if (confirm(`Are you sure you want to delete the "${listName}" sharing list?\n\nThis will remove the list from all contacts that are assigned to it. This action cannot be undone.`)) {
            this.deleteDistributionList(listName);
        }
    }

    /**
     * Delete a distribution list
     */
    async deleteDistributionList(listName) {
        try {
            console.log('🗑️ UI: Starting deletion of distribution list:', listName);
            const result = await this.contactManager.deleteDistributionList(listName);
            console.log('🗑️ UI: Deletion result:', result);
            
            if (result.success) {
                console.log('✅ UI: Distribution list deleted successfully, updating UI...');
                this.showToast({ 
                    message: `Distribution list "${listName}" deleted successfully`, 
                    type: 'success' 
                });
                
                // Clear the filter if the deleted list was active
                if (this.activeFilters.distributionList === listName) {
                    console.log('🔄 UI: Clearing active filter for deleted list');
                    this.activeFilters.distributionList = null;
                    await this.refreshContactsList();
                }
                
                // Refresh distribution lists in sidebar
                console.log('🔄 UI: Refreshing distribution lists display...');
                await this.renderDistributionLists();
                console.log('✅ UI: Distribution lists display refreshed');
            } else {
                console.error('❌ UI: Distribution list deletion failed:', result.error);
                this.showToast({ 
                    message: result.error || 'Failed to delete distribution list', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('Error deleting distribution list:', error);
            this.showToast({ message: 'Failed to delete distribution list', type: 'error' });
        }
    }

    // ========== MULTI-FIELD FORM COMPONENTS ==========

    /**
     * Setup multi-field component listeners
     */
    setupMultiFieldListeners() {
        // Add field buttons
        const addPhoneBtn = document.getElementById('add-phone-btn');
        const addEmailBtn = document.getElementById('add-email-btn');
        const addUrlBtn = document.getElementById('add-url-btn');
        const addAddressBtn = document.getElementById('add-address-btn');
        const addNoteBtn = document.getElementById('add-note-btn');

        if (addPhoneBtn) {
            addPhoneBtn.addEventListener('click', () => this.addMultiField('phone'));
        }
        if (addEmailBtn) {
            addEmailBtn.addEventListener('click', () => this.addMultiField('email'));
        }
        if (addUrlBtn) {
            addUrlBtn.addEventListener('click', () => this.addMultiField('url'));
        }
        if (addAddressBtn) {
            addAddressBtn.addEventListener('click', () => this.addMultiField('address'));
        }
        if (addNoteBtn) {
            addNoteBtn.addEventListener('click', () => this.addMultiField('note'));
        }

        // Initial setup for existing fields
        this.setupMultiFieldEvents('phone');
        this.setupMultiFieldEvents('email');
        this.setupMultiFieldEvents('url');
        this.setupMultiFieldEvents('address');
        this.setupMultiFieldEvents('note');
    }

    /**
     * Add a new multi-field item
     */
    addMultiField(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        const newItem = this.createMultiFieldItem(fieldType);
        container.appendChild(newItem);
        
        // Setup events for the new item
        this.setupMultiFieldEvents(fieldType);
        
        // Focus the new input based on field type
        let newInput;
        if (fieldType === 'address') {
            newInput = newItem.querySelector(`input[name="addressStreet[]"]`);
        } else if (fieldType === 'note') {
            newInput = newItem.querySelector(`textarea[name="${fieldType}[]"]`);
        } else {
            newInput = newItem.querySelector(`input[name="${fieldType}[]"]`);
        }
        
        if (newInput) {
            newInput.focus();
        }
    }

    /**
     * Create a new multi-field item
     */
    createMultiFieldItem(fieldType) {
        const item = document.createElement('div');
        item.className = 'multi-field-item';
        
        // Add specific class for special field types
        if (fieldType === 'address') {
            item.classList.add('address-field');
        } else if (fieldType === 'note') {
            item.classList.add('note-field');
        }

        const typeOptions = this.getFieldTypeOptions(fieldType);
        const fieldId = Date.now() + Math.random();

        // Special handling for address fields
        if (fieldType === 'address') {
            item.innerHTML = `
                <select class="field-type-select" name="${fieldType}Type[]">
                    ${typeOptions}
                </select>
                <div class="address-inputs">
                    <input type="text" name="addressStreet[]" placeholder="Street address">
                    <div class="address-row">
                        <input type="text" name="addressCity[]" placeholder="City">
                        <input type="text" name="addressState[]" placeholder="State/Province">
                        <input type="text" name="addressPostalCode[]" placeholder="Postal code">
                    </div>
                    <input type="text" name="addressCountry[]" placeholder="Country">
                </div>
                <label class="primary-checkbox">
                    <input type="checkbox" name="${fieldType}Primary[]" value="${fieldId}">
                    <span class="checkmark"></span>
                    Primary
                </label>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
        // Special handling for note fields
        else if (fieldType === 'note') {
            item.innerHTML = `
                <textarea name="${fieldType}[]" placeholder="Add a note..." rows="3"></textarea>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
        // Standard handling for other field types
        else {
            const inputType = this.getInputType(fieldType);
            const placeholder = this.getPlaceholder(fieldType);

            item.innerHTML = `
                <select class="field-type-select" name="${fieldType}Type[]">
                    ${typeOptions}
                </select>
                <input type="${inputType}" name="${fieldType}[]" placeholder="${placeholder}">
                <label class="primary-checkbox">
                    <input type="checkbox" name="${fieldType}Primary[]" value="${fieldId}">
                    <span class="checkmark"></span>
                    Primary
                </label>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }

        // Store the field ID for later reference
        item.dataset.fieldId = fieldId;

        return item;
    }

    /**
     * Get field type options for select
     */
    getFieldTypeOptions(fieldType) {
        const options = {
            phone: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'mobile', label: 'Mobile' },
                { value: 'fax', label: 'Fax' },
                { value: 'other', label: 'Other' }
            ],
            email: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'personal', label: 'Personal' },
                { value: 'other', label: 'Other' }
            ],
            url: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'personal', label: 'Personal' },
                { value: 'blog', label: 'Blog' },
                { value: 'other', label: 'Other' }
            ],
            address: [
                { value: 'home', label: 'Home' },
                { value: 'work', label: 'Work' },
                { value: 'other', label: 'Other' }
            ],
            note: [] // Notes don't have types
        };

        return options[fieldType]?.map(option => 
            `<option value="${option.value}">${option.label}</option>`
        ).join('') || '';
    }

    /**
     * Get input type for field
     */
    getInputType(fieldType) {
        const types = {
            phone: 'tel',
            email: 'email',
            url: 'url'
        };
        return types[fieldType] || 'text';
    }

    /**
     * Get placeholder text for field
     */
    getPlaceholder(fieldType) {
        const placeholders = {
            phone: 'Phone number',
            email: 'Email address',
            url: 'Website URL'
        };
        return placeholders[fieldType] || '';
    }

    /**
     * Setup events for multi-field items
     */
    setupMultiFieldEvents(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        // Remove field buttons
        const removeButtons = container.querySelectorAll('.remove-field-btn');
        removeButtons.forEach(button => {
            // Remove existing listeners to avoid duplicates
            button.replaceWith(button.cloneNode(true));
        });

        // Re-add listeners
        const newRemoveButtons = container.querySelectorAll('.remove-field-btn');
        newRemoveButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.removeMultiField(e.target.closest('.multi-field-item'), fieldType);
            });
        });

        // Primary checkbox logic - only one can be checked
        const primaryCheckboxes = container.querySelectorAll(`input[name="${fieldType}Primary[]"]`);
        primaryCheckboxes.forEach(checkbox => {
            checkbox.replaceWith(checkbox.cloneNode(true));
        });

        const newPrimaryCheckboxes = container.querySelectorAll(`input[name="${fieldType}Primary[]"]`);
        newPrimaryCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    // Uncheck all other primary checkboxes for this field type
                    newPrimaryCheckboxes.forEach(cb => {
                        if (cb !== e.target) {
                            cb.checked = false;
                        }
                    });
                }
            });
        });

        // Update remove button states
        this.updateRemoveButtonStates(fieldType);
    }

    /**
     * Remove a multi-field item
     */
    removeMultiField(item, fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        // Don't allow removing the last item
        const items = container.querySelectorAll('.multi-field-item');
        if (items.length <= 1) {
            this.showToast({
                message: `At least one ${fieldType} field must remain`,
                type: 'error'
            });
            return;
        }

        item.remove();
        this.updateRemoveButtonStates(fieldType);
    }

    /**
     * Update remove button states (disable if only one item)
     */
    updateRemoveButtonStates(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        const items = container.querySelectorAll('.multi-field-item');
        const removeButtons = container.querySelectorAll('.remove-field-btn');

        removeButtons.forEach(button => {
            button.disabled = items.length <= 1;
        });
    }

    /**
     * Extract multi-field data from form
     */
    extractMultiFieldData(formData, fieldType) {
        // Special handling for address fields
        if (fieldType === 'address') {
            return this.extractAddressData(formData);
        }

        const values = formData.getAll(`${fieldType}[]`);
        const types = formData.getAll(`${fieldType}Type[]`);
        const checkedPrimaries = formData.getAll(`${fieldType}Primary[]`);

        // Get all field items to map their IDs to indices
        const container = document.getElementById(`${fieldType}-fields`);
        const fieldItems = container ? Array.from(container.querySelectorAll('.multi-field-item')) : [];

        const fieldData = [];
        values.forEach((value, index) => {
            if (value.trim()) {
                // Get the field ID for this index
                const fieldItem = fieldItems[index];
                const fieldId = fieldItem ? fieldItem.dataset.fieldId : null;
                
                // Check if this field is marked as primary
                const isPrimary = fieldId && checkedPrimaries.includes(fieldId);
                
                fieldData.push({
                    value: value.trim(),
                    type: types[index] || 'other',
                    primary: isPrimary
                });
            }
        });

        return fieldData;
    }

    /**
     * Extract address data from form
     */
    extractAddressData(formData) {
        const streets = formData.getAll('addressStreet[]');
        const cities = formData.getAll('addressCity[]');
        const states = formData.getAll('addressState[]');
        const postalCodes = formData.getAll('addressPostalCode[]');
        const countries = formData.getAll('addressCountry[]');
        const types = formData.getAll('addressType[]');
        const checkedPrimaries = formData.getAll('addressPrimary[]');

        // Get all field items to map their IDs to indices
        const container = document.getElementById('address-fields');
        const fieldItems = container ? Array.from(container.querySelectorAll('.multi-field-item')) : [];

        const addressData = [];
        streets.forEach((street, index) => {
            // At least street or city should be filled for a valid address
            if (street.trim() || cities[index]?.trim()) {
                // Get the field ID for this index
                const fieldItem = fieldItems[index];
                const fieldId = fieldItem ? fieldItem.dataset.fieldId : null;
                
                // Check if this field is marked as primary
                const isPrimary = fieldId && checkedPrimaries.includes(fieldId);
                
                addressData.push({
                    street: street.trim(),
                    city: (cities[index] || '').trim(),
                    state: (states[index] || '').trim(),
                    postalCode: (postalCodes[index] || '').trim(),
                    country: (countries[index] || '').trim(),
                    type: types[index] || 'home',
                    primary: isPrimary
                });
            }
        });

        return addressData;
    }

    /**
     * Extract notes data from form
     */
    extractNotesData(formData) {
        const notes = formData.getAll('note[]');
        return notes
            .filter(note => note.trim())
            .map(note => note.trim());
    }

    /**
     * Populate multi-field data in form (for editing)
     */
    populateMultiFieldData(fieldType, data) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container || !data || data.length === 0) {
            return;
        }

        // Clear existing items
        container.innerHTML = '';

        // Special handling for addresses
        if (fieldType === 'address') {
            this.populateAddressData(data);
            return;
        }

        // Add items for each data entry
        data.forEach((item, index) => {
            const fieldItem = this.createMultiFieldItem(fieldType);
            
            // Set values
            const typeSelect = fieldItem.querySelector(`select[name="${fieldType}Type[]"]`);
            const valueInput = fieldItem.querySelector(`input[name="${fieldType}[]"]`);
            const primaryCheckbox = fieldItem.querySelector(`input[name="${fieldType}Primary[]"]`);

            // Normalize and set type value to match available options
            if (typeSelect) {
                const normalizedType = this.normalizeFieldType(fieldType, item.type);
                typeSelect.value = normalizedType;
            }
            
            if (valueInput) valueInput.value = item.value || '';
            if (primaryCheckbox) primaryCheckbox.checked = item.primary || false;

            container.appendChild(fieldItem);
        });

        // If no data provided, add one empty field
        if (data.length === 0) {
            const fieldItem = this.createMultiFieldItem(fieldType);
            container.appendChild(fieldItem);
        }

        // Setup events
        this.setupMultiFieldEvents(fieldType);
    }

    /**
     * Populate address data specifically
     */
    populateAddressData(data) {
        const container = document.getElementById('address-fields');
        if (!container) {
            return;
        }

        // Clear existing items
        container.innerHTML = '';

        // Handle cases where data might be undefined or empty
        if (!data || !Array.isArray(data) || data.length === 0) {
            // Add one empty field if no data
            const fieldItem = this.createMultiFieldItem('address');
            container.appendChild(fieldItem);
            this.setupMultiFieldEvents('address');
            return;
        }

        console.log(`🏠 DEBUG: Processing ${data.length} addresses`);
        // Add items for each address
        data.forEach((address, index) => {
            const fieldItem = this.createMultiFieldItem('address');
            
            // Set address values
            const typeSelect = fieldItem.querySelector('select[name="addressType[]"]');
            const streetInput = fieldItem.querySelector('input[name="addressStreet[]"]');
            const cityInput = fieldItem.querySelector('input[name="addressCity[]"]');
            const stateInput = fieldItem.querySelector('input[name="addressState[]"]');
            const postalCodeInput = fieldItem.querySelector('input[name="addressPostalCode[]"]');
            const countryInput = fieldItem.querySelector('input[name="addressCountry[]"]');
            const primaryCheckbox = fieldItem.querySelector('input[name="addressPrimary[]"]');

            if (typeSelect) typeSelect.value = address.type || 'home';
            if (streetInput) streetInput.value = address.street || '';
            if (cityInput) cityInput.value = address.city || '';
            if (stateInput) stateInput.value = address.state || '';
            if (postalCodeInput) postalCodeInput.value = address.postalCode || '';
            if (countryInput) countryInput.value = address.country || '';
            if (primaryCheckbox) primaryCheckbox.checked = address.primary || false;

            container.appendChild(fieldItem);
        });

        // Setup events
        this.setupMultiFieldEvents('address');
    }

    /**
     * Populate notes data in form
     */
    populateNotesData(data) {
        const container = document.getElementById('note-fields');
        if (!container) return;

        // Clear existing items
        container.innerHTML = '';

        // Handle cases where data might be undefined or empty
        if (!data || !Array.isArray(data) || data.length === 0) {
            // Add one empty field if no data
            const fieldItem = this.createMultiFieldItem('note');
            container.appendChild(fieldItem);
            this.setupMultiFieldEvents('note');
            return;
        }

        // Add items for each note
        data.forEach((note, index) => {
            const fieldItem = this.createMultiFieldItem('note');
            
            // Set note value
            const textarea = fieldItem.querySelector('textarea[name="note[]"]');
            if (textarea) textarea.value = note || '';

            container.appendChild(fieldItem);
        });

        // Setup events
        this.setupMultiFieldEvents('note');
    }

    /**
     * Normalize field type to match available options in select
     */
    normalizeFieldType(fieldType, type) {
        if (!type) return 'other';
        
        // Convert to lowercase for comparison
        const normalizedType = type.toLowerCase();
        
        // Define mappings for each field type
        const typeMappings = {
            phone: {
                'work': 'work',
                'home': 'home',
                'mobile': 'mobile',
                'cell': 'mobile',  // Map 'cell' to 'mobile'
                'fax': 'fax',
                'voice': 'other',
                'text': 'other',
                'pager': 'other'
            },
            email: {
                'work': 'work',
                'home': 'home',
                'personal': 'personal',
                'internet': 'other'
            },
            url: {
                'work': 'work',
                'home': 'home',
                'personal': 'personal',
                'blog': 'blog'
            }
        };
        
        const mapping = typeMappings[fieldType];
        if (mapping && mapping[normalizedType]) {
            return mapping[normalizedType];
        }
        
        // Default fallback
        return 'other';
    }

    // ========== IMPORT/EXPORT METHODS ==========

    /**
     * Show import modal
     */
    showImportModal() {
        this.showModal({ modalId: 'import-modal' });
        this.resetImportForm();
    }

    /**
     * Show export modal
     */
    showExportModal() {
        this.showModal({ modalId: 'export-modal' });
        this.resetExportForm();
        this.updateExportPreview();
    }

    /**
     * Reset import form
     */
    resetImportForm() {
        if (this.elements.importForm) {
            this.elements.importForm.reset();
        }
        this.setImportModalState('form');
        this.clearImportFormErrors();
    }

    /**
     * Reset export form
     */
    resetExportForm() {
        if (this.elements.exportForm) {
            this.elements.exportForm.reset();
            // Set default filename
            if (this.elements.exportFilename) {
                this.elements.exportFilename.value = 'contacts';
            }
        }
        this.clearExportFormErrors();
    }

    /**
     * Set import modal state
     */
    setImportModalState(state) {
        const formContainer = this.elements.importForm?.parentElement;
        const loadingContainer = this.elements.importLoading;
        const successContainer = this.elements.importSuccess;
        
        // Hide all states
        if (formContainer) formContainer.style.display = 'none';
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (successContainer) successContainer.style.display = 'none';
        
        // Show requested state
        switch (state) {
            case 'form':
                if (formContainer) formContainer.style.display = 'block';
                break;
            case 'loading':
                if (loadingContainer) loadingContainer.style.display = 'block';
                break;
            case 'success':
                if (successContainer) successContainer.style.display = 'block';
                break;
        }
    }

    /**
     * Handle import form submission
     */
    async handleImportSubmit(event) {
        event.preventDefault();
        
        const fileInput = this.elements.importFile;
        const cardNameInput = this.elements.importCardName;
        const markAsImportedInput = this.elements.markAsImported;
        
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            this.showFieldError('import-file', 'Please select a vCard file');
            return;
        }
        
        const file = fileInput.files[0];
        const cardName = cardNameInput?.value?.trim() || null;
        const markAsImported = markAsImportedInput?.checked !== false; // Default to true if element not found
        
        // Validate file type
        if (!file.name.match(/\.(vcf|vcard)$/i)) {
            this.showFieldError('import-file', 'Please select a valid vCard file (.vcf or .vcard)');
            return;
        }
        
        this.clearImportFormErrors();
        this.setImportModalState('loading');
        
        try {
            // Read file content
            const fileContent = await this.readFileAsText(file);
            
            // Parse and import contacts
            const result = await this.importContactsFromVCard(fileContent, cardName, markAsImported);
            
            if (result.success) {
                this.showImportSuccess(result);
                this.performSearch(); // Refresh contact list
            } else {
                this.setImportModalState('form');
                this.showFieldError('import-file', result.error);
            }
            
        } catch (error) {
            console.error('Import failed:', error);
            this.setImportModalState('form');
            this.showFieldError('import-file', error.message || 'Failed to import contacts');
        }
    }

    /**
     * Import contacts from vCard content
     */
    async importContactsFromVCard(vCardContent, cardName, markAsImported = true) {
        try {
            // Split multiple vCards if present
            const vCardBlocks = this.splitVCardContent(vCardContent);
            
            if (vCardBlocks.length === 0) {
                throw new Error('No valid vCard data found in file');
            }
            
            const results = {
                imported: 0,
                failed: 0,
                duplicates: 0, // Track duplicates
                errors: [],
                duplicateDetails: [], // Store duplicate information
                photosFiltered: 0 // Track how many contacts had photos filtered
            };
            
            for (let i = 0; i < vCardBlocks.length; i++) {
                try {
                    const vCardString = vCardBlocks[i];
                    
                    // Use the provided card name only for single contact imports
                    const contactCardName = vCardBlocks.length === 1 ? cardName : null;
                    
                    // Import via ContactManager with duplicate detection
                    const saveResult = await this.contactManager.importContactFromVCard(vCardString, contactCardName, markAsImported);
                    
                    // Track if photos were filtered for this contact
                    if (saveResult.contact && saveResult.contact.metadata.photosFiltered) {
                        results.photosFiltered++;
                    }
                    
                    if (saveResult.success) {
                        results.imported++;
                        console.log(`✅ Imported contact: ${saveResult.contact ? saveResult.contact.cardName : 'Unknown'}`);
                    } else if (saveResult.isDuplicate) {
                        results.duplicates++;
                        
                        // Try to get the contact name from vCard for duplicate display
                        let contactName = 'New Contact';
                        try {
                            const tempContact = this.contactManager.vCardStandard.importFromVCard(vCardString, contactCardName, false);
                            const displayData = this.contactManager.vCardStandard.extractDisplayData(tempContact, true, true);
                            contactName = displayData.fullName || tempContact.cardName || 'New Contact';
                        } catch (e) {
                            // If we can't parse it, use generic name
                        }
                        
                        results.duplicateDetails.push({
                            contactName: contactName,
                            duplicateOf: saveResult.duplicateOf.cardName,
                            matchPercentage: saveResult.matchPercentage,
                            matchedFields: saveResult.matchedFields
                        });
                        console.log(`⚠️ Skipped duplicate: ${contactName} (${Math.round(saveResult.matchPercentage * 100)}% match with ${saveResult.duplicateOf.cardName})`);
                    } else {
                        results.failed++;
                        results.errors.push(`Contact ${i + 1}: ${saveResult.error}`);
                    }
                    
                } catch (error) {
                    results.failed++;
                    results.errors.push(`Contact ${i + 1}: ${error.message}`);
                    console.error(`❌ Failed to import contact ${i + 1}:`, error);
                }
            }
            
            // Trigger contacts update
            await this.contactManager.loadContacts();
            
            return {
                success: results.imported > 0 || results.duplicates > 0, // Success if we processed anything
                imported: results.imported,
                failed: results.failed,
                duplicates: results.duplicates,
                errors: results.errors,
                duplicateDetails: results.duplicateDetails,
                total: vCardBlocks.length,
                photosFiltered: results.photosFiltered // Include photo filtering info
            };
            
        } catch (error) {
            console.error('Error in importContactsFromVCard:', error);
            return {
                success: false,
                error: error.message || 'Failed to import contacts'
            };
        }
    }

    /**
     * Split vCard content into individual vCard blocks
     */
    splitVCardContent(vCardContent) {
        const blocks = [];
        const lines = vCardContent.split(/\r?\n/);
        let currentBlock = [];
        let inVCard = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine === 'BEGIN:VCARD') {
                inVCard = true;
                currentBlock = [line];
            } else if (trimmedLine === 'END:VCARD') {
                if (inVCard) {
                    currentBlock.push(line);
                    blocks.push(currentBlock.join('\n'));
                    currentBlock = [];
                    inVCard = false;
                }
            } else if (inVCard) {
                currentBlock.push(line);
            }
        }
        
        return blocks;
    }

    /**
     * Show import success state
     */
    showImportSuccess(result) {
        this.setImportModalState('success');
        
        if (this.elements.importSuccessMessage) {
            let successMessage = '';
            
            if (result.imported > 0) {
                successMessage += `Successfully imported ${result.imported} contact${result.imported !== 1 ? 's' : ''}`;
            }
            
            if (result.duplicates > 0) {
                if (successMessage) successMessage += ', ';
                successMessage += `skipped ${result.duplicates} duplicate${result.duplicates !== 1 ? 's' : ''}`;
            }
            
            // Add photo filtering info if applicable
            if (result.photosFiltered > 0) {
                successMessage += ` (photos filtered from ${result.photosFiltered} contact${result.photosFiltered !== 1 ? 's' : ''})`;
            }
            
            this.elements.importSuccessMessage.textContent = successMessage;
        }
        
        if (this.elements.importResults) {
            let resultsHtml = '';
            
            if (result.imported > 0) {
                resultsHtml += `<div class="import-stat success">
                    <i class="fas fa-check-circle"></i>
                    <span>${result.imported} imported successfully</span>
                </div>`;
            }
            
            // Show duplicate information
            if (result.duplicates > 0) {
                resultsHtml += `<div class="import-stat info">
                    <i class="fas fa-copy"></i>
                    <span>${result.duplicates} duplicate${result.duplicates !== 1 ? 's' : ''} skipped</span>
                </div>`;
                
                // Show duplicate details
                if (result.duplicateDetails && result.duplicateDetails.length > 0) {
                    resultsHtml += `<div class="duplicate-details">
                        <h5>Duplicates Found:</h5>
                        <ul>`;
                    result.duplicateDetails.forEach(dup => {
                        const matchFields = [];
                        if (dup.matchedFields.name) matchFields.push('name');
                        if (dup.matchedFields.phone) matchFields.push('phone');
                        if (dup.matchedFields.email) matchFields.push('email');
                        
                        resultsHtml += `<li>${this.escapeHtml(dup.contactName)} → similar to ${this.escapeHtml(dup.duplicateOf)} (${Math.round(dup.matchPercentage * 100)}% match: ${matchFields.join(', ')})</li>`;
                    });
                    resultsHtml += `</ul></div>`;
                }
            }
            
            // Show photo filtering information
            if (result.photosFiltered > 0) {
                resultsHtml += `<div class="import-stat warning">
                    <i class="fas fa-camera"></i>
                    <span>Photos removed from ${result.photosFiltered} contact${result.photosFiltered !== 1 ? 's' : ''} (file size optimization)</span>
                </div>`;
            }
            
            if (result.failed > 0) {
                resultsHtml += `<div class="import-stat error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${result.failed} failed to import</span>
                </div>`;
                
                if (result.errors.length > 0) {
                    resultsHtml += `<div class="import-errors">
                        <h5>Errors:</h5>
                        <ul>${result.errors.map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}</ul>
                    </div>`;
                }
            }
            
            this.elements.importResults.innerHTML = resultsHtml;
        }
        
        // Show success toast with duplicate and photo filtering info
        let toastMessage = '';
        
        if (result.imported > 0) {
            toastMessage += `Imported ${result.imported} contact${result.imported !== 1 ? 's' : ''}`;
        }
        
        if (result.duplicates > 0) {
            if (toastMessage) toastMessage += ', ';
            toastMessage += `skipped ${result.duplicates} duplicate${result.duplicates !== 1 ? 's' : ''}`;
        }
        
        if (result.photosFiltered > 0) {
            if (toastMessage) toastMessage += ' ';
            toastMessage += `(${result.photosFiltered} photo${result.photosFiltered !== 1 ? 's' : ''} filtered)`;
        }
        
        if (!toastMessage) {
            toastMessage = 'Import completed';
        }
        
        this.showToast({
            message: toastMessage,
            type: 'success'
        });
        
        // Auto-close after 4 seconds if no errors (longer to read duplicate info)
        if (result.failed === 0) {
            setTimeout(() => {
                this.hideModal({ modalId: 'import-modal' });
            }, 4000);
        }
    }

    /**
     * Handle export form submission
     */
    async handleExportSubmit(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const exportType = formData.get('exportType') || 'all';
        const exportFormat = formData.get('exportFormat') || 'standard';
        const filename = formData.get('filename')?.trim() || 'contacts';
        
        // Validate filename
        if (!filename) {
            this.showFieldError('export-filename', 'Filename is required');
            return;
        }
        
        this.clearExportFormErrors();
        
        try {
            // Get contacts to export based on type
            const contactsToExport = this.getContactsForExport(exportType);
            
            if (contactsToExport.length === 0) {
                this.showFieldError('export-filename', 'No contacts found to export');
                return;
            }
            
            // Generate and download vCard file based on format
            await this.exportContacts(contactsToExport, filename, exportFormat);
            
            // Show success and close modal
            const formatLabel = exportFormat === 'apple' ? 'Apple/iCloud vCard 3.0' : 'Standard vCard 4.0';
            this.showToast({
                message: `Exported ${contactsToExport.length} contact${contactsToExport.length !== 1 ? 's' : ''} as ${formatLabel}`,
                type: 'success'
            });
            
            this.hideModal({ modalId: 'export-modal' });
            
        } catch (error) {
            console.error('Export failed:', error);
            this.showFieldError('export-filename', error.message || 'Failed to export contacts');
        }
    }

    /**
     * Get contacts for export based on type
     */
    getContactsForExport(exportType) {
        const allContacts = Array.from(this.contactManager.contacts.values());
        
        switch (exportType) {
            case 'owned':
                return allContacts.filter(contact => 
                    contact.metadata.isOwned && !contact.metadata.isDeleted);
            
            case 'active':
                return allContacts.filter(contact => 
                    !contact.metadata.isArchived && !contact.metadata.isDeleted);
            
            case 'all':
            default:
                return allContacts.filter(contact => !contact.metadata.isDeleted);
        }
    }

    /**
     * Export contacts to vCard file
     */
    async exportContacts(contacts, filename, format = 'standard') {
        try {
            let vCardContent;
            let fileExtension = '.vcf';
            
            if (format === 'apple') {
                // Export as Apple/iCloud vCard 3.0 format
                console.log('🍎 Exporting as Apple/iCloud vCard 3.0 format');
                vCardContent = contacts
                    .map(contact => {
                        const appleExport = this.contactManager.vCardStandard.exportAsAppleVCard(contact);
                        return appleExport.content;
                    })
                    .join('\n\n');
                fileExtension = '_apple.vcf';
            } else {
                // Export as standard vCard 4.0 format
                console.log('📄 Exporting as Standard vCard 4.0 format');
                vCardContent = contacts
                    .map(contact => contact.vcard)
                    .join('\n\n');
            }
            
            // Create and download file
            const blob = new Blob([vCardContent], { type: 'text/vcard;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}${fileExtension}`;
            a.style.display = 'none';
            
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up
            URL.revokeObjectURL(url);
            
            console.log(`✅ Exported ${contacts.length} contacts to ${filename}${fileExtension} (${format} format)`);
            
        } catch (error) {
            console.error('Error exporting contacts:', error);
            throw new Error('Failed to create export file');
        }
    }

    /**
     * Update export preview
     */
    updateExportPreview() {
        if (!this.elements.exportContactCount) return;
        
        const formData = new FormData(this.elements.exportForm);
        const exportType = formData.get('exportType') || 'all';
        const exportFormat = formData.get('exportFormat') || 'standard';
        
        const contactsToExport = this.getContactsForExport(exportType);
        const count = contactsToExport.length;
        
        const formatInfo = exportFormat === 'apple' 
            ? '<span class="format-badge apple">🍎 Apple/iCloud 3.0</span>'
            : '<span class="format-badge standard">📄 Standard 4.0</span>';
        
        this.elements.exportContactCount.innerHTML = `
            <span class="count-number">${count}</span> contact${count !== 1 ? 's' : ''} will be exported as ${formatInfo}
        `;
    }

    /**
     * Read file as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Clear import form errors
     */
    clearImportFormErrors() {
        const errorElements = ['import-file-error', 'import-card-name-error'];
        errorElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '';
                element.style.display = 'none';
            }
        });
    }

    /**
     * Clear export form errors
     */
    clearExportFormErrors() {
        const errorElements = ['export-filename-error'];
        errorElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '';
                element.style.display = 'none';
            }
        });
    }

    /**
     * Show field error
     */
    showFieldError(fieldId, message) {
        const errorElement = document.getElementById(fieldId + '-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    // ========== PROFILE SHARING METHODS ==========

    /**
     * Show profile sharing modal
     */
    showProfileShareModal() {
        if (!this.currentUser) {
            this.showToast({ message: 'Please sign in to share your profile', type: 'error' });
            return;
        }

        const modal = this.elements.profileShareModal;
        if (!modal) {
            this.showToast({ message: 'Profile sharing modal not found', type: 'error' });
            return;
        }

        try {
            // Generate profile URL
            const profileURL = this.profileRouter.generateProfileURL(this.currentUser.username);
            
            // Update modal content
            if (this.elements.profileUsernameDisplay) {
                this.elements.profileUsernameDisplay.textContent = this.currentUser.username;
            }
            
            if (this.elements.profileShareUrl) {
                this.elements.profileShareUrl.value = profileURL;
            }

            // Setup profile sharing event listeners if not already done
            this.setupProfileSharingEventListeners();

            // Show modal
            modal.style.display = 'flex';

        } catch (error) {
            this.logError('Failed to show profile share modal:', error);
            this.showToast({ message: 'Failed to generate profile link', type: 'error' });
        }
    }

    /**
     * Setup profile sharing modal event listeners
     */
    setupProfileSharingEventListeners() {
        // Copy profile URL button
        if (this.elements.copyProfileUrlBtn && !this.elements.copyProfileUrlBtn._profileListenerAdded) {
            this.elements.copyProfileUrlBtn.addEventListener('click', this.copyProfileURL.bind(this));
            this.elements.copyProfileUrlBtn._profileListenerAdded = true;
        }

        // Share via email
        if (this.elements.shareViaEmail && !this.elements.shareViaEmail._profileListenerAdded) {
            this.elements.shareViaEmail.addEventListener('click', this.shareViaEmail.bind(this));
            this.elements.shareViaEmail._profileListenerAdded = true;
        }
    }

    /**
     * Copy profile URL to clipboard
     */
    async copyProfileURL() {
        if (!this.elements.profileShareUrl) return;
        
        try {
            await navigator.clipboard.writeText(this.elements.profileShareUrl.value);
            
            // Update button text temporarily
            const button = this.elements.copyProfileUrlBtn;
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i> Copied!';
            button.disabled = true;
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
            }, 2000);
            
        } catch (error) {
            this.logError('Failed to copy profile URL:', error);
            this.showToast({ message: 'Failed to copy link to clipboard', type: 'error' });
        }
    }

    /**
     * Share profile via email
     */
    shareViaEmail() {
        if (!this.currentUser) return;
        
        const profileMetadata = this.profileRouter.getProfileMetadata(this.currentUser.username);
        const subject = encodeURIComponent(`Connect with ${this.currentUser.username} on Contact Manager`);
        const body = encodeURIComponent(profileMetadata.shareText);
        
        window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    }

    /**
     * Clear profile state when user signs out
     */
    clearProfileState() {
        if (this.profileRouter.hasProfileLink()) {
            this.profileRouter.clearProfileState();
        }
    }

    // ========== REVOKE SHARING METHODS ==========

    /**
     * Handle revoke sharing action with confirmation
     */
    async handleRevokeSharing(contactId, username) {
        try {
            const contact = this.contactManager.getContact(contactId);
            if (!contact) {
                this.showToast({ 
                    message: 'Contact not found', 
                    type: 'error' 
                });
                return;
            }

            // Show confirmation dialog
            const confirmed = confirm(
                `Revoke Sharing\n\n` +
                `Are you sure you want to stop sharing "${contact.cardName}" with ${username}?\n\n` +
                `They will lose access immediately and the contact will be removed from their account.`
            );
            
            if (!confirmed) {
                return;
            }

            // Show loading state
            this.showToast({ 
                message: `Revoking sharing from ${username}...`, 
                type: 'info' 
            });
            
            // Revoke the sharing
            const result = await this.revokeContactSharing(contactId, username);
            
            if (result.success) {
                // Show success message
                this.showToast({ 
                    message: result.message || `Sharing revoked from ${username}`, 
                    type: 'success' 
                });
                
                // Refresh the contact detail view to update sharing info
                const updatedContact = this.contactManager.getContact(contactId);
                if (updatedContact && this.selectedContactId === contactId) {
                    this.displayContactDetail(updatedContact);
                }
                
                // Refresh the contact list to update sharing indicators
                this.refreshContactsList();
                
            } else {
                this.showToast({ 
                    message: `Failed to revoke sharing: ${result.error}`, 
                    type: 'error' 
                });
            }
            
        } catch (error) {
            console.error('❌ Error in handleRevokeSharing:', error);
            this.showToast({ 
                message: 'Failed to revoke sharing due to an unexpected error', 
                type: 'error' 
            });
        }
    }

    /**
     * Revoke contact sharing from a specific user using individual database strategy
     */
    async revokeContactSharing(contactId, username) {
        try {
            let contact = this.contactManager.getContact(contactId);
            if (!contact || !contact.metadata.isOwned) {
                throw new Error('Can only revoke sharing for contacts you own');
            }

            let sharing = contact.metadata.sharing;
            console.log(`🔍 Before revocation - sharing metadata:`, {
                sharedWithUsers: sharing?.sharedWithUsers,
                shareCount: sharing?.shareCount,
                isShared: sharing?.isShared
            });
            
            if (!sharing?.sharedWithUsers?.includes(username)) {
                return {
                    success: false,
                    error: `Contact is not shared with ${username}`
                };
            }

            // Use the individual database revocation method from ContactDatabase
            const result = await this.contactManager.database.revokeIndividualContactAccess(contactId, username);
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to revoke database access');
            }

            // 🔧 CRITICAL FIX: Get fresh contact data after database operation
            contact = this.contactManager.getContact(contactId);
            sharing = contact.metadata.sharing;

            // Update contact metadata to reflect revoked sharing
            const updatedSharing = {
                ...sharing,
                sharedWithUsers: sharing.sharedWithUsers.filter(u => u !== username)
            };
            
            // Remove the user's permissions
            if (updatedSharing.sharePermissions) {
                delete updatedSharing.sharePermissions[username];
            }
            
            // Update derived flags based on remaining users
            updatedSharing.isShared = updatedSharing.sharedWithUsers.length > 0;
            updatedSharing.shareCount = updatedSharing.sharedWithUsers.length;
            
            console.log(`🔍 After revocation - updated sharing metadata:`, {
                sharedWithUsers: updatedSharing.sharedWithUsers,
                shareCount: updatedSharing.shareCount,
                isShared: updatedSharing.isShared
            });

            // Add revocation tracking
            const revokedFrom = contact.metadata.revokedFrom || [];
            revokedFrom.push({
                username: username,
                revokedAt: new Date().toISOString(),
                revokedBy: this.currentUser?.username || 'unknown'
            });

            // Save updated contact metadata using ContactManager
            const updateResult = await this.contactManager.updateContactMetadata(contactId, {
                metadata: {
                    sharing: updatedSharing,
                    revokedFrom: revokedFrom,
                    lastUpdated: new Date().toISOString()
                }
            });

            if (!updateResult.success) {
                console.warn('⚠️ Database access revoked but metadata update failed:', updateResult.error);
            }

            return {
                success: true,
                message: `Sharing revoked from ${username}`,
                details: {
                    username: username,
                    revokedAt: new Date().toISOString(),
                    remainingShares: updatedSharing.sharedWithUsers.length,
                    databaseRevoked: result.success,
                    metadataUpdated: updateResult.success
                }
            };

        } catch (error) {
            console.error('❌ Failed to revoke sharing:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Bulk revoke contact sharing from multiple users (for distribution lists)
     */
    async bulkRevokeContactSharing(contactId, usernames) {
        try {
            const results = {
                success: 0,
                failed: 0,
                errors: [],
                details: []
            };
            
            // Process revocations in parallel for better performance
            const revokePromises = usernames.map(async (username) => {
                try {
                    const result = await this.revokeContactSharing(contactId, username);
                    if (result.success) {
                        results.success++;
                        results.details.push({ username, status: 'success', ...result.details });
                    } else {
                        results.failed++;
                        results.errors.push(`${username}: ${result.error}`);
                        results.details.push({ username, status: 'failed', error: result.error });
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push(`${username}: ${error.message}`);
                    results.details.push({ username, status: 'error', error: error.message });
                }
            });
            
            await Promise.all(revokePromises);
            
            return {
                success: results.success > 0,
                message: `Revoked from ${results.success} users${results.failed > 0 ? `, ${results.failed} failed` : ''}`,
                ...results
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}/* Cache bust: tor 18 sep 2025 08:55:36 CEST */
