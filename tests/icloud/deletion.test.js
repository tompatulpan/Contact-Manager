/**
 * iCloud Sync — Deletion sync tests
 *
 * Covers both directions:
 * 1. Contact deleted on iCloud → should be removed from ContactManager
 * 2. Contact soft-deleted locally (with CardDAV metadata) → deleteContact() called on iCloud
 * 3. Contact soft-deleted locally but WITHOUT CardDAV metadata → NOT pushed to iCloud
 *    (regression test for the Nov 28 2025 deletion bug)
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { buildTestService, buildContact } from './setup.js';
import {
    FETCH_EMPTY,
    FETCH_OWNED_IN_SYNC,
    DELETE_SUCCESS,
    CREATE_SUCCESS,
} from './fixtures/carddav-responses.js';
import { OWNED_VCARD, DELETED_VCARD } from './fixtures/vcards.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

const ALICE_UID = 'uid-alice-owned-001';
const EVE_UID   = 'uid-eve-deleted-004';

describe('handleDeletions() — iCloud deleted, local exists', () => {

    it('marks contact as deleted when it disappears from iCloud', async () => {
        // Alice exists locally with CardDAV metadata, but iCloud returns EMPTY
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                carddav: { etag: '"etag-alice-v1"', source: 'iCloud', lastSyncedAt: new Date().toISOString() },
            },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [alice],
        );

        await service.handleDeletions();

        // Alice should now be deleted locally
        const contact = contactManager.contacts.get(`contact_${ALICE_UID}`);
        // Either removed from the Map entirely or flagged isDeleted
        const deleted = !contact || contact.metadata.isDeleted;
        expect(deleted).toBe(true);
    });

    it('does NOT delete a local contact that has no CardDAV metadata', async () => {
        // Regression test for the Nov 28 2025 deletion bug:
        // A contact without carddav etag is new/un-synced, not deleted on iCloud.
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: { isOwned: true },  // no carddav key
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },   // iCloud is empty
            [alice],
        );

        await service.handleDeletions();

        // Alice must NOT be deleted — she just hasn't synced yet
        const contact = contactManager.contacts.get(`contact_${ALICE_UID}`);
        expect(contact).toBeDefined();
        expect(contact?.metadata?.isDeleted).not.toBe(true);
    });

    it('does NOT falsely delete a contact whose UID still exists on iCloud', async () => {
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                carddav: { etag: '"etag-alice-v1"', source: 'iCloud' },
            },
        });

        // iCloud still has Alice → should not delete
        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_OWNED_IN_SYNC },
            [alice],
        );

        await service.handleDeletions();

        const contact = contactManager.contacts.get(`contact_${ALICE_UID}`);
        expect(contact).toBeDefined();
        expect(contact?.metadata?.isDeleted).not.toBe(true);
    });

});

describe('pushToICloud() — local deletions pushed to iCloud', () => {

    it('calls deleteContact on iCloud for a soft-deleted contact with CardDAV metadata', async () => {
        // Eve is soft-deleted locally and HAS a CardDAV etag → must be deleted on iCloud
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                carddav: {
                    etag: '"etag-eve-v1"',
                    href: '/card/uid-eve-deleted-004.vcf',
                    syncStatus: 'synced',
                    source: 'iCloud',
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                deleteContact: DELETE_SUCCESS,
            },
            [eve],
        );

        const result = await service.pushToICloud();

        expect(mockClient.deleteContact).toHaveBeenCalledTimes(1);
        const [calledUID] = mockClient.deleteContact.mock.calls[0];
        expect(calledUID).toBe(EVE_UID);
        expect(result.deleted).toBeGreaterThanOrEqual(1);
    });

    it('does NOT call deleteContact for a soft-deleted contact without CardDAV metadata', async () => {
        // Eve is soft-deleted but NEVER synced to iCloud (no etag) — nothing to delete remotely.
        // Regression test for the deletion bug.
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                // no carddav key
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [eve],
        );

        await service.pushToICloud();

        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

    it('does NOT re-process a deletion already marked as syncStatus=deleted', async () => {
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                carddav: {
                    etag: '"etag-eve-v1"',
                    syncStatus: 'deleted',  // already processed
                    source: 'iCloud',
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [eve],
        );

        await service.pushToICloud();

        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

});

describe('cross-server isolation (IS-11)', () => {

    it('does NOT delete a contact that was only ever synced to Baikal', async () => {
        // A contact pushed to Baikal carries metadata.carddav written by
        // ContactManager.updateContactCardDAVMetadata — no 'source' tag.
        // An empty/partial iCloud snapshot must not be read as "deleted on
        // iCloud" for that contact (ICLOUD_SYNC_REVIEW IS-11).
        const bob = buildContact('uid-bob-baikal-001', OWNED_VCARD, {
            cardName: 'Bob Baikal',
            metadata: {
                isOwned: true,
                carddav: {
                    etag: '"etag-baikal-v1"',
                    href: 'https://baikal.local/dav/card.vcf',
                    lastSyncedAt: new Date().toISOString(),
                    // deliberately NO source: 'iCloud'
                },
            },
        });

        const { service, contactManager, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },   // iCloud knows nothing about Bob
            [bob],
        );

        await service.handleDeletions();
        await service.pushToICloud();

        const contact = contactManager.contacts.get('contact_uid-bob-baikal-001');
        expect(contact).toBeDefined();
        expect(contact?.metadata?.isDeleted).not.toBe(true);
        // And nothing must be deleted on iCloud on his behalf either
        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

    it('does NOT push a Baikal etag as If-Match to iCloud', async () => {
        const bob = buildContact('uid-bob-baikal-002', OWNED_VCARD, {
            cardName: 'Bob Baikal',
            metadata: {
                isOwned: true,
                carddav: {
                    etag: '"etag-baikal-v1"',
                    href: 'https://baikal.local/dav/card.vcf',
                    // deliberately NO source: 'iCloud'
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                createContact: CREATE_SUCCESS,
            },
            [bob],
        );

        // Baikal-only state means "not on iCloud yet" → create, never update
        // with the Baikal etag.
        await service.pushSingleContact(bob);

        expect(mockClient.updateContact).not.toHaveBeenCalled();
        expect(mockClient.createContact).toHaveBeenCalled();
    });

});
