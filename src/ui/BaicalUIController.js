/**
 * Baical UI Controller
 * Manages UI interactions for Baical CardDAV integration
 */
export class BaicalUIController {
    constructor(eventBus, baicalConnector, configManager) {
        this.eventBus = eventBus;
        this.baicalConnector = baicalConnector;
        this.configManager = configManager;
        
        // UI state
        this.isModalOpen = false;
        this.currentEditingProfile = null;
        this.syncStatus = new Map(); // Track sync status per profile
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupBaicalConnectorCallbacks();
    }

    /**
     * Initialize Baical UI components
     */
    initialize() {
        this.createBaicalModal();
        this.createSyncStatusWidget();
        this.loadExistingConfigurations();
        console.log('🔌 Baical UI Controller initialized');
    }

    /**
     * Setup event listeners for UI interactions
     */
    setupEventListeners() {
        // Settings button click (we'll create this)
        document.addEventListener('click', (e) => {
            if (e.target.matches('#baical-settings-btn') || e.target.closest('#baical-settings-btn')) {
                e.preventDefault();
                this.openBaicalModal();
            }
        });

        // Sync now button click
        document.addEventListener('click', (e) => {
            if (e.target.matches('#sync-baical-now') || e.target.closest('#sync-baical-now')) {
                e.preventDefault();
                this.syncAllProfilesNow();
            }
        });

        // Modal form submission
        document.addEventListener('submit', (e) => {
            if (e.target.matches('#baical-connection-form')) {
                e.preventDefault();
                this.handleConnectionFormSubmit(e);
            }
        });

        // Modal close events
        document.addEventListener('click', (e) => {
            if (e.target.matches('#close-baical-modal') || e.target.closest('#close-baical-modal')) {
                this.closeBaicalModal();
            }
            
            if (e.target.matches('#baical-modal') && e.target.classList.contains('modal')) {
                this.closeBaicalModal();
            }
        });

        // Profile management buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('.baical-profile-edit')) {
                const profileName = e.target.dataset.profile;
                this.editProfile(profileName);
            }
            
            if (e.target.matches('.baical-profile-delete')) {
                const profileName = e.target.dataset.profile;
                this.deleteProfile(profileName);
            }
            
            if (e.target.matches('.baical-profile-sync')) {
                const profileName = e.target.dataset.profile;
                this.syncProfile(profileName);
            }
            
