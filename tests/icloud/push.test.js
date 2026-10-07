/**
 * iCloud Sync — Push tests
 *
 * Verifies that pushToICloud() sends the right HTTP calls for:
 * - New owned contacts (createContact)
 * - Modified owned contacts (updateContact)
 * - Contacts already in sync (skipped)
 * - Archived contacts (skipped)
 * - Shared contacts (not pushed in the regular owned-push loop;
 *   they go through refreshSharedContactsToICloud instead)
 */
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { buildTestService, buildContact, buildSharedContact } from './setup.js';
import {
    FETCH_EMPTY,
    CREATE_SUCCESS,
    UPDATE_SUCCESS,
} from './fixtures/carddav-responses.js';
import { OWNED_VCARD, SHARED_VCARD } from './fixtures/vcards.js';

// ICloudSyncService calls `userbase.deleteItem` for hard deletes; mock the global.
beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

const ALICE_UID = 'uid-alice-owned-001';
const BOB_UID   = 'uid-bob-shared-001';

describe('pushToICloud()', () => {

    it('calls createContact for a new owned contact (no CardDAV metadata)', async () => {
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: { isOwned: true },   // no carddav key → never synced
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                createContact: CREATE_SUCCESS,
            },
            [alice],
        );

        const result = await service.pushToICloud();

        expect(mockClient.createContact).toHaveBeenCalledTimes(1);
        const [calledVCard] = mockClient.createContact.mock.calls[0];
        expect(calledVCard).toContain('Alice Owned');
        expect(result.pushed).toBeGreaterThanOrEqual(1);
    });

    it('calls updateContact for an owned contact modified after last sync', async () => {
        const past = new Date(Date.now() - 60_000).toISOString(); // synced 60s ago
        const now  = new Date().toISOString();

        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                lastUpdated: now,
                carddav: {
                    etag: '"etag-alice-v1"',
                    href: '/card/uid-alice-owned-001.vcf',
                    lastSyncedAt: past,   // ← modified AFTER last sync
                    source: 'iCloud',
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                updateContact: UPDATE_SUCCESS,
            },
            [alice],
        );

        const result = await service.pushToICloud();

        expect(mockClient.updateContact).toHaveBeenCalledTimes(1);
        const [uid, vcard, etag] = mockClient.updateContact.mock.calls[0];
        expect(uid).toBe(ALICE_UID);
        expect(etag).toBe('"etag-alice-v1"');
        expect(vcard).toContain('Alice Owned');
        expect(result.pushed).toBeGreaterThanOrEqual(1);
    });

    it('skips an owned contact that was synced more recently than it was modified', async () => {
        const syncTime = new Date().toISOString();

        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                lastUpdated: new Date(Date.now() - 30_000).toISOString(), // modified 30s ago
                carddav: {
                    etag: '"etag-alice-v1"',
                    href: '/card/uid-alice-owned-001.vcf',
                    lastSyncedAt: syncTime, // ← synced AFTER last modification
                    source: 'iCloud',
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [alice],
        );

        const result = await service.pushToICloud();

        expect(mockClient.createContact).not.toHaveBeenCalled();
        expect(mockClient.updateContact).not.toHaveBeenCalled();
        expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it('skips an archived contact', async () => {
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: { isOwned: true, isArchived: true },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [alice],
        );

        await service.pushToICloud();

        expect(mockClient.createContact).not.toHaveBeenCalled();
        expect(mockClient.updateContact).not.toHaveBeenCalled();
    });

    it('does not push a shared (isOwned=false) contact in the regular push loop', async () => {
        const bob = buildSharedContact(BOB_UID, SHARED_VCARD, 'owner-user', {
            cardName: 'Bob Shared',
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [bob],
        );

        await service.pushToICloud();

        // Shared contacts must NOT be created/updated in the regular push loop.
        // They go through refreshSharedContactsToICloud() instead.
        expect(mockClient.createContact).not.toHaveBeenCalled();
        expect(mockClient.updateContact).not.toHaveBeenCalled();
    });

    it('updates the stored ETag after a successful update', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const now  = new Date().toISOString();

        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                lastUpdated: now,
                carddav: {
                    etag: '"etag-alice-v1"',
                    href: '/card/uid-alice-owned-001.vcf',
                    lastSyncedAt: past,
                    source: 'iCloud',
                },
            },
        });

        const { service, contactManager } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                updateContact: UPDATE_SUCCESS,  // returns etag-alice-v3
            },
            [alice],
        );

        await service.pushToICloud();

        const updated = contactManager.contacts.get(`contact_${ALICE_UID}`);
        expect(updated?.metadata?.carddav?.etag).toBe('"etag-alice-v3"');
    });

});
