/**
 * UserbaseAuth - session and authentication layer for the Userbase SDK
 *
 * Owns every auth-flow SDK call: init, signUp, signIn, signOut, verifyUser,
 * getVerificationMessage, and the session-preference storage keys
 * ('userbase-remember-me' / 'userbase-session-only').
 *
 * Auth state (currentUser, isInitialized, appId) lives on ContactDatabase;
 * this module reads and writes it through the injected accessors so there
 * is exactly one source of truth. ContactDatabase keeps thin delegating
 * methods, so callers and tests keep their existing API.
 *
 * Session rules this module enforces:
 * - "Keep me signed in" unchecked => session-only login, which must never
 *   survive a page refresh (rejectSessionOnlyLogin clears it once, at app
 *   startup, before the SDK can resume it).
 * - The SDK writes its session record only to the storage matching
 *   rememberMe; the stale record in the other storage is removed so it can
 *   never be resumed.
 * - getConnectionStatus() is a pure query; the destructive cleanup lives in
 *   rejectSessionOnlyLogin() / signOut().
 */

import { USERBASE_CONFIG } from '../config/app.config.js';

export class UserbaseAuth {
    /**
     * @param {Object} deps - Injected state and hooks
     * @param {Object} deps.eventBus - Event bus for auth/database events
     * @param {Function} deps.getUser - () => current user object or null
     * @param {Function} deps.setUser - (user|null) => void
     * @param {Function} deps.getInitialized - () => boolean
     * @param {Function} deps.setInitialized - (boolean) => void
     * @param {Function} deps.getAppId - () => string|null
     * @param {Function} deps.setAppId - (string) => void
     * @param {Function} deps.setupDatabases - async () => void, opens app databases after auth
     * @param {Function} deps.clearSessionData - () => void, full auth+cache state reset
     * @param {Function} deps.clearChangeHandlers - () => void, drops open-database change handlers
     * @param {Function} deps.startSharedDatabaseMonitoring - () => void, periodic discovery
     * @param {Function} deps.getActiveDatabases - () => string[], names of open databases
     */
    constructor(deps) {
        this.deps = deps;
        this.eventBus = deps.eventBus;
    }

    /**
     * Initialize Userbase connection
     * @param {string} appId - Userbase app ID
     */
    async initialize(appId) {
        if (this.deps.getInitialized()) {
            return;
        }

        try {
            // Check if Userbase SDK is available
            if (typeof window.userbase === 'undefined') {
                console.error('❌ Userbase SDK not loaded!');
                throw new Error('Userbase SDK not loaded. Make sure userbase.js is loaded before app.js');
            }

            this.deps.setAppId(appId);

            // Follow SDK specification exactly - let Userbase handle session resumption
            let session;
            try {
                session = await window.userbase.init({
                    appId,
                    sessionLength: 24,  // Hours - extend session if resuming
                    updateUserHandler: (user) => {
                        this.deps.setUser(user);
                        this.eventBus.emit('database:userUpdated', { user });
                    }
                });
            } catch (initError) {
                if (initError.message.includes('AppIdAlreadySet') ||
                    initError.message.includes('Application ID already set')) {

                    // Use existing session if available
                    if (window.userbase.user) {
                        session = { user: window.userbase.user };
                    } else {
                        session = { user: null };
                    }
                } else {
                    throw initError;
                }
            }

            // Simple session check - trust Userbase's session management completely
            if (session.user) {
                this.deps.setUser(session.user);
                await this.deps.setupDatabases();
                this.eventBus.emit('database:authenticated', { user: this.deps.getUser() });
            } else {
                this.deps.setUser(null);
            }

            this.deps.setInitialized(true);

            this.eventBus.emit('database:initialized', {
                appId,
                hasSession: !!session.user,
                timestamp: new Date().toISOString()
            });

            // Start periodic check for new shared databases
            this.deps.startSharedDatabaseMonitoring();

        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            this.eventBus.emit('database:error', {
                error: error.message,
                phase: 'initialization'
            });
            throw error;
        }
    }

    /**
     * Check if there's a stored session that can be restored
     * @returns {Promise<boolean>} True if stored session exists
     */
    async hasStoredSession() {
        try {
            // Check if Userbase has session data in localStorage
            if (typeof localStorage !== 'undefined') {
                // Look for Userbase session indicators
                const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';

                // Check for Userbase-specific storage keys that indicate an active session
                const keys = Object.keys(localStorage);
                const hasUserbaseSession = keys.some(key =>
                    (key.includes('userbase') || key.includes('Userbase') || key.startsWith('ub_')) &&
                    localStorage.getItem(key) !== null
                );

                // Also check sessionStorage for session-only auth
                const hasSessionOnly = sessionStorage.getItem('userbase-session-only') === 'true';

                const result = (hasRememberMe && hasUserbaseSession) || hasSessionOnly;
                return result;
            }
            return false;
        } catch (error) {
            console.error('Error checking stored session:', error);
            return false;
        }
    }

