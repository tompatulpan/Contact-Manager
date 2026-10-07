/**
 * Factory that creates a mock ICloudCardDAVClient.
 *
 * Strategy: We do NOT use jest.unstable_mockModule() because it requires
 * static analysis of imports which is fragile with ESM.  Instead we
 * directly set `service.iCloudClient` to a mock object after construction.
 *
 * Usage:
 *   import { createMockClient, seq } from './__mocks__/ICloudCardDAVClient.mock.js';
 *
 *   // Single response value (including arrays like contact lists):
 *   const mock = createMockClient({ fetchContacts: FETCH_EMPTY });
 *
 *   // Sequence of responses (for multi-call tests like 412 retry):
 *   const mock = createMockClient({
 *     updateContact: seq(UPDATE_412_STALE_ETAG, UPDATE_SUCCESS_AFTER_REFRESH),
 *   });
 */
import { jest } from '@jest/globals';
import {
    CONNECT_SUCCESS,
    FETCH_EMPTY,
    UPDATE_SUCCESS,
    CREATE_SUCCESS,
    DELETE_SUCCESS,
    GET_CONTACT_SUCCESS,
} from '../fixtures/carddav-responses.js';

/**
 * Wrap multiple responses as a sequence for multi-call mocking.
 * The last value is repeated once the sequence is exhausted.
 */
export function seq(...values) {
    return { __seq: true, values };
}

/**
 * Build a mock client.
 *
 * @param {object} overrides  Per-method response overrides.  Each key is a
 *   method name; the value is the resolved return value OR a seq(...) for
 *   multi-call sequences.
 *
 * @returns {object} Mock client with jest.fn() methods.
 */
export function createMockClient(overrides = {}) {
    function makeImpl(key, defaultValue) {
        const override = overrides[key];

        if (override !== undefined && override !== null && override.__seq === true) {
            // Sequence mode: return values in order, repeat last
            const values = override.values;
            let idx = 0;
            return jest.fn().mockImplementation(() => {
                const val = values[Math.min(idx, values.length - 1)];
                idx++;
                return Promise.resolve(val);
            });
        }

        const value = override !== undefined ? override : defaultValue;
        return jest.fn().mockResolvedValue(value);
    }

    return {
        connect: makeImpl('connect', CONNECT_SUCCESS),
        fetchContacts: makeImpl('fetchContacts', FETCH_EMPTY),
        updateContact: makeImpl('updateContact', UPDATE_SUCCESS),
        createContact: makeImpl('createContact', CREATE_SUCCESS),
        deleteContact: makeImpl('deleteContact', DELETE_SUCCESS),
        getContactByUID: makeImpl('getContactByUID', GET_CONTACT_SUCCESS),
    };
}
