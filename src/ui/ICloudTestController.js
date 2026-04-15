/**
 * iCloud Test Controller
 * Handles UI for testing iCloud CardDAV integration
 */

export class ICloudTestController {
    constructor(eventBus, contactManager, iCloudSyncService = null, ICloudCardDAVClient = null) {
        this.eventBus = eventBus;
        this.contactManager = contactManager;
        this.iCloudSyncService = iCloudSyncService;
        this.ICloudCardDAVClient = ICloudCardDAVClient;
        this.iCloudClient = null;
        this.fetchedContacts = [];
        
        // Defer initialization until DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeUI());
        } else {
            this.initializeUI();
        }
    }

    initializeUI() {
        console.log('🍎 Initializing iCloud Test Controller...');
        
        // Modal open button
        const testBtn = document.getElementById('icloud-test-btn');
        if (testBtn) {
            console.log('✅ Found icloud-test-btn, adding click handler');
            testBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🍎 iCloud Test button clicked!');
                this.openModal();
            });
        } else {
            console.warn('⚠️ icloud-test-btn not found in DOM');
        }

        // Modal close button
        const closeBtn = document.getElementById('close-icloud-test-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }

        // Test buttons
        document.getElementById('icloud-connect-btn')?.addEventListener('click', () => this.testConnect());
        document.getElementById('icloud-fetch-btn')?.addEventListener('click', () => this.testFetch());
        document.getElementById('icloud-push-btn')?.addEventListener('click', () => this.testPush());
        document.getElementById('icloud-import-btn')?.addEventListener('click', () => this.testImport());
        
        // Auto-sync buttons
        document.getElementById('icloud-start-autosync-btn')?.addEventListener('click', () => this.startAutoSync());
        document.getElementById('icloud-stop-autosync-btn')?.addEventListener('click', () => this.stopAutoSync());
        document.getElementById('icloud-sync-now-btn')?.addEventListener('click', () => this.syncNow());
        
        // Setup event listeners for sync service events
        if (this.iCloudSyncService) {
            this.setupSyncEventListeners();
        }
        
        console.log('✅ iCloud Test Controller initialized');
    }

    openModal() {
        console.log('📂 Opening iCloud test modal...');
        const modal = document.getElementById('icloud-test-modal');
        if (modal) {
            console.log('✅ Found modal, adding active class');
            modal.classList.add('active');
            modal.style.display = 'flex'; // Force display
            this.log('ℹ️ Ready to test iCloud sync', 'info');
        } else {
            console.error('❌ icloud-test-modal not found in DOM!');
        }
    }

    closeModal() {
        const modal = document.getElementById('icloud-test-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    getCredentials() {
        const emailField = document.getElementById('icloud-email');
        const passwordField = document.getElementById('icloud-password');
        
        console.log('🔍 Getting credentials from fields:', {
            emailField: !!emailField,
            passwordField: !!passwordField,
            emailValue: emailField?.value,
            passwordValue: passwordField?.value ? '***' : null
        });
        
        const email = emailField?.value.trim();
        const password = passwordField?.value.trim();

        if (!email || !password) {
            this.log('❌ Please enter both email and password', 'error');
            console.error('❌ Credentials validation failed:', { 
                hasEmail: !!email, 
                hasPassword: !!password 
            });
            return null;
        }

        console.log('✅ Credentials retrieved successfully');
        return { email, password };
    }

    async testConnect() {
        this.clearLog();
        this.log('🔌 Test 1: Connecting to iCloud...', 'info');

        const creds = this.getCredentials();
        console.log('🔐 Retrieved credentials:', { 
            hasEmail: !!creds?.email, 
            emailLength: creds?.email?.length,
            hasPassword: !!creds?.password,
            passwordLength: creds?.password?.length 
        });
        if (!creds) return;

        try {
            // Initialize iCloud client
            const ICloudCardDAVClient = this.ICloudCardDAVClient || window.ICloudCardDAVClient;
            if (!ICloudCardDAVClient) {
                this.log('❌ ICloudCardDAVClient not loaded', 'error');
                return;
            }

            // Use config values instead of hardcoded URLs
            // Note: Constructor expects (username, password) - pass email as username
            this.iCloudClient = new ICloudCardDAVClient(
                creds.email,  // username parameter (iCloud uses email as username)
                creds.password
                // proxyUrl defaults to APP_CONFIG.iCloud.proxyUrl in constructor
            );

            this.log('📡 Discovering principal URL...', 'info');
            const result = await this.iCloudClient.connect();

            if (result.success) {
                this.log(`✅ Connected successfully!`, 'success');
                this.log(`   Principal: ${result.principalUrl}`, 'success');
                this.log(`   Address Book: ${result.addressBookUrl}`, 'success');

                // Also initialize ICloudSyncService so instant auto-push works immediately
                if (this.iCloudSyncService && !this.iCloudSyncService.isConnected) {
                    this.log('🔄 Initializing sync service for instant push...', 'info');
                    const syncResult = await this.iCloudSyncService.initialize(creds);
                    if (syncResult.success) {
                        this.log('✅ Sync service ready — edits will push instantly', 'success');
                    } else {
                        this.log(`⚠️ Sync service init failed: ${syncResult.error}`, 'warn');
                    }
                }

                // Enable next buttons
                document.getElementById('icloud-fetch-btn').disabled = false;
                document.getElementById('icloud-push-btn').disabled = false;
                document.getElementById('icloud-start-autosync-btn').disabled = false;
            } else {
                this.log(`❌ Connection failed: ${result.error}`, 'error');
                this.iCloudClient = null;
            }
        } catch (error) {
            this.log(`❌ Error: ${error.message}`, 'error');
            console.error('iCloud connect error:', error);
            this.iCloudClient = null;
        }
    }

    async testFetch() {
        if (!this.iCloudClient) {
            this.log('❌ Not connected. Run Test 1 first!', 'error');
            return;
        }

        this.clearLog();
        this.log('📥 Test 2: Fetching contacts from iCloud...', 'info');

        try {
            const contacts = await this.iCloudClient.fetchContacts();
            this.fetchedContacts = contacts;

            this.log(`✅ Fetched ${contacts.length} contact(s)!`, 'success');

            if (contacts.length > 0) {
                this.log('\n📇 Sample contacts:', 'info');
                contacts.slice(0, 3).forEach((contact, idx) => {
                    this.log(`\n${idx + 1}. ${contact.fullName || 'No name'}`, 'info');
                    this.log(`   UID: ${contact.uid}`, 'info');
                    if (contact.phones.length > 0) {
                        this.log(`   Phone: ${contact.phones[0].value}`, 'info');
                    }
                    if (contact.emails.length > 0) {
                        this.log(`   Email: ${contact.emails[0]}`, 'info');
                    }
                });

                if (contacts.length > 3) {
                    this.log(`\n... and ${contacts.length - 3} more contacts`, 'info');
                }

                // Enable import button
                document.getElementById('icloud-import-btn').disabled = false;
            }
        } catch (error) {
            this.log(`❌ Error: ${error.message}`, 'error');
            console.error('iCloud fetch error:', error);
        }
    }

    async testPush() {
        if (!this.iCloudClient) {
            this.log('❌ Not connected. Run Test 1 first!', 'error');
            return;
        }

        this.clearLog();
        this.log('📤 Test 3: Pushing test contact to iCloud...', 'info');

        try {
            const timestamp = new Date().toISOString().split('T')[0];
            const uid = 'cm_test_' + Date.now();

            const vcard = `BEGIN:VCARD\r
VERSION:3.0\r
FN:CM Test Contact ${timestamp}\r
N:Contact;CM Test;;;${timestamp}\r
TEL;TYPE=CELL:+1-555-CM-TEST\r
EMAIL;TYPE=INTERNET:cm.test@example.com\r
ORG:Contact Manager\r
TITLE:Test Contact\r
NOTE:Created via Contact Manager iCloud integration on ${new Date().toLocaleString()}\r
UID:${uid}\r
END:VCARD\r
`;

            this.log(`📝 Generated vCard with UID: ${uid}`, 'info');

            const result = await this.iCloudClient.createContact(vcard);

            if (result.success) {
                this.log(`✅ Contact created successfully!`, 'success');
                this.log(`   UID: ${result.uid}`, 'success');
                if (result.etag) {
                    this.log(`   ETag: ${result.etag}`, 'success');
                }
                this.log('\n💡 Run Test 2 to see the new contact!', 'info');
            } else {
                this.log(`❌ Failed to create contact: ${result.error}`, 'error');
            }
        } catch (error) {
            this.log(`❌ Error: ${error.message}`, 'error');
            console.error('iCloud push error:', error);
        }
    }

    async testImport() {
        if (this.fetchedContacts.length === 0) {
            this.log('❌ No contacts to import. Run Test 2 first!', 'error');
            return;
        }

        this.clearLog();
        this.log(`🔄 Test 4: Importing ${this.fetchedContacts.length} contacts to Contact Manager...`, 'info');

        try {
            let importedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;

            for (const iCloudContact of this.fetchedContacts) {
                try {
                    // Check if contact already exists by UID
                    const existingContact = this.findContactByUID(iCloudContact.uid);
                    
                    if (existingContact) {
                        this.log(`⏭️ Skipped: ${iCloudContact.fullName} (already exists)`, 'info');
                        skippedCount++;
                        continue;
                    }

                    // Import contact from vCard (use importContactFromVCard method)
                    const result = await this.contactManager.importContactFromVCard(
                        iCloudContact.vcard,
                        iCloudContact.fullName || 'Imported Contact',
                        true // markAsImported
                    );

                    if (result.success) {
                        this.log(`✅ Imported: ${iCloudContact.fullName}`, 'success');
                        importedCount++;
                        
                        // Store import metadata
                        const contact = result.contact;
                        if (contact && contact.metadata) {
                            contact.metadata.importSource = 'iCloud';
                            contact.metadata.importedAt = new Date().toISOString();
                            await this.contactManager.database.updateContact(contact);
                        }
                    } else {
                        // Show better error message for duplicates
                        if (result.error && result.error.includes('duplicate')) {
                            this.log(`⏭️ Skipped: ${iCloudContact.fullName} (duplicate detected)`, 'info');
                            skippedCount++;
                        } else {
                            this.log(`❌ Failed: ${iCloudContact.fullName}`, 'error');
                            console.error(`Import error for ${iCloudContact.fullName}:`, result.error);
                            errorCount++;
                        }
                    }
                } catch (error) {
                    this.log(`❌ Error importing ${iCloudContact.fullName}: ${error.message}`, 'error');
                    errorCount++;
                }
            }

            this.log(`\n📊 Import complete:`, 'success');
            this.log(`   ✅ Imported: ${importedCount}`, 'success');
            this.log(`   ⏭️ Skipped: ${skippedCount}`, 'info');
            if (errorCount > 0) {
                this.log(`   ❌ Errors: ${errorCount}`, 'error');
            }

            // Refresh contact list
            this.eventBus.emit('contacts:refresh');

        } catch (error) {
            this.log(`❌ Import error: ${error.message}`, 'error');
            console.error('iCloud import error:', error);
        }
    }

    findContactByUID(uid) {
        for (const [contactId, contact] of this.contactManager.contacts) {
            if (contact.vcard && contact.vcard.includes(`UID:${uid}`)) {
                return contact;
            }
        }
        return null;
    }

    log(message, type = 'info') {
        const logDiv = document.getElementById('icloud-log');
        if (!logDiv) return;

        logDiv.style.display = 'block';

        const timestamp = new Date().toLocaleTimeString();
        const colors = {
            info: '#569cd6',
            success: '#4ec9b0',
            error: '#f48771'
        };

        const entry = document.createElement('div');
        entry.style.color = colors[type] || colors.info;
        entry.textContent = `[${timestamp}] ${message}`;
        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    clearLog() {
        const logDiv = document.getElementById('icloud-log');
        if (logDiv) {
            logDiv.innerHTML = '';
            logDiv.style.display = 'none';
        }
    }

    /**
     * Setup event listeners for sync service events
     */
    setupSyncEventListeners() {
        this.eventBus.on('icloud:syncStarted', () => {
            this.updateSyncStatus('Sync in progress...', 'syncing');
        });

        this.eventBus.on('icloud:syncCompleted', (data) => {
            const stats = data.stats || {};
            this.updateSyncStatus(
                `✅ Sync complete: ${stats.pushed || 0} pushed, ${stats.pulled || 0} pulled`,
                'success'
            );
            this.log(`Sync completed: ${stats.pushed || 0} contacts pushed, ${stats.pulled || 0} contacts pulled`, 'success');
        });

        this.eventBus.on('icloud:syncError', (data) => {
            this.updateSyncStatus(`❌ Sync error: ${data.error}`, 'error');
            this.log(`Sync error: ${data.error}`, 'error');
        });

        this.eventBus.on('icloud:autoSyncStarted', (data) => {
            const minutes = Math.round((data.intervalMs || 0) / 60000);
            this.updateSyncStatus(`🔄 Auto-sync started (every ${minutes} minutes)`, 'active');
            this.log(`Auto-sync started with ${minutes} minute interval`, 'success');
        });

        this.eventBus.on('icloud:autoSyncStopped', () => {
            this.updateSyncStatus('⏸️ Auto-sync stopped', 'stopped');
            this.log('Auto-sync stopped', 'info');
        });
    }

    /**
     * Start auto-sync with configured interval
     */
    async startAutoSync() {
        if (!this.iCloudSyncService) {
            this.log('❌ Sync service not available', 'error');
            return;
        }

        if (!this.iCloudClient) {
            this.log('❌ Please connect to iCloud first', 'error');
            return;
        }

        try {
            // Get credentials
            const credentials = this.getCredentials();
            if (!credentials) {
                this.log('❌ Please enter iCloud credentials', 'error');
                return;
            }

            // Initialize sync service if not already initialized
            if (!this.iCloudSyncService.isInitialized) {
                this.log('🔄 Initializing sync service...', 'info');
                await this.iCloudSyncService.initialize(credentials);
            }

            // Get interval from UI
            const intervalInput = document.getElementById('icloud-sync-interval');
            const intervalMinutes = parseInt(intervalInput?.value || '10', 10);

            // Start auto-sync
            this.log(`🚀 Starting auto-sync with ${intervalMinutes} minute interval...`, 'info');
            this.iCloudSyncService.startAutoSync(intervalMinutes);

            // Update UI
            document.getElementById('icloud-start-autosync-btn').style.display = 'none';
            document.getElementById('icloud-stop-autosync-btn').style.display = 'inline-block';
            document.getElementById('icloud-sync-now-btn').disabled = false;
            document.getElementById('icloud-sync-interval').disabled = true;

        } catch (error) {
            this.log(`❌ Failed to start auto-sync: ${error.message}`, 'error');
            console.error('Auto-sync start error:', error);
        }
    }

    /**
     * Stop auto-sync
     */
    stopAutoSync() {
        if (!this.iCloudSyncService) {
            this.log('❌ Sync service not available', 'error');
            return;
        }

        this.log('⏸️ Stopping auto-sync...', 'info');
        this.iCloudSyncService.stopAutoSync();

        // Update UI
        document.getElementById('icloud-start-autosync-btn').style.display = 'inline-block';
        document.getElementById('icloud-stop-autosync-btn').style.display = 'none';
        document.getElementById('icloud-sync-now-btn').disabled = true;
        document.getElementById('icloud-sync-interval').disabled = false;
    }

    /**
     * Perform manual sync now
     */
    async syncNow() {
        if (!this.iCloudSyncService) {
            this.log('❌ Sync service not available', 'error');
            return;
        }

        try {
            // Auto-initialize if not yet connected (user clicked Sync Now without Start Auto-Sync)
            if (!this.iCloudSyncService.isConnected) {
                const credentials = this.getCredentials();
                if (!credentials) {
                    this.log('❌ Please enter iCloud credentials first', 'error');
                    return;
                }
                this.log('🔌 Connecting sync service...', 'info');
                const initResult = await this.iCloudSyncService.initialize(credentials);
                if (!initResult.success) {
                    this.log(`❌ Connection failed: ${initResult.error}`, 'error');
                    return;
                }
                this.log('✅ Connected', 'success');
            }

            this.log('🔄 Manual sync triggered...', 'info');
            const syncResult = await this.iCloudSyncService.performSync();

            if (!syncResult.success) {
                this.log(`❌ Sync failed: ${syncResult.error}`, 'error');
                return;
            }

            // Display per-sync counts (not cumulative totals)
            const pushed = syncResult.pushed?.pushed || 0;
            const pulled = (syncResult.pulled?.imported || 0) + (syncResult.pulled?.updated || 0);
            this.log(`✅ Manual sync complete: ${pushed} pushed, ${pulled} pulled/updated`, 'success');
            
        } catch (error) {
            this.log(`❌ Manual sync failed: ${error.message}`, 'error');
            console.error('Manual sync error:', error);
        }
    }

    /**
     * Update sync status display
     */
    updateSyncStatus(message, status) {
        const statusDiv = document.getElementById('icloud-sync-status');
        if (!statusDiv) return;

        statusDiv.style.display = 'block';
        statusDiv.textContent = message;

        // Update styling based on status
        const statusColors = {
            syncing: { bg: '#fff3cd', text: '#856404' },
            success: { bg: '#d4edda', text: '#155724' },
            error: { bg: '#f8d7da', text: '#721c24' },
            active: { bg: '#d1ecf1', text: '#0c5460' },
            stopped: { bg: '#e2e3e5', text: '#383d41' }
        };

        const colors = statusColors[status] || statusColors.active;
        statusDiv.style.background = colors.bg;
        statusDiv.style.color = colors.text;
    }
}
