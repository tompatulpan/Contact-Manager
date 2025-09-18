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
            contactList: document.getElementById('contact-list'), // Use the correct ID from HTML
            contactDetail: document.getElementById('contact-detail-content'), // Use the correct ID from HTML
            
            // Navigation elements
            navItems: document.querySelectorAll('.nav-item'),
            viewToggle: document.getElementById('view-toggle'),
            
            // Search and filter elements
            searchInput: document.getElementById('search-input'),
            filterBtn: document.getElementById('filter-btn'),
            filterDropdown: document.getElementById('filter-dropdown'),
            sortSelect: document.getElementById('sort-select'),
            
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
            shareLoading: document.getElementById('share-loading'),
            shareSuccess: document.getElementById('share-success'),
            sharedWithUser: document.getElementById('shared-with-user'),
            
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
        
        // Filter button toggle
        if (this.elements.filterBtn) {
            this.elements.filterBtn.addEventListener('click', this.toggleFilterDropdown.bind(this));
        }
        
        // Filter checkboxes
        const filterOwned = document.getElementById('filter-owned');
        const filterShared = document.getElementById('filter-shared');
        const filterArchived = document.getElementById('filter-archived');
        
        if (filterOwned) {
            filterOwned.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterShared) {
            filterShared.addEventListener('change', this.handleFilterChange.bind(this));
        }
        if (filterArchived) {
            filterArchived.addEventListener('change', this.handleFilterChange.bind(this));
        }
        
        if (this.elements.sortSelect) {
            this.elements.sortSelect.addEventListener('change', this.handleSortChange.bind(this));
        }
        
        // Distribution list events
        if (this.elements.createListBtn) {
            this.elements.createListBtn.addEventListener('click', this.showCreateListModal.bind(this));
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
        
        // Share form
        if (this.elements.shareForm) {
            this.elements.shareForm.addEventListener('submit', this.handleShareSubmit.bind(this));
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
     * Toggle filter dropdown visibility
     */
    toggleFilterDropdown() {
        if (!this.elements.filterDropdown) return;
        
        const isVisible = this.elements.filterDropdown.style.display === 'block';
        this.elements.filterDropdown.style.display = isVisible ? 'none' : 'block';
    }

    /**
     * Handle filter checkbox changes
     */
    handleFilterChange() {
        const filterOwned = document.getElementById('filter-owned');
        const filterShared = document.getElementById('filter-shared');
        const filterArchived = document.getElementById('filter-archived');
        
        // Build filters based on checkbox states
        const filters = {
            includeArchived: filterArchived?.checked || false,
            includeDeleted: false,
            distributionList: this.activeFilters.distributionList // Preserve distribution list filter
        };
        
        // Handle ownership filtering
        const ownedChecked = filterOwned?.checked || false;
        const sharedChecked = filterShared?.checked || false;
        
        if (ownedChecked && !sharedChecked) {
            filters.ownership = 'owned';
        } else if (!ownedChecked && sharedChecked) {
            filters.ownership = 'shared';
        }
        // If both or neither are checked, show all (no ownership filter)
        
        this.activeFilters = filters;
        console.log('🔧 Filter changed:', filters);
        this.performSearch();
    }

    /**
     * Perform contact search
     */
    performSearch() {
        console.log('🔍 UI: Performing search with query:', this.searchQuery, 'filters:', this.activeFilters);
        console.log('🔍 UI: Contact manager has', this.contactManager?.contacts?.size || 0, 'total contacts');
        
        const results = this.contactManager.searchContacts(this.searchQuery, this.activeFilters);
        console.log('🔍 UI: Search results:', results.length, 'contacts');
        
        const sortedResults = this.contactManager.sortContacts(results, this.getCurrentSort());
        console.log('🔍 UI: Sorted results:', sortedResults.length, 'contacts');
        
        this.displayContactList(sortedResults);
        this.updateStats();
    }

    /**
     * Refresh the contacts list by performing a new search
     */
    refreshContactsList() {
        console.log('🔄 UI: Refreshing contacts list');
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
        console.log('🎨 UI: Received contactsUpdated event with', data?.contactCount || 0, 'contacts');
        
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
     * Render distribution lists in the sidebar
     */
    async renderDistributionLists() {
        if (!this.elements.distributionListsContainer) return;

        try {
            const listStats = await this.contactManager.getDistributionListCounts();
            
            if (listStats.length === 0) {
                this.elements.distributionListsContainer.innerHTML = `
                    <div class="no-lists-message">
                        <p>No distribution lists yet</p>
                    </div>
                `;
                return;
            }

            const listItems = listStats.map(list => `
                <div class="distribution-list-item" data-list-name="${list.name}">
                    <span class="distribution-list-name">${list.name}</span>
                    <span class="distribution-list-count">${list.count}</span>
                </div>
            `).join('');

            // Add "All Contacts" option at the top
            const allContactsCount = this.contactManager.contacts.size;
            this.elements.distributionListsContainer.innerHTML = `
                <div class="distribution-list-item ${this.activeFilters.distributionList === null ? 'active' : ''}" 
                     data-list-name="">
                    <span class="distribution-list-name">All Contacts</span>
                    <span class="distribution-list-count">${allContactsCount}</span>
                </div>
                ${listItems}
            `;

            // Add click listeners to distribution list items
            const listElements = this.elements.distributionListsContainer.querySelectorAll('.distribution-list-item');
            listElements.forEach(element => {
                element.addEventListener('click', this.handleDistributionListClick.bind(this));
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
        
        console.log('🎨 Distribution list selected:', listName || 'All Contacts');
    }

    /**
     * Show create list modal (placeholder for Phase 2)
     */
    showCreateListModal() {
        this.showToast('Creating distribution lists will be available in Phase 2', 'info');
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
     * Display contact list
     */
    displayContactList(contacts) {
        console.log('🎨 DisplayContactList called with', contacts.length, 'contacts');
        const container = this.elements.contactCards;
        console.log('🎨 Container element:', container);
        
        if (!container) {
            console.error('❌ Contact cards container not found!');
            return;
        }
        
        // Clear existing contacts
        container.innerHTML = '';
        console.log('🎨 Container cleared');
        
        if (contacts.length === 0) {
            console.log('🎨 No contacts to display, showing empty state');
            this.showEmptyState();
            return;
        }
        
        console.log('🎨 Creating', contacts.length, 'contact cards...');
        // Create contact cards
        contacts.forEach((contact, index) => {
            console.log(`🎨 Creating card ${index + 1}:`, contact.cardName);
            const contactCard = this.createContactCard(contact);
            container.appendChild(contactCard);
        });
        
        console.log('🎨 Contact cards created and appended');
        // Update contact count
        this.updateContactCount(contacts.length);
        console.log('✅ DisplayContactList completed');
    }

    /**
     * Create contact card element
     */
    createContactCard(contact) {
        try {
            console.log('🎨 Creating contact card for:', {
                contactId: contact.contactId,
                cardName: contact.cardName,
                hasVCard: !!contact.vcard,
                vCardLength: contact.vcard ? contact.vcard.length : 'N/A',
                metadata: contact.metadata
            });
            
            if (!contact.vcard) {
                console.warn('⚠️ Contact has no vCard data, creating fallback card');
                return this.createFallbackContactCard(contact);
            }
            
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
                        ${!contact.metadata.isOwned ? `<span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span>` : ''}
                    </div>
                </div>
                <div class="contact-actions">
                    <button class="btn-icon view-contact" data-contact-id="${contact.contactId}" title="View contact">
                        <i class="icon-eye"></i>
                    </button>
                    ${contact.metadata.isOwned ? `
                        <button class="btn-icon share-contact" data-contact-id="${contact.contactId}" title="Share contact">
                            <i class="icon-share"></i>
                        </button>
                        <button class="btn-icon edit-contact" data-contact-id="${contact.contactId}" title="Edit contact">
                            <i class="icon-edit"></i>
                        </button>
                        <button class="btn-icon archive-contact" data-contact-id="${contact.contactId}" title="Archive contact">
                            <i class="icon-archive"></i>
                        </button>
                        <button class="btn-icon delete-contact" data-contact-id="${contact.contactId}" title="Delete contact">
                            <i class="icon-trash"></i>
                        </button>
                    ` : `
                        <button class="btn-icon archive-contact" data-contact-id="${contact.contactId}" title="Archive shared contact">
                            <i class="icon-archive"></i>
                        </button>
                    `}
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
            `<span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span>` : '';
        
        card.innerHTML = `
            <div class="contact-avatar">
                <span class="avatar-initial">?</span>
            </div>
            <div class="contact-info">
                <h3 class="contact-name">${this.escapeHtml(contactName)}</h3>
                <p class="contact-error">Invalid contact data</p>
                ${sharedInfo}
            </div>
            <div class="contact-actions">
                <button class="btn-icon view-contact" data-contact-id="${contact.contactId}" title="View raw data">
                    <i class="icon-eye"></i>
                </button>
            </div>
        `;
        
        return card;
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
            `<span class="shared-indicator">Shared by ${contact.metadata.sharedBy}</span>` : '';
        
        card.innerHTML = `
            <div class="contact-avatar">
                <span class="avatar-initial">?</span>
            </div>
            <div class="contact-info">
                <h3 class="contact-name">${this.escapeHtml(contactName)}</h3>
                <p class="contact-error">Invalid contact data</p>
                ${sharedInfo}
            </div>
            <div class="contact-actions">
                <button class="btn-icon view-contact" data-contact-id="${contact.contactId}" title="View raw data">
                    <i class="icon-eye"></i>
                </button>
            </div>
        `;
        
        return card;
    }

    /**
     * Attach event listeners to contact card buttons
     */
    attachContactCardListeners(card, contact) {
        console.log('🔗 Attaching listeners to contact card:', contact.contactId);
        
        // View contact button
        const viewBtn = card.querySelector('.view-contact');
        if (viewBtn) {
            console.log('🔗 Adding view button listener');
            viewBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('👁️ View button clicked for:', contact.contactId);
                this.selectContact(contact.contactId);
            });
        }

        // Edit contact button (only for owned contacts)
        const editBtn = card.querySelector('.edit-contact');
        if (editBtn) {
            console.log('🔗 Adding edit button listener');
            editBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('✏️ Edit button clicked for:', contact.contactId);
                this.showEditContactModal(contact.contactId);
            });
        }

        // Share contact button (only for owned contacts)
        const shareBtn = card.querySelector('.share-contact');
        if (shareBtn) {
            console.log('🔗 Adding share button listener');
            shareBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('📤 Share button clicked for:', contact.contactId);
                this.showShareContactModal(contact.contactId);
            });
        }

        // Delete contact button (only for owned contacts)
        const deleteBtn = card.querySelector('.delete-contact');
        if (deleteBtn) {
            console.log('🔗 Adding delete button listener');
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('🗑️ Delete button clicked for:', contact.contactId);
                this.showDeleteConfirmModal(contact.contactId);
            });
        }

        // Archive contact button (both owned and shared contacts)
        const archiveBtn = card.querySelector('.archive-contact');
        if (archiveBtn) {
            console.log('🔗 Adding archive button listener');
            archiveBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                console.log('📦 Archive button clicked for:', contact.contactId);
                this.archiveContact(contact.contactId);
            });
        }

        // Click on card to select (but not on buttons)
        card.addEventListener('click', (event) => {
            if (!event.target.closest('.contact-actions')) {
                console.log('🎯 Card clicked (not on button) for:', contact.contactId);
                this.selectContact(contact.contactId);
            }
        });
        
        console.log('✅ All listeners attached for contact card:', contact.contactId);
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
        
        // Populate contact preview
        this.populateShareContactPreview(contact);
        
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
     * Populate contact preview in share modal
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
    }

    /**
     * Set share modal state
     */
    setShareModalState(state) {
        const formContainer = document.getElementById('share-form-container');
        const loadingContainer = this.elements.shareLoading;
        const successContainer = this.elements.shareSuccess;
        
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
     * Handle share form submission
     */
    async handleShareSubmit(event) {
        event.preventDefault();
        
        if (!this.currentShareContact) {
            console.error('No contact selected for sharing');
            return;
        }
        
        // Get form data
        const formData = new FormData(event.target);
        const username = formData.get('username')?.trim();
        const isReadOnly = formData.get('readonly') === 'on';
        
        // Validate input
        if (!username) {
            this.showShareFormError('share-username', 'Username is required');
            return;
        }
        
        // Prevent sharing with self
        if (username === this.contactManager.database.currentUser?.username) {
            this.showShareFormError('share-username', 'You cannot share a contact with yourself');
            return;
        }
        
        console.log('🔄 Sharing contact with:', username, 'readonly:', isReadOnly);
        
        // Show loading state
        this.setShareModalState('loading');
        
        try {
            // Share via ContactManager/Database
            const result = await this.contactManager.database.shareContacts(username, isReadOnly, false);
            
            if (result.success) {
                // Update contact sharing metadata
                await this.updateContactSharingMetadata(this.currentShareContact.contactId, username, isReadOnly);
                
                // Show success state
                this.setShareModalState('success');
                if (this.elements.sharedWithUser) {
                    this.elements.sharedWithUser.textContent = username;
                }
                
                // Refresh contacts list to show sharing indicators
                this.refreshContactsList();
                
                console.log('✅ Contact shared successfully with:', username);
                
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
            this.showShareFormError('share-username', error.message || 'Failed to share contact');
        }
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
     * Show share form error
     */
    showShareFormError(fieldName, message) {
        const errorElement = document.getElementById(`${fieldName}-error`);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
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

            // Populate first phone number (simplified for now)
            if (displayData.phones.length > 0) {
                this.setFormFieldValue('phone', displayData.phones[0].value);
            } else {
                this.setFormFieldValue('phone', '');
            }

            // Populate first email (simplified for now)
            if (displayData.emails.length > 0) {
                this.setFormFieldValue('email', displayData.emails[0].value);
            } else {
                this.setFormFieldValue('email', '');
            }

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

        // Handle phone numbers (simplified - single phone for now)
        const phone = formData.get('phone');
        if (phone && phone.trim()) {
            contactData.phones = [{
                value: phone.trim(),
                type: 'other',
                primary: true
            }];
        } else {
            contactData.phones = [];
        }

        // Handle email addresses (simplified - single email for now)
        const email = formData.get('email');
        if (email && email.trim()) {
            contactData.emails = [{
                value: email.trim(),
                type: 'other',
                primary: true
            }];
        } else {
            contactData.emails = [];
        }

        // Initialize empty arrays for other fields
        contactData.urls = [];
        contactData.notes = [];

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
}/* Cache bust: tor 18 sep 2025 08:55:36 CEST */
