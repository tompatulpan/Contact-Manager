/**
 * ICloudConnector - Dedicated iCloud CardDAV sync
 * 
 * DESIGN: One-way export only (push, no pull)
 * - Simplified for iCloud's single addressbook architecture
 * - No ETag tracking (always overwrite)
 * - No conflict resolution (Contact Manager is authority)
 * - Automatic vCard 3.0 conversion
 * 
 * This class separates iCloud logic from general CardDAV (BaikalConnector)
 */

class ICloudConnector {
    constructor(eventBus, contactManager, vCard3Processor) {
        this.eventBus = eventBus;
        this.contactManager = contactManager;
        this.vCard3Processor = vCard3Processor;
        this.bridgeUrl = 'http://localhost:3001/api';
        this.connections = new Map(); // profileName → connection config
        this.isConnected = false;
    }

    /**
     * Connect to iCloud CardDAV server
     * Simplified: No discovery needed for one-way export
     * Just stores credentials for push operations
     * 
     * @param {Object} config - iCloud connection config
     * @returns {Promise<Object>} Connection result
     */
    async connect(config) {
        try {
            console.log('🍎 Connecting to iCloud CardDAV (one-way export mode)...');
            
            // For one-way export, we don't need to discover addressbooks
            // Just store the connection config for push operations
            this.connections.set(config.profileName, {
                ...config,
                serverUrl: config.serverUrl,
                username: config.username,
                password: config.password,
                addressbooks: [{ 
                    displayName: 'iCloud Contacts',
                    href: '/carddavhome/card/'  // iCloud's standard addressbook path
                }],
                connectedAt: new Date().toISOString(),
                mode: 'one-way-export'
            });
            this.isConnected = true;
            
            console.log(`✅ iCloud connected in one-way export mode`);
            console.log(`   Profile: ${config.profileName}`);
            console.log(`   Server: ${config.serverUrl}`);
            console.log(`   Username: ${config.username}`);
            
            return { 
                success: true, 
                addressbooks: [{ displayName: 'iCloud Contacts', href: '/carddavhome/card/' }],
                mode: 'one-way-export'
            };

        } catch (error) {
            console.error('❌ iCloud connection failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Push single contact to iCloud (one-way export)
     * ALWAYS regenerates vCard from contact data to ensure freshness
     * 
     * @param {Object} contact - Contact object with vcard field
     * @param {string} profileName - iCloud profile name
     * @returns {Promise<Object>} Push result
     */
    async pushContact(contact, profileName) {
        if (!contact) {
            throw new Error(`Contact object is null`);
        }

        console.log(`🍎 iCloud export: ${contact.cardName}`);

        const connectionInfo = this.connections.get(profileName);
        if (!connectionInfo) {
            throw new Error(`iCloud profile "${profileName}" not connected`);
        }

        try {
            // 🔄 CRITICAL FIX: Always regenerate vCard from contact data
            // This ensures we send FRESH data, not stale cached vCard
            let vCardToSend;
            let uid = this.contactManager.extractUIDFromVCard(contact.vcard);
            
            if (!uid) {
                uid = contact.contactId;
            }

            // Parse existing vCard to get contact data
            const vCardData = this.contactManager.vCardStandard.parseVCard(contact.vcard);
            
            // Extract all properties into flat structure
            const contactData = {
                fn: vCardData.properties.get('FN') || contact.cardName || 'Unknown',
                org: vCardData.properties.get('ORG'),
                title: vCardData.properties.get('TITLE'),
                note: vCardData.properties.get('NOTE'),
                bday: vCardData.properties.get('BDAY'),
                uid: uid // Ensure UID is preserved
            };

            // Extract multi-value properties
            const telArray = vCardData.properties.get('TEL');
            if (telArray && Array.isArray(telArray)) {
                contactData.phones = telArray.map(tel => ({
                    value: tel.value,
                    type: tel.parameters?.TYPE || 'voice',
                    primary: tel.parameters?.PREF === '1'
                }));
            }

            const emailArray = vCardData.properties.get('EMAIL');
            if (emailArray && Array.isArray(emailArray)) {
                contactData.emails = emailArray.map(email => ({
                    value: email.value,
                    type: email.parameters?.TYPE || 'internet',
                    primary: email.parameters?.PREF === '1'
                }));
            }

            const urlArray = vCardData.properties.get('URL');
            if (urlArray && Array.isArray(urlArray)) {
                contactData.urls = urlArray.map(url => ({
                    value: url.value,
                    type: url.parameters?.TYPE || 'work',
                    primary: url.parameters?.PREF === '1'
                }));
            }

            const adrArray = vCardData.properties.get('ADR');
            if (adrArray && Array.isArray(adrArray)) {
                contactData.addresses = adrArray.map(adr => ({
                    value: adr.value,
                    type: adr.parameters?.TYPE || 'home',
                    primary: adr.parameters?.PREF === '1'
                }));
            }

            // Regenerate fresh vCard 4.0
            vCardToSend = this.contactManager.vCardStandard.generateVCard(contactData);

            console.log(`🔄 Regenerated fresh vCard from contact data`);
            console.log(`📋 Using vCard with UID: ${uid}`);
            console.log(`📄 vCard length: ${vCardToSend.length} bytes`);
            console.log(`🔍 vCard preview: ${vCardToSend.substring(0, 200)}...`);

            // Convert to vCard 3.0 for iCloud compatibility
            // CRITICAL: Pass UID to ensure it's preserved during conversion
            const vCard3Result = this.vCard3Processor.export({
                contactId: contact.contactId,
                cardName: contact.cardName,
                vcard: vCardToSend,
                metadata: contact.metadata,
                uid: uid  // 🔑 CRITICAL: Preserve original UID to prevent duplicates
            });

            if (vCard3Result && vCard3Result.content) {
                vCardToSend = vCard3Result.content;
                console.log(`✅ Converted to vCard 3.0 for iCloud`);
            }

            // Push to bridge server
            const response = await fetch(`${this.bridgeUrl}/push/${profileName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contact: {
                        uid: uid,
                        vcard: vCardToSend,
                        etag: null  // iCloud: always overwrite
                    },
                    addressbook: 'default',
                    forceOverwrite: true
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log(`✅ iCloud push successful: ${contact.cardName}`);
            } else {
                console.error(`❌ iCloud push failed: ${result.error}`);
            }

            return result;

        } catch (error) {
            console.error(`❌ iCloud push error for ${contact.cardName}:`, error);
            return { success: false, error: error.message };
        }
    }
    /**
     * Push all contacts to iCloud
     * Gets contacts from ContactManager cache
     * 
     * @param {string} profileName - iCloud profile name
     * @returns {Promise<Object>} Push result
     */
    async pushAllContacts(profileName) {
        try {
            console.log(`🍎 iCloud: Starting push all contacts...`);

            // 🔒 CRITICAL: Set syncInProgress flag to prevent cache corruption during push
            // This prevents handleContactsChanged from clearing the contacts Map
            this.contactManager.syncInProgress = true;
            console.log('🔒 Sync lock enabled - cache protected during push');

            // Get all contacts from ContactManager
            const allContacts = this.contactManager.getAllOwnedContacts();
            
            console.log(`📤 Got ${allContacts.length} contacts from ContactManager`);
            
            // Log first contact to verify data freshness
            if (allContacts.length > 0) {
                const firstContact = allContacts[0];
                console.log(`🔍 Sample contact: ${firstContact.cardName}`);
                console.log(`📄 Sample vCard preview: ${firstContact.vcard.substring(0, 200)}...`);
            }

            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            // Push in batches
            const BATCH_SIZE = 10;
            for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
                const batch = allContacts.slice(i, i + BATCH_SIZE);
                const batchPromises = batch.map(contact => 
                    this.pushContact(contact, profileName)
                );

                const results = await Promise.all(batchPromises);
                
                results.forEach((result, idx) => {
                    if (result.success) {
                        successCount++;
                    } else {
                        errorCount++;
                        errors.push({
                            contact: batch[idx].cardName,
                            error: result.error
                        });
                    }
                });

                console.log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1} complete: ${results.filter(r => r.success).length}/${batch.length} succeeded`);
            }

            console.log(`✅ iCloud push complete: ${successCount}/${allContacts.length} succeeded, ${errorCount} failed`);

            // 🔓 CRITICAL: Release sync lock
            this.contactManager.syncInProgress = false;
            console.log('🔓 Sync lock released - cache operations resumed');

            return {
                success: successCount > 0,
                successCount,
                errorCount,
                total: allContacts.length,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            console.error('❌ iCloud push all failed:', error);
            
            // 🔓 CRITICAL: Always release sync lock, even on error
            this.contactManager.syncInProgress = false;
            console.log('🔓 Sync lock released (error cleanup)');
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect from iCloud
     */
    disconnect(profileName) {
        this.connections.delete(profileName);
        if (this.connections.size === 0) {
            this.isConnected = false;
        }
        console.log(`🍎 iCloud profile ${profileName} disconnected`);
    }

    /**
     * Get connection status
     */
    getConnectionStatus(profileName) {
        const connection = this.connections.get(profileName);
        return {
            isConnected: !!connection,
            connectedAt: connection?.connectedAt,
            addressbooksCount: connection?.addressbooks?.length || 0
        };
    }
}

// Export for ES6 modules
export { ICloudConnector };
