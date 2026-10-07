/**
 * iCloud Sync — Orphaned contact cleanup tests
 *
 * An "orphaned" contact is one that exists on the iCloud server but has been
 * soft-deleted locally (and the deletion hasn't been pushed yet, so the
 * server still has it).
 *
 * The inverse scenario — contact on server but never synced locally — must
 * NOT be treated as an orphan; it should be pulled instead.
 *
 * These tests cover ICloudSyncService behaviour as well as the
 * shouldPushContact() guard that prevents incorrectly deleting un-synced contacts.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { buildTestService, buildContact } from './setup.js';
import {
    FETCH_EMPTY,
    FETCH_OWNED_IN_SYNC,
    DELETE_SUCCESS,
    DELETE_FAILURE_404,
} from './fixtures/carddav-responses.js';
import { OWNED_VCARD, DELETED_VCARD } from './fixtures/vcards.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

const ALICE_UID = 'uid-alice-owned-001';
const EVE_UID   = 'uid-eve-deleted-004';

describe('Orphaned contact detection', () => {

    it('pushes deletion to iCloud for a locally-deleted contact that HAS carddav metadata', async () => {
        // Eve was previously synced (has etag) and is now soft-deleted locally.
        // On next push, her deletion must be sent to iCloud.
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                carddav: {
                    etag: '"etag-eve-v1"',
                    href: `/card/${EVE_UID}.vcf`,
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

        await service.pushToICloud();

        expect(mockClient.deleteContact).toHaveBeenCalledTimes(1);
        expect(mockClient.deleteContact).toHaveBeenCalledWith(EVE_UID, '"etag-eve-v1"');
    });

    it('does NOT call deleteContact for a locally-deleted contact WITHOUT carddav metadata', async () => {
        // Eve never synced — nothing to delete on iCloud.
        // This is the regression test for the Nov 28 2025 bug.
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                // no carddav key → never pushed to iCloud
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },
            [eve],
        );

        await service.pushToICloud();

        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

    it('handles a 404 from deleteContact gracefully (already gone from iCloud)', async () => {
        const eve = buildContact(EVE_UID, DELETED_VCARD, {
            cardName: 'Eve Deleted',
            metadata: {
                isOwned: true,
                isDeleted: true,
                carddav: {
                    etag: '"etag-eve-v1"',
                    href: `/card/${EVE_UID}.vcf`,
                    syncStatus: 'synced',
                    source: 'iCloud',
                },
            },
        });

        const { service } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                deleteContact: DELETE_FAILURE_404,
            },
            [eve],
        );

        // Must not throw even when iCloud returns 404
        await expect(service.pushToICloud()).resolves.toBeDefined();
    });

    it('does NOT delete a locally-active contact just because it is missing from iCloud', async () => {
        // Alice exists locally (active, has carddav metadata) but iCloud is empty.
        // The deletion check in handleDeletions should delete her locally
        // (iCloud-side deletion wins for owned contacts).
        // This test ensures handleDeletions doesn't also call iCloud DELETE.
        const alice = buildContact(ALICE_UID, OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                isDeleted: false,  // ← NOT deleted locally
                carddav: {
                    etag: '"etag-alice-v1"',
                    source: 'iCloud',
                    lastSyncedAt: new Date().toISOString(),
                },
            },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },   // iCloud is empty → Alice "deleted" on iCloud
            [alice],
        );

        // handleDeletions detects Alice is gone from iCloud → removes her locally
        await service.handleDeletions();

        // The deletion is iCloud→local, NOT local→iCloud.
        // deleteContact must NOT be called (Alice wasn't deleted locally then pushed).
        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

});
