/**
 * UserbaseSDKWrapper and ContactDatabase forwarding tests.
 *
 * Pins two things:
 * 1. The ContactDatabase delegators forward the caller's arguments verbatim
 *    (a regression here silently resets retry parameters to defaults).
 * 2. safeDeleteItem retry behavior: conflicts back off fast, transient
 *    connection errors back off slowly, everything else fails immediately.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { ContactDatabase } from '../src/core/ContactDatabase.js';
import { UserbaseSDKWrapper } from '../src/core/UserbaseSDKWrapper.js';

describe('ContactDatabase — SDK wrapper forwarding', () => {
    it('has every delegating method on the prototype (regression: an orphaned /** comment once silently deleted two of them)', () => {
        const delegated = [
            'sleep', 'isTransientError', 'retryTransientError',
            'validateInsertItemParams', 'validateUpdateItemParams', 'validateDeleteItemParams',
            'validateShareDatabaseParams', 'validateModifyDatabasePermissionsParams',
            'calculateItemSize', 'isValidItemType',
            'handleInsertItemError', 'handleUpdateItemError', 'handleDeleteItemError',
            'handleShareDatabaseError', 'handleModifyDatabasePermissionsError',
            'safeInsertItem', 'safeUpdateItem', 'safeDeleteItem',
            'safeShareDatabase', 'safeModifyDatabasePermissions',
            'handleSDKError', 'handleGetDatabasesError'
        ];
        const missing = delegated.filter(name => typeof ContactDatabase.prototype[name] !== 'function');
        expect(missing).toEqual([]);
    });

    it('forwards caller retry arguments instead of resetting them', async () => {
        const seen = [];
        const db = Object.create(ContactDatabase.prototype);
        db.sdk = {
            retryTransientError: async (...args) => { seen.push(['retryTransientError', args]); },
            safeDeleteItem: async (...args) => { seen.push(['safeDeleteItem', args]); }
        };

        await db.retryTransientError('op', 'ctx', 5, 250);
        await db.safeDeleteItem({ databaseName: 'x' }, 'ctx', 7);

        expect(seen[0][1]).toEqual(['op', 'ctx', 5, 250]);
        expect(seen[1][1][2]).toBe(7);
    });
});

describe('UserbaseSDKWrapper — safeDeleteItem retries', () => {
    afterEach(() => {
        delete globalThis.userbase;
    });

    const makeWrapper = () => {
        const wrapper = new UserbaseSDKWrapper({ emit: () => {} });
        wrapper.delays = [];
        wrapper.sleep = async (ms) => { wrapper.delays.push(ms); };
        return wrapper;
    };

    it('retries ItemUpdateConflict with the fast backoff (100ms base)', async () => {
        const wrapper = makeWrapper();
        let attempts = 0;
        globalThis.userbase = {
            deleteItem: async () => {
                attempts++;
                if (attempts < 3) {
                    const err = new Error('Conflict');
                    err.name = 'ItemUpdateConflict';
                    throw err;
                }
                return {};
            }
        };

        const result = await wrapper.safeDeleteItem({ databaseName: 'db', itemId: 'a' }, 'test');

        expect(result).toEqual({});
        expect(attempts).toBe(3);
        expect(wrapper.delays).toEqual([100, 200]); // 2^0*100, 2^1*100
    });

    it('retries transient connection errors with the slow backoff (1000ms base)', async () => {
        const wrapper = makeWrapper();
        let attempts = 0;
        globalThis.userbase = {
            deleteItem: async () => {
                attempts++;
                if (attempts < 2) {
                    const err = new Error('Service unavailable');
                    err.name = 'ServiceUnavailable';
                    throw err;
                }
                return {};
            }
        };

        await wrapper.safeDeleteItem({ databaseName: 'db', itemId: 'a' }, 'test');

        expect(attempts).toBe(2);
        expect(wrapper.delays).toEqual([1000]); // 2^0*1000
    });

    it('does not retry other errors', async () => {
        const wrapper = makeWrapper();
        globalThis.userbase = {
            deleteItem: async () => {
                const err = new Error('Database not found');
                err.name = 'DatabaseNotFound';
                throw err;
            }
        };

        await expect(wrapper.safeDeleteItem({ databaseName: 'db', itemId: 'a' }, 'test'))
            .rejects.toMatchObject({ name: 'DatabaseNotFound' });
        expect(wrapper.delays).toEqual([]);
    });

    it('rejects invalid params without calling the SDK', async () => {
        const wrapper = makeWrapper();
        let called = false;
        globalThis.userbase = {
            deleteItem: async () => { called = true; }
        };

        await expect(wrapper.safeDeleteItem({ itemId: 'a' }, 'test'))
            .rejects.toMatchObject({ name: 'DatabaseNameMissing' });
        expect(called).toBe(false);
        expect(wrapper.delays).toEqual([]);
    });

    it('honors a custom maxRetries argument', async () => {
        const wrapper = makeWrapper();
        let attempts = 0;
        globalThis.userbase = {
            deleteItem: async () => {
                attempts++;
                if (attempts < 5) {
                    const err = new Error('Conflict');
                    err.name = 'ItemUpdateConflict';
                    throw err;
                }
                return {};
            }
        };

        await wrapper.safeDeleteItem({ databaseName: 'db', itemId: 'a' }, 'test', 7);

        expect(attempts).toBe(5);
        expect(wrapper.delays).toEqual([100, 200, 400, 800]);
    });
});
