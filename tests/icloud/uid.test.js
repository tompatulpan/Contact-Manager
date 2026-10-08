/**
 * UID integrity tests (IS-16)
 *
 * Observed live: importing a vCard file whose cards have no UID made the
 * sync loop create/re-import/delete in a churn —
 *   1. push created the iCloud copy with a server-generated UID,
 *      but never wrote that UID back into the local vCard
 *   2. the next pull could not match the UID-less local card against its
 *      iCloud copy and re-imported the copy as a duplicate
 *   3. the deletion check treats "UID never found in snapshot" as
 *      "deleted on iCloud" and destroyed the original
 *
 * Fixes under test:
 *   - VCardStandard.importVCard injects a UID when the source has none
 *   - an existing UID from the file is preserved untouched
 *   - handleDeletions never treats a UID-less contact as remote-deleted
 *   - both push paths write the iCloud-assigned UID back into the vCard
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { VCardStandard } from '../../src/core/VCardStandard.js';
import { buildTestService, buildContact } from './setup.js';
import { FETCH_EMPTY, CREATE_SUCCESS } from './fixtures/carddav-responses.js';
import { UIDLESS_VCARD, OWNED_VCARD } from './fixtures/vcards.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

describe('VCardStandard.importVCard() — UID injection', () => {

    it('injects a UID when the source vCard has none', () => {
        const result = new VCardStandard().importVCard(UIDLESS_VCARD, 'Test Contact', true);
        expect(result.success).toBe(true);
        expect(result.contact.vcard).toMatch(/^UID:contact_\S+$/m);
    });

    it('preserves an existing UID from the source vCard', () => {
        const result = new VCardStandard().importVCard(OWNED_VCARD, 'Test Contact', true);
        expect(result.success).toBe(true);
        const match = result.contact.vcard.match(/^UID:(.+)$/m);
        const originalMatch = OWNED_VCARD.match(/^UID:(.+)$/m);
        expect(match?.[1]).toBe(originalMatch?.[1]);
    });

});

describe('ICloudSyncService — UID-less contacts and sync', () => {

    it('does NOT treat a UID-less contact as deleted on iCloud', async () => {
        const bob = buildContact('uid-bob-uidless-001', UIDLESS_VCARD, {
            cardName: 'Bob UID-less',
            metadata: {
                isOwned: true,
                isImported: true,   // imported type: remote-delete-wins WOULD apply — the UID guard must still save it
                carddav: { etag: '"etag-bob-v1"', source: 'iCloud' },
            },
        });

        const { service, contactManager, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY },   // nothing on iCloud
            [bob],
        );

        await service.handleDeletions();

        const contact = contactManager.contacts.get('contact_uid-bob-uidless-001');
        expect(contact).toBeDefined();
        expect(contact?.metadata?.isDeleted).not.toBe(true);
        expect(mockClient.deleteContact).not.toHaveBeenCalled();
    });

    it('pushToICloud writes the iCloud-assigned UID back into the local vCard', async () => {
        const carol = buildContact('uid-carol-uidless-002', UIDLESS_VCARD, {
            cardName: 'Carol UID-less',
            metadata: { isOwned: true },
        });

        const { service, contactManager } = await buildTestService(
            { fetchContacts: FETCH_EMPTY, createContact: CREATE_SUCCESS },
            [carol],
        );

        await service.pushToICloud();

        const contact = contactManager.contacts.get('contact_uid-carol-uidless-002');
        expect(contact).toBeDefined();
        // CREATE_SUCCESS.uid === 'uid-carol-remote-002'
        expect(contact?.vcard).toMatch(/^UID:uid-carol-remote-002$/m);
    });

    it('pushSingleContact refuses a UID-less contact (handled by the bulk cycle instead)', async () => {
        const dave = buildContact('uid-dave-uidless-003', UIDLESS_VCARD, {
            cardName: 'Dave UID-less',
            metadata: { isOwned: true },
        });

        const { service, mockClient } = await buildTestService(
            { fetchContacts: FETCH_EMPTY, createContact: CREATE_SUCCESS },
            [dave],
        );

        const result = await service.pushSingleContact(dave);

        // Immediate push refuses: nothing addressable. The bulk pushToICloud
        // cycle creates it and writes the assigned UID back (previous test).
        expect(result.success).toBe(false);
        expect(result.error).toContain('no UID');
        expect(mockClient.createContact).not.toHaveBeenCalled();
    });

    it('does not rewrite the UID when it already matches', async () => {
        const alice = buildContact('uid-alice-owned-001', OWNED_VCARD, {
            cardName: 'Alice Owned',
            metadata: {
                isOwned: true,
                isImported: true,
                // Already synced to iCloud under her own UID
                carddav: { etag: '"etag-alice-v1"', source: 'iCloud', lastSyncedAt: new Date().toISOString() },
            },
        });

        const { service } = await buildTestService({ fetchContacts: FETCH_EMPTY }, [alice]);

        const vcardBefore = alice.vcard;
        await service.pushSingleContact(alice);

        // Unchanged: the contact is in sync, nothing was pushed or rewritten
        expect(alice.vcard).toBe(vcardBefore);
    });

});
