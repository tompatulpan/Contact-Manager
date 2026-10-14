/**
 * ContactDatabase — sync readiness and shared-UID cache
 *
 * Covers the database-side helpers behind the "green card turns orange"
 * protection:
 * - _cacheSharedDbUids / isSharedContactUID: which vCard UIDs live in
 *   received shared databases, and how a revoke empties the cache
 * - waitForContactDataReady: resolves once every tracked database has
 *   delivered its first snapshot, and times out if one never does
 * - clearSessionData resets the state so a new session rebuilds it
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { ContactDatabase } from '../../src/core/ContactDatabase.js';
import { EventBus } from '../../src/utils/EventBus.js';

// clearSessionData() clears the browser session keys; stub the storage APIs
beforeAll(() => {
    global.localStorage = global.localStorage || { removeItem: () => {} };
    global.sessionStorage = global.sessionStorage || { removeItem: () => {} };
});

function buildDb() {
    return new ContactDatabase(new EventBus());
}

const BOB_ITEM = { itemId: 'item-bob', item: { vcard: 'BEGIN:VCARD\r\nUID:uid-bob-shared-001\r\nEND:VCARD' } };

describe('ContactDatabase — shared-UID cache', () => {

    it('reports UIDs cached from a received shared database snapshot', () => {
        const db = buildDb();
        expect(db.isSharedContactUID('uid-bob-shared-001')).toBe(false);

        db._cacheSharedDbUids('db-received-1', [BOB_ITEM]);

        expect(db.isSharedContactUID('uid-bob-shared-001')).toBe(true);
        expect(db.isSharedContactUID('uid-someone-else')).toBe(false);
        expect(db.isSharedContactUID(null)).toBe(false);
    });

    it('drops the UID when the sharer revokes (empty snapshot)', () => {
        const db = buildDb();
        db._cacheSharedDbUids('db-received-1', [BOB_ITEM]);
        expect(db.isSharedContactUID('uid-bob-shared-001')).toBe(true);

        // Change handler fires again with no items after a revoke
        db._cacheSharedDbUids('db-received-1', []);
        expect(db.isSharedContactUID('uid-bob-shared-001')).toBe(false);
    });
});

describe('ContactDatabase — waitForContactDataReady', () => {

    it('resolves once all tracked databases delivered their first snapshot', async () => {
        const db = buildDb();

        const contactsLoad = db._createInitialLoadDeferred();
        db.contactsInitialLoadDeferred = contactsLoad;
        const sharedLoad = db._createInitialLoadDeferred();
        db.sharedInitialLoadDeferreds.add(sharedLoad);

        let settled = false;
        const ready = db.waitForContactDataReady(1000).then(() => { settled = true; });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(settled).toBe(false); // still waiting for both snapshots

        sharedLoad.resolve();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(settled).toBe(false); // own contacts database still pending

        contactsLoad.resolve();
        await ready;
        expect(settled).toBe(true);
    });

    it('times out when a database never delivers a snapshot', async () => {
        const db = buildDb();

        const contactsLoad = db._createInitialLoadDeferred();
        db.contactsInitialLoadDeferred = contactsLoad;

        const start = Date.now();
        await db.waitForContactDataReady(25);

        // Resolved via the timeout fallback, not via the deferred
        expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    });

    it('returns immediately when nothing is tracked', async () => {
        const db = buildDb();
        await db.waitForContactDataReady(1000); // must not hang or throw
    });

    it('clearSessionData resets readiness state', () => {
        const db = buildDb();
        db.contactsInitialLoadDeferred = db._createInitialLoadDeferred();
        db.sharedInitialLoadDeferreds.add(db._createInitialLoadDeferred());
        db._cacheSharedDbUids('db-received-1', [BOB_ITEM]);

        db.clearSessionData();

        expect(db.contactsInitialLoadDeferred).toBeNull();
        expect(db.sharedInitialLoadDeferreds.size).toBe(0);
        expect(db.isSharedContactUID('uid-bob-shared-001')).toBe(false);
    });
});
