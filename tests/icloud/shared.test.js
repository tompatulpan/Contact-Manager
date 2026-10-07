/**
 * iCloud Sync — Shared contact tests
 *
 * Shared contacts (isOwned=false, contactId starts with "shared_") are
 * handled separately from owned contacts:
 * - They are NOT pulled from iCloud (CM is not the authority; the owner is)
 * - They ARE force-pushed during refreshSharedContactsToICloud()
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { buildTestService, buildSharedContact } from './setup.js';
import {
    FETCH_EMPTY,
    FETCH_SHARED,
    CREATE_SUCCESS,
    UPDATE_SUCCESS,
} from './fixtures/carddav-responses.js';
import { SHARED_VCARD } from './fixtures/vcards.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

const BOB_UID = 'uid-bob-shared-001';

describe('refreshSharedContactsToICloud()', () => {

    it('returns refreshed=0 when there are no shared contacts', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY });

        const result = await service.refreshSharedContactsToICloud();

        expect(result.refreshed).toBe(0);
        expect(result.success).toBe(true);
    });

    it('force-pushes a shared contact to iCloud', async () => {
        const bob = buildSharedContact(BOB_UID, SHARED_VCARD, 'alice-user', {
            cardName: 'Bob Shared',
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,  // Bob not on iCloud yet → createContact called
                createContact: CREATE_SUCCESS,
            },
            [bob],
        );

        const result = await service.refreshSharedContactsToICloud();

        // Should have tried to push Bob
        const pushed =
            mockClient.createContact.mock.calls.length +
            mockClient.updateContact.mock.calls.length;
        expect(pushed).toBeGreaterThanOrEqual(1);
        expect(result.refreshed).toBeGreaterThanOrEqual(1);
    });

    it('force-pushes even when iCloud already has the shared contact (overrides it)', async () => {
        // Bob already exists on iCloud but we still force-push in the refresh cycle
        const bob = buildSharedContact(BOB_UID, SHARED_VCARD, 'alice-user', {
            cardName: 'Bob Shared',
            metadata: {
                isOwned: false,
                isDeleted: false,
                isArchived: false,
                sharedBy: 'alice-user',
            },
        });

        // sharedContactSyncCache has Bob's existing ETag
        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_SHARED,   // Bob exists on iCloud
                updateContact: UPDATE_SUCCESS,
                createContact: CREATE_SUCCESS,
            },
            [bob],
        );

        // Pre-populate the shared sync cache so the service attempts an UPDATE
        service.sharedContactSyncCache = new Map();
        service.sharedContactSyncCache.set(bob.contactId, {
            etag: '"etag-bob-v1"',
            href: `/card/${BOB_UID}.vcf`,
            uid: BOB_UID,
            lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
        });

        const result = await service.refreshSharedContactsToICloud();

        const pushed =
            mockClient.createContact.mock.calls.length +
            mockClient.updateContact.mock.calls.length;
        expect(pushed).toBeGreaterThanOrEqual(1);
        expect(result.refreshed).toBeGreaterThanOrEqual(1);
    });

    it('skips archived shared contacts', async () => {
        const bob = buildSharedContact(BOB_UID, SHARED_VCARD, 'alice-user', {
            cardName: 'Bob Shared',
            metadata: {
                isOwned: false,
                isArchived: true,
                isDeleted: false,
                sharedBy: 'alice-user',
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [bob],
        );

        const result = await service.refreshSharedContactsToICloud();

        expect(mockClient.createContact).not.toHaveBeenCalled();
        expect(mockClient.updateContact).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(0);
    });

});
