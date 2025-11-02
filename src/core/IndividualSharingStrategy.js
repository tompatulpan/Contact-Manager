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
     * 🆕 CORE: Share contact with individual user using separate database
     * Creates unique database per sharing relationship for granular control
     * @param {Object} contact - Contact to share
     * @param {string} username - Target username
     * @returns {Promise<Object>} Share result
     */
    async shareContactIndividually(contact, username, readOnly = true, resharingAllowed = false) {
        const startTime = Date.now();
        let databaseOpened = false; // 🔧 Track database opening state
        let sharedDbName = null; // 🔧 Store the actual database name for cleanup
        
        try {
            if (!contact || !username) {
                throw new Error('Contact and username are required');
            }

            // Create unique database name for this specific sharing relationship
            // Remove 'contact_' prefix to avoid double naming  
            const cleanContactId = contact.contactId.startsWith('contact_') ? contact.contactId.substring(8) : contact.contactId;
            sharedDbName = `shared-contact-${cleanContactId}-to-${username.trim()}`;
            
            console.log(`📤 Creating individual shared database: ${sharedDbName}`);

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
                console.log(`📡 Individual database ${sharedDbName} change detected`);
            });
            
            databaseOpened = true; // 🔧 Mark database as successfully opened

            // Insert contact into individual database with sharing metadata
            let sharedContact = {
                ...contact,
                metadata: {
                    ...contact.metadata,
                    sharedAt: new Date().toISOString(),
                    sharedBy: this.database.currentUser?.username,
                    sharedWith: username.trim(),
                    originalContactId: contact.contactId,
                    sharingType: 'individual',
                    lastSharedUpdate: new Date().toISOString()
                }
            };

            // 🔧 CRITICAL FIX: Optimize contact to fit within 10KB Userbase limit
            sharedContact = this.database.optimizeContactForStorage(sharedContact);

            // Check if contact already exists in this database, update if exists, insert if not
            try {
                await this.database.safeInsertItem({
                    databaseName: sharedDbName,
                    item: sharedContact,
                    itemId: contact.contactId
                }, 'shareContactIndividually');
                console.log(`✅ Contact inserted into individual database: ${sharedDbName}`);
            } catch (insertError) {
                if (insertError.name === 'ItemAlreadyExists') {
                    console.log(`🔄 Contact already exists in ${sharedDbName}, updating instead`);
                    await this.database.safeUpdateItem({
                        databaseName: sharedDbName,
                        item: sharedContact,
                        itemId: contact.contactId
                    }, 'shareContactIndividually');
                    console.log(`✅ Contact updated in individual database: ${sharedDbName}`);
                } else {
                    throw insertError; // Re-throw other errors
                }
            }

            // Share database with target user (readOnly by default)
            await this.database.safeShareDatabase({
                databaseName: sharedDbName,
                username: username.trim(),
                readOnly: true,
                resharingAllowed: false,
                requireVerified: false  // Allow sharing with unverified users
            }, 'shareContactIndividually');

            const duration = Date.now() - startTime;
            console.log(`✅ Individual share created: ${sharedDbName} → ${username} (${duration}ms)`);
            
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
                    console.log(`🧹 Cleaning up failed sharing database: ${sharedDbName}`);
                    
                    // Try to delete the contact from the database if it was inserted
                    try {
                        await this.database.safeDeleteItem({
                            databaseName: sharedDbName,
                            itemId: contact.contactId
                        }, 'cleanup_failed_share');
                        console.log(`🗑️ Removed contact from failed sharing database: ${sharedDbName}`);
                    } catch (deleteError) {
                        console.warn(`⚠️ Could not clean up contact from failed database:`, deleteError.message);
                    }
                    
                    // Note: We don't delete the database itself as Userbase doesn't have a deleteDatabase method
                    // But removing the contact data prevents false positive "already shared" detection
                } catch (cleanupError) {
                    console.warn(`⚠️ Cleanup process failed:`, cleanupError.message);
                }
            } else {
                console.log(`⏭️ Skipping cleanup - database was never opened for ${username}`);
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

            console.log(`📤 Bulk sharing contact with ${usernames.length} users individually`);

            const results = [];
            const uniqueUsernames = [...new Set(usernames.map(u => u.trim()).filter(u => u))];
            
            // Process in batches to avoid overwhelming the network/service
            for (let i = 0; i < uniqueUsernames.length; i += this.batchSize) {
                const batch = uniqueUsernames.slice(i, i + this.batchSize);
                const batchStartTime = Date.now();
                
                console.log(`🔄 Processing batch ${Math.floor(i/this.batchSize) + 1}/${Math.ceil(uniqueUsernames.length/this.batchSize)} (${batch.length} users)`);
                
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
                console.log(`✅ Batch completed: ${batchSuccessCount}/${batch.length} successful in ${batchDuration}ms`);
                
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
            
            console.log(`📊 Bulk sharing performance: ${successCount}/${uniqueUsernames.length} successful in ${totalDuration}ms (avg: ${averageDuration.toFixed(0)}ms per user)`);
            
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
     * 🆕 GRANULAR: Revoke access from specific user by deleting their individual database
     * SOLVES: User A can revoke from User C without affecting User B
     * 🔧 ENHANCED: Also deletes contact from Baikal server (deletion authority override)
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @param {Object} contact - Full contact object (needed for Baikal deletion)
     * @returns {Promise<Object>} Revoke result
     */
    async revokeIndividualAccess(contactId, username, contact = null) {
        const startTime = Date.now();
        
        try {
            if (!contactId || !username) {
                throw new Error('ContactId and username are required for revocation');
            }

            const trimmedUsername = username.trim();
            // Remove 'contact_' prefix to avoid double naming
            const cleanContactId = contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
            const sharedDbName = `shared-contact-${cleanContactId}-to-${trimmedUsername}`;
            
            console.log(`🗑️ Revoking individual access: ${sharedDbName}`);

            // Enhanced revocation: Query database first to find the actual item
            let databaseItems = [];
            let actualItemId = null;
            let foundContactData = null; // Store full contact data for Baikal deletion
            
            try {
                // First, try to open the database and get all items
                await new Promise((resolve, reject) => {
                    this.database.openDatabase(sharedDbName, (items) => {
                        databaseItems = items || [];
                        resolve();
                    }).catch(reject);
                });
                
                console.log(`🔍 Found ${databaseItems.length} items in shared database ${sharedDbName}`);
                
                if (databaseItems.length === 0) {
                    console.log(`ℹ️ Database ${sharedDbName} is empty, access already revoked`);
                    // Still try Baikal deletion if contact provided
                    if (contact) {
                        await this.deleteFromBaikalOnRevoke(contact, trimmedUsername);
                    }
                    return { 
                        success: true, 
                        message: 'Access already revoked (database empty)',
                        revokedFrom: trimmedUsername,
                        duration: Date.now() - startTime
                    };
                }
                
                // Search for the contact using multiple approaches
                let foundItem = null;
                
                // Approach 1: Direct itemId match
                foundItem = databaseItems.find(item => item.itemId === contactId);
                if (foundItem) {
                    actualItemId = foundItem.itemId;
                    foundContactData = foundItem.item;
                    console.log(`✅ Found contact using direct itemId match: ${actualItemId}`);
                } else {
                    // Approach 2: Search by item.contactId property
                    foundItem = databaseItems.find(item => item.item?.contactId === contactId);
                    if (foundItem) {
                        actualItemId = foundItem.itemId;
                        foundContactData = foundItem.item;
                        console.log(`✅ Found contact using item.contactId match: ${actualItemId}`);
                    } else {
                        // Approach 3: Search by item content (vCard or other fields)
                        foundItem = databaseItems.find(item => {
                            const itemData = item.item || {};
                            return itemData.contactId === contactId || 
                                   itemData.cardName?.includes(contactId) ||
                                   item.itemId?.includes(contactId);
                        });
                        if (foundItem) {
                            actualItemId = foundItem.itemId;
                            foundContactData = foundItem.item;
                            console.log(`✅ Found contact using content search: ${actualItemId}`);
                        }
                    }
                }
                
                if (!actualItemId) {
                    console.log(`⚠️ Contact not found in database ${sharedDbName}, access already revoked`);
                    // Still try Baikal deletion if contact provided
                    if (contact) {
                        await this.deleteFromBaikalOnRevoke(contact, trimmedUsername);
                    }
                    return { 
                        success: true, 
                        message: 'Access already revoked (contact not found)',
                        revokedFrom: trimmedUsername,
                        duration: Date.now() - startTime
                    };
                }
                
            } catch (openError) {
                if (openError.name === 'DatabaseNotFound') {
                    console.log(`ℹ️ Database ${sharedDbName} doesn't exist, access already revoked`);
                    // Still try Baikal deletion if contact provided
                    if (contact) {
                        await this.deleteFromBaikalOnRevoke(contact, trimmedUsername);
                    }
                    return { 
                        success: true, 
                        message: 'Access already revoked (database not found)',
                        revokedFrom: trimmedUsername,
                        duration: Date.now() - startTime
                    };
                }
                console.error(`❌ Error opening database ${sharedDbName}:`, openError);
                throw openError;
            }

            // Now delete the contact using the correct itemId
            console.log(`🗑️ Deleting item with actualItemId: ${actualItemId} from database: ${sharedDbName}`);
            
            await this.database.safeDeleteItem({
                databaseName: sharedDbName,
                itemId: actualItemId
            }, 'revokeIndividualAccess');

            // 🔧 NEW: Delete from Baikal server (deletion authority override)
            // Use found contact data or fallback to provided contact
            const contactForBaikal = foundContactData || contact;
            if (contactForBaikal) {
                await this.deleteFromBaikalOnRevoke(contactForBaikal, trimmedUsername);
            } else {
                console.warn(`⚠️ No contact data available for Baikal deletion - contact may remain on server`);
            }

            // Clear cache entry
            const cacheKey = `${contactId}-${trimmedUsername}`;
            this.shareCache.delete(cacheKey);

            const duration = Date.now() - startTime;
            console.log(`✅ Revoked individual access for ${trimmedUsername} to contact ${contactId} (${duration}ms)`);
            
            return { 
                success: true, 
                revokedFrom: trimmedUsername,
                sharedDbName,
                duration,
                method: 'individual-database-deletion',
                actualItemId: actualItemId
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Failed to revoke individual access:`, error);
            
            this.database.handleDeleteItemError(error, 'revokeIndividualAccess');
            
            return { 
                success: false, 
                error: error.message,
                duration,
                revokedFrom: username.trim()
            };
        }
    }

    /**
     * 🔧 NEW: Delete shared contact from Baikal server when revoked
     * This prevents orphaned contacts in the "Shared with Me" addressbook
     * @param {Object} contact - Contact to delete from Baikal
     * @param {string} revokedUsername - Username whose access was revoked
     */
    async deleteFromBaikalOnRevoke(contact, revokedUsername) {
        try {
            // Check if BaikalConnector is available
            if (!this.database.BaikalConnector) {
                console.log(`ℹ️ BaikalConnector not available - skipping Baikal deletion for revoked contact`);
                return { success: false, reason: 'connector_not_available' };
            }

            console.log(`🗑️ Deleting revoked contact "${contact.cardName}" from Baikal server`);
            
            // Get all connected Baikal profiles from BaikalConnector
            const connections = this.database.BaikalConnector.connections || new Map();
            
            if (connections.size === 0) {
                console.log(`ℹ️ No active Baikal connections - skipping Baikal deletion`);
                return { success: false, reason: 'no_active_connections' };
            }

            // Delete from all connected profiles
            let deletedCount = 0;
            let errorCount = 0;
            
            for (const [profileName, connectionInfo] of connections.entries()) {
                try {
                    console.log(`🗑️ Attempting to delete from profile "${profileName}"...`);
                    
                    // Delete from shared-contacts addressbook (where shared contacts are stored)
                    const deleteResult = await this.database.BaikalConnector.deleteContactFromBaikal(
                        contact,
                        profileName,
                        'shared-contacts' // Shared contacts addressbook
                    );
                    
                    if (deleteResult && deleteResult.success) {
                        deletedCount++;
                        console.log(`✅ Deleted revoked contact from Baikal profile "${profileName}"`);
                    } else {
                        errorCount++;
                        console.warn(`⚠️ Failed to delete from Baikal profile "${profileName}":`, deleteResult?.error || 'Unknown error');
                    }
                } catch (profileError) {
                    errorCount++;
                    console.error(`❌ Error deleting from Baikal profile "${profileName}":`, profileError.message);
                }
            }

            if (deletedCount > 0) {
                console.log(`✅ Revoked contact deleted from ${deletedCount} Baikal profile(s) (${errorCount} failed)`);
                return { success: true, deletedCount, errorCount };
            } else {
                console.warn(`⚠️ Could not delete revoked contact from any Baikal profiles (${errorCount} errors)`);
                return { success: false, reason: 'deletion_failed', errorCount };
            }
            
        } catch (error) {
            console.error(`❌ Error deleting revoked contact from Baikal:`, error);
            return { success: false, error: error.message };
        }
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
            
            console.log(`🔄 Updating contact across ${sharedDatabases.length} individual databases`);
            
            // Update all databases in parallel (with batching for large numbers)
            const updateResults = [];
            
            for (let i = 0; i < sharedDatabases.length; i += this.batchSize) {
                const batch = sharedDatabases.slice(i, i + this.batchSize);
                
                const batchPromises = batch.map(async (dbName) => {
                    try {
                        // First, check if the database has any items (skip empty databases)
                        let hasItems = false;
                        try {
                            await new Promise((resolve, reject) => {
                                this.database.openDatabase(dbName, (items) => {
                                    hasItems = items && items.length > 0;
                                    resolve();
                                }).catch(reject);
                            });
                            
                            if (!hasItems) {
                                console.log(`⏭️ Skipping empty database: ${dbName}`);
                                return { 
                                    database: dbName, 
                                    success: true, 
                                    message: 'Skipped - database is empty',
                                    skipped: true 
                                };
                            }
                        } catch (checkError) {
                            console.log(`⏭️ Skipping inaccessible database: ${dbName}`);
                            return { 
                                database: dbName, 
                                success: true, 
                                message: 'Skipped - database not accessible',
                                skipped: true 
                            };
                        }
                        
                        // Extract username from database name for metadata
                        const username = this.extractUsernameFromDbName(dbName);
                        
                        const updatedContact = {
                            ...contact,
                            metadata: {
                                ...contact.metadata,
                                lastSharedUpdate: new Date().toISOString(),
                                sharedWith: username,
                                sharingType: 'individual'
                            }
                        };

                        await this.database.safeUpdateItem({
                            databaseName: dbName,
                            itemId: contact.contactId,
                            item: updatedContact
                        }, 'updateContactAcrossSharedDatabases');
                        
                        return { dbName, username, success: true };
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
            
            console.log(`✅ Updated ${successCount}/${sharedDatabases.length} databases in ${duration}ms${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`);
            
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
            const cleanContactId = contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
            
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
            const cleanContactId = contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
            
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
                const cleanContactId = contactId.startsWith('contact_') ? contactId.substring(8) : contactId;
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
        console.log('📋 Individual sharing cache cleared');
    }

    /**
     * ⚙️ CONFIG: Set batch size for parallel operations
     * @param {number} size - New batch size (1-10 recommended)
     */
    setBatchSize(size) {
        if (size >= 1 && size <= 10) {
            this.batchSize = size;
            console.log(`⚙️ Batch size set to ${size}`);
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
    sanitizeContactId(contactId) {
        return contactId ? contactId.replace(/[^a-zA-Z0-9\-_]/g, '_') : 'unknown';
    }
}