            if (e.target.matches('.baical-profile-test')) {
                const profileName = e.target.dataset.profile;
                this.testProfile(profileName);
            }
        });
    }

    /**
     * Setup callbacks for BaicalConnector events
     */
    setupBaicalConnectorCallbacks() {
        this.baicalConnector.onStatusChange = (statusInfo) => {
            this.updateSyncStatus(statusInfo.profileName, {
                status: statusInfo.status,
                timestamp: statusInfo.timestamp,
                isConnected: statusInfo.isConnected
            });
        };

        this.baicalConnector.onContactsReceived = (contacts, profileName) => {
            this.handleReceivedContacts(contacts, profileName);
        };

        this.baicalConnector.onError = (errorInfo) => {
            this.showNotification(`Baical error: ${errorInfo.error}`, 'error');
        };
    }

    /**
     * Create Baical settings modal
     */
    createBaicalModal() {
        const modalHTML = `
            <div id="baical-modal" class="modal">
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h2>Baical CardDAV Integration</h2>
                        <button id="close-baical-modal" class="modal-close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="baical-modal-tabs">
                            <button class="baical-tab active" data-tab="connection">Connection</button>
                            <button class="baical-tab" data-tab="profiles">Profiles</button>
                            <button class="baical-tab" data-tab="sync">Sync Status</button>
                        </div>

                        <!-- Connection Tab -->
                        <div id="baical-connection-tab" class="baical-tab-content active">
                            <div class="connection-info">
                                <h3>Connect to Baical Server</h3>
                                <p>Add your CardDAV server details to sync contacts across all devices.</p>
                                <p><strong>Note:</strong> Requires CardDAV bridge server running on port 3001</p>
                            </div>
                            
                            <form id="baical-connection-form">
                                <div class="form-group">
                                    <label for="baical-server-url">Server URL *</label>
                                    <input type="url" 
                                           id="baical-server-url" 
                                           name="serverUrl" 
                                           placeholder="https://your-server.com/dav.php" 
                                           required>
                                    <small>Full CardDAV server endpoint URL</small>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baical-username">Username *</label>
                                    <input type="text" 
                                           id="baical-username" 
                                           name="username" 
                                           placeholder="your-username" 
                                           required>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baical-password">Password *</label>
                                    <input type="password" 
                                           id="baical-password" 
                                           name="password" 
                                           placeholder="your-password" 
                                           required>
                                    <small>Password is not stored and must be entered each session</small>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baical-profile-name">Profile Name *</label>
                                    <input type="text" 
                                           id="baical-profile-name" 
                                           name="profileName" 
                                           placeholder="My Baical Server" 
                                           required>
                                </div>
                                
                                <div class="form-group">
                                    <label for="baical-sync-interval">Sync Interval</label>
                                    <select id="baical-sync-interval" name="syncInterval">
                                        <option value="5">Every 5 minutes</option>
                                        <option value="15" selected>Every 15 minutes</option>
                                        <option value="30">Every 30 minutes</option>
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
                                    <button type="button" id="test-baical-connection" class="btn btn-secondary">
                                        <i class="fas fa-test-tube"></i> Test Connection
                                    </button>
                                    <button type="submit" class="btn btn-primary">
                                        <i class="fas fa-link"></i> Connect
                                    </button>
                                </div>
                                
                                <div id="baical-connection-status" class="connection-status"></div>
                            </form>
                        </div>

                        <!-- Profiles Tab -->
                        <div id="baical-profiles-tab" class="baical-tab-content">
                            <div class="profiles-header">
                                <h3>Connection Profiles</h3>
                                <button id="add-new-profile" class="btn btn-primary btn-small">
                                    <i class="fas fa-plus"></i> Add Profile
                                </button>
                            </div>
                            <div id="baical-profiles-list" class="profiles-list">
                                <!-- Profiles will be dynamically inserted here -->
                            </div>
                        </div>

                        <!-- Sync Status Tab -->
                        <div id="baical-sync-tab" class="baical-tab-content">
                            <div class="sync-header">
                                <h3>Sync Status</h3>
                                <button id="sync-all-profiles" class="btn btn-primary">
                                    <i class="fas fa-sync"></i> Sync All Now
                                </button>
                            </div>
                            <div id="baical-sync-status" class="sync-status-list">
                                <!-- Sync status will be dynamically inserted here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Setup tab switching
        this.setupTabSwitching();
    }

    /**
     * Create sync status widget for main interface
     */
    createSyncStatusWidget() {
        // Add to header or create a dedicated area
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            const syncWidget = document.createElement('div');
            syncWidget.className = 'sync-status-widget';
            syncWidget.innerHTML = `
                <button id="baical-settings-btn" class="btn btn-ghost" title="Baical CardDAV Settings">
                    <i class="fas fa-server"></i>
                    <span id="baical-sync-indicator">Baical</span>
                </button>
            `;
            
            // Insert before the logout button
            const logoutBtn = document.getElementById('logout-btn');
            headerRight.insertBefore(syncWidget, logoutBtn);
        }
    }

    /**
     * Setup tab switching functionality
     */
    setupTabSwitching() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('.baical-tab')) {
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
        document.querySelectorAll('.baical-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.baical-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `baical-${tabName}-tab`);
        });

        // Load tab-specific content
        if (tabName === 'profiles') {
            this.renderProfilesList();
        } else if (tabName === 'sync') {
            this.renderSyncStatus();
        }
    }

    /**
     * Open Baical settings modal
     */
    openBaicalModal() {
        const modal = document.getElementById('baical-modal');
        if (modal) {
            modal.style.display = 'block';
            this.isModalOpen = true;
            
            // Load existing configurations
            this.loadExistingConfigurations();
        }
    }

    /**
     * Close Baical settings modal
     */
    closeBaicalModal() {
        const modal = document.getElementById('baical-modal');
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
            const config = {
                serverUrl: formData.get('serverUrl'),
                username: formData.get('username'),
                password: formData.get('password'),
                profileName: formData.get('profileName'),
                syncInterval: parseInt(formData.get('syncInterval')) * 60 * 1000,
                bidirectionalSync: formData.has('bidirectionalSync'),
                isUpdate: !!this.currentEditingProfile
            };

            this.showConnectionStatus('Connecting to Baical server...', 'info');

            // Test connection first
            const result = await this.baicalConnector.connectToServer(config);

            if (result.success) {
                // Save configuration
                const saveResult = await this.configManager.saveConfiguration(config);
                
                if (saveResult.success) {
                    this.showConnectionStatus(
                        `Connected! Found ${result.contactCount} contacts`, 
                        'success'
                    );
                    
                    // Handle received contacts
                    if (result.contacts && result.contacts.length > 0) {
                        this.handleReceivedContacts(result.contacts, config.profileName);
                    }
                    
                    // Update UI
                    this.updateSyncIndicator('connected');
                    this.renderProfilesList();
                    
                    // Switch to profiles tab
                    this.switchTab('profiles');
                    
                } else {
                    this.showConnectionStatus(`Failed to save configuration: ${saveResult.error}`, 'error');
                }
            } else {
                this.showConnectionStatus(`Connection failed: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('❌ Connection form submission error:', error);
            this.showConnectionStatus(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Handle received contacts from Baical
     */
    async handleReceivedContacts(contacts, profileName) {
        try {
            console.log(`📥 Received ${contacts.length} contacts from Baical profile: ${profileName}`);
            
            let addedCount = 0;
            let skippedCount = 0;

            for (const baicalContact of contacts) {
                try {
                    // Convert Baical contact to our format
                    const contactData = this.convertBaicalContactToLocal(baicalContact, profileName);
                    
                    // Check for duplicates
                    const isDuplicate = await this.checkForDuplicate(contactData);
                    
                    if (!isDuplicate) {
                        // Add contact via event bus
                        this.eventBus.emit('contact:importFromBaical', {
                            contact: contactData,
                            source: 'baical',
                            profileName: profileName
                        });
                        addedCount++;
                    } else {
                        skippedCount++;
                    }

                } catch (error) {
                    console.error('❌ Error processing Baical contact:', error);
                    skippedCount++;
                }
            }

            this.showNotification(
                `Baical sync complete: ${addedCount} added, ${skippedCount} skipped`, 
                'success'
            );

        } catch (error) {
            console.error('❌ Error handling received contacts:', error);
            this.showNotification(`Error processing Baical contacts: ${error.message}`, 'error');
        }
    }

    /**
     * Convert Baical contact format to local format
     */
    convertBaicalContactToLocal(baicalContact, profileName) {
        return {
            contactId: `baical_${profileName}_${baicalContact.uid || Date.now()}`,
            cardName: `${baicalContact.name || 'Unnamed'} (Baical)`,
            vcard: baicalContact.vcard || this.generateBasicVCard(baicalContact),
            metadata: {
                source: 'baical',
                profileName: profileName,
                originalUid: baicalContact.uid,
                importedAt: new Date().toISOString(),
                isOwned: false,
                isArchived: false,
                baicalSync: {
                    profileName: profileName,
                    lastSync: new Date().toISOString(),
                    syncEnabled: true
                }
            }
        };
    }

    /**
     * Generate basic vCard from Baical contact data
     */
    generateBasicVCard(baicalContact) {
        return `BEGIN:VCARD
VERSION:4.0
FN:${baicalContact.name || 'Unnamed Contact'}
${baicalContact.email ? `EMAIL:${baicalContact.email}` : ''}
${baicalContact.phone ? `TEL:${baicalContact.phone}` : ''}
END:VCARD`;
    }

    /**
     * Check for duplicate contacts
     */
    async checkForDuplicate(contactData) {
        // This would integrate with your existing duplicate detection
        // For now, return false (no duplicates)
        return false;
    }

    /**
     * Show connection status message
     */
    showConnectionStatus(message, type = 'info') {
        const statusElement = document.getElementById('baical-connection-status');
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
     * Show notification
     */
    showNotification(message, type = 'info') {
        // This would integrate with your existing notification system
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Try to use existing notification system
        if (this.eventBus) {
            this.eventBus.emit('notification:show', { message, type });
        }
    }

    /**
     * Update sync indicator in header
     */
    updateSyncIndicator(status) {
        const indicator = document.getElementById('baical-sync-indicator');
        if (indicator) {
            switch (status) {
                case 'connected':
                    indicator.textContent = 'Baical ✓';
                    indicator.className = 'connected';
                    break;
                case 'syncing':
                    indicator.textContent = 'Baical ⟳';
                    indicator.className = 'syncing';
                    break;
                case 'error':
                    indicator.textContent = 'Baical ✗';
                    indicator.className = 'error';
                    break;
                default:
                    indicator.textContent = 'Baical';
                    indicator.className = '';
            }
        }
    }

    /**
     * Load existing configurations and update UI
     */
    async loadExistingConfigurations() {
        try {
            const configurations = this.configManager.getAllConfigurations();
            
            if (configurations.length > 0) {
                this.updateSyncIndicator('connected');
                console.log(`📖 Loaded ${configurations.length} Baical configurations`);
            }

        } catch (error) {
            console.error('❌ Error loading Baical configurations:', error);
        }
    }

    /**
     * Render profiles list
     */
    renderProfilesList() {
        const profilesList = document.getElementById('baical-profiles-list');
        if (!profilesList) return;

        const configurations = this.configManager.getAllConfigurations();
        
        if (configurations.length === 0) {
            profilesList.innerHTML = `
                <div class="no-profiles">
                    <p>No Baical profiles configured.</p>
                    <p>Use the Connection tab to add your first profile.</p>
                </div>
            `;
            return;
        }

        const profilesHTML = configurations.map(config => `
            <div class="profile-item" data-profile="${config.profileName}">
                <div class="profile-info">
                    <h4>${config.profileName}</h4>
                    <p>${config.serverUrl}</p>
                    <p>Username: ${config.username}</p>
                    <p>Sync: ${config.autoSync ? 'Every ' + (config.syncInterval / 60000) + ' min' : 'Manual'}</p>
                    <p class="profile-status" id="status-${config.profileName}">
                        ${config.isActive ? '🟢 Active' : '🔴 Inactive'}
                    </p>
                </div>
                <div class="profile-actions">
                    <button class="btn btn-small baical-profile-sync" data-profile="${config.profileName}">
                        <i class="fas fa-sync"></i> Sync
                    </button>
                    <button class="btn btn-small baical-profile-test" data-profile="${config.profileName}">
                        <i class="fas fa-test-tube"></i> Test
                    </button>
                    <button class="btn btn-small baical-profile-edit" data-profile="${config.profileName}">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-small btn-danger baical-profile-delete" data-profile="${config.profileName}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `).join('');

        profilesList.innerHTML = profilesHTML;
    }

    /**
     * Render sync status
     */
    renderSyncStatus() {
        const syncStatusContainer = document.getElementById('baical-sync-status');
        if (!syncStatusContainer) return;

        const status = this.baicalConnector.getStatus();
        
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
                    const result = await this.baicalConnector.testSync(config.profileName);
                    if (result.success) {
                        successCount++;
                        if (result.contacts && result.contacts.length > 0) {
                            await this.handleReceivedContacts(result.contacts, config.profileName);
                        }
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
            const result = await this.baicalConnector.testSync(profileName);
            
            if (result.success) {
                if (result.contacts && result.contacts.length > 0) {
                    await this.handleReceivedContacts(result.contacts, profileName);
                }
                this.updateSyncIndicator('connected');
                this.showNotification(`${profileName} synced successfully`, 'success');
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
     * Edit profile (placeholder for future implementation)
     */
    editProfile(profileName) {
        console.log('✏️ Edit profile:', profileName);
        this.showNotification('Profile editing will be implemented soon', 'info');
    }

    /**
     * Delete profile
     */
    async deleteProfile(profileName) {
        if (!confirm(`Delete Baical profile "${profileName}"?`)) {
            return;
        }

        try {
            const result = await this.configManager.deleteConfiguration(profileName);
            
            if (result.success) {
                await this.baicalConnector.disconnect(profileName);
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
     * Clear connection form
     */
    clearConnectionForm() {
        const form = document.getElementById('baical-connection-form');
        if (form) {
            form.reset();
        }
        
        const statusElement = document.getElementById('baical-connection-status');
        if (statusElement) {
            statusElement.innerHTML = '';
        }
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
}