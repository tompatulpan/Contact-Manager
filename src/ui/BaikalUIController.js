/**
 * Baikal UI Controller
 * Manages UI interactions for Baikal CardDAV integration
 */
import { BaikalURLHelper } from '../integrations/BaikalURLHelper.js';
import { CredentialStorageUI } from './CredentialStorageUI.js';

export class BaikalUIController {
    constructor(eventBus, baikalConnector, configManager, contactManager, iCloudConnector = null) {
        this.eventBus = eventBus;
        this.baikalConnector = baikalConnector;
        this.configManager = configManager;
        this.contactManager = contactManager; // ⭐ Add ContactManager reference
        this.iCloudConnector = iCloudConnector; // 🍎 Add ICloudConnector reference
        
        // 🔐 Initialize Secure Credential Storage
        this.credentialUI = new CredentialStorageUI(eventBus);
        
        // UI state
        this.isModalOpen = false;
        this.currentEditingProfile = null;
        this.syncStatus = new Map(); // Track sync status per profile
        this.isPushing = false; // ⭐ Prevent duplicate push operations
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupBaikalConnectorCallbacks();
    }

    /**
     * Initialize Baikal UI components
     */
    async initialize() {
        // 🔐 Initialize credential storage (detects private browsing)
        await this.credentialUI.initialize();
        
        // Ensure modal exists in DOM before wiring events
        try {
            this.createBaikalModal();
        } catch (e) {
            console.warn('⚠️ Failed to create Baikal modal at init:', e);
        }

        await this.configManager.loadConfigurations();
        await this.loadExistingConfigurations(); // Load profiles into UI first
        this.createSyncStatusWidget(); // Create the Baikal UI button (resilient insertion)
        // this.setupEventListeners(); // ❌ REMOVED: Already called in constructor - prevents duplicate listeners
        this.setupTabSwitching(); // Setup tab switching
        await this.autoConnectSavedProfiles();
        console.log('🔌 Baikal UI Controller initialized');
    }

