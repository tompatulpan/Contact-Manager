/**
 * SyncStatistics - Unified statistics tracking for sync operations
 * 
 * Provides consistent tracking and reporting of sync metrics across
 * different sync services (iCloud, Baikal, etc.)
 * 
 * @module utils/SyncStatistics
 */
export class SyncStatistics {
    constructor(serviceName = 'Sync') {
        this.serviceName = serviceName;
        this.reset();
    }

    /**
     * Reset all statistics to initial state
     */
    reset() {
        this.pulled = 0;
        this.pushed = 0;
        this.deleted = 0;
        this.skipped = 0;
        this.errors = 0;
        this.imported = 0;
        this.updated = 0;
        this.startTime = null;
        this.endTime = null;
    }

    /**
     * Mark the start of a sync operation
     */
    startSync() {
        this.startTime = Date.now();
    }

    /**
     * Mark the end of a sync operation
     */
    endSync() {
        this.endTime = Date.now();
    }

    /**
     * Get sync duration in milliseconds
     * @returns {number} Duration in ms, or 0 if not completed
     */
    getDuration() {
        if (!this.startTime) return 0;
        const end = this.endTime || Date.now();
        return end - this.startTime;
    }

    /**
     * Increment a counter
     * @param {string} counter - Counter name (pulled, pushed, deleted, skipped, errors, imported, updated)
     * @param {number} amount - Amount to increment (default: 1)
     */
    increment(counter, amount = 1) {
        if (this.hasOwnProperty(counter) && typeof this[counter] === 'number') {
            this[counter] += amount;
        }
    }

    /**
     * Set a counter to a specific value
     * @param {string} counter - Counter name
     * @param {number} value - Value to set
     */
    set(counter, value) {
        if (this.hasOwnProperty(counter) && typeof this[counter] === 'number') {
            this[counter] = value;
        }
    }

    /**
     * Get formatted summary object
     * @returns {Object} Statistics summary
     */
    getSummary() {
        return {
            service: this.serviceName,
            duration: this.getDuration(),
            pulled: this.pulled,
            pushed: this.pushed,
            deleted: this.deleted,
            skipped: this.skipped,
            errors: this.errors,
            imported: this.imported,
            updated: this.updated,
            total: this.pulled + this.pushed + this.deleted + this.skipped,
            success: this.errors === 0
        };
    }

    /**
     * Log sync results to console with standardized formatting
     * @param {Object} options - Additional logging options
     * @param {number} options.activeContacts - Count of active contacts
     * @param {number} options.deletedRecords - Count of deleted records (orphans)
     * @param {number} options.totalContacts - Total contacts in database
     * @param {boolean} options.verbose - Show detailed breakdown
     */
    logResults(options = {}) {
        const duration = this.getDuration();
        const {
            activeContacts,
            deletedRecords,
            totalContacts,
            verbose = false
        } = options;

        // Main success message
        console.log(`✅ ${this.serviceName} complete in ${duration}ms`);

        // Operation counts
        if (this.pulled > 0 || this.imported > 0 || this.updated > 0) {
            const pullDetails = [];
            if (this.imported > 0) pullDetails.push(`${this.imported} imported`);
            if (this.updated > 0) pullDetails.push(`${this.updated} updated`);
            if (this.pulled > 0 && this.imported === 0 && this.updated === 0) {
                pullDetails.push(`${this.pulled} contacts`);
            }
            console.log(`   📥 Pulled: ${pullDetails.join(', ') || this.pulled + ' contacts'}`);
        } else {
            console.log(`   📥 Pulled: 0 contacts`);
        }

        if (this.pushed > 0) {
            console.log(`   📤 Pushed: ${this.pushed} contacts`);
        } else {
            console.log(`   📤 Pushed: 0 contacts`);
        }

        if (this.deleted > 0) {
            console.log(`   🗑️ Deleted: ${this.deleted} from server`);
        } else {
            console.log(`   🗑️ Deleted: 0 from server`);
        }

        if (this.skipped > 0) {
            console.log(`   ⏭️ Skipped: ${this.skipped} (already synced)`);
        }

        if (this.errors > 0) {
            console.warn(`   ❌ Errors: ${this.errors} failed`);
        }

        // Database state (if provided)
        if (typeof activeContacts === 'number') {
            console.log(`   📊 Database state:`);
            console.log(`      - Active contacts: ${activeContacts}`);
            
            if (typeof deletedRecords === 'number') {
                console.log(`      - Deleted records (orphans): ${deletedRecords}`);
            }
            
            if (typeof totalContacts === 'number') {
                console.log(`      - Total in database: ${totalContacts}`);
            }

            // Warning for orphaned records
            if (deletedRecords > 0) {
                console.warn(`⚠️ WARNING: ${deletedRecords} orphaned deletion records in database!`);
                console.warn(`   Run: await window.iCloudSyncService.cleanupOrphanedDeletions()`);
            }
        }

        // Verbose details
        if (verbose) {
            console.log(`   📈 Statistics:`, this.getSummary());
        }
    }

    /**
     * Log error results to console
     * @param {Error} error - The error that occurred
     */
    logError(error) {
        console.error(`❌ ${this.serviceName} failed:`, error);
        console.error(`   Duration: ${this.getDuration()}ms`);
        console.error(`   Progress: ${this.pushed} pushed, ${this.pulled} pulled before failure`);
    }

    /**
     * Create a result object for event emission or return value
     * @returns {Object} Sync result object
     */
    toResult() {
        return {
            success: this.errors === 0,
            duration: this.getDuration(),
            stats: this.getSummary()
        };
    }
}
