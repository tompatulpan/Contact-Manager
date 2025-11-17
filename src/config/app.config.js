/**
 * Application Configuration
 * Contains all application settings and constants
 */

// Application Version and Metadata
export const APP_CONFIG = {
    name: 'Contact Management System',
    version: '1.0.0',
    description: 'RFC 9553 compliant contact management with end-to-end encryption',
    author: 'Contact Management Team',
    
    // Build information (would be injected during build)
    build: {
        timestamp: new Date().toISOString(),
        environment: 'development'
    }
};

// Userbase Configuration
export const USERBASE_CONFIG = {
    // Replace with your actual Userbase App ID
    appId: '77e5016f-285d-4678-a31a-3718479a638a',
    
    // Database names
    databases: {
        contacts: 'contacts',
        settings: 'user-settings',
        activity: 'activity-log',
        sharedContactMeta: 'shared-contact-metadata',
        distributionSharing: 'distribution-sharing'
    },
    
    // Connection settings
    connectionTimeout: 10000,
    retryAttempts: 3
};

// Authentication Configuration
export const AUTH_CONFIG = {
    // Performance Thresholds (milliseconds)
    PERFORMANCE_THRESHOLDS: {
        ULTRA_FAST: 500,     // Session detection only
        FAST: 2000,          // Session detection + minimal setup
        NORMAL: 5000,        // Session detection + full database setup + contact loading
        SLOW: 8000           // Full authentication flow with retries
    },
    
    // Authentication Method Names
    METHODS: {
        EXISTING_SESSION: 'existing-session',
        DATABASE_INIT: 'database-init', 
        SESSION_RESTORE: 'session-restore',
        MANUAL_LOGIN: 'manual-login'
    },
    
    // Authentication Error Types
    ERRORS: {
        NOT_SIGNED_IN: 'Not signed in.',
        SDK_NOT_LOADED: 'Userbase SDK not loaded',
        SESSION_EXPIRED: 'Session expired',
        INIT_FAILED: 'Database initialization failed',
        NETWORK_ERROR: 'Network connection failed',
        INVALID_SESSION: 'Invalid session data'
    },
    
    // Session Storage Keys
    STORAGE_KEYS: {
        REMEMBER_ME: 'userbase-remember-me',
        SESSION_ONLY: 'userbase-session-only',
        PAGE_LOADED: 'userbase-page-loaded'
    }
};

// Contact Management Settings
export const CONTACT_CONFIG = {
    // Maximum limits
    maxContactsPerUser: 10000,
    maxPhoneNumbers: 10,
    maxEmailAddresses: 10,
    maxUrls: 5,
    maxNotes: 5,
    maxDistributionLists: 50,
    
    // Field length limits
    fieldLimits: {
        fullName: 255,
        cardName: 100,
        organization: 255,
        title: 255,
        note: 1000
    },
    
    // Default values
    defaults: {
        cardName: 'New Contact',
        phoneType: 'work',
        emailType: 'work',
        urlType: 'work'
    }
};

// UI Configuration
export const UI_CONFIG = {
    // Pagination
    itemsPerPage: 50,
    maxSearchResults: 100,
    
    // Debounce delays (ms)
    searchDebounce: 300,
    autoSaveDebounce: 1000,
    resizeDebounce: 250,
    
    // Animation durations (ms)
    fastAnimation: 150,
    normalAnimation: 300,
    slowAnimation: 500,
    
    // Toast notification duration
    toastDuration: 5000,
    
    // Theme settings
    theme: {
        default: 'light',
        options: ['light', 'dark', 'auto']
    },
    
    // View modes
    viewModes: ['card', 'list'],
    defaultViewMode: 'card',
    
    // Sort options
    sortOptions: [
        { value: 'name', label: 'Name' },
        { value: 'created', label: 'Created Date' },
        { value: 'updated', label: 'Updated Date' },
        { value: 'accessed', label: 'Last Accessed' }
    ],
    defaultSort: 'name'
};