    /**
     * Auto-connect saved profiles on startup
     */
    async autoConnectSavedProfiles() {
        try {
            // Safety check: ensure configManager is available
            if (!this.configManager) {
                console.warn('⚠️ BaikalConfigManager not available, skipping auto-connect');
                return;
            }

            // Load configurations first, then get them
            await this.configManager.loadConfigurations();
            const configurations = this.configManager.getAllConfigurations();
            
            console.log('🔍 DEBUG: Raw configurations:', configurations);
            console.log('🔍 DEBUG: Configurations type:', typeof configurations);
            console.log('🔍 DEBUG: Configurations length:', configurations?.length);
            
            if (!configurations || configurations.length === 0) {
                console.log('📋 No saved Baikal configurations found, skipping auto-connect');
                return;
            }
            
            console.log(`🔗 Auto-connecting ${configurations.length} saved profile(s)...`);
            
            for (const config of configurations) {
                if (config.autoConnect !== false) { // Default to auto-connect unless explicitly disabled
                    console.log(`🔗 Auto-connecting to saved profile: ${config.profileName}`);
                    
                    try {
                        let password = null;
                        let credentialSource = null;
                        
                        // 🔐 STRATEGY 1: Try simple localStorage password first (from storePassword method)
                        const storageKey = `baikal_password_${config.profileName}`;
                        console.log(`🔍 DEBUG: Checking localStorage key: ${storageKey}`);
                        
                        password = this.getStoredPassword(config.profileName);
                        console.log(`🔍 DEBUG: getStoredPassword returned:`, password ? '***found***' : 'null');
                        
                        if (password) {
                            credentialSource = 'localStorage (simple)';
                            console.log(`✅ Found saved password for ${config.profileName} (source: ${credentialSource})`);
                        }
                        
                        // 🔐 STRATEGY 2: Fallback to secure credential storage
                        if (!password) {
                            console.log(`🔍 DEBUG: Trying SecureCredentialStorage for ${config.profileName}...`);
                            const storedCreds = await this.credentialUI.getStoredCredentials(config.profileName);
                            console.log(`🔍 DEBUG: SecureCredentialStorage result:`, storedCreds);
                            
                            if (storedCreds.success && storedCreds.credentials.password) {
                                password = storedCreds.credentials.password;
                                credentialSource = `SecureCredentialStorage (${storedCreds.method})`;
                                console.log(`✅ Found saved credentials for ${config.profileName} (source: ${credentialSource})`);
                            }
                        }
                        
                        // No password found in either storage
                        if (!password) {
                            // List all localStorage keys for debugging
                            const allKeys = Object.keys(localStorage);
                            const baikalKeys = allKeys.filter(k => k.includes('baikal'));
                            console.log(`🔍 DEBUG: All baikal-related localStorage keys:`, baikalKeys);
                            
                            console.warn(`⚠️ No saved credentials for ${config.profileName} - skipping auto-connect`);
                            console.log(`💡 User will need to reconnect to save credentials`);
                            continue;
                        }
                        
                        // Build config with retrieved credentials
                        const configWithPassword = {
                            ...config,
                            password: password
                        };
                        
                        const result = await this.baikalConnector.connectToServer(configWithPassword);
                        if (result.success) {
                            console.log(`✅ Auto-connected to ${config.profileName}`);
                            
                            // 🆕 Start auto-sync with 15-minute intervals
                            try {
                                const autoSyncResult = await this.baikalConnector.initializeAutoSync(config.profileName);
                                if (autoSyncResult.success) {
                                    console.log(`🔄 Auto-sync started for ${config.profileName} (15-minute intervals)`);
                                }
                            } catch (autoSyncError) {
                                console.warn(`⚠️ Auto-sync error for ${config.profileName}:`, autoSyncError.message);
                            }
                        } else {
                            console.warn(`⚠️ Auto-connect failed for ${config.profileName}: ${result.error}`);
                        }
                    } catch (error) {
                        console.warn(`⚠️ Auto-connect error for ${config.profileName}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Auto-connect failed:', error);
        }
    }

    /**
     * Setup event listeners for UI interactions
     */
    setupEventListeners() {
        // 🛡️ Prevent duplicate event listener setup
        if (this.eventListenersSetup) {
            console.log('⚠️ Event listeners already setup, skipping duplicate setup');
            return;
        }
        this.eventListenersSetup = true;
        
        // Settings button click (we'll create this)
        document.addEventListener('click', (e) => {
            if (e.target.matches('#baikal-settings-btn') || e.target.closest('#baikal-settings-btn')) {
                e.preventDefault();
                this.openBaikalModal();
            }
        });

        // Sync now button click
        document.addEventListener('click', (e) => {
            if (e.target.matches('#sync-baikal-now') || e.target.closest('#sync-baikal-now')) {
                e.preventDefault();
                this.syncAllProfilesNow();
            }
        });

        // Modal form submission
        document.addEventListener('submit', (e) => {
            if (e.target.matches('#baikal-connection-form')) {
                e.preventDefault();
                this.handleConnectionFormSubmit(e);
            }
        });

        // Real-time URL validation
        document.addEventListener('input', (e) => {
            if (e.target.matches('#baikal-server-url')) {
                this.validateServerURL(e.target.value);
            }
        });

        // Modal close events
        document.addEventListener('click', (e) => {
            if (e.target.matches('#close-baikal-modal') || e.target.closest('#close-baikal-modal')) {
                this.closeBaikalModal();
            }
            
            if (e.target.matches('#baikal-modal') && e.target.classList.contains('modal')) {
                this.closeBaikalModal();
            }
        });

        // Profile management buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('.baikal-profile-edit')) {
                const profileName = e.target.dataset.profile;
                this.editProfile(profileName);
            }
            
            if (e.target.matches('.baikal-profile-delete')) {
                const profileName = e.target.dataset.profile;
                this.deleteProfile(profileName);
            }
            
            if (e.target.matches('.baikal-profile-disconnect')) {
                const profileName = e.target.dataset.profile;
                this.disconnectProfile(profileName);
            }
            
            if (e.target.matches('.baikal-profile-sync')) {
                const profileName = e.target.dataset.profile;
                this.syncProfile(profileName);
            }
            
            if (e.target.matches('.baikal-profile-push')) {
                const profileName = e.target.dataset.profile;
                this.pushAllContactsToProfile(profileName);
            }
            
            if (e.target.matches('.baikal-profile-test')) {
                const profileName = e.target.dataset.profile;
                this.testProfile(profileName);
            }
        });

        // 🆕 Event bus listeners for Baikal contact handling
        this.eventBus.on('baikal:contactsReceived', async (data) => {
            const { contacts, profileName } = data;
            console.log(`📥 Received ${contacts.length} contacts from Baikal profile: ${profileName}`);
            await this.handleReceivedContacts(contacts, profileName);
        });
        
        // 🔐 Listen for logout events to clear stored passwords
        this.eventBus.on('auth:logout', (data) => {
            console.log(`🔐 Logout detected (${data.reason}), clearing CardDAV/iCloud passwords`);
            this.clearAllStoredPasswords();
        });
    }

    /**
     * Setup callbacks for BaikalConnector events
     */
    setupBaikalConnectorCallbacks() {
        this.baikalConnector.onStatusChange = (statusInfo) => {
            this.updateSyncStatus(statusInfo.profileName, {
                status: statusInfo.status,
                timestamp: statusInfo.timestamp,
                isConnected: statusInfo.isConnected
            });
        };

        // ❌ REMOVED: Duplicate callback handler - use EventBus only
        // this.baikalConnector.onContactsReceived = (contacts, profileName) => {
        //     this.handleReceivedContacts(contacts, profileName);
        // };

        this.baikalConnector.onError = (errorInfo) => {
            this.showNotification(`Baikal error: ${errorInfo.error}`, 'error');
        };
    }

    /**
     * Create Baikal settings modal
     */
    createBaikalModal() {
        // Avoid inserting modal multiple times
        if (document.getElementById('baikal-modal')) {
            console.log('🔍 DEBUG: Baikal modal already exists, skipping creation');
            return;
        }

        const modalHTML = `
            <div id="baikal-modal" class="modal">
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h2>CardDAV Integration</h2>
                        <button id="close-baikal-modal" class="modal-close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="baikal-modal-tabs">
                            <button class="baikal-tab active" data-tab="connection">Connection</button>
                            <button class="baikal-tab" data-tab="profiles">Profiles</button>
                            <button class="baikal-tab" data-tab="sync">Sync Status</button>
                        </div>

                        <!-- Connection Tab -->
                        <div id="baikal-connection-tab" class="baikal-tab-content active">
                            <div class="connection-info">
                                <h3>Connect to CardDAV Server</h3>
                                <p>Add your CardDAV server details to sync contacts across all devices.</p>
                                <p><strong>Note:</strong> Requires CardDAV bridge server running on port 3001</p>
                            </div>
                            
                            <form id="baikal-connection-form">
                                <div class="form-group">
                                    <label for="baikal-server-url">Server URL *</label>
                                    <input type="url" 
                                           id="baikal-server-url" 
                                           name="serverUrl" 
                                           placeholder="https://contacts.icloud.com/" 
                                           required>
                                    <small class="url-guidance">
                                        <strong>Use base server URL only</strong> (e.g., https://server.com/dav.php/)<br>
                                        📱 <strong>iCloud:</strong> https://contacts.icloud.com/ (requires app-specific password)<br>
                                        🔧 <strong>Baikal:</strong> https://server.com/dav.php/<br>
                                        ❌ Don't use: https://server.com/dav.php/addressbooks/user/default/<br>
                                        ✅ The bridge will auto-discover your addressbook path.
                                    </small>
                                    <div id="url-validation-result" class="url-validation" style="display: none;"></div>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baikal-username">Username *</label>
                                    <input type="text" 
                                           id="baikal-username" 
                                           name="username" 
                                           placeholder="your-username" 
                                           autocomplete="username"
                                           required>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baikal-password">Password *</label>
                                    <input type="password" 
                                           id="baikal-password" 
                                           name="password" 
                                           placeholder="your-password" 
                                           required>
                                    <small>Password is not stored and must be entered each session</small>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baikal-profile-name">Profile Name *</label>
                                    <input type="text" 
                                           id="baikal-profile-name" 
                                           name="profileName" 
                                           placeholder="My Baikal Server" 
                                           required>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baikal-sync-interval">Sync Interval</label>
                                    <select id="baikal-sync-interval" name="syncInterval">
                                        <option value="5">Every 5 minutes</option>
                                        <option value="15">Every 15 minutes</option>
                                        <option value="30" selected>Every 30 minutes</option>
                                        <option value="60">Every hour</option>
                                        <option value="0">Manual sync only</option>
                                    </select>
                                </div>
                                
                                <div class="form-group">
                                    <label class="checkbox-item">
                                        <input type="checkbox" name="bidirectionalSync" checked>
                                        <span>Bidirectional sync (push changes to server)</span>
                                    </label>
                                </div>
                                
                                <div class="form-actions">
                                    <button type="button" id="test-baikal-connection" class="btn btn-secondary">
                                        <i class="fas fa-test-tube"></i> Test Connection
                                    </button>
                                    <button type="submit" class="btn btn-primary">
                                        <i class="fas fa-link"></i> Connect
                                    </button>
                                </div>
                                
                                <div id="baikal-connection-status" class="connection-status"></div>
                            </form>
                        </div>

                        <!-- Profiles Tab -->
                        <div id="baikal-profiles-tab" class="baikal-tab-content">
                            <div class="profiles-header">
                                <h3>Connection Profiles</h3>
                                <button id="add-new-profile" class="btn btn-primary btn-small">
                                    <i class="fas fa-plus"></i> Add Profile
                                </button>
                            </div>
                            <div id="baikal-profiles-list" class="profiles-list">
                                <!-- Profiles will be dynamically inserted here -->
                            </div>
                        </div>

                        <!-- Sync Status Tab -->
                        <div id="baikal-sync-tab" class="baikal-tab-content">
                            <div class="sync-header">
                                <h3>Sync Status</h3>
                                <button id="sync-all-profiles" class="btn btn-primary">
                                    <i class="fas fa-sync"></i> Sync All Now
                                </button>
                            </div>
                            <div id="baikal-sync-status" class="sync-status-list">
                                <!-- Sync status will be dynamically inserted here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into DOM
        try {
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        } catch (err) {
            console.error('❌ Failed to insert Baikal modal into DOM:', err);
        }

        // Setup tab switching
        this.setupTabSwitching();
    }

    /**
     * Create sync status widget for main interface
     */
    createSyncStatusWidget() {
        console.log('🔍 DEBUG: createSyncStatusWidget called');
        // Add to header or create a dedicated area
        const existing = document.getElementById('baikal-settings-btn');
        if (existing) {
            console.log('🔍 DEBUG: Baikal settings button already present');
            return;
        }

        const syncWidget = document.createElement('div');
        syncWidget.className = 'sync-status-widget';
        syncWidget.innerHTML = `
            <button id="baikal-settings-btn" class="btn btn-ghost" title="CardDAV Settings">
                <i class="fas fa-server"></i>
                <span id="baikal-sync-indicator">CardDAV</span>
            </button>
        `;

        // Try preferred insertion points with fallbacks
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) headerRight.insertBefore(syncWidget, logoutBtn);
            else headerRight.appendChild(syncWidget);
            console.log('✅ DEBUG: Baikal widget created and inserted into .header-right');
            return;
        }

        const header = document.querySelector('header');
        if (header) {
            header.appendChild(syncWidget);
            console.log('✅ DEBUG: Baikal widget created and appended to <header>');
            return;
        }

        // Final fallback: append to body
        document.body.appendChild(syncWidget);
        console.log('✅ DEBUG: Baikal widget appended to <body> as fallback');
    }

    /**
     * Setup tab switching functionality
     */
    setupTabSwitching() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('.baikal-tab')) {
                const tabName = e.target.dataset.tab;
                this.switchTab(tabName);
            }
        });
    }

