/**
 * Test setup helper for iCloud sync tests.
 *
 * Builds a fully wired test environment:
 *   - MockDatabase (in-memory, from TestHelpers)
 *   - Real EventBus
 *   - Real VCardStandard + ContactValidator (no external deps)
 *   - Real ContactManager backed by MockDatabase
 *   - ICloudSyncService with a pre-injected mock iCloudClient
 *
 * No real network calls, no Userbase, no Cloudflare Worker needed.
 *
 * Usage:
 *   const { service, contactManager, mockClient } = await buildTestService({
 *       fetchContacts: FETCH_OWNED_IN_SYNC,
 *   });
 */

import { EventBus } from '../../src/utils/EventBus.js';
import { VCardStandard } from '../../src/core/VCardStandard.js';
import { ContactValidator } from '../../src/core/ContactValidator.js';
import { ContactManager } from '../../src/core/ContactManager.js';
import { ICloudSyncService } from '../../src/integrations/ICloudSyncService.js';
import { MockDatabase } from '../../src/utils/TestHelpers.js';
import { createMockClient } from './__mocks__/ICloudCardDAVClient.mock.js';

/**
 * Build a test service with injected mock iCloud client.
 *
 * @param {object} clientOverrides  Passed to createMockClient() — override per-method responses.
 * @param {Array}  seedContacts     Contacts to seed into ContactManager before returning.
 *
 * @returns {{ service, contactManager, mockClient, eventBus, db }}
 */
export async function buildTestService(clientOverrides = {}, seedContacts = []) {
    const eventBus = new EventBus();
    const db = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator();

    await db.initialize();

    const contactManager = new ContactManager(eventBus, db, vCardStandard, validator);

    // Seed contacts directly into the in-memory Map
    for (const contact of seedContacts) {
        contactManager.contacts.set(contact.contactId, contact);
        // Also persist to MockDatabase so updateContact calls don't fail
        await db.saveContact(contact);
    }

    const mockClient = createMockClient(clientOverrides);

    const service = new ICloudSyncService(eventBus, contactManager);

    // Inject mock client and mark as connected — bypass real HTTP initialization
    service.iCloudClient = mockClient;
    service.isConnected = true;

    return { service, contactManager, mockClient, eventBus, db };
}

/**
 * Build a minimal contact object suitable for seeding into the test service.
 *
 * @param {string} uid        UID value embedded in the vCard (must be stable).
 * @param {string} vcard      Full vCard string.
 * @param {object} overrides  Metadata overrides.
 */
export function buildContact(uid, vcard, overrides = {}) {
    const now = new Date().toISOString();
    return {
        contactId: overrides.contactId ?? `contact_${uid}`,
        cardName: overrides.cardName ?? 'Test Contact',
        vcard,
        metadata: {
            createdAt: now,
            lastUpdated: now,
            isOwned: true,
            isArchived: false,
            isDeleted: false,
            sharing: { isShared: false, shareCount: 0, sharedWithUsers: [] },
            usage: { accessCount: 0 },
            sync: { version: 1, lastSyncedAt: now },
            ...overrides.metadata,
        },
        ...overrides,
    };
}

/**
 * Build a shared (received) contact object.
 * isOwned = false, contactId starts with "shared_".
 */
export function buildSharedContact(uid, vcard, sharedBy = 'owner-user', overrides = {}) {
    return buildContact(uid, vcard, {
        contactId: `shared_${uid}`,
        cardName: overrides.cardName ?? 'Shared Contact',
        ...overrides,
        metadata: {
            isOwned: false,
            isArchived: false,
            isDeleted: false,
            sharedBy,
            sharing: { isShared: false, shareCount: 0, sharedWithUsers: [] },
            usage: { accessCount: 0 },
            sync: { version: 1 },
            ...(overrides.metadata ?? {}),
        },
    });
}

/**
 * Wait for all pending setTimeout(fn, 10) callbacks to fire.
 * MockDatabase emits 'contacts:changed' asynchronously; tests that assert
 * on contactManager.contacts must call this after an import/save.
 */
export async function flushEvents(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
