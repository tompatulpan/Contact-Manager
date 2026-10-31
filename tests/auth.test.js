/**
 * UserbaseAuth unit tests.
 *
 * The auth module owns the session-preference rules that were broken and
 * hand-fixed in the browser earlier (session-only logins must not survive a
 * refresh; persistent logins must). These tests pin that behavior at the
 * storage level, with the SDK and the state hooks stubbed out.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UserbaseAuth } from '../src/core/UserbaseAuth.js';

// Minimal storage shims (Jest's node environment has no DOM)
const makeStorage = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        keys: () => [...map.keys()]
    };
};

const makeAuth = (storage) => {
    const state = { currentUser: null, isInitialized: false, appId: null };
    const calls = { setupDatabases: 0, clearSessionData: 0, clearChangeHandlers: 0, startMonitoring: 0 };
    const auth = new UserbaseAuth({
        eventBus: { emit: () => {} },
        getUser: () => state.currentUser,
        setUser: (u) => { state.currentUser = u; },
        getInitialized: () => state.isInitialized,
        setInitialized: (v) => { state.isInitialized = v; },
        getAppId: () => state.appId,
        setAppId: (id) => { state.appId = id; },
        setupDatabases: async () => { calls.setupDatabases++; },
        // Mimics ContactDatabase.clearSessionData: resets auth state AND the
        // session-preference storage keys
        clearSessionData: () => {
            calls.clearSessionData++;
            storage.localStorage.removeItem('userbase-remember-me');
            storage.sessionStorage.removeItem('userbase-session-only');
            storage.sessionStorage.removeItem('userbase-page-loaded');
        },
        clearChangeHandlers: () => { calls.clearChangeHandlers++; },
        startSharedDatabaseMonitoring: () => { calls.startMonitoring++; },
        getActiveDatabases: () => ['contacts']
    });
    return { auth, state, calls };
};

describe('UserbaseAuth — session preferences', () => {
    let localStorage, sessionStorage, auth, state, calls;

    beforeEach(() => {
        localStorage = makeStorage();
        sessionStorage = makeStorage();
        globalThis.localStorage = localStorage;
        globalThis.sessionStorage = sessionStorage;
        globalThis.window = {};
        globalThis.userbase = {
            signIn: async () => ({ user: { username: 'alice' } }),
            signUp: async () => ({ user: { username: 'alice' } }),
            signOut: async () => {},
            init: async () => ({ user: null })
        };
        globalThis.window.userbase = globalThis.userbase;
        ({ auth, state, calls } = makeAuth({ localStorage, sessionStorage }));
    });

    afterEach(() => {
        delete globalThis.localStorage;
        delete globalThis.sessionStorage;
        delete globalThis.userbase;
        delete globalThis.window;
    });

    it('sign-in with rememberMe stores the persistent preference and clears the session-only flag', async () => {
        sessionStorage.setItem('userbase-session-only', 'true'); // stale flag from a previous login

        const result = await auth.signIn('alice', 'pw', true);

        expect(result.success).toBe(true);
        expect(result.sessionType).toBe('persistent');
        expect(localStorage.getItem('userbase-remember-me')).toBe('true');
        expect(sessionStorage.getItem('userbase-session-only')).toBeNull();
        expect(state.currentUser).toEqual({ username: 'alice' });
        expect(calls.setupDatabases).toBe(1);
    });

    it('sign-in without rememberMe stores the session-only preference and clears the persistent flag', async () => {
        localStorage.setItem('userbase-remember-me', 'true'); // stale flag from a previous login

        const result = await auth.signIn('alice', 'pw', false);

        expect(result.success).toBe(true);
        expect(result.sessionType).toBe('session');
        expect(sessionStorage.getItem('userbase-session-only')).toBe('true');
        expect(localStorage.getItem('userbase-remember-me')).toBeNull();
    });

    it('rejectSessionOnlyLogin clears the session when flag is set and no user is live, exactly once', async () => {
        sessionStorage.setItem('userbase-session-only', 'true');

        const first = await auth.rejectSessionOnlyLogin();
        const second = await auth.rejectSessionOnlyLogin();

        expect(first).toBe(true);   // rejected: flag cleared + signed out
        expect(second).toBe(false); // flag gone, nothing to reject
        expect(sessionStorage.getItem('userbase-session-only')).toBeNull();
        expect(calls.clearSessionData).toBe(1);
    });

    it('rejectSessionOnlyLogin does nothing once a session is live in memory', async () => {
        sessionStorage.setItem('userbase-session-only', 'true');
        state.currentUser = { username: 'alice' }; // mid-session: currentUser set

        const rejected = await auth.rejectSessionOnlyLogin();

        expect(rejected).toBe(false);
        expect(sessionStorage.getItem('userbase-session-only')).toBe('true'); // untouched
        expect(calls.clearSessionData).toBe(0);
    });

    it('getConnectionStatus is a pure query — no storage writes, no state changes', () => {
        localStorage.setItem('userbase-remember-me', 'true');
        state.currentUser = { username: 'alice' };
        state.isInitialized = true;

        const before = sessionStorage.keys();
        const status = auth.getConnectionStatus();

        expect(status).toEqual({
            isInitialized: true,
            isAuthenticated: true,
            currentUser: 'alice',
            sessionType: 'persistent',
            activeDatabases: ['contacts']
        });
        expect(sessionStorage.keys()).toEqual(before);
        expect(state.currentUser).toEqual({ username: 'alice' }); // unchanged
    });

    it('signOut clears both SDK session records and resets app state', async () => {
        state.currentUser = { username: 'alice' };
        localStorage.setItem('userbase-remember-me', 'true');

        const result = await auth.signOut();

        expect(result.success).toBe(true);
        expect(state.currentUser).toBeNull();
        expect(calls.clearSessionData).toBe(1);
        expect(calls.clearChangeHandlers).toBe(1);
    });
});