// Feature Flags
export const FEATURE_FLAGS = {
    // Core features
    enableContactSharing: true,
    enableDistributionLists: true,
    enableQRCodeGeneration: true,
    enableVCardImportExport: true,
    enableContactArchiving: true,
    
    // Advanced features
    enableBulkOperations: true,
    enableAdvancedSearch: true,
    enableContactAnalytics: true,
    enableActivityLogging: true,
    enableRealTimeSync: true,
    
    // UI features
    enableDarkMode: true,
    enableResponsiveDesign: true,
    enableKeyboardShortcuts: true,
    enableAccessibility: true,
    
    // Development features
    enableDebugMode: false,
    enableTestMode: false,
    enablePerformanceMonitoring: false
};

// Performance Settings
export const PERFORMANCE_CONFIG = {
    // Caching
    searchCacheSize: 1000,
    vCardParseCache: 500,
    imageCacheSize: 100,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // INTERVAL TIMING STRATEGY
    // ═══════════════════════════════════════════════════════════════════════════
    // Order matters: Fast → Medium → Slow to prevent resource conflicts
    // Staggered start times prevent startup storms
    // Related operations grouped together for logical flow
    
    // ───────────────────────────────────────────────────────────────────────────
    // HIGH-FREQUENCY: Real-time operations (< 1 minute)
    // ───────────────────────────────────────────────────────────────────────────
    sharedDatabaseCheckInterval: 10000, // 10 sec - Check for new shared databases from other users
    sharedDatabaseCheckDelay: 15000, // 15 sec - Initial delay before monitoring starts (allow app initialization)
    autoSaveInterval: 30000, // 30 sec - Auto-save pending changes to prevent data loss
    statisticsUpdateInterval: 60000, // 1 min - Update contact counts, activity stats, UI metrics
    baikalHeartbeatInterval: 60000, // 1 min - Keep CardDAV connection alive with health check
    
    // ───────────────────────────────────────────────────────────────────────────
    // MEDIUM-FREQUENCY: Synchronization operations (5 minutes)
    // ───────────────────────────────────────────────────────────────────────────
    // NOTE: sharedContactsRefreshInterval and sharingValidationInterval run at SAME frequency
    //       but OFFSET by 2.5 minutes to distribute load and prevent simultaneous operations
    sharedContactsRefreshInterval: 300000, // 5 min - Force-refresh shared contacts from Userbase (ecosystem integrity)
    sharingValidationOffset: 150000, // 2.5 min - Offset for sharingValidationInterval (runs 2.5 min after refresh)
    sharingValidationInterval: 300000, // 5 min - Validate sharing relationships, repair broken shares (runs offset from refresh)
    maintenanceInterval: 300000, // 5 min - Database cleanup, cache optimization, expired data removal
    sharedContactFallbackDelay: 300000, // 5 min - Delay before fallback sync starts (avoid startup conflicts)
    
    // ───────────────────────────────────────────────────────────────────────────
    // LOW-FREQUENCY: External sync operations (30+ minutes)
    // ───────────────────────────────────────────────────────────────────────────
    // CardDAV bridge intervals - All synchronized to prevent conflict with Baikal server
    baikalPullInterval: 1800000, // 30 min - Sync FROM Baikal (import external edits from iPhone/Thunderbird)
    baikalPushInterval: 1800000, // 30 min - Push TO Baikal (export local changes to CardDAV server)
    baikalProtectionInterval: 1800000, // 30 min - Detect/correct unauthorized edits + refresh shared contacts to CardDAV
    sharedContactFallbackInterval: 3600000, // 60 min - Safety net: catch any dropped WebSocket updates for shared contacts
    
    // Memory management
    maxMemoryUsage: 100, // MB
    garbageCollectionThreshold: 1000 // number of operations
};

// Security Settings
export const SECURITY_CONFIG = {
    // Input validation
    enableInputSanitization: true,
    maxInputLength: 10000,
    
    // Content Security
    allowedProtocols: ['http:', 'https:', 'tel:', 'mailto:'],
    blockedDomains: [],
    
    // Rate limiting
    maxRequestsPerMinute: 100,
    maxSearchesPerMinute: 50,
    
    // Session management
    sessionTimeout: 3600000, // 1 hour
    maxSessions: 5
};

