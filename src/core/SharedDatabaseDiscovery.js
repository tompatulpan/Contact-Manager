/**
 * SharedDatabaseDiscovery - discovery layer for shared contact databases
 *
 * Owns the "which shared databases exist" concern:
 * - listing shared contact databases (owned + received) via the SDK
 * - the 30s TTL cache over that list
 * - the periodic monitoring cycle that detects new/removed databases and
 *   triggers differential opening of just the new ones (via the injected
 *   onNewDatabases hook)
 *
 * Listing goes through the SDK wrapper (safeGetDatabases) so errors get
 * SDK-compliant handling; this module then degrades gracefully by
 * returning { success: false } instead of throwing.
 *
 * State (sharedDatabaseCache, lastKnownSharedCount, openedSharedDatabases,
 * monitor timer ids) lives on ContactDatabase; this module reads and writes
 * it through the injected accessors so there is exactly one source of
 * truth. ContactDatabase keeps thin delegating methods, so callers keep
 * their existing API.
 */

import { PERFORMANCE_CONFIG } from '../config/app.config.js';

export class SharedDatabaseDiscovery {
    /**
     * @param {Object} deps - Injected state and hooks
     * @param {Function} deps.safeGetDatabases - (options|null, context) => SDK result
     * @param {Function} deps.getCache - () => cache object ({ lastFetch, data, isValid, ttl })
     * @param {Function} deps.setCache - (cache) => void
     * @param {Function} deps.getLastKnownCount - () => number
     * @param {Function} deps.setLastKnownCount - (number) => void
     * @param {Function} deps.getOpenedSharedDatabases - () => Set, open-database names/ids
     * @param {Function} deps.setMonitorTimer - (id|null) => void, periodic check timer
     * @param {Function} deps.setFallbackTimer - (id|null) => void, fallback sync timer
     * @param {Function} deps.onNewDatabases - async (owned[], received[]) => void,
     *        opens the newly discovered databases
     * @param {Function} deps.performFallbackSharedContactSync - async () => void
     */
    constructor(deps) {
        this.deps = deps;
    }

    /**
     * Get all shared contact databases (both owned and received) - CRITICAL for cross-device sharing
     * @param {Object} [options] - Optional parameters for getDatabases
     * @param {string} [options.databaseName] - Specific database name to retrieve
     * @param {string} [options.databaseId] - Specific database ID to retrieve
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabases(options = null) {
        try {
            const result = await this.deps.safeGetDatabases(options, 'getAllSharedContactDatabases');

            // SDK guarantees this format: { databases: [...] }
            if (!result || !Array.isArray(result.databases)) {
                console.warn('⚠️ Unexpected databases format from SDK:', result);
                return { success: true, ownedSharedDatabases: [], receivedSharedDatabases: [] };
            }

            const databasesArray = result.databases;

            // Filter for shared contact databases
            const sharedContactDatabases = databasesArray.filter(db =>
                db.databaseName.startsWith('shared-contact-')
            );

            // Separate owned vs received shared databases
            const ownedSharedDatabases = sharedContactDatabases.filter(db => db.isOwner);
            const receivedSharedDatabases = sharedContactDatabases.filter(db => !db.isOwner);

            return {
                success: true,
                ownedSharedDatabases,
                receivedSharedDatabases
            };
        } catch (error) {
            // Errors were already handled SDK-compliantly in the wrapper
            // (auth:required / rateLimited / serviceUnavailable events);
            // degrade gracefully so callers can treat this as "no data".

            return {
                success: false,
                error: error.message,
                ownedSharedDatabases: [],
                receivedSharedDatabases: []
            };
        }
    }

    /**
     * Get all shared contact databases with caching
     * @param {boolean} [forceRefresh=false] - Force refresh cache
     * @returns {Promise<Object>} Object with ownedSharedDatabases and receivedSharedDatabases arrays
     */
    async getAllSharedContactDatabasesCached(forceRefresh = false) {
        const now = Date.now();
        const cache = this.deps.getCache();

        // Check if cache is valid and not forcing refresh
        if (!forceRefresh &&
            cache.isValid &&
            cache.lastFetch &&
            (now - cache.lastFetch) < cache.ttl) {

            return cache.data;
        }

        // Fetch fresh data
        const result = await this.getAllSharedContactDatabases();

        // Update cache
        this.deps.setCache({
            lastFetch: now,
            data: result,
            isValid: result.success,
            ttl: cache.ttl
        });

        return result;
    }

