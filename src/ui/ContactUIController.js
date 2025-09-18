/**
 * ContactUIController - Main UI coordinator
 * Manages all UI components and handles user interactions
 */
export class ContactUIController {
    constructor(eventBus, contactManager) {
        this.eventBus = eventBus;
        this.contactManager = contactManager;
        
        // UI state
        this.currentUser = null;
        this.selectedContactId = null;
        this.currentView = 'contacts'; // contacts, archived, shared
        this.searchQuery = '';
        this.activeFilters = {};
        
        // Throttling for display updates
        this.displayUpdateTimeout = null;
        
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

    /**
     * Initialize the UI controller
     */
    async initialize() {
        try {
            console.log('🎨 Initializing UI Controller...');
            
            // Cache DOM elements
            this.cacheElements();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Initialize authentication state
            this.initializeAuthenticationState();
            
            // Setup UI components
            this.setupComponents();
            
            // Initialize responsive behavior
            this.initializeResponsiveDesign();
            
            console.log('✅ UI Controller initialized');
            
        } catch (error) {
            console.error('UI Controller initialization failed:', error);
            throw error;
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
            contactList: document.querySelector('.contact-list'),
            contactDetail: document.querySelector('.contact-detail'),
            
            // Navigation elements
            navItems: document.querySelectorAll('.nav-item'),
            viewToggle: document.getElementById('view-toggle'),
            
            // Search and filter elements
            searchInput: document.getElementById('search-input'),
            filterDropdown: document.getElementById('filter-dropdown'),
            sortSelect: document.getElementById('sort-select'),
            
            // Contact elements
            contactCards: document.getElementById('contact-list'), // Fixed: use correct element ID
            contactForm: document.getElementById('contact-form'),
            contactModal: document.getElementById('contact-modal'),
            
            // UI controls
            newContactBtn: document.getElementById('new-contact-btn'),
            userMenuBtn: document.getElementById('user-menu-btn'),
            userDropdown: document.getElementById('user-dropdown'),
            currentUserDisplay: document.getElementById('current-user'),
            logoutBtn: document.getElementById('logout-btn'),
            
            // Toast notifications
            toastContainer: document.getElementById('toast-container'),
            
            // Loading states
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingSpinner: document.querySelector('.loading-spinner'),
            
            // Stats elements
            contactCount: document.getElementById('contact-count'),
            statsContainer: document.querySelector('.stats')
        };
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
        
        // Contact events
        this.eventBus.on('contactManager:contactsUpdated', this.handleContactsUpdated.bind(this));
        this.eventBus.on('contact:created', this.handleContactCreated.bind(this));
        this.eventBus.on('contact:updated', this.handleContactUpdated.bind(this));
        this.eventBus.on('contact:deleted', this.handleContactDeleted.bind(this));
        this.eventBus.on('contacts:changed', this.handleContactsUpdated.bind(this));
        
        // UI events
        this.eventBus.on('ui:showToast', this.showToast.bind(this));
        this.eventBus.on('ui:showModal', this.showModal.bind(this));
        this.eventBus.on('ui:hideModal', this.hideModal.bind(this));
        this.eventBus.on('ui:updateStats', this.updateStats.bind(this));
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
        
        if (this.elements.sortSelect) {
            this.elements.sortSelect.addEventListener('change', this.handleSortChange.bind(this));
        }
        
        // Navigation
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', this.handleNavigation.bind(this));
        });
        
        // Contact actions
        if (this.elements.newContactBtn) {
            this.elements.newContactBtn.addEventListener('click', this.showNewContactModal.bind(this));
        }
        
        if (this.elements.userMenuBtn) {
            this.elements.userMenuBtn.addEventListener('click', this.toggleUserMenu.bind(this));
        }

        if (this.elements.logoutBtn) {
            this.elements.logoutBtn.addEventListener('click', this.handleSignOut.bind(this));
        }
        
