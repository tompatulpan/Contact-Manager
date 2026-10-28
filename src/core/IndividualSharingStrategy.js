/**
 * IndividualSharingStrategy - Individual Database per Share Strategy
 * Implements granular contact sharing with separate databases per recipient
 * Optimized for bulk operations with parallel processing and smart batching
 */
export class IndividualSharingStrategy {
    constructor(database) {
        this.database = database;
        this.batchSize = 5; // Limit concurrent operations to avoid overwhelming the service
        this.shareCache = new Map(); // Cache sharing relationships
        this.updateQueue = new Set(); // Queue updates to avoid duplicates
        this.backgroundProcessing = false;
        this.sharingQueue = [];
    }

    /**
     * Project an owner contact into the copy a single recipient is allowed to see.
     *
     * Owner-only state never leaves the owner's database: the recipient list
     * and permission map (`metadata.sharing`), usage analytics, CardDAV sync
     * state, UI state, list membership, and the `CATEGORIES:SHARED:` backup
     * line inside the vCard. The recipient gets contact data plus the
     * attribution relevant to them.
     *
     * @param {Object} contact - Owner's contact
     * @param {string} username - Recipient username
     * @param {Object} extra - Additional recipient-facing metadata to merge
     * @returns {Object} Recipient copy
     */
    buildRecipientContact(contact, username, extra = {}) {
        const {
            sharing, usage, carddav, cardDAV, ui, distributionLists,
            isSharedWithUsers, sharePermissions, sync,
            ...recipientMetadata
        } = contact.metadata || {};

        const vcard = typeof contact.vcard === 'string'
            ? contact.vcard.replace(/\r?\nCATEGORIES:SHARED:[^\r\n]*/g, '')
            : contact.vcard;

        return {
            contactId: contact.contactId,
            cardName: contact.cardName,
            vcard,
            metadata: {
                ...recipientMetadata,
                sharedWith: username,
                sharingType: 'individual',
                ...extra
            }
        };
    }

