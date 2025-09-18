/**
 * TestHelpers - Utility functions for testing the contact management system
 * Provides mock data, test utilities, and helper functions
 */

/**
 * Generate mock contact data for testing
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock contact data
 */
export function generateMockContactData(overrides = {}) {
    const defaults = {
        fn: 'John Doe',
        cardName: 'John Doe - Work',
        organization: 'Tech Company Inc.',
        title: 'Software Developer',
        phones: [
            { value: '+1-555-123-4567', type: 'work', primary: true },
            { value: '+1-555-987-6543', type: 'mobile', primary: false }
        ],
        emails: [
            { value: 'john.doe@company.com', type: 'work', primary: true },
            { value: 'john@personal.com', type: 'home', primary: false }
        ],
        urls: [
            { value: 'https://company.com/john', type: 'work', primary: true },
            { value: 'https://johndoe.dev', type: 'personal', primary: false }
        ],
        birthday: '1985-03-15',
        notes: ['Important client contact', 'Prefers email communication'],
        distributionLists: ['work', 'clients']
    };

    const result = { ...defaults, ...overrides };
    
    // If name changed, also update related fields to avoid search conflicts
    if (overrides.fn && overrides.fn !== defaults.fn) {
        const firstName = overrides.fn.split(' ')[0].toLowerCase();
        const lastName = overrides.fn.split(' ')[1]?.toLowerCase() || 'user';
        
        // Update emails if not explicitly overridden
        if (!overrides.emails) {
            result.emails = [
                { value: `${firstName}.${lastName}@company.com`, type: 'work', primary: true },
                { value: `${firstName}@personal.com`, type: 'home', primary: false }
            ];
        }
        
        // Update URLs if not explicitly overridden
        if (!overrides.urls) {
            result.urls = [
                { value: `https://company.com/${firstName}`, type: 'work', primary: true },
                { value: `https://${firstName}${lastName}.dev`, type: 'personal', primary: false }
            ];
        }
    }

    return result;
}

/**
 * Generate mock vCard string
 * @param {Object} contactData - Contact data
 * @returns {string} Mock vCard string
 */
export function generateMockVCard(contactData = {}) {
    const data = generateMockContactData(contactData);
    
    let vcard = 'BEGIN:VCARD\n';
    vcard += 'VERSION:4.0\n';
    vcard += `FN:${data.fn}\n`;
    
    if (data.organization) {
        vcard += `ORG:${data.organization}\n`;
    }
    
    if (data.title) {
        vcard += `TITLE:${data.title}\n`;
    }
    
    if (data.phones) {
        data.phones.forEach(phone => {
            const params = phone.type ? `;TYPE=${phone.type}` : '';
            const pref = phone.primary ? ';PREF=1' : '';
            vcard += `TEL${params}${pref}:${phone.value}\n`;
        });
    }
    
    if (data.emails) {
        data.emails.forEach(email => {
            const params = email.type ? `;TYPE=${email.type}` : '';
            const pref = email.primary ? ';PREF=1' : '';
            vcard += `EMAIL${params}${pref}:${email.value}\n`;
        });
    }
    
    if (data.urls) {
        data.urls.forEach(url => {
            const params = url.type ? `;TYPE=${url.type}` : '';
            const pref = url.primary ? ';PREF=1' : '';
            vcard += `URL${params}${pref}:${url.value}\n`;
        });
    }
    
    if (data.birthday) {
        vcard += `BDAY:${data.birthday}\n`;
    }
    
    if (data.notes) {
        data.notes.forEach(note => {
            vcard += `NOTE:${note}\n`;
        });
    }
    
    vcard += `REV:${new Date().toISOString()}\n`;
    vcard += 'END:VCARD';
    
    return vcard;
}

/**
 * Generate mock contact object with full metadata
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock contact object
 */
