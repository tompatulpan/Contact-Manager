/**
 * SharedDatabaseDiscovery unit tests.
 *
 * Pins the discovery behavior the sharing flow depends on:
 * - the TTL cache serves the same result within the TTL and refetches on
 *   forceRefresh
 * - listing splits owned vs received shared-contact databases and degrades
 *   gracefully when the SDK call fails (no throw)
 * - the monitoring cycle opens only databases not already open
 *   (differential update), and updates the known count
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { SharedDatabaseDiscovery } from '../src/core/SharedDatabaseDiscovery.js';

const db = (name, isOwner, id) => ({
    databaseName: name,
    databaseId: id || name + '-id',
    isOwner
});

const makeDiscovery = (sdkResult) => {
    const state = {
        cache: { lastFetch: null, data: null, isValid: false, ttl: 30000 },
        lastKnownCount: 0,
        opened: new Set(),
        calls: { fetches: 0, opened: [], fallbackSyncs: 0 }
    };
    const discovery = new SharedDatabaseDiscovery({
        safeGetDatabases: async () => {
            state.calls.fetches++;
            if (sdkResult instanceof Error) throw sdkResult;
            return sdkResult;
        },
        getCache: () => state.cache,
        setCache: (c) => { state.cache = c; },
        getLastKnownCount: () => state.lastKnownCount,
        setLastKnownCount: (n) => { state.lastKnownCount = n; },
        getOpenedSharedDatabases: () => state.opened,
        setMonitorTimer: () => {},
        setFallbackTimer: () => {},
        onNewDatabases: async (owned, received) => {
            state.calls.opened.push({ owned, received });
            owned.forEach(d => state.opened.add(d.databaseName));
            received.forEach(d => state.opened.add(d.databaseId));
        },
        performFallbackSharedContactSync: async () => { state.calls.fallbackSyncs++; }
    });
    return { discovery, state };
};

describe('SharedDatabaseDiscovery — listing', () => {
    it('splits owned and received shared-contact databases and skips non-shared databases', async () => {
        const { discovery } = makeDiscovery({
            databases: [
                db('shared-contact-abc-to-bob', true),
                db('shared-contact-abc-to-carol', false),
                db('contacts', true), // own contacts db: not shared-contact-
                db('user-settings', true)
            ]
        });

        const result = await discovery.getAllSharedContactDatabases();

        expect(result.success).toBe(true);
        expect(result.ownedSharedDatabases.map(d => d.databaseName)).toEqual(['shared-contact-abc-to-bob']);
        expect(result.receivedSharedDatabases.map(d => d.databaseName)).toEqual(['shared-contact-abc-to-carol']);
    });

    it('returns success:false (never throws) when the SDK call fails', async () => {
        const err = new Error('Not signed in.');
        err.name = 'UserNotSignedIn';
        const { discovery } = makeDiscovery(err);

        const result = await discovery.getAllSharedContactDatabases();

        expect(result).toEqual({
            success: false,
            error: 'Not signed in.',
            ownedSharedDatabases: [],
            receivedSharedDatabases: []
        });
    });
});

describe('SharedDatabaseDiscovery — TTL cache', () => {
    it('serves the same result within the TTL and refetches on forceRefresh', async () => {
        const { discovery, state } = makeDiscovery({ databases: [] });

        const first = await discovery.getAllSharedContactDatabasesCached();
        const second = await discovery.getAllSharedContactDatabasesCached();

        expect(second).toBe(first);            // same object: served from cache
        expect(state.calls.fetches).toBe(1);   // only one SDK call

        await discovery.getAllSharedContactDatabasesCached(true);
        expect(state.calls.fetches).toBe(2);   // forceRefresh bypasses cache
    });

    it('does not serve a failed result as valid cache', async () => {
        const err = new Error('Service unavailable');
        err.name = 'ServiceUnavailable';
        const { discovery, state } = makeDiscovery(err);

        const result = await discovery.getAllSharedContactDatabasesCached();
        expect(result.success).toBe(false);
        expect(state.cache.isValid).toBe(false);
    });

    it('invalidateSharedDatabaseCache forces a refetch on the next call', async () => {
        const { discovery, state } = makeDiscovery({ databases: [] });

        await discovery.getAllSharedContactDatabasesCached();
        discovery.invalidateSharedDatabaseCache();
        await discovery.getAllSharedContactDatabasesCached();

        expect(state.calls.fetches).toBe(2);
    });
});

describe('SharedDatabaseDiscovery — monitoring cycle', () => {
    it('opens only databases that are not already open (differential update)', async () => {
        const { discovery, state } = makeDiscovery({
            databases: [
                db('shared-contact-a-to-bob', true),
                db('shared-contact-b-to-bob', true)
            ]
        });
        state.lastKnownCount = 1;
        state.opened.add('shared-contact-a-to-bob'); // already open

        await discovery.checkForNewSharedDatabases();

        expect(state.calls.opened).toHaveLength(1);
        expect(state.calls.opened[0].owned.map(d => d.databaseName))
            .toEqual(['shared-contact-b-to-bob']); // only the new one
        expect(state.lastKnownCount).toBe(2);
    });

    it('does not open anything when the count did not grow', async () => {
        const { discovery, state } = makeDiscovery({
            databases: [db('shared-contact-a-to-bob', true)]
        });
        state.lastKnownCount = 1;

        await discovery.checkForNewSharedDatabases();

        expect(state.calls.opened).toHaveLength(0);
        expect(state.lastKnownCount).toBe(1);
    });
});
