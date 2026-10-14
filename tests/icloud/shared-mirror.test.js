/**
 * iCloud Sync — Shared contact mirror protection
 *
 * Regression tests for the "green card turns orange" failure mode:
 * a contact shared between two users is force-pushed to the recipient's
 * own iCloud account. If the pull phase then runs before (or without)
 * the shared card being loaded locally, the iCloud mirror is imported
 * as an owned/imported (orange) duplicate.
 *
 * Covers:
 * - performSync() waits for local contact data readiness before pulling
 * - pullFromICloud() skips the iCloud mirror while the share is active
 * - forcePushSharedContact() falls back to a forced update when the
 *   create hits 403 (a contact already exists at that UID's href)
 */
import { describe, it, expect } from '@jest/globals';
import { buildTestService, buildSharedContact, flushEvents } from './setup.js';
import {
    FETCH_EMPTY,
    FETCH_NEW_REMOTE_CONTACT,
    FETCH_SHARED,
    CREATE_403_EXISTS,
    UPDATE_SUCCESS,
} from './fixtures/carddav-responses.js';
import { SHARED_VCARD } from './fixtures/vcards.js';

const BOB_UID = 'uid-bob-shared-001';

/** Count non-deleted contacts in ContactManager. */
function activeCount(contactManager) {
    return [...contactManager.contacts.values()].filter(c => !c.metadata.isDeleted).length;
}

describe('shared contact mirror protection', () => {

    it('performSync waits for local contact data readiness before pulling', async () => {
        const { service, db } = await buildTestService({
            fetchContacts: FETCH_NEW_REMOTE_CONTACT,
        });

        // Keep the readiness gate closed until we release it
        let releaseReady;
        db.waitForContactDataReady = () => new Promise(resolve => { releaseReady = resolve; });

        let finished = false;
        const syncPromise = service.performSync().then(result => {
            finished = true;
            return result;
        });

        // Pull must not have run while the gate was closed
        await flushEvents(50);
        expect(finished).toBe(false);

        releaseReady();
        const result = await syncPromise;

        expect(result.success).toBe(true);
        expect(finished).toBe(true);
    });

    it('pull skips the iCloud mirror of a contact held in a received shared database', async () => {
        const { service, contactManager, db } = await buildTestService({
            fetchContacts: FETCH_SHARED,
        });

        // Simulate ContactDatabase's shared-UID cache: Bob's UID is in a
        // database shared with this user (the share is still active)
        db.isSharedContactUID = (uid) => uid === BOB_UID;

        const result = await service.pullFromICloud();

        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(1);

        await flushEvents();
        expect(activeCount(contactManager)).toBe(0);
    });

    it('still imports a remote contact when no shared database holds its UID', async () => {
        const { service, contactManager, db } = await buildTestService({
            fetchContacts: FETCH_SHARED,
        });

        // Shared-UID cache present but empty: normal import must happen
        db.isSharedContactUID = () => false;

        const result = await service.pullFromICloud();

        expect(result.imported).toBe(1);
        await flushEvents();
        expect(activeCount(contactManager)).toBe(1);
    });

    it('force-push falls back to a forced update when create returns 403 (contact already exists)', async () => {
        const bob = buildSharedContact(BOB_UID, SHARED_VCARD, 'alice-user', {
            cardName: 'Bob Shared',
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                createContact: CREATE_403_EXISTS,
                updateContact: UPDATE_SUCCESS,
            },
            [bob],
        );

        const result = await service.refreshSharedContactsToICloud();

        expect(result.refreshed).toBe(1);
        expect(mockClient.createContact).toHaveBeenCalledTimes(1);
        expect(mockClient.updateContact).toHaveBeenCalledWith(BOB_UID, expect.any(String), null);

        // The fallback cached the etag: the next refresh force-updates
        // directly instead of attempting the create (and failing) again
        await service.refreshSharedContactsToICloud();

        expect(mockClient.createContact).toHaveBeenCalledTimes(1);
        expect(mockClient.updateContact).toHaveBeenCalledTimes(2);
    });
});
