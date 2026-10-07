/**
 * iCloud Sync — timer lifecycle tests (IS-12)
 *
 * startAutoSync() used to arm the shared-refresh offset with an anonymous
 * setTimeout whose handle was never stored, so stopAutoSync() could not
 * cancel it. A stop/start landing inside the offset window (ContactManager
 * does exactly that around bulk operations) leaked an interval per leak
 * that force-pushed every shared contact every 15 minutes for the life of
 * the tab. The re-entrancy guard also checked only syncInterval.
 */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import { buildTestService } from './setup.js';
import { FETCH_EMPTY } from './fixtures/carddav-responses.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

describe('startAutoSync()/stopAutoSync() — timer lifecycle', () => {

    it('stores and clears the shared-refresh offset timeout', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY }, []);

        service.startAutoSync(10, { skipInitialSync: true });
        expect(service.syncInterval).not.toBeNull();
        expect(service.sharedRefreshTimeout).not.toBeNull();
        expect(service.sharedRefreshInterval).toBeNull(); // not armed yet

        service.stopAutoSync();
        expect(service.syncInterval).toBeNull();
        expect(service.sharedRefreshTimeout).toBeNull();
        expect(service.sharedRefreshInterval).toBeNull();
    });

    it('is a no-op while the offset timeout is still pending (re-entrancy guard)', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY }, []);

        service.startAutoSync(10, { skipInitialSync: true });
        const firstIntervalHandle = service.syncInterval;
        const firstTimeoutHandle = service.sharedRefreshTimeout;

        // Second call while all three timer slots are occupied must not
        // touch the existing handles.
        service.startAutoSync(10, { skipInitialSync: true });

        expect(service.syncInterval).toBe(firstIntervalHandle);
        expect(service.sharedRefreshTimeout).toBe(firstTimeoutHandle);

        service.stopAutoSync();
    });

    it('skipInitialSync does not run an immediate performSync()', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY }, []);

        const performSyncSpy = jest.fn();
        service.performSync = performSyncSpy;

        service.startAutoSync(10, { skipInitialSync: true });
        service.stopAutoSync();

        expect(performSyncSpy).not.toHaveBeenCalled();
    });

    it('runs an immediate performSync() when skipInitialSync is not set', async () => {
        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY }, []);

        const performSyncSpy = jest.fn();
        service.performSync = performSyncSpy;

        service.startAutoSync(10);
        service.stopAutoSync();

        expect(performSyncSpy).toHaveBeenCalledTimes(1);
    });

});