    /**
     * 🆕 CORE: Share contact with individual user using separate database
     * Creates unique database per sharing relationship for granular control
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @returns {Promise<Object>} Share result
     */
    async shareContactIndividually(contact, username) {
        const startTime = Date.now();
        let databaseOpened = false; // 🔧 Track database opening state
        let sharedDbName = null; // 🔧 Store the actual database name for cleanup
        
        try {
            if (!contact || !username) {
                throw new Error('Contact and username are required');
            }

            // Create unique database name for this specific sharing relationship
            // Remove 'contact_' prefix to avoid double naming  
            const cleanContactId = this.sanitizeContactId(contact.contactId);
            sharedDbName = `shared-contact-${cleanContactId}-to-${username.trim()}`;
            

            // Validate parameters before SDK call
            const insertValidation = this.database.validateInsertItemParams({
                databaseName: sharedDbName,
                item: contact,
                itemId: contact.contactId
            });

            if (!insertValidation.isValid) {
                throw new Error(`Invalid insertItem parameters: ${insertValidation.errors.join(', ')}`);
            }

            const shareValidation = this.database.validateShareDatabaseParams({
                databaseName: sharedDbName,
                username: username.trim(),
                readOnly: true,
                resharingAllowed: false
            });

            if (!shareValidation.isValid) {
                throw new Error(`Invalid shareDatabase parameters: ${shareValidation.errors.join(', ')}`);
            }

            // Create and open the individual database
            await this.database.openDatabase(sharedDbName, () => {
            });
            
            databaseOpened = true; // 🔧 Mark database as successfully opened

            let sharedContact = this.buildRecipientContact(contact, username.trim(), {
                sharedAt: new Date().toISOString(),
                sharedBy: this.database.currentUser?.username,
                originalContactId: contact.contactId,
                lastSharedUpdate: new Date().toISOString()
            });

            // 🔧 CRITICAL FIX: Optimize contact to fit within 10KB Userbase limit
            sharedContact = this.database.optimizeContactForStorage(sharedContact);

            // Check if contact already exists in this database, update if exists, insert if not
            try {
                await this.database.safeInsertItem({
                    databaseName: sharedDbName,
                    item: sharedContact,
                    itemId: contact.contactId
                }, 'shareContactIndividually');
            } catch (insertError) {
                if (insertError.name === 'ItemAlreadyExists') {
                    await this.database.safeUpdateItem({
                        databaseName: sharedDbName,
                        item: sharedContact,
                        itemId: contact.contactId
                    }, 'shareContactIndividually');
                } else {
                    throw insertError; // Re-throw other errors
                }
            }

            // Share database with target user (readOnly by default)
            await this.database.safeShareDatabase({
                databaseName: sharedDbName,
                username: username.trim(),
                readOnly: true,
                resharingAllowed: false
                // requireVerified defaults to true for security ✅
            }, 'shareContactIndividually');

            const duration = Date.now() - startTime;
            
            // Cache the result for performance
            const cacheKey = `${contact.contactId}-${username}`;
            this.shareCache.set(cacheKey, {
                sharedDbName,
                sharedAt: new Date().toISOString(),
                success: true
            });
            
            return { 
                success: true, 
                sharedDbName,
                sharingType: 'individual',
                duration,
                username: username.trim()
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Individual sharing failed for ${username}:`, error);
            
            // 🔧 CRITICAL FIX: Clean up database if sharing failed
            // Only attempt cleanup if we successfully opened the database AND have the database name
            if (databaseOpened && sharedDbName) {
                try {
                    
                    // Try to delete the contact from the database if it was inserted
                    try {
                        await this.database.safeDeleteItem({
                            databaseName: sharedDbName,
                            itemId: contact.contactId
                        }, 'cleanup_failed_share');
                    } catch (deleteError) {
                        console.warn(`⚠️ Could not clean up contact from failed database:`, deleteError.message);
                    }
                    
                    // Note: We don't delete the database itself as Userbase doesn't have a deleteDatabase method
                    // But removing the contact data prevents false positive "already shared" detection
                } catch (cleanupError) {
                    console.warn(`⚠️ Cleanup process failed:`, cleanupError.message);
                }
            } else {
            }
            
            this.database.handleShareDatabaseError(error, 'shareContactIndividually');
            
            return { 
                success: false, 
                error: error.message,
                duration,
                username: username.trim()
            };
        }
    }

    /**
     * 🚀 OPTIMIZED: Share contact with multiple users using parallel processing with batching
     * Time: ~100-200ms instead of n×100ms through smart batching and parallel execution
     * @param {Object} contact - Contact to share
     * @param {Array} usernames - Array of usernames
     * @returns {Promise<Object>} Bulk share result with performance metrics
     */
    async shareContactWithMultipleUsers(contact, usernames) {
        const startTime = Date.now();
        
        try {
            if (!Array.isArray(usernames) || usernames.length === 0) {
                return { 
                    success: false, 
                    error: 'Valid usernames array is required',
                    results: [],
                    successCount: 0,
                    errorCount: 0
                };
            }


            const results = [];
            const uniqueUsernames = [...new Set(usernames.map(u => u.trim()).filter(u => u))];
            
            // Process in batches to avoid overwhelming the network/service
            for (let i = 0; i < uniqueUsernames.length; i += this.batchSize) {
                const batch = uniqueUsernames.slice(i, i + this.batchSize);
                const batchStartTime = Date.now();
                
                
                const batchPromises = batch.map(async (username) => {
                    try {
                        const result = await this.shareContactIndividually(contact, username);
                        return {
                            username,
                            success: result.success,
                            sharedDbName: result.sharedDbName,
                            duration: result.duration,
                            error: result.error
                        };
                    } catch (error) {
                        return {
                            username,
                            success: false,
                            error: error.message,
                            duration: Date.now() - batchStartTime
                        };
                    }
                });
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                
                const batchDuration = Date.now() - batchStartTime;
                const batchSuccessCount = batchResults.filter(r => r.success).length;
                
                // Small delay between batches to be respectful to the service
                if (i + this.batchSize < uniqueUsernames.length) {
                    await this.sleep(50); // 50ms between batches
                }
            }
            
            const totalDuration = Date.now() - startTime;
            const successCount = results.filter(r => r.success).length;
            const errorCount = results.length - successCount;
            const averageDuration = results.length > 0 ? 
                results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length : 0;
            
            
            return {
                success: successCount > 0,
                results,
                successCount,
                errorCount,
                totalDuration,
                averageDuration,
                batchSize: this.batchSize,
                totalBatches: Math.ceil(uniqueUsernames.length / this.batchSize)
            };
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            console.error('❌ Bulk sharing failed:', error);
            return {
                success: false,
                error: error.message,
                results: [],
                successCount: 0,
                errorCount: usernames.length,
                totalDuration
            };
        }
    }

    /**
     * Check whether an error is transient (connection lost / service
     * briefly unavailable). Delegates to ContactDatabase when available and
     * falls back to a name/message check for lighter test doubles.
     * @param {Error} error - The error object
     * @returns {boolean} True if retrying may succeed
     */
    isTransientError(error) {
        if (!error) {
            return false;
        }
        if (typeof this.database?.isTransientError === 'function' && this.database.isTransientError(error)) {
            return true;
        }
        return error.name === 'ServiceUnavailable' ||
            error.name === 'TooManyRequests' ||
            /reconnect|service unavailable/i.test(error.message || '');
    }

    /**
     * Retry an operation on transient errors with exponential backoff.
     * Userbase throws these while reconnecting; waiting a few seconds
     * usually lets the call succeed instead of failing the whole revoke.
     * @param {Function} operation - Async operation to attempt
     * @param {string} context - Context for logging
     * @param {number} maxRetries - Maximum retry attempts (default: 3)
     * @returns {Promise<Object>} Operation result
     */
    async retryTransient(operation, context, maxRetries = 3) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (!this.isTransientError(error) || attempt >= maxRetries) {
                    throw error;
                }
                const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                console.warn(`🚫 Transient ${error.name || 'error'} in ${context}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * Revoke one recipient's access to a contact.
     *
     * Idempotent: deletes the recipient copy (if present) and revokes the
     * recipient's permission on the per-recipient database. Each step
     * tolerates "already gone" conditions so a retry never fails on
     * partial state.
     *
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revoke result
     */
    async revokeIndividualAccess(contactId, username) {
        const startTime = Date.now();

        if (!contactId || !username) {
            return { success: false, error: 'ContactId and username are required for revocation' };
        }

        const trimmedUsername = username.trim();
        const cleanContactId = this.sanitizeContactId(contactId);
        const sharedDbName = `shared-contact-${cleanContactId}-to-${trimmedUsername}`;
        const result = {
            success: false,
            revokedFrom: trimmedUsername,
            sharedDbName,
            itemDeleted: false,
            permissionRevoked: false,
            errors: []
        };

        // Step 1: remove the recipient copy
        try {
            const items = await this.retryTransient(() => new Promise((resolve, reject) => {
                this.database.openDatabase(sharedDbName, (dbItems) => resolve(dbItems || [])).catch(reject);
            }), `revokeIndividualAccess:open ${sharedDbName}`);

            const target = items.find(item =>
                item.itemId === contactId ||
                item.contactId === contactId ||
                item.metadata?.originalContactId === contactId
            );

            if (target) {
                await this.retryTransient(
                    () => this.database.safeDeleteItem({
                        databaseName: sharedDbName,
                        itemId: target.itemId
                    }),
                    `revokeIndividualAccess:delete ${sharedDbName}`
                );
                result.itemDeleted = true;
            }
        } catch (error) {
            if (error.name === 'DatabaseNotFound') {
                // Nothing was ever shared through this database; permission revoke below is a no-op too.
                result.success = true;
                result.duration = Date.now() - startTime;
                result.message = 'Access already revoked (database not found)';
                this.shareCache.delete(`${contactId}-${trimmedUsername}`);
                return result;
            }
            if (error.name !== 'ItemDoesNotExist') {
                console.error(`❌ Failed to delete shared copy from ${sharedDbName}:`, error);
                result.errors.push(`delete: ${error.message}`);
            }
        }

        // Step 2: revoke the recipient's database permission
        try {
            await this.database.safeModifyDatabasePermissions({
                databaseName: sharedDbName,
                username: trimmedUsername,
                revoke: true
            }, 'revokeIndividualAccess');
            result.permissionRevoked = true;
        } catch (error) {
            if (['UserNotFound', 'DatabaseNotFound', 'DatabaseNotShared', 'UserNotVerified'].includes(error.name)) {
                // Recipient no longer has (or never had) access — treat as already revoked.
                result.permissionRevoked = true;
            } else {
                console.error(`❌ Failed to revoke permission on ${sharedDbName} for ${trimmedUsername}:`, error);
                result.errors.push(`permission: ${error.message}`);
            }
        }

        this.shareCache.delete(`${contactId}-${trimmedUsername}`);

        // Permission revocation is authoritative: once the recipient's
        // permission on the database is revoked they can no longer read it,
        // so a leftover (now unreadable) copy does not keep the share alive.
        result.success = result.permissionRevoked;
        if (result.errors.length > 0) {
            if (result.success) {
                result.warnings = result.errors;
                result.errors = [];
            } else {
                result.error = result.errors.join('; ');
            }
        } else if (!result.success) {
            result.error = 'Permission revocation failed';
        }
        result.duration = Date.now() - startTime;
        return result;
    }


    /**
     * 🚀 OPTIMIZED: Update contact across all individual shared databases with parallel processing
     * Time: ~100-200ms instead of n×100ms through parallel execution
     * @param {Object} contact - Updated contact data
     * @returns {Promise<Object>} Update result with performance metrics
     */
    async updateContactAcrossSharedDatabases(contact) {
        const startTime = Date.now();
        
        try {
            if (!contact || !contact.contactId) {
                throw new Error('Valid contact with contactId is required');
            }

            // Get all individual shared databases for this contact
            const sharedDatabases = await this.getContactSharedDatabases(contact.contactId);
            
            if (sharedDatabases.length === 0) {
                return { 
                    success: true, 
                    message: 'No shared databases to update', 
                    duration: Date.now() - startTime,
                    updatedCount: 0
                };
            }
            
            
            // Update all databases in parallel (with batching for large numbers)
            const updateResults = [];
            
            for (let i = 0; i < sharedDatabases.length; i += this.batchSize) {
                const batch = sharedDatabases.slice(i, i + this.batchSize);
                
                const batchPromises = batch.map(async (dbName) => {
                    try {
                        // Extract username from database name for metadata
                        const username = this.extractUsernameFromDbName(dbName);
                        
                        const updatedContact = this.buildRecipientContact(contact, username, {
                            lastSharedUpdate: new Date().toISOString()
                        });

                        // 🎯 OPTIMIZE: Trim metadata before updating shared database to avoid 10KB limit
                        const optimizedContact = this.database.optimizeContactForStorage(updatedContact);

                        // Update directly — no re-open to "check for items".
                        // The per-recipient databases are already open (login's
                        // setupSharedDatabases opened every owned shared
                        // database), and a second openDatabase call on an
                        // already-open database can fail; the old pre-check
                        // swallowed that failure and silently skipped the
                        // update, leaving recipients with stale copies after
                        // every owner edit.
                        try {
                            await this.database.safeUpdateItem({
                                databaseName: dbName,
                                itemId: contact.contactId,
                                item: optimizedContact
                            }, 'updateContactAcrossSharedDatabases');

                            return { dbName, username, success: true };
                        } catch (updateError) {
                            if (updateError.name === 'ItemDoesNotExist') {
                                // Empty database (e.g. the recipient copy was
                                // removed by a revoke): nothing to update
                                return {
                                    dbName,
                                    username,
                                    success: true, 
                                    message: 'Skipped - database is empty',
                                    skipped: true 
                                };
                            }
                            throw updateError;
                        }
                    } catch (error) {
                        console.error(`❌ Failed to update ${dbName}:`, error);
                        return { 
                            dbName, 
                            username: this.extractUsernameFromDbName(dbName),
                            success: false, 
                            error: error.message 
                        };
                    }
                });
                
                const batchResults = await Promise.all(batchPromises);
                updateResults.push(...batchResults);
                
                // Small delay between batches
                if (i + this.batchSize < sharedDatabases.length) {
                    await this.sleep(25); // 25ms between update batches
                }
            }
            
            const duration = Date.now() - startTime;
            const successCount = updateResults.filter(r => r.success && !r.skipped).length;
            const skippedCount = updateResults.filter(r => r.skipped).length;
            const errorCount = updateResults.filter(r => !r.success).length;
            
            
            return {
                success: successCount > 0 || skippedCount > 0,
                results: updateResults,
                successCount,
                skippedCount,
                errorCount,
                duration,
                updatedCount: successCount,
                totalDatabases: sharedDatabases.length
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('❌ Error updating contact across shared databases:', error);
            return { 
                success: false, 
                error: error.message, 
                duration,
                updatedCount: 0
            };
        }
    }

    /**
     * 📋 LIST: Get all individual shared databases for a contact
     * @param {string} contactId - Contact ID
     * @returns {Promise<Array>} Array of database names
     */
    async getContactSharedDatabases(contactId) {
        try {
            const result = await userbase.getDatabases();
            const allDatabases = result.databases;
            
            // Remove 'contact_' prefix to avoid double naming
            const cleanContactId = this.sanitizeContactId(contactId);
            
            return allDatabases
                .filter(db => 
                    db.databaseName.startsWith(`shared-contact-${cleanContactId}-to-`) &&
                    db.isOwner
                )
                .map(db => db.databaseName);
                
        } catch (error) {
            console.error('❌ Failed to get contact shared databases:', error);
            return [];
        }
    }

    /**
     * 📋 LIST: Get all individual shares for a contact with metadata
     * @param {string} contactId - Contact ID
     * @returns {Promise<Array>} Array of individual shares with details
     */
    async getIndividualShares(contactId) {
        try {
            const result = await userbase.getDatabases();
            const allDatabases = result.databases;
            
            // Remove 'contact_' prefix to avoid double naming
            const cleanContactId = this.sanitizeContactId(contactId);
            
            // Find all individual shared databases for this contact
            const individualShares = allDatabases
                .filter(db => 
                    db.databaseName.startsWith(`shared-contact-${cleanContactId}-to-`) &&
                    db.isOwner
                )
                .map(db => ({
                    databaseName: db.databaseName,
                    sharedWith: this.extractUsernameFromDbName(db.databaseName),
                    users: db.users || [],
                    isOwner: db.isOwner,
                    receivedByUsers: (db.users || []).filter(user => user.username !== this.database.currentUser?.username)
                }));
            
            return individualShares;
            
        } catch (error) {
            console.error('❌ Failed to get individual shares:', error);
            return [];
        }
    }

    /**
     * 🔧 UTILITY: Extract username from individual database name
     * @param {string} databaseName - Database name in format shared-contact-{contactId}-to-{username}
     * @returns {string} Username
     */
    extractUsernameFromDbName(databaseName) {
        const match = databaseName.match(/shared-contact-.+-to-(.+)$/);
        return match ? match[1] : 'unknown';
    }

    /**
     * 📊 ANALYTICS: Get sharing statistics for performance monitoring
     * @param {string} contactId - Optional contact ID to filter stats
     * @returns {Promise<Object>} Sharing statistics
     */
    async getSharingStats(contactId = null) {
        try {
            const result = await userbase.getDatabases();
            const allDatabases = result.databases;
            
            let pattern;
            if (contactId) {
                // Remove 'contact_' prefix to avoid double naming
                const cleanContactId = this.sanitizeContactId(contactId);
                pattern = `shared-contact-${cleanContactId}-to-`;
            } else {
                pattern = 'shared-contact-';
            }
                
            const sharedDatabases = allDatabases.filter(db => 
                db.databaseName.includes(pattern) && db.isOwner
            );
            
            const stats = {
                totalSharedDatabases: sharedDatabases.length,
                individualShares: sharedDatabases.filter(db => db.databaseName.includes('-to-')).length,
                groupShares: sharedDatabases.filter(db => !db.databaseName.includes('-to-')).length,
                uniqueContacts: new Set(
                    sharedDatabases.map(db => {
                        const match = db.databaseName.match(/shared-contact-(.+?)(-to-|$)/);
                        return match ? match[1] : null;
                    }).filter(Boolean)
                ).size,
                cacheSize: this.shareCache.size,
                batchSize: this.batchSize
            };
            
            if (contactId) {
                stats.contactSpecific = {
                    contactId,
                    sharedWithUsers: sharedDatabases
                        .filter(db => db.databaseName.includes('-to-'))
                        .map(db => this.extractUsernameFromDbName(db.databaseName))
                };
            }
            
            return stats;
            
        } catch (error) {
            console.error('❌ Failed to get sharing stats:', error);
            return {
                totalSharedDatabases: 0,
                individualShares: 0,
                groupShares: 0,
                uniqueContacts: 0,
                error: error.message
            };
        }
    }

    /**
     * 🧹 CLEANUP: Clear sharing cache and reset performance optimizations
     */
    clearCache() {
        this.shareCache.clear();
        this.updateQueue.clear();
        this.sharingQueue = [];
    }

    /**
     * ⚙️ CONFIG: Set batch size for parallel operations
     * @param {number} size - New batch size (1-10 recommended)
     */
    setBatchSize(size) {
        if (size >= 1 && size <= 10) {
            this.batchSize = size;
        } else {
            console.warn('⚠️ Batch size must be between 1 and 10');
        }
    }

    /**
     * 🔧 UTILITY: Sleep utility for delays
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 🔧 UTILITY: Sanitize contact ID for database naming
     * @param {string} contactId - Contact ID to sanitize
     * @returns {string} Sanitized contact ID safe for database names
     */
    /**
     * Contact ID as used inside per-recipient database names
     * (`shared-contact-{id}-to-{username}`). The `contact_` prefix is dropped
     * to avoid `shared-contact-contact_...`; this must match everywhere a
     * database name is built or parsed.
     */
    sanitizeContactId(contactId) {
        return contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
    }
}