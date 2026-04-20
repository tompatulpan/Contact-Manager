/**
 * SyncValidator - Validates sync results and checks server health
 * Extracted from BaikalConnector for modularity.
 */
import { PERFORMANCE_CONFIG } from '../config/app.config.js';

export class SyncValidator {
    constructor(connector) {
        this.connector = connector;
    }

    get contactManager() { return this.connector.contactManager; }
    get connections() { return this.connector.connections; }

    async validateSyncResult(serverContacts, profileName) {
        if (!this.contactManager) {
            console.warn('⚠️ ContactManager not set, skipping sync validation');
            return;
        }

        const localContacts = Array.from(this.contactManager.contacts.values())
            .filter(c => !c.metadata?.isDeleted && !c.metadata?.isArchived);

        // Check 1: Zero contacts from server
        if (serverContacts.length === 0 && localContacts.length > 0) {
            const profile = this.connections.get(profileName);
            console.error('❌ SYNC VALIDATION FAILED:');
            console.error(`   📊 Server contacts: ${serverContacts.length}`);
            console.error(`   📊 Local contacts: ${localContacts.length}`);
            console.error(`   🔗 Server URL: ${profile?.serverUrl || 'unknown'}`);
            console.error(`   📁 Addressbook: ${profile?.addressbookUrl || 'unknown'}`);
            console.error('');
            console.error('⚠️ POSSIBLE CAUSES:');
            console.error('   1. Radicale server was restarted and lost data (in-memory storage?)');
            console.error('   2. Wrong addressbook path in connection settings');
            console.error('   3. Server configuration changed');
            console.error('   4. Network/CORS issue preventing data retrieval');
            console.error('');
            console.error('💡 TO FIX:');
            console.error('   1. Check if Radicale server is running: http://127.0.0.1:5232');
            console.error('   2. Verify addressbook exists: /test/contacts/');
            console.error('   3. Re-push contacts: Click "Manual Push" in CardDAV settings');

            this.showServerEmptyWarning(profileName, serverContacts.length, localContacts.length, profile);

            throw new Error(
                `SAFETY ABORT: Server returned 0 contacts but you have ${localContacts.length} local contacts. ` +
                `This indicates a server error. Aborting sync to prevent data loss. See console for details.`
            );
        }

        // Check 2: Massive contact drop (>50% reduction)
        const localSyncedCount = localContacts.filter(c =>
            c.metadata?.cardDAV?.lastSyncedAt &&
            c.metadata?.cardDAV?.profileName === profileName
        ).length;

        if (localSyncedCount > 10 && serverContacts.length < localSyncedCount * 0.5) {
            const dropPercent = Math.round((1 - serverContacts.length / localSyncedCount) * 100);
            console.error(`❌ SAFETY CHECK: Server contact count dropped ${dropPercent}%`);
            console.error(`   Previous synced: ${localSyncedCount}`);
            console.error(`   Current server: ${serverContacts.length}`);
            console.error(`   Profile: ${profileName}`);

            throw new Error(
                `SAFETY ABORT: Server contact count dropped ${dropPercent}% ` +
                `(from ${localSyncedCount} to ${serverContacts.length}). ` +
                `This may indicate a server error. Aborting sync to prevent mass deletion.`
            );
        }

        if (localSyncedCount > 0) {
            console.log(`📊 Sync validation: ${serverContacts.length} server contacts vs ${localSyncedCount} previously synced with ${profileName}`);
        } else {
            console.log(`📊 Initial sync for profile "${profileName}": ${serverContacts.length} server contacts`);
        }

        // Check 3: Missing ETags
        if (serverContacts.length > 0) {
            const contactsWithoutETag = serverContacts.filter(c => !c.etag).length;
            if (contactsWithoutETag / serverContacts.length > 0.9) {
                console.warn(
                    `⚠️ WARNING: ${Math.round(contactsWithoutETag / serverContacts.length * 100)}% ` +
                    `of contacts missing ETags. Server may be returning incomplete data.`
                );
            }
        }

        console.log(`✅ Sync validation passed: ${serverContacts.length} contacts from server`);
    }

    showServerEmptyWarning(profileName, serverCount, localCount, profile) {
        const warningHTML = `
            <div class="server-empty-warning" style="
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: white; border: 3px solid #dc3545; border-radius: 12px;
                padding: 30px; max-width: 600px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                z-index: 10000; font-family: system-ui, -apple-system, sans-serif;
            ">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 64px; margin-bottom: 10px;">⚠️</div>
                    <h2 style="color: #dc3545; margin: 0; font-size: 24px;">CardDAV Server Empty!</h2>
                </div>
                <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                    <p style="margin: 0; font-size: 16px; line-height: 1.6;">
                        <strong>Server returned 0 contacts</strong> but you have <strong>${localCount} local contacts</strong>.<br>
                        Sync has been <strong>aborted to prevent data loss</strong>.
                    </p>
                </div>
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 16px; margin-bottom: 10px; color: #333;">🔍 Possible Causes:</h3>
                    <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                        <li>CardDAV server was restarted (in-memory storage)</li>
                        <li>Wrong addressbook path in settings</li>
                        <li>Server configuration changed</li>
                        <li>Network connectivity issue</li>
                    </ul>
                </div>
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 16px; margin-bottom: 10px; color: #333;">💡 Recommended Actions:</h3>
                    <ol style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                        <li>Check if CardDAV server is running</li>
                        <li>Verify addressbook path: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${profile?.addressbookUrl || 'N/A'}</code></li>
                        <li>Click <strong>"Manual Push"</strong> to restore ${localCount} contacts to server</li>
                    </ol>
                </div>
                <div style="text-align: center;">
                    <button data-action="dismiss-server-warning" style="
                        background: #007bff; color: white; border: none; padding: 12px 30px;
                        border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: 600;
                    ">I Understand</button>
                </div>
            </div>
            <div class="modal-overlay-server-warning" data-action="dismiss-server-warning" style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); z-index: 9999;
            "></div>
        `;

        document.querySelectorAll('.server-empty-warning, .modal-overlay-server-warning').forEach(el => el.remove());
        document.body.insertAdjacentHTML('beforeend', warningHTML);

        // Attach dismiss handlers (CSP-safe — no inline onclick)
        document.querySelectorAll('[data-action="dismiss-server-warning"]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.server-empty-warning, .modal-overlay-server-warning').forEach(e => e.remove());
            });
        });

        console.log('🚨 Server empty warning displayed to user');
    }

    async performHealthCheck(profileName) {
        try {
            const connection = this.connections.get(profileName);
            if (!connection) {
                return { healthy: false, reason: 'No connection found for profile' };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(),
                PERFORMANCE_CONFIG?.networkTimeout || 5000);

            try {
                const response = await fetch(connection.serverUrl, {
                    method: 'HEAD',
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Basic ${Buffer.from(
                            `${connection.username}:${connection.password}`
                        ).toString('base64')}`
                    }
                });
                clearTimeout(timeoutId);

                if (response.ok || response.status === 401) {
                    return { healthy: true };
                } else {
                    return { healthy: false, reason: `Server returned ${response.status}` };
                }
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (error) {
            return { healthy: false, reason: `Health check failed: ${error.message}` };
        }
    }
}