    /**
     * Invalidate shared database cache
     * Call this when you know the shared database list has changed
     */
    invalidateSharedDatabaseCache() {
        const cache = this.deps.getCache();
        this.deps.setCache({
            ...cache,
            isValid: false,
            data: null
        });
    }

    /**
     * Check for new shared databases with smart caching and differential updates
     */
    async checkForNewSharedDatabases() {
        try {
            // Use cached data with forced refresh for monitoring
            const allDatabases = await this.getAllSharedContactDatabasesCached(true);
            if (!allDatabases.success) {
                return;
            }

            const { ownedSharedDatabases, receivedSharedDatabases } = allDatabases;
            const totalSharedCount = ownedSharedDatabases.length + receivedSharedDatabases.length;

            // Check if we have new shared databases
            const currentSharedCount = this.deps.getLastKnownCount() || 0;

            if (totalSharedCount > currentSharedCount) {

                // Only setup NEW databases, not all databases
                const opened = this.deps.getOpenedSharedDatabases();
                const newOwnedDatabases = ownedSharedDatabases.filter(db =>
                    !opened.has(db.databaseName));
                const newReceivedDatabases = receivedSharedDatabases.filter(db =>
                    !opened.has(db.databaseId));

                if (newOwnedDatabases.length > 0 || newReceivedDatabases.length > 0) {

                    // Setup only new databases instead of all databases
                    await this.deps.onNewDatabases(newOwnedDatabases, newReceivedDatabases);
                }

                this.deps.setLastKnownCount(totalSharedCount);

            } else if (totalSharedCount < currentSharedCount) {
                // Handle case where shared databases were removed
                this.deps.setLastKnownCount(totalSharedCount);

                // TODO: Clean up opened database tracking for removed databases
            }

        } catch (error) {
            console.error('🔄 Error checking for new shared databases:', error);
        }
    }

    /**
     * Start monitoring for new shared databases
     */
    startSharedDatabaseMonitoring() {
        // Add initial delay to avoid immediate redundant call after setup
        setTimeout(() => {
            // Check periodically for new shared databases
            const monitorId = setInterval(async () => {
                try {
                    await this.checkForNewSharedDatabases();
                } catch (error) {
                    console.error('🔄 Error checking for new shared databases:', error);
                }
            }, PERFORMANCE_CONFIG.sharedDatabaseCheckInterval); // 10 seconds
            this.deps.setMonitorTimer(monitorId);
        }, PERFORMANCE_CONFIG.sharedDatabaseCheckDelay); // Start monitoring after 15 seconds to allow initial setup to complete

        // 🛡️ SAFETY NET: Hourly fallback sync for shared contacts
        // This catches any WebSocket updates that may have been dropped due to:
        // - syncInProgress blocking (now fixed, but extra safety)
        // - Network issues
        // - Browser background tab throttling
        // - Unknown edge cases
        setTimeout(() => {
            const fallbackId = setInterval(async () => {
                try {
                    await this.deps.performFallbackSharedContactSync();
                } catch (error) {
                    console.error('🔄 Error in fallback shared contact sync:', error);
                }
            }, PERFORMANCE_CONFIG.sharedContactFallbackInterval); // 1 hour (60 * 60 * 1000)
            this.deps.setFallbackTimer(fallbackId);
        }, PERFORMANCE_CONFIG.sharedContactFallbackDelay); // Start after 5 minutes (don't run immediately on startup)
    }
}

export default SharedDatabaseDiscovery;