export function generateMockContact(overrides = {}) {
    const contactData = generateMockContactData(overrides);
    const vcard = generateMockVCard(contactData);
    const now = new Date().toISOString();
    
    const defaults = {
        contactId: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        cardName: contactData.cardName,
        vcard,
        metadata: {
            createdAt: now,
            lastUpdated: now,
            isOwned: true,
            isArchived: false,
            isDeleted: false,
            isFavorite: false,
            isPinned: false,
            distributionLists: contactData.distributionLists || [],
            
            sharing: {
                isShared: false,
                shareCount: 0,
                sharedWithUsers: [],
                sharePermissions: {},
                shareHistory: []
            },
            
            usage: {
                accessCount: 0,
                lastAccessedAt: null,
                interactionHistory: []
            },
            
            sync: {
                version: 1,
                lastSyncedAt: now,
                hasUnresolvedConflicts: false
            }
        }
    };

    return { ...defaults, ...overrides };
}

/**
 * Generate multiple mock contacts
 * @param {number} count - Number of contacts to generate
 * @param {Object} baseOverrides - Base overrides to apply to all contacts
 * @returns {Array} Array of mock contacts
 */
export function generateMockContacts(count = 5, baseOverrides = {}) {
    const names = [
        { fn: 'John Doe', cardName: 'John Doe - Work', organization: 'Tech Corp', title: 'Developer' },
        { fn: 'Jane Smith', cardName: 'Jane Smith - Client', organization: 'Design Inc', title: 'Designer' },
        { fn: 'Mike Johnson', cardName: 'Mike Johnson - Personal', organization: 'Freelance', title: 'Consultant' },
        { fn: 'Sarah Wilson', cardName: 'Sarah Wilson - Work', organization: 'Marketing Ltd', title: 'Manager' },
        { fn: 'David Brown', cardName: 'David Brown - Friend', organization: 'Startup Co', title: 'Founder' },
        { fn: 'Lisa Davis', cardName: 'Lisa Davis - Family', organization: 'Hospital', title: 'Doctor' },
        { fn: 'Tom Anderson', cardName: 'Tom Anderson - Client', organization: 'Bank Corp', title: 'Analyst' },
        { fn: 'Amy White', cardName: 'Amy White - Work', organization: 'Law Firm', title: 'Lawyer' }
    ];

    const contacts = [];
    for (let i = 0; i < count; i++) {
        const nameData = names[i % names.length];
        const phoneNum = `+1-555-${(100 + i).toString().padStart(3, '0')}-${(1000 + i).toString().padStart(4, '0')}`;
        const email = `${nameData.fn.toLowerCase().replace(' ', '.')}@${nameData.organization.toLowerCase().replace(' ', '')}.com`;
        
        const overrides = {
            ...nameData,
            phones: [{ value: phoneNum, type: 'work', primary: true }],
            emails: [{ value: email, type: 'work', primary: true }],
            ...baseOverrides
        };
        
        contacts.push(generateMockContact(overrides));
    }
    
    return contacts;
}

/**
 * Create mock EventBus for testing
 */
export class MockEventBus {
    constructor() {
        this.events = new Map();
        this.emittedEvents = [];
    }

