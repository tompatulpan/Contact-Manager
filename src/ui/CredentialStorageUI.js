/**
 * UI Controller for Secure Credential Storage
 * 
 * Provides user interface for:
 * - Master password setup
 * - Credential storage consent
 * - Storage method selection
 * - Private browsing mode handling
 */

import { SecureCredentialStorage } from '../utils/SecureCredentialStorage.js';

export class CredentialStorageUI {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.credentialStorage = new SecureCredentialStorage();
        this.currentProfile = null;
    }

    /**
     * Initialize credential storage UI
     */
    async initialize() {
        // Check storage availability
        const info = this.credentialStorage.getStorageInfo();
        
        if (info.isPrivateBrowsing) {
            this.showPrivateBrowsingNotice();
        }

        return info;
    }

    /**
     * Show private browsing notice with storage options
     */
    showPrivateBrowsingNotice() {
        const notice = document.createElement('div');
        notice.id = 'private-browsing-notice';
        notice.className = 'credential-notice private-browsing';
        notice.innerHTML = `
            <div class="notice-content">
                <div class="notice-icon">🔒</div>
                <div class="notice-text">
                    <h4>Private Browsing Mode Detected</h4>
                    <p>To save your CardDAV credentials, you can:</p>
                    <ul>
                        <li>✅ <strong>Set a master password</strong> - Credentials encrypted in memory (this session only)</li>
                        <li>⚠️ <strong>Session storage</strong> - Credentials cleared when tab closes</li>
                        <li>❌ <strong>Don't save</strong> - Enter credentials each time you connect</li>
                    </ul>
                </div>
                <div class="notice-actions">
                    <button id="setup-master-password-btn" class="btn btn-primary">
                        🔐 Set Master Password
                    </button>
                    <button id="use-session-storage-btn" class="btn btn-secondary">
                        Use Session Storage
                    </button>
                    <button id="dismiss-notice-btn" class="btn btn-text">
                        Don't Save
                    </button>
                </div>
            </div>
        `;

        // Insert at top of main content area
        const mainContent = document.querySelector('.main-content') || document.body;
        mainContent.insertBefore(notice, mainContent.firstChild);

        // Attach event listeners
        this.attachNoticeEventListeners();
    }

    /**
     * Attach event listeners to notice buttons
     */
    attachNoticeEventListeners() {
        const setupBtn = document.getElementById('setup-master-password-btn');
        const sessionBtn = document.getElementById('use-session-storage-btn');
        const dismissBtn = document.getElementById('dismiss-notice-btn');

        if (setupBtn) {
            setupBtn.addEventListener('click', () => this.showMasterPasswordSetup());
        }

        if (sessionBtn) {
            sessionBtn.addEventListener('click', () => {
                this.hideNotice();
                this.showToast('Session storage enabled - credentials will be cleared on tab close', 'info');
            });
        }

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => this.hideNotice());
        }
    }

    /**
     * Hide private browsing notice
     */
    hideNotice() {
        const notice = document.getElementById('private-browsing-notice');
        if (notice) {
            notice.remove();
        }
    }

    /**
     * Show master password setup modal
     */
    showMasterPasswordSetup() {
        const modal = document.createElement('div');
        modal.id = 'master-password-modal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal-content credential-modal">
                <div class="modal-header">
                    <h3>🔐 Set Master Password</h3>
                    <button class="close-btn" id="close-master-password-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="modal-description">
                        Your master password will be used to encrypt your CardDAV credentials in memory.
                        <strong>This password is never stored</strong> - you'll need to re-enter it each time you open this tab.
                    </p>
                    
                    <div class="form-group">
                        <label for="master-password-input">Master Password</label>
                        <input type="password" 
                               id="master-password-input" 
                               class="form-control"
                               placeholder="Enter a strong password"
                               autocomplete="new-password">
                        <small class="form-hint">Use a password you'll remember for this session</small>
                    </div>

                    <div class="form-group">
                        <label for="master-password-confirm">Confirm Password</label>
                        <input type="password" 
                               id="master-password-confirm" 
                               class="form-control"
                               placeholder="Re-enter your password"
                               autocomplete="new-password">
                    </div>

                    <div class="password-strength" id="password-strength">
                        <div class="strength-bar">
                            <div class="strength-fill" id="strength-fill"></div>
                        </div>
                        <div class="strength-text" id="strength-text">Password strength: <span>-</span></div>
                    </div>

                    <div class="security-info">
                        <h4>🛡️ Security Information</h4>
                        <ul>
                            <li>✅ Credentials encrypted using AES-256-GCM</li>
                            <li>✅ Master password never stored or transmitted</li>
                            <li>✅ Encryption keys generated in your browser</li>
                            <li>⚠️ Lost password = lost credentials (memory cleared on tab close)</li>
                        </ul>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="cancel-master-password-btn" class="btn btn-secondary">Cancel</button>
                    <button id="confirm-master-password-btn" class="btn btn-primary">
                        🔐 Enable Encryption
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Attach event listeners
        this.attachMasterPasswordListeners();
    }

    /**
     * Attach event listeners to master password modal
     */
    attachMasterPasswordListeners() {
        const passwordInput = document.getElementById('master-password-input');
        const confirmInput = document.getElementById('master-password-confirm');
        const confirmBtn = document.getElementById('confirm-master-password-btn');
        const cancelBtn = document.getElementById('cancel-master-password-btn');
        const closeBtn = document.getElementById('close-master-password-modal');

        // Password strength indicator
        if (passwordInput) {
            passwordInput.addEventListener('input', (e) => {
                this.updatePasswordStrength(e.target.value);
            });
        }

        // Confirm button
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const password = passwordInput?.value;
                const confirm = confirmInput?.value;

                if (!password || !confirm) {
                    this.showToast('Please fill in both password fields', 'error');
                    return;
                }

                if (password !== confirm) {
                    this.showToast('Passwords do not match', 'error');
                    return;
                }

                if (password.length < 8) {
                    this.showToast('Password must be at least 8 characters', 'error');
                    return;
                }

                // Set master password
                const success = await this.credentialStorage.setMasterPassword(password);
                
                if (success) {
                    this.closeMasterPasswordModal();
                    this.hideNotice();
                    this.showToast('🔐 Master password set - encrypted storage enabled', 'success');
                    
                    // Emit event
                    this.eventBus?.emit('credentialStorage:masterPasswordSet', {
                        encryptionEnabled: true
                    });
                } else {
                    this.showToast('Failed to set master password', 'error');
                }
            });
        }

        // Cancel/Close buttons
        [cancelBtn, closeBtn].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => this.closeMasterPasswordModal());
            }
        });
    }

    /**
     * Update password strength indicator
     */
    updatePasswordStrength(password) {
        const strengthFill = document.getElementById('strength-fill');
        const strengthText = document.getElementById('strength-text');

        if (!password) {
            if (strengthFill) strengthFill.style.width = '0%';
            if (strengthText) strengthText.innerHTML = 'Password strength: <span>-</span>';
            return;
        }

        // Calculate strength
        let strength = 0;
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
        if (/\d/.test(password)) strength++;
        if (/[^a-zA-Z0-9]/.test(password)) strength++;

        const percentage = (strength / 5) * 100;
        const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
        const colors = ['#ff4444', '#ff8800', '#ffbb33', '#00C851', '#007E33'];
        const level = Math.min(strength, levels.length - 1);

        if (strengthFill) {
            strengthFill.style.width = `${percentage}%`;
            strengthFill.style.backgroundColor = colors[level];
        }

        if (strengthText) {
            strengthText.innerHTML = `Password strength: <span style="color: ${colors[level]}">${levels[level]}</span>`;
        }
    }

    /**
     * Close master password modal
     */
    closeMasterPasswordModal() {
        const modal = document.getElementById('master-password-modal');
        if (modal) {
            modal.remove();
        }
    }

    /**
     * Show storage consent dialog before storing credentials
     */
    async showStorageConsent(profileName, credentials) {
        console.log('🔐 showStorageConsent called with:', { profileName, hasCredentials: !!credentials });
        
        return new Promise((resolve) => {
            const info = this.credentialStorage.getStorageInfo();
            console.log('🔐 Storage info:', info);
            
            const modal = document.createElement('div');
            modal.id = 'storage-consent-modal';
            modal.className = 'modal-overlay active';
            console.log('🔐 Modal element created:', modal);
            
            let storageOptionsHTML = '';
            
            if (info.isPrivateBrowsing && !info.hasEncryptionKey) {
                // Private browsing without master password
                storageOptionsHTML = `
                    <div class="storage-option">
                        <input type="radio" id="storage-session" name="storage-method" value="session" checked>
                        <label for="storage-session">
                            <strong>Session Storage (Temporary)</strong>
                            <p>Credentials saved for this tab only. Cleared when you close the tab.</p>
                        </label>
                    </div>
                    <div class="storage-option disabled">
                        <input type="radio" id="storage-encrypted" name="storage-method" value="encrypted" disabled>
                        <label for="storage-encrypted">
                            <strong>Encrypted Memory (Recommended)</strong>
                            <p>⚠️ Requires master password. Click "Set Master Password" above first.</p>
                        </label>
                    </div>
                `;
            } else if (info.isPrivateBrowsing && info.hasEncryptionKey) {
                // Private browsing with master password
                storageOptionsHTML = `
                    <div class="storage-option">
                        <input type="radio" id="storage-encrypted" name="storage-method" value="encrypted" checked>
                        <label for="storage-encrypted">
                            <strong>Encrypted Memory (Recommended)</strong>
                            <p>Credentials encrypted with your master password. Secure and private.</p>
                        </label>
                    </div>
                    <div class="storage-option">
                        <input type="radio" id="storage-session" name="storage-method" value="session">
                        <label for="storage-session">
                            <strong>Session Storage (Less Secure)</strong>
                            <p>Credentials stored unencrypted. Use only if encryption fails.</p>
                        </label>
                    </div>
                `;
            } else {
                // Regular browsing mode
                storageOptionsHTML = `
                    <div class="storage-option">
                        <input type="radio" id="storage-encrypted" name="storage-method" value="encrypted" checked>
                        <label for="storage-encrypted">
                            <strong>Encrypted Storage (Recommended)</strong>
                            <p>Credentials encrypted and saved. You'll be asked for master password on next visit.</p>
                        </label>
                    </div>
                    <div class="storage-option">
                        <input type="radio" id="storage-session" name="storage-method" value="session">
                        <label for="storage-session">
                            <strong>Session Only</strong>
                            <p>Credentials cleared when browser closes. Re-enter credentials next time.</p>
                        </label>
                    </div>
                    <div class="storage-option">
                        <input type="radio" id="storage-none" name="storage-method" value="none">
                        <label for="storage-none">
                            <strong>Don't Save</strong>
                            <p>Enter credentials manually each time you connect.</p>
                        </label>
                    </div>
                `;
            }

            modal.innerHTML = `
                <div class="modal-content credential-modal">
                    <div class="modal-header">
                        <h3>💾 Save CardDAV Credentials?</h3>
                        <button class="close-btn" id="close-storage-consent">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p class="modal-description">
                            Profile: <strong>${profileName}</strong><br>
                            Server: <code>${credentials.serverUrl}</code><br>
                            Username: <code>${credentials.username}</code>
                        </p>

                        <div class="storage-options">
                            ${storageOptionsHTML}
                        </div>

                        ${info.isPrivateBrowsing ? `
                            <div class="info-box">
                                <div class="info-icon">🔒</div>
                                <div class="info-text">
                                    <strong>Private Browsing Mode</strong><br>
                                    localStorage is not available in private browsing. Credentials will be stored in memory only.
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button id="cancel-storage-consent" class="btn btn-secondary">Cancel</button>
                        <button id="confirm-storage-consent" class="btn btn-primary">Save Credentials</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            console.log('🔐 Modal appended to body');
            console.log('🔐 Modal in DOM?', document.getElementById('storage-consent-modal'));

            // Event listeners
            const confirmBtn = document.getElementById('confirm-storage-consent');
            const cancelBtn = document.getElementById('cancel-storage-consent');
            const closeBtn = document.getElementById('close-storage-consent');
            
            console.log('🔐 Buttons found:', { confirmBtn: !!confirmBtn, cancelBtn: !!cancelBtn, closeBtn: !!closeBtn });

            const cleanup = () => {
                modal.remove();
            };

            confirmBtn?.addEventListener('click', async () => {
                const selected = document.querySelector('input[name="storage-method"]:checked');
                const method = selected?.value || 'session';

                let options = {
                    usePersistentStorage: method !== 'session' && method !== 'none',
                    useEncryption: method === 'encrypted',
                    rememberPassword: method === 'encrypted' && !info.isPrivateBrowsing
                };

                if (method === 'none') {
                    cleanup();
                    resolve({ saved: false, method: 'none' });
                    return;
                }

                const result = await this.credentialStorage.storeCredentials(
                    profileName,
                    credentials,
                    options
                );

                cleanup();
                
                if (result.success) {
                    this.showToast(`✅ Credentials saved using ${result.method}`, 'success');
                    resolve({ saved: true, method: result.method });
                } else {
                    this.showToast(`❌ Failed to save credentials: ${result.error}`, 'error');
                    resolve({ saved: false, error: result.error });
                }
            });

            [cancelBtn, closeBtn].forEach(btn => {
                btn?.addEventListener('click', () => {
                    cleanup();
                    resolve({ saved: false, cancelled: true });
                });
            });
        });
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        // Use existing toast system if available
        if (this.eventBus) {
            this.eventBus.emit('ui:notification', { message, type });
        } else {
            // Fallback to console
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Get stored credentials for a profile
     */
    async getStoredCredentials(profileName) {
        return await this.credentialStorage.getCredentials(profileName);
    }

    /**
     * Remove stored credentials for a profile
     */
    async removeStoredCredentials(profileName) {
        const result = await this.credentialStorage.removeCredentials(profileName);
        if (result.success) {
            this.showToast(`Credentials removed for ${profileName}`, 'success');
        }
        return result;
    }
}