    /**
     * Attempt to restore a stored session silently and initialize database
     * @returns {Promise<Object>} Restoration result
     */
    async restoreSession() {
        try {
            // Check session preferences first
            const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';
            const hasSessionOnly = sessionStorage.getItem('userbase-session-only') === 'true';

            if (!hasRememberMe && !hasSessionOnly) {
                return {
                    success: false,
                    error: 'No session preference found'
                };
            }

            // For session-only auth, sessions should NOT persist across page refreshes
            // Userbase SDK will try to restore it, so we explicitly clear and reject
            if (hasSessionOnly) {
                await this.rejectSessionOnlyLogin();
                return {
                    success: false,
                    error: 'Session-only auth expired on page refresh'
                };
            }

            // Ensure appId is set (required by userbase.init) — initialize() may not have run yet
            if (!this.deps.getAppId()) {
                this.deps.setAppId(USERBASE_CONFIG.appId);
            }

            // ✅ SDK COMPLIANT: Use proper async/await instead of Promise constructor
            const session = await userbase.init({
                appId: this.deps.getAppId(),
                updateUserHandler: (user) => {
                    this.deps.setUser(user);
                    this.eventBus.emit('database:userUpdated', { user });
                }
            });

            if (session.user) {
                this.deps.setUser(session.user);
                this.deps.setInitialized(true);

                // 🚀 CRITICAL: Initialize databases immediately during restoration
                try {
                    await this.deps.setupDatabases();

                    // Emit authentication event
                    this.eventBus.emit('database:authenticated', { user: this.deps.getUser() });

                    return {
                        success: true,
                        user: { username: session.user.username },
                        sessionType: hasRememberMe ? 'persistent' : 'session',
                        databasesReady: true
                    };
                } catch (dbError) {
                    console.error('❌ Database setup failed during restoration:', dbError);
                    return {
                        success: true, // Session restored but database setup failed
                        user: { username: session.user.username },
                        sessionType: hasRememberMe ? 'persistent' : 'session',
                        databasesReady: false,
                        dbError: dbError.message
                    };
                }
            } else {
                return {
                    success: false,
                    error: 'No valid session found'
                };
            }
        } catch (error) {
            console.error('Session restoration failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sign up new user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {string} [email] - Optional email address
     * @param {Object} [profile] - Optional user profile data
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signup result
     */
    async signUp(username, password, email = null, profile = null, rememberMe = false) {
        try {
            // The auth modal can be reached before userbase.init() ran on this
            // page load (SDK loaded late, or an earlier init attempt failed);
            // the SDK would reject signUp with AppIdNotSet. Initialize first.
            if (!this.deps.getInitialized()) {
                await this.initialize(USERBASE_CONFIG.appId);
            }

            const signUpParams = {
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session',
                sessionLength: rememberMe ? 720 : 24 // Hours - 720h (30 days) for persistent, 24h for session
            };

            // Add optional parameters if provided
            if (email) signUpParams.email = email;
            if (profile) signUpParams.profile = profile;

            const result = await userbase.signUp(signUpParams);

            // The SDK writes the new session only to the storage matching rememberMe;
            // remove any stale record from the other storage so it cannot be resumed
            if (rememberMe) {
                sessionStorage.removeItem('userbaseCurrentSession');
            } else {
                localStorage.removeItem('userbaseCurrentSession');
            }

            this.deps.setUser(result.user || result); // Handle both wrapped and unwrapped user objects

            // Persist session preference so hasStoredSession() / restoreSession() can read it
            if (rememberMe) {
                localStorage.setItem('userbase-remember-me', 'true');
                sessionStorage.removeItem('userbase-session-only');
            } else {
                localStorage.removeItem('userbase-remember-me');
                sessionStorage.setItem('userbase-session-only', 'true');
            }

            await this.deps.setupDatabases();

            this.eventBus.emit('database:authenticated', { user: this.deps.getUser() });
            return { success: true, user: this.deps.getUser() };
        } catch (error) {
            console.error('Sign up failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign in existing user - follows Userbase SDK specification exactly
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {boolean} [rememberMe=false] - Session persistence preference
     * @returns {Promise<Object>} Signin result
     */
    async signIn(username, password, rememberMe = false) {
        try {
            // Same AppIdNotSet protection as signUp: ensure the SDK has an
            // app ID before calling into it
            if (!this.deps.getInitialized()) {
                await this.initialize(USERBASE_CONFIG.appId);
            }

            // Follow SDK specification exactly - no custom session tracking
            const result = await userbase.signIn({
                username,
                password,
                rememberMe: rememberMe ? 'local' : 'session',
                sessionLength: rememberMe ? 720 : 24 // Hours - 720h (30 days) for persistent, 24h for session
            });

            // The SDK writes the new session only to the storage matching rememberMe;
            // remove any stale record from the other storage so it cannot be resumed
            if (rememberMe) {
                sessionStorage.removeItem('userbaseCurrentSession');
            } else {
                localStorage.removeItem('userbaseCurrentSession');
            }

            this.deps.setUser(result.user || result); // Handle both wrapped and unwrapped user objects

            // Persist session preference so hasStoredSession() / restoreSession() can read it
            if (rememberMe) {
                localStorage.setItem('userbase-remember-me', 'true');
                sessionStorage.removeItem('userbase-session-only');
            } else {
                localStorage.removeItem('userbase-remember-me');
                sessionStorage.setItem('userbase-session-only', 'true');
            }

            await this.deps.setupDatabases();

            this.eventBus.emit('database:authenticated', { user: this.deps.getUser() });

            return {
                success: true,
                user: this.deps.getUser(),
                sessionType: rememberMe ? 'persistent' : 'session'
            };
        } catch (error) {
            console.error('Sign in failed:', error);

            // Handle UserAlreadySignedIn gracefully
            if (error.name === 'UserAlreadySignedIn') {

                if (this.deps.getUser()) {
                    await this.deps.setupDatabases();
                    this.eventBus.emit('database:authenticated', { user: this.deps.getUser() });
                    return { success: true, user: this.deps.getUser() };
                }
            }

            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign out current user - follows Userbase SDK specification exactly
     * @returns {Promise<Object>} Signout result
     */
    async signOut() {
        try {
            // Let Userbase handle the logout completely - no manual storage clearing
            await userbase.signOut();

            // The SDK only invalidates the session matching the current rememberMe setting;
            // remove both session records so no stale one can be resumed in a new tab
            sessionStorage.removeItem('userbaseCurrentSession');
            localStorage.removeItem('userbaseCurrentSession');

            // Only clear application-specific state
            this.deps.setUser(null);
            this.deps.clearSessionData();
            this.deps.clearChangeHandlers();

            this.eventBus.emit('database:signedOut', {});
            return { success: true };
        } catch (error) {
            // Handle "Not signed in" gracefully per SDK docs
            if (error.message && error.message.includes('Not signed in')) {
                this.deps.setUser(null);
                this.deps.clearSessionData();
                this.eventBus.emit('database:signedOut', {});
                return { success: true };
            }

            console.error('❌ Sign out failed:', error);
            this.eventBus.emit('database:error', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify a user using their verification message (required for secure sharing)
     * @param {string} verificationMessage - The verification message from the user being verified
     * @returns {Promise<Object>} Verification result
     */
    async verifyUser(verificationMessage) {
        try {
            await userbase.verifyUser({
                verificationMessage: verificationMessage.trim()
            });

            return { success: true };

        } catch (error) {
            console.error(`❌ User verification failed:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current user's verification message for sharing with others
     * @returns {Promise<Object>} Verification message result
     */
    async getVerificationMessage() {
        try {
            const result = await userbase.getVerificationMessage();

            return { success: true, verificationMessage: result.verificationMessage };

        } catch (error) {
            console.error(`❌ Failed to get verification message:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Reject a session-only login on a fresh page load.
     *
     * "Keep me signed in" was unchecked, so the login must not survive a
     * page refresh. The flag alone cannot distinguish "just logged in"
     * from "page refreshed" (it stays 'true' in sessionStorage for the
     * whole tab lifetime), so this acts only when no session is live in
     * memory (currentUser is null) — i.e. exactly once, at app startup,
     * before the SDK can restore the session from storage.
     *
     * Clears the preference flag, the Userbase SDK session record from
     * both storages (the SDK would otherwise resume it) and the in-memory
     * state. Callers can then treat the user as signed out.
     *
     * @returns {Promise<boolean>} true when a session-only login was rejected
     */
    async rejectSessionOnlyLogin() {
        if (sessionStorage.getItem('userbase-session-only') !== 'true' || this.deps.getUser()) {
            return false;
        }

        this.deps.clearSessionData();
        try { localStorage.removeItem('userbaseCurrentSession'); } catch (e) {}
        try { sessionStorage.removeItem('userbaseCurrentSession'); } catch (e) {}
        try {
            if (typeof userbase !== 'undefined' && userbase) {
                await userbase.signOut();
            }
        } catch (e) {
            // signOut before userbase.init() throws — storage is already
            // cleared, so the session cannot be restored anyway
        }
        return true;
    }

    /**
     * Get database connection status.
     *
     * Pure status getter — no side effects, no sign-out, no storage writes.
     * The "reject session-only on page refresh" cleanup happens once at
     * app startup via rejectSessionOnlyLogin(); this method must stay
     * side-effect free because it is called during a live session
     * (app.getStatus(), handleAuthenticated recovery) where a destructive
     * branch would sign the user out.
     *
     * @returns {Object} Connection status
     */
    getConnectionStatus() {
        const hasRememberMe = localStorage.getItem('userbase-remember-me') === 'true';

        return {
            isInitialized: this.deps.getInitialized(),
            isAuthenticated: !!this.deps.getUser(),
            currentUser: this.deps.getUser()?.username,
            sessionType: hasRememberMe ? 'persistent' : 'session',
            activeDatabases: this.deps.getActiveDatabases()
        };
    }
}

export default UserbaseAuth;