// Development Configuration
export const DEV_CONFIG = {
    // Logging
    enableLogging: true,
    logLevel: 'info', // debug, info, warn, error
    enableConsoleOutput: true,
    
    // Testing
    enableTestData: false,
    testDataSize: 10,
    
    // Debug features
    enableDevTools: true,
    enableHotReload: false,
    enableSourceMaps: true,
    
    // API endpoints for development
    mockApiDelay: 500,
    enableMockData: false
};

// Responsive Design Breakpoints
export const BREAKPOINTS = {
    mobile: 768,
    tablet: 1024,
    desktop: 1200,
    widescreen: 1400
};

// Error Messages
export const ERROR_MESSAGES = {
    // Authentication
    AUTH_REQUIRED: 'Authentication required. Please sign in.',
    INVALID_CREDENTIALS: 'Invalid username or password.',
    USER_EXISTS: 'Username already exists. Please choose another.',
    
    // Validation
    REQUIRED_FIELD: 'This field is required.',
    INVALID_EMAIL: 'Please enter a valid email address.',
    INVALID_PHONE: 'Please enter a valid phone number.',
    INVALID_URL: 'Please enter a valid URL.',
    
    // Contact operations
    CONTACT_NOT_FOUND: 'Contact not found.',
    CONTACT_CREATE_FAILED: 'Failed to create contact. Please try again.',
    CONTACT_UPDATE_FAILED: 'Failed to update contact. Please try again.',
    CONTACT_DELETE_FAILED: 'Failed to delete contact. Please try again.',
    
    // Database
    CONNECTION_ERROR: 'Unable to connect to the database. Please check your internet connection.',
    SYNC_ERROR: 'Synchronization failed. Your changes may not be saved.',
    
    // General
    NETWORK_ERROR: 'Network error. Please check your internet connection.',
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
    PERMISSION_DENIED: 'You do not have permission to perform this action.',
    RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait and try again.'
};

// Success Messages
export const SUCCESS_MESSAGES = {
    CONTACT_CREATED: 'Contact created successfully.',
    CONTACT_UPDATED: 'Contact updated successfully.',
    CONTACT_DELETED: 'Contact deleted successfully.',
    CONTACT_ARCHIVED: 'Contact archived successfully.',
    CONTACT_RESTORED: 'Contact restored successfully.',
    CONTACT_SHARED: 'Contact shared successfully.',
    CONTACT_EXPORTED: 'Contact exported successfully.',
    CONTACT_IMPORTED: 'Contact imported successfully.',
    SETTINGS_SAVED: 'Settings saved successfully.',
    SIGNED_IN: 'Signed in successfully.',
    SIGNED_OUT: 'Signed out successfully.'
};

// Default Contact Data Template
export const DEFAULT_CONTACT_TEMPLATE = {
    fn: '',
    cardName: '',
    organization: '',
    title: '',
    phones: [],
    emails: [],
    urls: [],
    birthday: '',
    notes: [],
    distributionLists: []
};

// Export all configurations as a single object for convenience
export const CONFIG = {
    app: APP_CONFIG,
    userbase: USERBASE_CONFIG,
    auth: AUTH_CONFIG,
    contact: CONTACT_CONFIG,
    ui: UI_CONFIG,
    features: FEATURE_FLAGS,
    performance: PERFORMANCE_CONFIG,
    security: SECURITY_CONFIG,
    dev: DEV_CONFIG,
    breakpoints: BREAKPOINTS,
    errors: ERROR_MESSAGES,
    success: SUCCESS_MESSAGES,
    templates: {
        defaultContact: DEFAULT_CONTACT_TEMPLATE
    }
};

// Utility function to get environment-specific config
export function getEnvironmentConfig() {
    const env = DEV_CONFIG.environment || 'development';
    
    const envConfigs = {
        development: {
            enableDebugMode: true,
            enableTestMode: true,
            enableLogging: true,
            logLevel: 'debug'
        },
        staging: {
            enableDebugMode: false,
            enableTestMode: false,
            enableLogging: true,
            logLevel: 'info'
        },
        production: {
            enableDebugMode: false,
            enableTestMode: false,
            enableLogging: false,
            logLevel: 'error'
        }
    };
    
    return envConfigs[env] || envConfigs.development;
}

export default CONFIG;