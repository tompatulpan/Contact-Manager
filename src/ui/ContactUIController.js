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
            
            // Clear contact detail to remove static welcome message
            this.clearContactDetail();

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
            console.log('📋 Create List button found, adding event listener');
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
        
        // Share type tabs
        const shareTypeTabs = document.querySelectorAll('.share-type-tab');
        shareTypeTabs.forEach(tab => {
            tab.addEventListener('click', this.handleShareTypeChange.bind(this));
        });
        
        // Distribution list select change
        if (this.elements.shareDistributionListSelect) {
            this.elements.shareDistributionListSelect.addEventListener('change', this.handleDistributionListSelectChange.bind(this));
        }
        
        // Create list form
        if (this.elements.createListForm) {
            this.elements.createListForm.addEventListener('submit', this.handleCreateListSubmit.bind(this));
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
            const distributionLists = await this.contactManager.getDistributionLists();
            
            if (distributionLists.length === 0) {
                this.elements.distributionListsContainer.innerHTML = `
                    <div class="no-lists-message">
                        <p>No distribution lists yet</p>
                    </div>
                `;
                return;
            }

            const listItems = distributionLists.map(list => {
                const userCount = list.usernames ? list.usernames.length : 0;
                return `
                    <div class="distribution-list-item" data-list-name="${this.escapeHtml(list.name)}">
                        <div class="list-item-content">
                            <span class="distribution-list-name" style="color: ${list.color || '#007bff'}">${this.escapeHtml(list.name)}</span>
                            <span class="distribution-list-count">${userCount}</span>
                        </div>
                        <div class="distribution-list-users">
                            <span class="user-count">${userCount} user${userCount !== 1 ? 's' : ''}</span>
                            <button class="manage-list-btn" data-list-name="${this.escapeHtml(list.name)}">Manage</button>
                        </div>
                    </div>
                `;
            }).join('');

            // Display sharing lists only (no "All Contacts" since these are for sharing)
            this.elements.distributionListsContainer.innerHTML = listItems;

            // Add click listeners for manage buttons
            const manageButtons = this.elements.distributionListsContainer.querySelectorAll('.manage-list-btn');
            manageButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering the list item click
                    const listName = button.dataset.listName;
                    this.openUsernameManagementModal(listName);
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
        
        console.log('🎨 Distribution list selected:', listName || 'All Contacts');
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
        
        // Hide loading indicator
        const loadingElement = document.getElementById('loading-indicator');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        // Clear existing contacts
        container.innerHTML = '';
        console.log('🎨 Container cleared');
        
        if (contacts.length === 0) {
            console.log('🎨 No contacts to display, showing empty state');
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
        
        // Populate distribution list selects
        setTimeout(() => this.populateDistributionListSelects(), 100);
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
        if (!this.elements.shareWithListSelect) return;
        
        try {
            const distributionLists = await this.contactManager.getDistributionLists();
            
            // Clear existing options (except the first placeholder)
            this.elements.shareWithListSelect.innerHTML = '<option value="">Choose a sharing list...</option>';
            
            if (distributionLists.length === 0) {
                this.elements.shareWithListSelect.innerHTML += '<option value="" disabled>No sharing lists created yet</option>';
                return;
            }
            
            // Add distribution list options
            distributionLists.forEach(list => {
                const option = document.createElement('option');
                option.value = list.name;
                option.textContent = `${list.name} (${list.userCount} users)`;
                this.elements.shareWithListSelect.appendChild(option);
            });
            
            // Add change listener to show preview
            this.elements.shareWithListSelect.addEventListener('change', (e) => {
                this.showShareListPreview(e.target.value);
            });
            
        } catch (error) {
            console.error('Error populating share-with-list dropdown:', error);
            this.elements.shareWithListSelect.innerHTML = '<option value="">Error loading lists</option>';
        }
    }

    /**
     * Show preview of users in selected sharing list
     */
    async showShareListPreview(listName) {
        if (!this.elements.shareListPreview || !this.elements.shareListUsers) return;
        
        if (!listName) {
            this.elements.shareListPreview.style.display = 'none';
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
        
        // Get usernames from the distribution list
        const usernames = await this.contactManager.getUsernamesInDistributionList(listName);
        
        if (usernames.length === 0) {
            this.showFieldError('share-with-distribution-list', 'This sharing list has no users');
            return;
        }
        
        console.log(`🔄 Sharing contact "${this.currentShareContact.cardName}" with ${usernames.length} users from "${listName}":`, usernames);
        
        // Show loading state
        this.setShareModalState('loading');
        
        try {
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            // Share contact with each user in the distribution list
            for (const username of usernames) {
                try {
                    // Skip sharing with self
                    if (username === this.contactManager.database.currentUser?.username) {
                        console.log(`⏭️ Skipping self-share with: ${username}`);
                        continue;
                    }
                    
                    console.log(`📤 Sharing with user: ${username}`);
                    const result = await this.contactManager.shareContactWithUser(
                        this.currentShareContact.contactId, 
                        username, 
                        isReadOnly
                    );
                    
                    if (result.success) {
                        successCount++;
                        console.log(`✅ Successfully shared with: ${username}`);
                    } else {
                        errorCount++;
                        errors.push(`${username}: ${result.error}`);
                        console.error(`❌ Failed to share with ${username}:`, result.error);
                    }
                } catch (error) {
                    errorCount++;
                    errors.push(`${username}: ${error.message}`);
                    console.error(`❌ Error sharing with ${username}:`, error);
                }
            }
            
            // Show results
            if (successCount > 0 && errorCount === 0) {
                // Complete success
                this.setShareModalState('success', {
                    title: 'Contact Shared Successfully!',
                    message: `Your contact was shared with all ${successCount} users in "${listName}".`,
                    details: usernames.map(u => `✅ ${u}`).join('\n')
                });
                
                // Update contact metadata
                await this.contactManager.updateContactMetadata(this.currentShareContact.contactId, {
                    lastSharedAt: new Date().toISOString(),
                    sharedWith: [...(this.currentShareContact.metadata?.sharedWith || []), ...usernames]
                });
                
            } else if (successCount > 0 && errorCount > 0) {
                // Partial success
                this.setShareModalState('warning', {
                    title: 'Partially Shared',
                    message: `Shared with ${successCount} users, but ${errorCount} failed.`,
                    details: `Errors:\n${errors.join('\n')}`
                });
                
            } else {
                // Complete failure
                this.setShareModalState('error', {
                    title: 'Sharing Failed',
                    message: `Failed to share with any users in "${listName}".`,
                    details: `Errors:\n${errors.join('\n')}`
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
            
            // Share each contact in the distribution list
            for (const contact of contacts) {
                try {
                    // Set current contact for sharing
                    this.currentShareContact = contact;
                    
                    // Share via ContactManager/Database
                    const result = await this.contactManager.database.shareContacts(username, isReadOnly, false);
                    
                    if (result.success) {
                        // Update contact sharing metadata
                        await this.updateContactSharingMetadata(contact.contactId, username, isReadOnly);
                        successCount++;
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
            const listItem = event.target.closest('.distribution-list-item');
            const listName = listItem?.dataset.listName;
            
            if (listName !== undefined) {
                this.filterByDistributionList(listName);
            }
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
    filterByDistributionList(listName) {
        // Update active filter
        this.activeFilters.distributionList = listName || null;
        
        // Update UI state
        document.querySelectorAll('.distribution-list-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeItem = document.querySelector(`.distribution-list-item[data-list-name="${listName || ''}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
        
        // Apply filter
        this.refreshContactsList();
        
        // Show appropriate message
        const listDisplayName = listName || 'All Contacts';
        this.showToast({ 
            message: `Showing: ${listDisplayName}`, 
            type: 'info' 
        });
    }

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
                this.showToast({ 
                    message: `Added "${username}" to distribution list`, 
                    type: 'success' 
                });
                
                // Refresh distribution lists in sidebar
                this.renderDistributionLists();
            } else {
                this.showToast({ 
                    message: result.error || 'Failed to add username', 
                    type: 'error' 
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
}/* Cache bust: tor 18 sep 2025 08:55:36 CEST */