    on(eventName, callback) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }
        this.events.get(eventName).push(callback);
        
        return () => this.off(eventName, callback);
    }

    once(eventName, callback) {
        const unsubscribe = this.on(eventName, (...args) => {
            unsubscribe();
            callback(...args);
        });
        return unsubscribe;
    }

    off(eventName, callback) {
        if (this.events.has(eventName)) {
            const listeners = this.events.get(eventName);
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    emit(eventName, data) {
        this.emittedEvents.push({ eventName, data, timestamp: Date.now() });
        
        if (this.events.has(eventName)) {
            this.events.get(eventName).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Mock EventBus error in ${eventName}:`, error);
                }
            });
        }
    }

    clear() {
        this.events.clear();
        this.emittedEvents = [];
    }

    getEmittedEvents() {
        return [...this.emittedEvents];
    }

    getLastEmittedEvent(eventName) {
        const events = this.emittedEvents.filter(e => e.eventName === eventName);
        return events.length > 0 ? events[events.length - 1] : null;
    }
}

/**
 * Create mock Database for testing
 */
export class MockDatabase {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.isInitialized = false;
        this.currentUser = null;
        this.contacts = new Map();
        this.settings = {};
        this.activities = [];
        this.shouldFail = false;
        this.failureMessage = 'Mock database failure';
    }

    async initialize() {
        this.isInitialized = true;
        return { success: true, user: null };
    }

    async signUp(username, password) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        this.currentUser = { username, userId: `user_${Date.now()}` };
        return { success: true, user: this.currentUser };
    }

    async signIn(username, password) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        this.currentUser = { username, userId: `user_${Date.now()}` };
        return { success: true, user: this.currentUser };
    }

    async signOut() {
        this.currentUser = null;
        return { success: true };
    }

    async saveContact(contact) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        const itemId = contact.contactId || `item_${Date.now()}`;
        this.contacts.set(itemId, { ...contact, itemId });
        return { success: true, itemId };
    }

    async updateContact(contact) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        const itemId = contact.contactId || contact.itemId;
        this.contacts.set(itemId, contact);
        return { success: true, itemId };
    }

    async deleteContact(itemId) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        this.contacts.delete(itemId);
        return { success: true };
    }

    async logActivity(activity) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        const itemId = `activity_${Date.now()}`;
        this.activities.push({ ...activity, itemId, timestamp: new Date().toISOString() });
        return { success: true, itemId };
    }

    async saveSettings(settings) {
        if (this.shouldFail) {
            return { success: false, error: this.failureMessage };
        }
        
        this.settings = settings;
        return { success: true, itemId: 'settings' };
    }

    async updateSettings(settings) {
        return this.saveSettings(settings);
    }

    // Test utilities
    setFailureMode(shouldFail, message = 'Mock database failure') {
        this.shouldFail = shouldFail;
        this.failureMessage = message;
    }

    getContacts() {
        return Array.from(this.contacts.values());
    }

    getActivities() {
        return [...this.activities];
    }

    clear() {
        this.contacts.clear();
        this.activities = [];
        this.settings = {};
    }
}

/**
 * Validation test helpers
 */
export const ValidationTestHelpers = {
    /**
     * Valid test data for validation
     */
    validContactData: {
        fn: 'John Doe',
        cardName: 'John Doe - Test',
        phones: [{ value: '+1-555-123-4567', type: 'work', primary: true }],
        emails: [{ value: 'john@example.com', type: 'work', primary: true }],
        urls: [{ value: 'https://example.com', type: 'work', primary: true }],
        organization: 'Test Company',
        title: 'Test Title',
        birthday: '1990-01-01'
    },

    /**
     * Invalid test data for validation
     */
    invalidContactData: {
        fn: '', // Invalid: empty required field
        cardName: 'Test',
        phones: [{ value: 'invalid-phone', type: 'work', primary: true }],
        emails: [{ value: 'invalid-email', type: 'work', primary: true }],
        urls: [{ value: 'invalid-url', type: 'work', primary: true }],
        birthday: 'invalid-date'
    },

    /**
     * Edge case test data
     */
    edgeCaseContactData: {
        fn: 'A'.repeat(256), // Too long
        cardName: 'B'.repeat(101), // Too long
        phones: Array(15).fill({ value: '+1-555-123-4567', type: 'work' }), // Too many
        emails: Array(15).fill({ value: 'test@example.com', type: 'work' }), // Too many
        organization: 'C'.repeat(256), // Too long
        notes: ['D'.repeat(1001)] // Too long note
    }
};

/**
 * Performance test helpers
 */
export const PerformanceTestHelpers = {
    /**
     * Measure execution time of a function
     * @param {Function} fn - Function to measure
     * @param {...any} args - Function arguments
     * @returns {Promise<Object>} Result with execution time
     */
    async measureExecutionTime(fn, ...args) {
        const start = performance.now();
        const result = await fn(...args);
        const end = performance.now();
        
        return {
            result,
            executionTime: end - start,
            executionTimeMs: Math.round((end - start) * 100) / 100
        };
    },

    /**
     * Generate large dataset for performance testing
     * @param {number} size - Dataset size
     * @returns {Array} Large contact dataset
     */
    generateLargeDataset(size = 1000) {
        return generateMockContacts(size);
    },

    /**
     * Simulate slow network conditions
     * @param {number} delayMs - Delay in milliseconds
     * @returns {Promise} Promise that resolves after delay
     */
    async simulateNetworkDelay(delayMs = 1000) {
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }
};

/**
 * DOM test helpers for component testing
 */
export const DOMTestHelpers = {
    /**
     * Create a DOM element with attributes
     * @param {string} tagName - Element tag name
     * @param {Object} attributes - Element attributes
     * @param {string} textContent - Element text content
     * @returns {HTMLElement} Created element
     */
    createElement(tagName, attributes = {}, textContent = '') {
        const element = document.createElement(tagName);
        
        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, value);
        });
        
        if (textContent) {
            element.textContent = textContent;
        }
        
        return element;
    },

    /**
     * Create a container div for testing
     * @param {string} id - Container ID
     * @returns {HTMLElement} Container element
     */
    createContainer(id = 'test-container') {
        const container = this.createElement('div', { id, class: 'test-container' });
        document.body.appendChild(container);
        return container;
    },

    /**
     * Clean up test DOM elements
     * @param {string} selector - CSS selector for elements to remove
     */
    cleanup(selector = '.test-container') {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => element.remove());
    },

    /**
     * Simulate user input event
     * @param {HTMLElement} element - Target element
     * @param {string} value - Input value
     */
    simulateInput(element, value) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    },

    /**
     * Simulate click event
     * @param {HTMLElement} element - Target element
     */
    simulateClick(element) {
        element.dispatchEvent(new Event('click', { bubbles: true }));
    }
};

/**
 * vCard test helpers
 */
export const VCardTestHelpers = {
    /**
     * Sample RFC 9553 compliant vCard
     */
    sampleVCard: `BEGIN:VCARD
VERSION:4.0
FN:John Doe
ORG:Example Company
TITLE:Software Developer
TEL;TYPE=work;PREF=1:+1-555-123-4567
TEL;TYPE=mobile:+1-555-987-6543
EMAIL;TYPE=work;PREF=1:john.doe@example.com
EMAIL;TYPE=home:john@personal.com
URL;TYPE=work:https://example.com/john
BDAY:1985-03-15
NOTE:Important contact
REV:2025-01-20T10:00:00Z
END:VCARD`,

    /**
     * Invalid vCard for testing error handling
     */
    invalidVCard: `BEGIN:VCARD
VERSION:3.0
FN:Invalid Contact
INVALID_PROPERTY:test
END:VCARD`,

    /**
     * Minimal valid vCard
     */
    minimalVCard: `BEGIN:VCARD
VERSION:4.0
FN:Minimal Contact
END:VCARD`,

    /**
     * Complex vCard with multiple values
     */
    complexVCard: `BEGIN:VCARD
VERSION:4.0
FN:Complex Contact
TEL;TYPE=work;PREF=1:+1-555-111-1111
TEL;TYPE=home:+1-555-222-2222
TEL;TYPE=mobile:+1-555-333-3333
EMAIL;TYPE=work;PREF=1:work@example.com
EMAIL;TYPE=home:home@example.com
EMAIL;TYPE=other:other@example.com
URL;TYPE=work:https://work.example.com
URL;TYPE=personal:https://personal.example.com
NOTE:Note 1
NOTE:Note 2
END:VCARD`
};

/**
 * Export all test helpers
 */
export default {
    generateMockContactData,
    generateMockVCard,
    generateMockContact,
    generateMockContacts,
    MockEventBus,
    MockDatabase,
    ValidationTestHelpers,
    PerformanceTestHelpers,
    DOMTestHelpers,
    VCardTestHelpers
};