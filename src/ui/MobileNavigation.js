/**
 * Mobile Navigation Controller
 * Handles page-based navigation for mobile devices
 */
export class MobileNavigation {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.currentPage = 'contacts'; // Default to contact list
        this.pageHistory = ['contacts'];
        
        this.init();
    }

    init() {
        // Only initialize on mobile devices
        if (!this.isMobile()) return;

        
        // Set initial page state
        this.setActivePage('contacts');
        
        // Bind event handlers
        this.bindEvents();
        
        // Hide desktop elements
        this.hideDesktopElements();
    }

    isMobile() {
        return window.innerWidth <= 768;
    }

    bindEvents() {
        // Mobile menu button - show sidebar
        const menuBtn = document.getElementById('mobile-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', () => this.showMenu());
        }

        // Mobile back buttons
        const backMenuBtn = document.getElementById('mobile-back-menu');
        if (backMenuBtn) {
            backMenuBtn.addEventListener('click', () => this.goBack());
        }

        const backDetailBtn = document.getElementById('mobile-back-detail');
        if (backDetailBtn) {
            backDetailBtn.addEventListener('click', () => this.goBack());
        }

        // Mobile new contact button
        const newContactBtn = document.getElementById('mobile-new-contact');
        if (newContactBtn) {
            newContactBtn.addEventListener('click', () => {
                this.eventBus.emit('ui:show-contact-form', { isEdit: false });
            });
        }

        // Contact item clicks - show detail page
        this.eventBus.on('contact:selected', (data) => {
            if (this.isMobile()) {
                this.showContactDetail(data.contact);
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.isMobile() && !document.body.classList.contains('mobile-nav-active')) {
                document.body.classList.add('mobile-nav-active');
                this.setActivePage(this.currentPage);
            } else if (!this.isMobile() && document.body.classList.contains('mobile-nav-active')) {
                document.body.classList.remove('mobile-nav-active');
                this.showDesktopElements();
            }
        });
    }

    setActivePage(page) {
        if (!this.isMobile()) return;

        
        // Remove all page classes
        const sections = document.querySelectorAll('.left-sidebar, .contact-list-section, .contact-detail-section');
        sections.forEach(section => {
            section.classList.remove('page-active', 'page-previous');
        });

        // Set body class for mobile navigation
        document.body.classList.add('mobile-nav-active');
        document.body.className = document.body.className.replace(/mobile-page-\w+/g, '');
        document.body.classList.add(`mobile-page-${page}`);

        // Activate the current page
        let activeSection;
        switch (page) {
            case 'menu':
                activeSection = document.querySelector('.left-sidebar');
                break;
            case 'contacts':
                activeSection = document.querySelector('.contact-list-section');
                break;
            case 'detail':
                activeSection = document.querySelector('.contact-detail-section');
                break;
        }

        if (activeSection) {
            activeSection.classList.add('page-active');
        }

        this.currentPage = page;
    }

    showMenu() {
        // Only add to history if not already on menu page
        if (this.currentPage !== 'menu') {
            this.pageHistory.push('menu');
        }
        this.setActivePage('menu');
    }

    showContacts() {
        // Only add to history if not already on contacts page
        if (this.currentPage !== 'contacts') {
            this.pageHistory.push('contacts');
        }
        this.setActivePage('contacts');
    }

    showContactDetail(contact) {
        
        // Update mobile page title with contact name
        const titleElement = document.getElementById('mobile-contact-title');
        if (titleElement && contact) {
            titleElement.textContent = contact.cardName || 'Contact';
        }
        
        // Ensure contact detail content is visible
        const detailSection = document.querySelector('.contact-detail-section');
        if (detailSection) {
        } else {
        }
        
        // Check if there's actual content in the detail area
        const detailContent = document.getElementById('contact-detail-content');
        if (detailContent) {
        } else {
        }
        
        // Only add to history if not already on detail page
        if (this.currentPage !== 'detail') {
            this.pageHistory.push('detail');
        } else {
        }
        
        this.setActivePage('detail');
        
    }

    goBack() {
        
        if (this.pageHistory.length > 1) {
            this.pageHistory.pop(); // Remove current page
            const previousPage = this.pageHistory[this.pageHistory.length - 1];
            this.setActivePage(previousPage);
        } else {
            // Default back to contacts
            this.setActivePage('contacts');
            this.pageHistory = ['contacts'];
        }
    }

    hideDesktopElements() {
        // Hide desktop header
        const header = document.querySelector('.app-header');
        if (header) {
            header.style.display = 'none';
        }

        // Force mobile layout
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.classList.add('mobile-layout');
        }
    }

    showDesktopElements() {
        // Show desktop header
        const header = document.querySelector('.app-header');
        if (header) {
            header.style.display = '';
        }

        // Remove mobile layout
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.classList.remove('mobile-layout');
        }
    }

    // Update contact list to show only list view on mobile
    updateContactListForMobile() {
        if (!this.isMobile()) return;

        // Hide view toggle buttons on mobile
        const viewControls = document.querySelector('.view-controls');
        if (viewControls) {
            viewControls.style.display = 'none';
        }

        // Force list view
        const contactList = document.getElementById('contact-list');
        if (contactList) {
            contactList.classList.remove('card-view');
            contactList.classList.add('list-view');
        }

        // Update mobile page title based on current filters
        this.updateMobileTitle();
    }

    updateMobileTitle() {
        const titleElement = document.querySelector('.mobile-page-title');
        if (!titleElement || this.currentPage !== 'contacts') return;

        // Get current filter state
        const ownedChecked = document.getElementById('filter-owned')?.checked;
        const sharedChecked = document.getElementById('filter-shared')?.checked;
        const archivedChecked = document.getElementById('filter-archived')?.checked;

        let title = 'All Contacts';
        
        if (ownedChecked && !sharedChecked && !archivedChecked) {
            title = 'My Contacts';
        } else if (!ownedChecked && sharedChecked && !archivedChecked) {
            title = 'Shared with Me';
        } else if (archivedChecked && !ownedChecked && !sharedChecked) {
            title = 'Archived';
        } else if (ownedChecked && archivedChecked && !sharedChecked) {
            title = 'My Contacts + Archived';
        } else if (sharedChecked && archivedChecked && !ownedChecked) {
            title = 'Shared + Archived';
        }

        titleElement.textContent = title;
    }

    // Handle contact list updates for mobile
    handleContactListUpdate() {
        if (this.isMobile()) {
            this.updateContactListForMobile();
        }
    }

    // Handle search input on mobile
    setupMobileSearch() {
        if (!this.isMobile()) return;

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            // Prevent zoom on focus for iOS
            searchInput.setAttribute('autocomplete', 'off');
            searchInput.setAttribute('autocorrect', 'off');
            searchInput.setAttribute('autocapitalize', 'off');
            searchInput.setAttribute('spellcheck', 'false');
        }
    }
}