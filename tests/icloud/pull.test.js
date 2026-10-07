/**
 * iCloud Sync — Pull tests
 *
 * Verifies that pullFromICloud() correctly imports new contacts from iCloud,
 * updates existing contacts when the ETag differs, skips contacts whose ETag
 * matches, and doesn't crash on malformed vCards.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { buildTestService, buildContact, flushEvents } from './setup.js';
import {
    FETCH_EMPTY,
    FETCH_NEW_REMOTE_CONTACT,
    FETCH_OWNED_IN_SYNC,
    FETCH_OWNED_UPDATED_REMOTELY,
    FETCH_MALFORMED,
    FETCH_MIXED,
} from './fixtures/carddav-responses.js';
import { OWNED_VCARD } from './fixtures/vcards.js';

const ALICE_UID = 'uid-alice-owned-001';
const ALICE_ETAG_V1 = '"etag-alice-v1"';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Count non-deleted contacts in ContactManager. */
function activeCount(contactManager) {
    return [...contactManager.contacts.values()].filter(c => !c.metadata.isDeleted).length;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('pullFromICloud()', () => {

    it('returns zero counts when iCloud is empty', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY });

        const result = await service.pullFromICloud();

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
    });

    it('imports a new contact that only exists on iCloud', async () => {
        const { service, contactManager } = await buildTestService({
            fetchContacts: FETCH_NEW_REMOTE_CONTACT,
        });

        expect(activeCount(contactManager)).toBe(0);

        const result = await service.pullFromICloud();

        expect(result.imported).toBe(1);
        expect(result.updated).toBe(0);

        // Wait for MockDatabase to fire the contacts:changed event asynchronously
        await flushEvents();

        expect(activeCount(contactManager)).toBe(1);

        const imported = [...contactManager.contacts.values()][0];
        expect(imported.cardName).toBeDefined();
        expect(imported.vcard).toContain('Carol Remote');
    });

    it('stores the iCloud ETag on the imported contact', async () => {
        const { service, contactManager } = await buildTestService({
            fetchContacts: FETCH_NEW_REMOTE_CONTACT,
        });

        await service.pullFromICloud();
        await flushEvents();

        const contact = [...contactManager.contacts.values()][0];
        expect(contact.metadata?.carddav?.etag).toBe('"etag-carol-v1"');
        expect(contact.metadata?.carddav?.source).toBe('iCloud');
    });

    it('skips a contact whose local ETag matches iCloud ETag (already in sync)', async () => {
        // Seed Alice with same ETag as iCloud returns
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: { isOwned: true, carddav: { etag: ALICE_ETAG_V1, source: 'iCloud' } },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_OWNED_IN_SYNC },
            [alice],
        );

        const before = activeCount(contactManager);
        const result = await service.pullFromICloud();

        expect(result.skipped).toBeGreaterThanOrEqual(1);
        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        // Contact count must not change
        expect(activeCount(contactManager)).toBe(before);
    });

    it('updates a contact when iCloud ETag differs from local ETag', async () => {
        // Seed Alice with OLD ETag; iCloud returns NEW ETag
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                carddav: { etag: '"etag-alice-v1"', source: 'iCloud' },
            },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_OWNED_UPDATED_REMOTELY },
            [alice],
        );

        const result = await service.pullFromICloud();

        expect(result.updated).toBe(1);
        expect(result.imported).toBe(0);

        // Local copy should now carry the updated vCard and new ETag
        const updated = [...contactManager.contacts.values()].find(
            c => c.vcard?.includes(ALICE_UID)
        );
        expect(updated?.metadata?.carddav?.etag).toBe('"etag-alice-v2"');
        expect(updated?.vcard).toContain('alice.updated@example.com');
    });

    it('handles a mix of new + in-sync contacts correctly', async () => {
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: { isOwned: true, carddav: { etag: ALICE_ETAG_V1, source: 'iCloud' } },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_MIXED },
            [alice],
        );

        const result = await service.pullFromICloud();
        await flushEvents();

        expect(result.imported).toBe(1);   // Carol imported
        expect(result.updated).toBe(0);    // Alice skipped (same ETag)
        expect(activeCount(contactManager)).toBe(2);
    });

    it('does not crash on a malformed vCard and skips that contact gracefully', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_MALFORMED });

        // Should not throw
        await expect(service.pullFromICloud()).resolves.toBeDefined();
    });

    it('does not re-import a contact that is pending local deletion', async () => {
        // Alice is soft-deleted locally with a CardDAV etag (= pending delete push)
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                isDeleted: true,
                carddav: { etag: ALICE_ETAG_V1, source: 'iCloud' },
            },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_OWNED_IN_SYNC },
            [alice],
        );

        const result = await service.pullFromICloud();

        // Alice must not be re-imported (it's pending deletion)
        expect(result.imported).toBe(0);
        expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

});