        // Contact form
        if (this.elements.contactForm) {
            this.elements.contactForm.addEventListener('submit', this.handleContactSubmit.bind(this));
        }
        
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
    }

    /**
     * Setup window event listeners
     */
    setupWindowEventListeners() {
        window.addEventListener('resize', this.handleWindowResize);
        window.addEventListener('popstate', this.handlePopState.bind(this));
    }

    /**
     * Initialize authentication state
     */
    initializeAuthenticationState() {
        // Check if user is already authenticated
        const connectionStatus = this.contactManager.database.getConnectionStatus();
        
        console.log('🔍 Checking authentication state:', connectionStatus);
        
        if (connectionStatus.isAuthenticated) {
            console.log('✅ User already authenticated:', connectionStatus.currentUser);
            this.currentUser = { username: connectionStatus.currentUser };
            this.showMainApplication();
        } else {
            console.log('🔐 No authentication found, showing login modal');
            this.showAuthenticationModal();
        }
    }

    /**
     * Setup UI components
     */
    setupComponents() {
        // Components will be created when UI components are implemented
        // This is a placeholder for component initialization
        console.log('Setting up UI components...');
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
        
        const formData = new FormData(event.target);
        const username = formData.get('username');
        const password = formData.get('password');
        const isSignUp = event.target.dataset.mode === 'signup';
        
        // Show loading state
        this.showAuthLoading(true);
        this.clearAuthError();
        
        try {
            let result;
            if (isSignUp) {
                result = await this.contactManager.database.signUp(username, password);
            } else {
                result = await this.contactManager.database.signIn(username, password);
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
        if (data && data.user && data.user.username) {
            console.log('🎉 Authentication successful:', data.user.username);
            this.currentUser = data.user;
            this.updateUserInterface();
            this.hideAuthenticationModal();
            this.showMainApplication();
        } else {
            console.error('Invalid user data in authentication event:', data);
            this.showAuthError('Authentication failed - invalid user data');
        }
    }

    /**
     * Handle sign out
     */
    async handleSignOut() {
        try {
            const result = await this.contactManager.database.signOut();
            if (result.success) {
                this.currentUser = null;
                this.showAuthenticationModal();
                this.hideMainApplication();
            }
        } catch (error) {
            this.showToast({ message: 'Sign out failed', type: 'error' });
        }
    }

    /**
     * Handle signed out event
     */
    handleSignedOut() {
        this.currentUser = null;
        this.showAuthenticationModal();
        this.hideMainApplication();
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
        this.performSearch();
    }

    /**
     * Perform contact search
     */
    performSearch() {
        const results = this.contactManager.searchContacts(this.searchQuery, this.activeFilters);
        const sortedResults = this.contactManager.sortContacts(results, this.getCurrentSort());
        this.displayContactList(sortedResults);
        this.updateStats();
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
        // Throttle rapid consecutive updates during authentication
        if (this.displayUpdateTimeout) {
            clearTimeout(this.displayUpdateTimeout);
        }
        
        this.displayUpdateTimeout = setTimeout(() => {
            this.performSearch();
            this.updateStats();
            this.displayUpdateTimeout = null;
        }, 100); // 100ms delay to batch rapid updates
    }

    /**
     * Handle contact creation
     */
    handleContactCreated(data) {
        this.hideContactModal();
        this.performSearch();
        this.selectContact(data.contact.contactId);
    }

    /**
     * Handle contact updates
     */
    handleContactUpdated(data) {
        this.hideContactModal();
        this.performSearch();
        if (this.selectedContactId === data.contact.contactId) {
            this.displayContactDetail(data.contact);
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
     * Show new contact modal
     */
    showNewContactModal() {
        this.showModal({ modalId: 'contact-modal', mode: 'create' });
        this.resetContactForm();
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
     * Handle contact form submission
     */
    async handleContactSubmit(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const isEdit = event.target.dataset.mode === 'edit';
        const contactId = event.target.dataset.contactId;
        
        // Convert form data to contact data object
        const contactData = this.formDataToContactData(formData);
        
        // Show loading state
        this.showFormLoading(true);
        
        try {
            let result;
            if (isEdit && contactId) {
                result = await this.contactManager.updateContact(contactId, contactData);
            } else {
                result = await this.contactManager.createContact(contactData);
            }
            
            if (!result.success) {
                this.showFormError(result.error);
                if (result.validationErrors) {
                    this.highlightFormErrors(result.validationErrors);
                }
            }
            // Success is handled by event listeners
            
        } catch (error) {
            this.showFormError(error.message);
        }
        
        this.showFormLoading(false);
    }

    /**
     * Display contact list
     */
    displayContactList(contacts) {
        const container = this.elements.contactCards;
        if (!container) {
            console.error('❌ Contact list container not found!');
            return;
        }
        
        // Clear existing contacts
        container.innerHTML = '';
        
        if (contacts.length === 0) {
            this.showEmptyState();
            return;
        }
        
        // Create contact cards
        contacts.forEach(contact => {
            const contactCard = this.createContactCard(contact);
            container.appendChild(contactCard);
        });
        
        // Update contact count
        this.updateContactCount(contacts.length);
    }

    /**
     * Create contact card element
     */
    createContactCard(contact) {
        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
        
        const card = document.createElement('div');
        card.className = 'contact-card';
        card.dataset.contactId = contact.contactId;
        
        card.innerHTML = `
            <div class="contact-avatar">
                <span class="avatar-initial">${displayData.fullName.charAt(0).toUpperCase()}</span>
            </div>
            <div class="contact-info">
                <h3 class="contact-name">${this.escapeHtml(displayData.fullName)}</h3>
                <p class="contact-organization">${this.escapeHtml(displayData.organization)}</p>
                <p class="contact-title">${this.escapeHtml(displayData.title)}</p>
                <div class="contact-meta">
                    ${displayData.phones.length > 0 ? `<span class="contact-phone">${this.escapeHtml(displayData.phones[0].value)}</span>` : ''}
                    ${displayData.emails.length > 0 ? `<span class="contact-email">${this.escapeHtml(displayData.emails[0].value)}</span>` : ''}
                </div>
                <div class="contact-tags">
                    ${contact.metadata.distributionLists?.map(list => 
                        `<span class="tag">${this.escapeHtml(list)}</span>`
                    ).join('') || ''}
                    ${!contact.metadata.isOwned ? '<span class="tag tag-shared">Shared</span>' : ''}
                </div>
            </div>
            <div class="contact-actions">
                <button class="btn btn-icon edit-contact" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-icon delete-contact" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        // Add event listeners
        card.addEventListener('click', (event) => {
            if (!event.target.closest('.contact-actions')) {
                this.selectContact(contact.contactId);
            }
        });
        
        card.querySelector('.edit-contact').addEventListener('click', (event) => {
            event.stopPropagation();
            this.showEditContactModal(contact.contactId);
        });
        
        card.querySelector('.delete-contact').addEventListener('click', (event) => {
            event.stopPropagation();
            this.confirmDeleteContact(contact.contactId);
        });
        
        return card;
    }

    /**
     * Select and display contact details
     */
    async selectContact(contactId) {
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
        
        // Track access
        await this.contactManager.trackContactAccess(contactId);
    }

    /**
     * Display contact details
     */
    displayContactDetail(contact) {
        const container = this.elements.contactDetail;
        if (!container) return;
        
        const displayData = this.contactManager.vCardStandard.extractDisplayData(contact);
        
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
                <div class="contact-actions">
                    <button class="btn btn-primary edit-contact" data-contact-id="${contact.contactId}">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-secondary export-contact" data-contact-id="${contact.contactId}">
                        <i class="fas fa-download"></i> Export
                    </button>
                </div>
            </div>
            
            <div class="contact-detail-body">
                ${this.renderContactFields(displayData)}
                ${this.renderContactMetadata(contact)}
            </div>
        `;
        
        // Add event listeners for detail actions
        this.setupContactDetailListeners(container, contact.contactId);
    }

    /**
     * Render contact fields
     */
    renderContactFields(displayData) {
        let html = '';
        
        // Phone numbers
        if (displayData.phones.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-phone"></i> Phone Numbers</h4>
                    ${displayData.phones.map(phone => `
                        <div class="field-item">
                            <span class="field-value">${this.escapeHtml(phone.value)}</span>
                            <span class="field-type">${phone.type}</span>
                            ${phone.primary ? '<span class="field-primary">Primary</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        // Email addresses
        if (displayData.emails.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-envelope"></i> Email Addresses</h4>
                    ${displayData.emails.map(email => `
                        <div class="field-item">
                            <a href="mailto:${email.value}" class="field-value">${this.escapeHtml(email.value)}</a>
                            <span class="field-type">${email.type}</span>
                            ${email.primary ? '<span class="field-primary">Primary</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        // URLs
        if (displayData.urls.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-globe"></i> Websites</h4>
                    ${displayData.urls.map(url => `
                        <div class="field-item">
                            <a href="${url.value}" target="_blank" class="field-value">${this.escapeHtml(url.value)}</a>
                            <span class="field-type">${url.type}</span>
                            ${url.primary ? '<span class="field-primary">Primary</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        // Notes
        if (displayData.notes.length > 0) {
            html += `
                <div class="field-group">
                    <h4><i class="fas fa-sticky-note"></i> Notes</h4>
                    ${displayData.notes.map(note => `
                        <div class="field-item">
                            <p class="field-value">${this.escapeHtml(note)}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        return html;
    }

    /**
     * Render contact metadata
     */
    renderContactMetadata(contact) {
        const metadata = contact.metadata;
        
        return `
            <div class="metadata-section">
                <h4><i class="fas fa-info-circle"></i> Information</h4>
                <div class="metadata-grid">
                    <div class="metadata-item">
                        <span class="metadata-label">Created:</span>
                        <span class="metadata-value">${new Date(metadata.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Updated:</span>
                        <span class="metadata-value">${new Date(metadata.lastUpdated).toLocaleDateString()}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Type:</span>
                        <span class="metadata-value">${metadata.isOwned ? 'Owned' : 'Shared'}</span>
                    </div>
                    ${metadata.usage.accessCount > 0 ? `
                        <div class="metadata-item">
                            <span class="metadata-label">Views:</span>
                            <span class="metadata-value">${metadata.usage.accessCount}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Show authentication modal
     */
    showAuthenticationModal() {
        const modal = this.elements.authModal;
        if (modal) {
            modal.style.display = 'flex';
            console.log('✅ Authentication modal shown');
        } else {
            console.warn('⚠️ Authentication modal not found');
        }
    }

    /**
     * Hide authentication modal
     */
    hideAuthenticationModal() {
        const modal = this.elements.authModal;
        if (modal) {
            modal.style.display = 'none';
            console.log('✅ Authentication modal hidden');
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
    }

    /**
     * Update user interface with current user
     */
    updateUserInterface() {
        if (this.currentUser && this.elements.currentUserDisplay) {
            this.elements.currentUserDisplay.textContent = this.currentUser.username;
            console.log('✅ Updated user interface for:', this.currentUser.username);
        } else if (this.currentUser && !this.elements.currentUserDisplay) {
            console.warn('⚠️ Current user display element not found');
        }
    }

    /**
     * Show toast notification
     */
    showToast(data) {
        const { message, type = 'info' } = data;
        const container = this.elements.toastContainer;
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <span class="toast-message">${this.escapeHtml(message)}</span>
                <button class="toast-close" aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        container.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            this.removeToast(toast);
        }, 5000);
        
        // Add close button listener
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.removeToast(toast);
        });
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
        if (typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
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
        
        // Update UI with stats (removed the event emission to prevent infinite recursion)
        if (this.elements.statsContainer) {
            this.elements.statsContainer.innerHTML = `
                <div class="stat-item">
                    <span class="stat-value">${stats.active}</span>
                    <span class="stat-label">Active</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${stats.archived}</span>
                    <span class="stat-label">Archived</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${stats.shared}</span>
                    <span class="stat-label">Shared</span>
                </div>
            `;
        }
    }

    showEmptyState() {
        const container = this.elements.contactCards;
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-address-book"></i>
                    <h3>No contacts found</h3>
                    <p>Get started by adding your first contact</p>
                    <button class="btn btn-primary" onclick="document.getElementById('new-contact-btn').click()">
                        <i class="fas fa-plus"></i> Add Contact
                    </button>
                </div>
            `;
        }
    }

    clearContactDetail() {
        if (this.elements.contactDetail) {
            this.elements.contactDetail.innerHTML = `
                <div class="empty-detail">
                    <i class="fas fa-user"></i>
                    <p>Select a contact to view details</p>
                </div>
            `;
        }
        this.selectedContactId = null;
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

    resetContactForm() {
        const form = document.getElementById('contact-form');
        if (form) {
            form.reset();
            
            // Clear any error messages
            const errorElements = form.querySelectorAll('.field-error');
            errorElements.forEach(el => el.style.display = 'none');
            
            // Remove error classes from form fields
            const fieldElements = form.querySelectorAll('.field-error-highlight');
            fieldElements.forEach(el => el.classList.remove('field-error-highlight'));
            
            console.log('✅ Contact form reset');
        }
    }

    populateContactForm(contact) {
        console.log('Populate contact form:', contact);
    }

    formDataToContactData(formData) {
        // Convert form data to contact data format
        // This would be implemented based on the actual form structure
        return {
            fn: formData.get('fullName'),
            cardName: formData.get('cardName'),
            // ... other fields
        };
    }

    showFormLoading(show) {
        console.log('Show form loading:', show);
    }

    showFormError(error) {
        console.log('Show form error:', error);
    }

    highlightFormErrors(errors) {
        console.log('Highlight form errors:', errors);
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
        
        if (form && submitText && toggleText) {
            const isSignUp = form.dataset.mode === 'signup';
            
            if (isSignUp) {
                // Switch to sign in
                form.dataset.mode = 'signin';
                submitText.textContent = 'Sign In';
                toggleText.textContent = 'Need an account? Sign Up';
            } else {
                // Switch to sign up
                form.dataset.mode = 'signup';
                submitText.textContent = 'Sign Up';
                toggleText.textContent = 'Already have an account? Sign In';
            }
        }
    }

    confirmDeleteContact(contactId) {
        if (confirm('Are you sure you want to delete this contact?')) {
            this.contactManager.deleteContact(contactId);
        }
    }

    toggleUserMenu() {
        if (this.elements.userDropdown) {
            this.elements.userDropdown.classList.toggle('show');
        }
    }

    setupContactDetailListeners(container, contactId) {
        // Setup listeners for contact detail actions
    }

    handleModalBackdropClick(event) {
        // Close modal when clicking on backdrop (not on modal content)
        if (event.target.classList.contains('modal')) {
            const modalId = event.target.id;
            this.hideModal({ modalId });
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
    }
}/* Cache bust: tor 18 sep 2025 08:55:36 CEST */