    /**
     * Switch between modal tabs
     */
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.baikal-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.baikal-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `baikal-${tabName}-tab`);
        });

        // Load tab-specific content
        if (tabName === 'profiles') {
            this.renderProfilesList();
        } else if (tabName === 'sync') {
            this.renderSyncStatus();
        }
    }

    /**
     * Open Baikal settings modal
     */
    openBaikalModal() {
        console.log('🔍 DEBUG: openBaikalModal called');
        const modal = document.getElementById('baikal-modal');
        if (modal) {
            modal.style.display = 'block';
            this.isModalOpen = true;
            console.log('🔍 DEBUG: Modal opened successfully');
            
            // Load existing configurations
            this.loadExistingConfigurations();
        } else {
            console.error('❌ DEBUG: baikal-modal element not found');
        }
    }

    /**
     * Close Baikal settings modal
     */
    closeBaikalModal() {
        const modal = document.getElementById('baikal-modal');
        if (modal) {
            modal.style.display = 'none';
            this.isModalOpen = false;
            this.currentEditingProfile = null;
            
            // Clear form
            this.clearConnectionForm();
        }
    }

    /**
     * Handle connection form submission
     */
    async handleConnectionFormSubmit(event) {
        try {
            const formData = new FormData(event.target);
            const originalServerUrl = formData.get('serverUrl');
            const isUpdate = !!this.currentEditingProfile;
            const password = formData.get('password');
            
            // Handle password for updates
            if (isUpdate && !password) {
                // If updating and password is empty, check if we have a stored password
                const storedPassword = this.getStoredPassword(this.currentEditingProfile);
                if (!storedPassword) {
                    this.showConnectionStatus('Please enter password to update profile', 'error');
                    return;
                }
                // Use stored password for connection test
                formData.set('password', storedPassword);
            }
            
            // 🔧 URL Helper: Parse and fix common URL mistakes
            const urlAnalysis = BaikalURLHelper.parseFullURL(originalServerUrl);
            const urlFixes = BaikalURLHelper.fixCommonMistakes(originalServerUrl);
            
            let serverUrl = originalServerUrl;
            let urlWarnings = [];
            
            // Apply URL fixes if needed
            if (urlFixes.wasFixed) {
                serverUrl = urlFixes.fixedUrl;
                urlWarnings.push(`URL auto-corrected: ${urlFixes.fixes.join(', ')}`);
            }
            
            // If URL was parsed successfully, use recommended server URL
            if (urlAnalysis.success && urlAnalysis.recommendation) {
                serverUrl = urlAnalysis.recommendation.serverUrl;
                urlWarnings.push(`URL optimized for CardDAV: Using "${serverUrl}" (removed addressbook path)`);
            }
            
            const finalPassword = password || formData.get('password'); // Get updated password
            
            const config = {
                serverUrl: serverUrl,
                username: formData.get('username'),
                password: finalPassword,
                profileName: formData.get('profileName'),
                syncInterval: parseInt(formData.get('syncInterval')) * 60 * 1000,
                bidirectionalSync: formData.has('bidirectionalSync'),
                autoConnect: formData.has('autoConnect') || true, // Default to true if not specified
                isUpdate: isUpdate
            };

            // 🐛 DEBUG: Log config before sending to catch any issues
            console.log('📋 Connection config being sent:', {
                serverUrl: config.serverUrl,
                username: config.username,
                profileName: config.profileName,
                passwordPresent: !!config.password,
                isUpdate: config.isUpdate
            });

            // Show URL warnings if any
            if (urlWarnings.length > 0) {
                this.showConnectionStatus(`URL Auto-Fix: ${urlWarnings.join(' | ')}`, 'warning');
                
                // Brief delay to show the warning
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            this.showConnectionStatus('Connecting to Baikal server...', 'info');

            // 🍎 Detect iCloud and route to ICloudConnector
            const isICloud = config.serverUrl.toLowerCase().includes('icloud.com') || 
                            config.serverUrl.toLowerCase().includes('apple.com');
            
            let result;
            
            if (isICloud && this.iCloudConnector) {
                console.log(`🍎 Routing connection to ICloudConnector for: ${config.profileName}`);
                this.showConnectionStatus('Connecting to iCloud CardDAV...', 'info');
                result = await this.iCloudConnector.connect(config);
            } else {
                console.log(`📤 Routing connection to BaikalConnector for: ${config.profileName}`);
                result = await this.baikalConnector.connectToServer(config);
            }

            if (result.success) {
                // 🔐 Store password in simple localStorage for auto-reconnect
                this.storePassword(config.profileName, finalPassword);
                console.log(`🔐 Password stored for auto-reconnect: ${config.profileName}`);
                
                // 🔐 Ask user to save credentials securely (optional, advanced features)
                console.log('🔐 DEBUG: About to show credential consent dialog');
                console.log('🔐 DEBUG: credentialUI exists?', !!this.credentialUI);
                console.log('🔐 DEBUG: showStorageConsent exists?', !!this.credentialUI?.showStorageConsent);
                
                try {
                    const credentialSaveResult = await this.credentialUI.showStorageConsent(
                        config.profileName,
                        {
                            serverUrl: config.serverUrl,
                            username: config.username,
                            password: finalPassword
                        }
                    );
                    
                    console.log('🔐 DEBUG: Consent dialog returned:', credentialSaveResult);
                    
                    if (credentialSaveResult.saved) {
                        console.log(`✅ Credentials saved using: ${credentialSaveResult.method}`);
                    } else {
                        console.log('⚠️ User chose not to save credentials');
                    }
                } catch (consentError) {
                    console.error('❌ DEBUG: Consent dialog error:', consentError);
                    console.log('⚠️ Skipping credential save due to error');
                }
                
                // Save configuration (without password)
                const saveResult = await this.configManager.saveConfiguration(config);
                
                if (saveResult.success) {
                    const updateMessage = isUpdate ? 'updated' : 'created';
                    this.showConnectionStatus(
                        `Profile ${updateMessage}! Found ${result.contactCount} contacts`, 
                        'success'
                    );
                    
                    // Handle received contacts (only for new profiles, not updates)
                    if (!isUpdate && result.contacts && result.contacts.length > 0) {
                        this.handleReceivedContacts(result.contacts, config.profileName);
                    }
                    
                    // Update UI
                    this.updateSyncIndicator('connected');
                    this.renderProfilesList();
                    
                    // Clear editing mode and reset form
                    this.currentEditingProfile = null;
                    this.clearConnectionForm();
                    
                    // Reset submit button text
                    const submitButton = event.target.querySelector('button[type="submit"]');
                    if (submitButton) {
                        submitButton.innerHTML = '<i class="fas fa-plug"></i> Connect to CardDAV';
                    }
                    
                    // Switch to profiles tab
                    this.switchTab('profiles');
                    
                    // 🆕 Start/restart auto-sync with 15-minute default intervals (ONLY for non-iCloud profiles)
                    if (!isICloud) {
                        console.log(`🔄 ${isUpdate ? 'Restarting' : 'Initializing'} auto-sync for ${config.profileName}`);
                        try {
                            const autoSyncResult = await this.baikalConnector.initializeAutoSync(config.profileName);
                            if (autoSyncResult.success) {
                                console.log(`✅ Auto-sync ${isUpdate ? 'restarted' : 'started'} with 15-minute intervals`);
                            } else {
                                console.warn('⚠️ Auto-sync initialization failed:', autoSyncResult.error);
                            }
                        } catch (autoSyncError) {
                            console.warn('⚠️ Auto-sync error:', autoSyncError.message);
                        }
                    } else {
                        console.log(`🍎 iCloud profile - skipping auto-sync (one-way export mode)`);
                    }
                    
                } else {
                    this.showConnectionStatus(`Failed to save configuration: ${saveResult.error}`, 'error');
                }
            } else {
                // Show detailed error with URL guidance
                let errorMessage = `Connection failed: ${result.error}`;
                
                // 🍎 Special handling for iCloud configuration errors
                if (result.serverType === 'iCloud' && result.help) {
                    console.log('🍎 iCloud configuration help:', result.help);
                    
                    // Create a detailed iCloud help modal
                    errorMessage = `iCloud Setup Required\n\n${result.help.message}\n\n`;
                    errorMessage += `Steps to fix:\n`;
                    result.help.steps.forEach((step, index) => {
                        errorMessage += `${step}\n`;
                    });
                    
                    if (result.help.commonIssues) {
                        errorMessage += `\nCommon Issues:\n`;
                        result.help.commonIssues.forEach(issue => {
                            if (issue.trim()) errorMessage += `${issue}\n`;
                        });
                    }
                    
                    if (result.help.example) {
                        errorMessage += `\nExample Configuration:\n`;
                        errorMessage += `Server URL: ${result.help.example.serverUrl}\n`;
                        errorMessage += `Username: ${result.help.example.username}\n`;
                        errorMessage += `Password: ${result.help.example.password}`;
                    }
                    
                    // Show in a more prominent alert for iCloud
                    alert(errorMessage);
                }
                
                if (!urlAnalysis.success && urlAnalysis.guidance) {
                    errorMessage += `\n\nURL Guidance: ${urlAnalysis.guidance.suggestions.join(', ')}`;
                }
                
                this.showConnectionStatus(errorMessage, 'error');
            }

        } catch (error) {
            console.error('❌ Connection form submission error:', error);
            this.showConnectionStatus(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Handle received contacts from Baikal
     */
    async handleReceivedContacts(contacts, profileName) {
        try {
            console.log(`📥 Received ${contacts.length} contacts from Baikal profile: ${profileName}`);
            
            let addedCount = 0;
            let skippedCount = 0;

            for (const baikalContact of contacts) {
                try {
                    // Convert Baikal contact to our format
                    const contactData = this.convertBaikalContactToLocal(baikalContact, profileName);
                    
                    // Check for duplicates
                    const isDuplicate = await this.checkForDuplicate(contactData);
                    
                    if (!isDuplicate) {
                        // Add contact via event bus
                        this.eventBus.emit('contact:importFromBaikal', {
                            contact: contactData,
                            source: 'baikal',
                            profileName: profileName
                        });
                        addedCount++;
                    } else {
                        skippedCount++;
                    }

                } catch (error) {
                    console.error('❌ Error processing Baikal contact:', error);
                    skippedCount++;
                }
            }

            this.showNotification(
                `Baikal sync complete: ${addedCount} added, ${skippedCount} skipped`, 
                'success'
            );

        } catch (error) {
            console.error('❌ Error handling received contacts:', error);
            this.showNotification(`Error processing Baikal contacts: ${error.message}`, 'error');
        }
    }

    /**
     * Convert Baikal contact format to local format
     */
    convertBaikalContactToLocal(baikalContact, profileName) {
        // 🛡️ Use original UID to prevent duplicate contacts
        const originalUID = baikalContact.uid || baikalContact.id || `baikal_${Date.now()}`;
        
        return {
            contactId: originalUID, // ⭐ Use original UID, not generated one
            cardName: baikalContact.name || 'Unnamed Contact', // ⭐ Don't add (Baikal) suffix
            vcard: baikalContact.vcard || this.generateBasicVCard(baikalContact),
            metadata: {
                source: 'baikal',
                profileName: profileName,
                originalUid: baikalContact.uid,
                importedAt: new Date().toISOString(),
                isOwned: false,
                isArchived: false,
                baikalSync: {
                    profileName: profileName,
                    lastSync: new Date().toISOString(),
                    syncEnabled: true
                }
            }
        };
    }

    /**
     * Generate basic vCard from Baikal contact data
     */
    generateBasicVCard(baikalContact) {
        return `BEGIN:VCARD
VERSION:4.0
FN:${baikalContact.name || 'Unnamed Contact'}
${baikalContact.email ? `EMAIL:${baikalContact.email}` : ''}
${baikalContact.phone ? `TEL:${baikalContact.phone}` : ''}
END:VCARD`;
    }

    /**
     * Check for duplicate contacts using UID matching
     */
    async checkForDuplicate(contactData) {
        try {
            if (!this.contactManager) {
                console.warn('⚠️ ContactManager not available for duplicate check');
                return false;
            }
            
            // Check if contact with same UID already exists
            const existingContact = await this.contactManager.getContactByUID(contactData.contactId);
            
            if (existingContact) {
                console.log(`🔍 Duplicate detected: Contact with UID ${contactData.contactId} already exists`);
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Error checking for duplicate:', error);
            return false; // Default to not duplicate if error
        }
    }

    /**
     * Show connection status message
     */
    showConnectionStatus(message, type = 'info') {
        const statusElement = document.getElementById('baikal-connection-status');
        if (statusElement) {
            statusElement.innerHTML = `
                <div class="status ${type}">
                    <i class="fas ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-times' : 'fa-info'}"></i>
                    ${message}
                </div>
            `;
        }
    }

    /**
     * Check if profile is an iCloud server
     * @param {string} profileName - Profile name to check
     * @returns {boolean} True if iCloud profile
     */
    isICloudProfile(profileName) {
        const config = this.getProfileConfig(profileName);
        if (!config) return false;
        
        // Check if server URL contains icloud.com or apple.com
        const serverUrl = config.serverUrl || config.url || '';
        return serverUrl.toLowerCase().includes('icloud.com') || 
               serverUrl.toLowerCase().includes('apple.com');
    }

    /**
     * Get profile configuration from either connector
     * @param {string} profileName - Profile name
     * @returns {Object|null} Profile config or null
     */
    getProfileConfig(profileName) {
        // Check BaikalConnector
        if (this.baikalConnector && this.baikalConnector.connections) {
            const connection = this.baikalConnector.connections.get(profileName);
            if (connection) return connection;
        }
        
        // Check ICloudConnector
        if (this.iCloudConnector && this.iCloudConnector.connections) {
            const connection = this.iCloudConnector.connections.get(profileName);
            if (connection) return connection;
        }
        
        // Check saved configs
        const configs = this.configManager?.getAllConfigurations() || [];
        const savedConfig = configs.find(c => c.profileName === profileName);
        if (savedConfig) return savedConfig;
        
        return null;
    }

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (info, success, warning, error)
     * @param {boolean} silent - If true, only log to console (no UI notification)
     */
    showNotification(message, type = 'info', silent = false) {
        // Always log to console
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Skip UI notification if silent mode
        if (silent) {
            return;
        }
        
        // Try to use existing notification system
        if (this.eventBus) {
            this.eventBus.emit('notification:show', { message, type });
        }
    }

    /**
     * Update sync indicator in header
     */
    updateSyncIndicator(status) {
        const indicator = document.getElementById('baikal-sync-indicator');
        if (indicator) {
            switch (status) {
                case 'connected':
                    indicator.textContent = 'CardDAV ✓';
                    indicator.className = 'connected';
                    break;
                case 'syncing':
                    indicator.textContent = 'CardDAV ⟳';
                    indicator.className = 'syncing';
                    break;
                case 'error':
                    indicator.textContent = 'CardDAV ✗';
                    indicator.className = 'error';
                    break;
                default:
                    indicator.textContent = 'CardDAV';
                    indicator.className = '';
            }
        }
    }

    /**
     * Load existing configurations and update UI
     */
    async loadExistingConfigurations() {
        try {
            console.log('🔍 DEBUG: loadExistingConfigurations called');
            const configurations = this.configManager.getAllConfigurations();
            console.log('🔍 DEBUG: Retrieved configurations:', configurations);
            
            if (configurations.length > 0) {
                this.updateSyncIndicator('connected');
                console.log(`📖 Loaded ${configurations.length} Baikal configurations`);
            } else {
                console.log('📝 No Baikal configurations found');
            }

            // Always render profiles list to update UI
            this.renderProfilesList();

        } catch (error) {
            console.error('❌ Error loading Baikal configurations:', error);
        }
    }

    /**
     * Render profiles list
     */
    renderProfilesList() {
        console.log('🔍 DEBUG: renderProfilesList called');
        const profilesList = document.getElementById('baikal-profiles-list');
        if (!profilesList) {
            console.log('❌ DEBUG: baikal-profiles-list element not found');
            return;
        }

        const configurations = this.configManager.getAllConfigurations();
        console.log('🔍 DEBUG: Found configurations:', configurations);
        
        if (configurations.length === 0) {
            profilesList.innerHTML = `
                <div class="no-profiles">
                    <p>No Baikal profiles configured.</p>
                    <p>Use the Connection tab to add your first profile.</p>
                </div>
            `;
            console.log('📝 DEBUG: Rendered no-profiles message');
            return;
        }

        const profilesHTML = configurations.map(config => {
            // Check if this is an iCloud profile (one-way export only)
            const isICloud = config.serverUrl && 
                (config.serverUrl.toLowerCase().includes('icloud.com') || 
                 config.serverUrl.toLowerCase().includes('apple.com'));
            
            return `
            <div class="profile-item" data-profile="${config.profileName}">
                <div class="profile-info">
                    <h4>${config.profileName}${isICloud ? ' 🍎' : ''}</h4>
                    <p>${config.serverUrl}</p>
                    <p>Username: ${config.username}</p>
                    <p>Mode: ${isICloud ? '📤 One-Way Export (Push Only)' : 'Sync: ' + (config.autoSync ? 'Every ' + (config.syncInterval / 60000) + ' min' : 'Manual')}</p>
                    <p class="profile-status" id="status-${config.profileName}">
                        ${config.isActive ? '🟢 Active' : '🔴 Inactive'}
                    </p>
                </div>
                <div class="profile-actions">
                    ${!isICloud ? `<button class="btn btn-small baikal-profile-sync" data-profile="${config.profileName}">
                        <i class="fas fa-sync"></i> Sync
                    </button>` : ''}
                    <button class="btn btn-small btn-primary baikal-profile-push" data-profile="${config.profileName}">
                        <i class="fas fa-upload"></i> Push All
                    </button>
                    <button class="btn btn-small btn-secondary baikal-profile-edit" data-profile="${config.profileName}">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-small btn-danger baikal-profile-delete" data-profile="${config.profileName}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;
        }).join('');

        profilesList.innerHTML = profilesHTML;
        console.log(`✅ DEBUG: Rendered ${configurations.length} profiles`);
    }

    /**
     * Render sync status
     */
    renderSyncStatus() {
        const syncStatusContainer = document.getElementById('baikal-sync-status');
        if (!syncStatusContainer) return;

        const status = this.baikalConnector.getStatus();
        
        const statusHTML = `
            <div class="sync-overview">
                <h4>Sync Overview</h4>
                <p>Bridge Status: ${status.isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
                <p>Active Connections: ${status.connectionCount}</p>
            </div>
            
            <div class="sync-details">
                ${status.connections.map(conn => `
                    <div class="sync-item">
                        <h5>${conn.profileName}</h5>
                        <p>Status: ${conn.connected ? '🟢 Connected' : '🔴 Disconnected'}</p>
                        <p>Last Sync: ${conn.lastSync ? new Date(conn.lastSync).toLocaleString() : 'Never'}</p>
                    </div>
                `).join('')}
            </div>
        `;

        syncStatusContainer.innerHTML = statusHTML;
    }

    /**
     * Sync all profiles now
     */
    async syncAllProfilesNow() {
        try {
            this.updateSyncIndicator('syncing');
            const configurations = this.configManager.getAllConfigurations();
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const config of configurations) {
                if (config.isActive) {
                    const result = await this.baikalConnector.testSync(config.profileName);
                    if (result.success) {
                        successCount++;
                        // ✅ Contacts handled via EventBus - no need for direct handling
                        // if (result.contacts && result.contacts.length > 0) {
                        //     await this.handleReceivedContacts(result.contacts, config.profileName);
                        // }
                    } else {
                        errorCount++;
                    }
                }
            }
            
            this.updateSyncIndicator(errorCount === 0 ? 'connected' : 'error');
            this.showNotification(
                `Sync complete: ${successCount} successful, ${errorCount} failed`, 
                errorCount === 0 ? 'success' : 'warning'
            );

        } catch (error) {
            console.error('❌ Sync all profiles error:', error);
            this.updateSyncIndicator('error');
            this.showNotification(`Sync error: ${error.message}`, 'error');
        }
    }

    /**
     * Sync specific profile
     */
    async syncProfile(profileName) {
        try {
            this.updateSyncIndicator('syncing');
            
            // First, get the configuration for this profile
            const configurations = this.configManager.getAllConfigurations();
            const config = configurations.find(c => c.profileName === profileName);
            
            if (!config) {
                throw new Error(`Configuration for profile "${profileName}" not found`);
            }
            
            // Check if connection already exists, if not, connect first
            const connections = this.baikalConnector.getConnections();
            const existingConnection = connections.find(c => c.profileName === profileName);
            
            if (!existingConnection) {
                console.log(`🔗 No active connection for ${profileName}, connecting first...`);
                // Note: This will fail without password - need to prompt user or store encrypted password
                console.warn(`⚠️ Cannot auto-reconnect ${profileName} - password not stored for security`);
                throw new Error(`Profile ${profileName} is not connected and password is not stored for security. Please reconnect manually.`);
            }
            
            // Now perform the sync
            const result = await this.baikalConnector.testSync(profileName);
            
            if (result.success) {
                // 📤 iCloud One-Way Export Mode
                if (result.mode === 'one-way-export') {
                    this.updateSyncIndicator('connected');
                    this.showNotification(
                        `${profileName}: One-Way Export Mode - Use "Push Contacts" to export to iCloud`, 
                        'info'
                    );
                    
                    // Show detailed message about one-way mode
                    if (result.message) {
                        console.log(`ℹ️ ${result.message}`);
                    }
                    if (result.recommendation) {
                        console.log(`💡 ${result.recommendation}`);
                    }
                } else {
                    // Normal bidirectional sync
                    this.updateSyncIndicator('connected');
                    this.showNotification(`${profileName} synced successfully`, 'success');
                }
            } else {
                this.updateSyncIndicator('error');
                this.showNotification(`${profileName} sync failed: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('❌ Profile sync error:', error);
            this.updateSyncIndicator('error');
            this.showNotification(`Sync error: ${error.message}`, 'error');
        }
    }

    /**
     * Push all contacts to a specific profile/server
     */
    async pushAllContactsToProfile(profileName) {
        // Prevent multiple simultaneous push operations
        if (this.isPushing) {
            console.log('⚠️ Push operation already in progress, ignoring duplicate request');
            return;
        }
        
        try {
            this.isPushing = true; // Set flag to prevent duplicates
            console.log(`📤 Starting push all contacts to profile: ${profileName}`);
            
            // Update UI to show pushing in progress
            const pushButton = document.querySelector(`[data-profile="${profileName}"].baikal-profile-push`);
            if (pushButton) {
                const originalText = pushButton.innerHTML;
                pushButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pushing...';
                pushButton.disabled = true;
            }
            
            // Get the configuration for this profile
            const configurations = this.configManager.getAllConfigurations();
            const config = configurations.find(c => c.profileName === profileName);
            
            if (!config) {
                throw new Error(`Configuration for profile "${profileName}" not found`);
            }
            
            // 🍎 Route to ICloudConnector for iCloud profiles
            const isICloud = this.isICloudProfile(profileName);
            
            if (isICloud && this.iCloudConnector) {
                console.log(`🍎 Routing to ICloudConnector for iCloud profile: ${profileName}`);
                
                // Check if iCloud connection exists
                const iCloudConnection = this.iCloudConnector.getConnectionStatus(profileName);
                if (!iCloudConnection || !iCloudConnection.isConnected) {
                    throw new Error(`iCloud profile ${profileName} is not connected. Please connect first.`);
                }
                
                // Use ICloudConnector for one-way export with vCard regeneration
                const result = await this.iCloudConnector.pushAllContacts(profileName);
                
                if (result.success) {
                    this.showNotification(
                        `✅ Pushed ${result.successCount}/${result.total} contacts to iCloud`,
                        'success'
                    );
                    console.log(`✅ iCloud push complete: ${result.successCount}/${result.total} contacts`);
                } else {
                    throw new Error(result.error || 'iCloud push failed');
                }
                
                return result;
            }
            
            // 📤 Use BaikalConnector for standard CardDAV servers
            console.log(`📤 Routing to BaikalConnector for CardDAV profile: ${profileName}`);
            
            // Check if connection exists
            const connections = this.baikalConnector.getConnections();
            const existingConnection = connections.find(c => c.profileName === profileName);
            
            if (!existingConnection) {
                throw new Error(`Profile ${profileName} is not connected. Please connect first.`);
            }
            
            // Get all owned and shared contacts from Contact Manager
            const allContactsRaw = this.contactManager ? this.contactManager.getAllOwnedContacts() : [];
            
            if (!this.contactManager) {
                throw new Error('Contact Manager not available');
            }
            
            // ✅ Filter out archived and deleted contacts before pushing
            const allContacts = allContactsRaw.filter(contact => {
                const isArchived = contact.metadata?.isArchived;
                const isDeleted = contact.metadata?.isDeleted;
                return !isArchived && !isDeleted;
            });
            
            // 🔍 ENHANCED LOGGING: Show detailed contact analysis
            const totalContacts = this.contactManager.getAllContacts();
            console.log(`🔍 CONTACT ANALYSIS FOR CARDDAV PUSH:`);
            console.log(`   📊 Total contacts in system: ${totalContacts.length}`);
            console.log(`   📤 Retrieved for push consideration: ${allContactsRaw.length}`);
            console.log(`   ✅ Active contacts (after filtering): ${allContacts.length}`);
            console.log(`   🚫 Filtered out (archived/deleted): ${allContactsRaw.length - allContacts.length}`);
            
            // Categorize contacts for better understanding
            let ownedCount = 0;
            let sharedCount = 0;
            let archivedCount = 0;
            let deletedCount = 0;
            let skippedCount = 0;
            
            // List all contacts with their status
            totalContacts.forEach((contact, index) => {
                const isOwned = contact.metadata?.isOwned;
                const isShared = contact.contactId?.startsWith('shared_') || 
                               contact.metadata?.isShared || 
                               contact.metadata?.sharedBy;
                const deleted = contact.metadata?.isDeleted;
                const archived = contact.metadata?.isArchived;
                
                let status = '';
                let category = '';
                
                if (deleted) {
                    status = '🗑️ DELETED → SKIP';
                    category = 'deleted';
                    deletedCount++;
                } else if (archived) {
                    status = '📦 ARCHIVED → SKIP';
                    category = 'archived';
                    archivedCount++;
                } else if (isOwned) {
                    status = '✅ OWNED → PUSH';
                    category = 'owned';
                    ownedCount++;
                } else if (isShared) {
                    status = '👥 SHARED → PUSH';
                    category = 'shared';
                    sharedCount++;
                } else {
                    status = '❓ UNKNOWN → SKIP';
                    category = 'skipped';
                    skippedCount++;
                }
                
                console.log(`   ${index + 1}. "${contact.cardName}" - ${status}`);
            });
            
            console.log(`📋 PUSH SUMMARY:`);
            console.log(`   ✅ Owned contacts (will push): ${ownedCount}`);
            console.log(`   👥 Shared contacts (will push): ${sharedCount}`);
            console.log(`   📦 Archived (excluded from push): ${archivedCount}`);
            console.log(`   🗑️ Deleted (excluded from push): ${deletedCount}`);
            console.log(`   ❓ Skipped (other reasons): ${skippedCount}`);
            console.log(`   📤 Total to push to CardDAV: ${allContacts.length}`);
            
            if (allContacts.length === 0) {
                this.showNotification('No active contacts found eligible for CardDAV push', 'warning');
                console.log('💡 Tip: Archived contacts are excluded. Restore them to include in sync.');
                return;
            }
            
            console.log(`📤 Ready to push ${allContacts.length} active contacts to ${profileName}`);
            
            // Push filtered contacts (archived and deleted are excluded)
            const result = await this.baikalConnector.testPushOwnedContacts(profileName, allContacts);
            
            if (result.success) {
                const successCount = result.successCount || 0;
                const totalCount = result.totalCount || allContacts.length;
                const skippedCount = result.skippedCount || 0;
                
                // ✅ Silent notification for background sync (only errors shown)
                const isSilent = true; // Background sync mode
                
                if (skippedCount > 0) {
                    this.showNotification(
                        `Pushed ${successCount}/${totalCount} contacts (${skippedCount} unchanged)`, 
                        'success',
                        isSilent // Silent - logged to console only
                    );
                } else {
                    this.showNotification(
                        `Pushed ${successCount}/${totalCount} contacts to ${profileName}`, 
                        'success',
                        isSilent // Silent - logged to console only
                    );
                }
                
                console.log(`✅ Push completed: ${successCount}/${totalCount} contacts pushed, ${skippedCount} skipped (unchanged)`);
            } else {
                throw new Error(result.error || 'Push operation failed');
            }

        } catch (error) {
            console.error('❌ Push all contacts error:', error);
            this.showNotification(`Push failed: ${error.message}`, 'error');
        } finally {
            this.isPushing = false; // ⭐ Clear flag to allow future push operations
            
            // Restore button state
            const pushButton = document.querySelector(`[data-profile="${profileName}"].baikal-profile-push`);
            if (pushButton) {
                pushButton.innerHTML = '<i class="fas fa-upload"></i> Push All';
                pushButton.disabled = false;
            }
        }
    }

    /**
     * Edit profile - populate form with existing configuration
     */
    async editProfile(profileName) {
        try {
            console.log('✏️ Edit profile:', profileName);
            
            // Get the configuration
            const config = this.configManager.getConfiguration(profileName);
            if (!config) {
                this.showNotification(`Profile "${profileName}" not found`, 'error');
                return;
            }
            
            // Set editing mode
            this.currentEditingProfile = profileName;
            
            // Switch to connection tab
            this.switchTab('connection');
            
            // Populate the form
            const form = document.getElementById('baikal-connection-form');
            if (!form) {
                console.error('❌ Connection form not found');
                return;
            }
            
            // Fill in the form fields
            const profileNameInput = form.querySelector('[name="profileName"]');
            const serverUrlInput = form.querySelector('[name="serverUrl"]');
            const usernameInput = form.querySelector('[name="username"]');
            const passwordInput = form.querySelector('[name="password"]');
            const syncIntervalInput = form.querySelector('[name="syncInterval"]');
            const bidirectionalSyncInput = form.querySelector('[name="bidirectionalSync"]');
            const autoConnectInput = form.querySelector('[name="autoConnect"]');
            
            if (profileNameInput) {
                profileNameInput.value = config.profileName;
                profileNameInput.readOnly = true; // Don't allow changing profile name
            }
            
            if (serverUrlInput) serverUrlInput.value = config.serverUrl || '';
            if (usernameInput) usernameInput.value = config.username || '';
            if (passwordInput) {
                passwordInput.value = ''; // Always empty for security
                passwordInput.placeholder = 'Enter new password or leave empty to keep current';
            }
            
            if (syncIntervalInput) {
                // Convert ms to minutes for display
                syncIntervalInput.value = Math.floor(config.syncInterval / 60000) || 15;
            }
            
            if (bidirectionalSyncInput) {
                bidirectionalSyncInput.checked = config.bidirectionalSync !== false;
            }
            
            if (autoConnectInput) {
                autoConnectInput.checked = config.isActive !== false;
            }
            
            // Update form submit button text
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.innerHTML = '<i class="fas fa-save"></i> Update Profile';
            }
            
            // Scroll to form
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            this.showNotification(`Editing profile "${profileName}". Password field is empty - enter new password or leave empty to keep current.`, 'info');
            
        } catch (error) {
            console.error('❌ Edit profile error:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Delete profile
     */
    async deleteProfile(profileName) {
        if (!confirm(`Delete Baikal profile "${profileName}"?`)) {
            return;
        }

        try {
            const result = await this.configManager.deleteConfiguration(profileName);
            
            if (result.success) {
                await this.baikalConnector.disconnect(profileName);
                
                // Remove stored password
                this.removeStoredPassword(profileName);
                
                this.renderProfilesList();
                this.showNotification(`Profile "${profileName}" deleted`, 'success');
            } else {
                this.showNotification(`Failed to delete profile: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('❌ Delete profile error:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Disconnect profile (without deleting)
     */
    async disconnectProfile(profileName) {
        try {
            console.log(`🔌 Disconnecting profile: ${profileName}`);
            
            // Disconnect from BaikalConnector
            await this.baikalConnector.disconnect(profileName);
            
            // Update UI
            this.renderProfilesList();
            this.showNotification(`Profile "${profileName}" disconnected`, 'success');
            
            console.log(`✅ Profile "${profileName}" disconnected successfully`);
            
        } catch (error) {
            console.error('❌ Disconnect profile error:', error);
            this.showNotification(`Error disconnecting: ${error.message}`, 'error');
        }
    }

    /**
     * Test profile connectivity
     */
    async testProfile(profileName) {
        try {
            const config = this.configManager.getConfiguration(profileName);
            if (!config) {
                this.showNotification('Profile not found', 'error');
                return;
            }

            this.showNotification(`Testing ${profileName}...`, 'info');
            
            const result = await this.configManager.testConfiguration(config);
            
            if (result.success) {
                this.showNotification(`${profileName} test successful`, 'success');
            } else {
                this.showNotification(`${profileName} test failed: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('❌ Test profile error:', error);
            this.showNotification(`Test error: ${error.message}`, 'error');
        }
    }

    /**
     * Validate server URL in real-time
     */
    validateServerURL(url) {
        const validationDiv = document.getElementById('url-validation-result');
        if (!validationDiv) return;

        if (!url || url.trim() === '') {
            validationDiv.style.display = 'none';
            return;
        }

        try {
            // Parse the URL using our helper
            const urlAnalysis = BaikalURLHelper.parseFullURL(url);
            const urlFixes = BaikalURLHelper.fixCommonMistakes(url);
            
            let validationHTML = '';
            let validationClass = '';

            if (urlAnalysis.success) {
                // URL is a full addressbook path - show recommendation
                validationHTML = `
                    <div class="url-validation-success">
                        ✅ <strong>URL Detected:</strong> ${urlAnalysis.type}<br>
                        <strong>Recommended:</strong> Use "${urlAnalysis.recommendation.serverUrl}" instead<br>
                        <small>The bridge will auto-discover the addressbook path</small>
                    </div>
                `;
                validationClass = 'url-warning';
            } else if (urlFixes.wasFixed) {
                // URL has fixable issues
                validationHTML = `
                    <div class="url-validation-warning">
                        ⚠️ <strong>Auto-fixes available:</strong><br>
                        Original: ${url}<br>
                        Suggested: ${urlFixes.fixedUrl}<br>
                        <small>Changes: ${urlFixes.fixes.join(', ')}</small>
                    </div>
                `;
                validationClass = 'url-info';
            } else {
                // URL validation
                const validation = BaikalURLHelper.validateServerURL(url);
                
                if (validation.isValid) {
                    validationHTML = `
                        <div class="url-validation-success">
                            ✅ <strong>URL looks good!</strong> Ready to connect.
                        </div>
                    `;
                    validationClass = 'url-success';
                } else {
                    validationHTML = `
                        <div class="url-validation-error">
                            ❌ <strong>Issues found:</strong><br>
                            ${validation.issues.join('<br>')}<br>
                            ${validation.recommendations.length > 0 ? 
                                '<strong>Suggestions:</strong><br>' + validation.recommendations.join('<br>') : ''
                            }
                        </div>
                    `;
                    validationClass = 'url-error';
                }
            }

            validationDiv.innerHTML = validationHTML;
            validationDiv.className = `url-validation ${validationClass}`;
            validationDiv.style.display = 'block';

        } catch (error) {
            validationDiv.innerHTML = `
                <div class="url-validation-error">
                    ❌ <strong>Invalid URL:</strong> ${error.message}
                </div>
            `;
            validationDiv.className = 'url-validation url-error';
            validationDiv.style.display = 'block';
        }
    }

    /**
     * Clear connection form
     */
    clearConnectionForm() {
        const form = document.getElementById('baikal-connection-form');
        if (form) {
            form.reset();
            
            // Reset profile name field to editable
            const profileNameInput = form.querySelector('[name="profileName"]');
            if (profileNameInput) {
                profileNameInput.readOnly = false;
            }
            
            // Reset submit button text
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.innerHTML = '<i class="fas fa-plug"></i> Connect to CardDAV';
            }
        }
        
        const statusElement = document.getElementById('baikal-connection-status');
        if (statusElement) {
            statusElement.innerHTML = '';
        }

        // Clear URL validation
        const validationDiv = document.getElementById('url-validation-result');
        if (validationDiv) {
            validationDiv.style.display = 'none';
        }
        
        // Clear editing mode
        this.currentEditingProfile = null;
    }

    /**
     * Update sync status for profile
     */
    updateSyncStatus(profileName, status) {
        this.syncStatus.set(profileName, status);
        
        // Update profile status in UI if visible
        const statusElement = document.getElementById(`status-${profileName}`);
        if (statusElement) {
            const statusText = status.isConnected ? '🟢 Connected' : '🔴 Disconnected';
            statusElement.textContent = statusText;
        }
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.syncStatus.clear();
        this.isModalOpen = false;
        this.currentEditingProfile = null;
    }

    /**
     * Store password securely in localStorage
     * Note: Passwords persist across page refreshes until logout
     * Cleared automatically when user signs out from Contact Manager
     */
    storePassword(profileName, password) {
        try {
            // Use a prefixed key for organization
            const key = `baikal_password_${profileName}`;
            localStorage.setItem(key, password);
            console.log(`🔐 Stored password for profile: ${profileName} (persists until logout)`);
        } catch (error) {
            console.error('❌ Failed to store password:', error);
        }
    }

    /**
     * Retrieve stored password from localStorage
     */
    getStoredPassword(profileName) {
        try {
            const key = `baikal_password_${profileName}`;
            const password = localStorage.getItem(key);
            if (password) {
                console.log(`🔓 Retrieved stored password for profile: ${profileName}`);
            }
            return password;
        } catch (error) {
            console.error('❌ Failed to retrieve password:', error);
            return null;
        }
    }

    /**
     * Remove stored password from localStorage
     */
    removeStoredPassword(profileName) {
        try {
            const key = `baikal_password_${profileName}`;
            localStorage.removeItem(key);
            console.log(`🗑️ Removed password for profile: ${profileName}`);
        } catch (error) {
            console.error('❌ Failed to remove password:', error);
        }
    }

    /**
     * Clear all stored passwords from localStorage
     * Called automatically on Contact Manager logout
     */
    clearAllStoredPasswords() {
        try {
            const keys = Object.keys(localStorage);
            let clearedCount = 0;
            keys.forEach(key => {
                if (key.startsWith('baikal_password_')) {
                    localStorage.removeItem(key);
                    clearedCount++;
                }
            });
            if (clearedCount > 0) {
                console.log(`🗑️ Cleared ${clearedCount} stored CardDAV password(s) on logout`);
            }
        } catch (error) {
            console.error('❌ Failed to clear passwords:', error);
        }
    }
}