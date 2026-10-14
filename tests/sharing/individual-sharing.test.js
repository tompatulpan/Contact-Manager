/**
 * IndividualSharingStrategy — recipient projection and revocation.
 *
 * Covers SH-01 (revocation must revoke the Userbase permission, not just
 * delete the item) and SH-02 (the recipient copy must not carry owner-only
 * sharing metadata or the CATEGORIES:SHARED backup line).
 *
 * A small fake stands in for ContactDatabase: it records the SDK-wrapper
 * calls the strategy makes and lets a test script the failure modes.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { IndividualSharingStrategy } from '../../src/core/IndividualSharingStrategy.js';
import { ContactDatabase } from '../../src/core/ContactDatabase.js';

class FakeDatabase {
    constructor() {
        this.currentUser = { username: 'owner' };
        this.calls = [];
        // databaseName -> array of flattened items ({...item, itemId})
        this.databases = new Map();
        this.failPermissionWith = null;
    }

    validateInsertItemParams() { return { isValid: true, errors: [] }; }
    validateShareDatabaseParams() { return { isValid: true, errors: [] }; }
    optimizeContactForStorage(contact) { return contact; }
    handleShareDatabaseError() {}
    handleDeleteItemError() {}

    async openDatabase(databaseName, changeHandler) {
        this.calls.push(['openDatabase', databaseName]);
        if (!this.databases.has(databaseName)) {
            this.databases.set(databaseName, []);
        }
        changeHandler(this.databases.get(databaseName));
    }

    async safeInsertItem({ databaseName, item, itemId }) {
        this.calls.push(['safeInsertItem', databaseName, itemId]);
        this.databases.get(databaseName).push({ ...item, itemId });
    }

    async safeUpdateItem({ databaseName, item, itemId }) {
        this.calls.push(['safeUpdateItem', databaseName, itemId]);
        const items = this.databases.get(databaseName);
        const idx = items.findIndex(i => i.itemId === itemId);
        items[idx] = { ...item, itemId };
    }

    async safeDeleteItem({ databaseName, itemId }) {
        this.calls.push(['safeDeleteItem', databaseName, itemId]);
        const items = this.databases.get(databaseName) || [];
        const idx = items.findIndex(i => i.itemId === itemId);
        if (idx === -1) {
            const err = new Error('Item does not exist');
            err.name = 'ItemDoesNotExist';
            throw err;
        }
        items.splice(idx, 1);
    }

    async safeShareDatabase(params) {
        this.calls.push(['safeShareDatabase', params.databaseName, params.username, params.readOnly, params.resharingAllowed]);
    }

    async safeModifyDatabasePermissions(params) {
        this.calls.push([
            'safeModifyDatabasePermissions',
            params.databaseName,
            params.username,
            params.readOnly,
            params.revoke
        ]);
        if (this.failPermissionWith) {
            const err = new Error(this.failPermissionWith);
            err.name = this.failPermissionWith;
            throw err;
        }
    }
}

const ownerContact = () => ({
    contactId: 'contact_abc123',
    itemId: 'contact_abc123',
    cardName: 'Alice Example',
    vcard: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:contact_abc123\r\nFN:Alice Example\r\nN:Example;Alice;;;\r\nCATEGORIES:SHARED:bob,carol\r\nEND:VCARD',
    metadata: {
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-02T00:00:00.000Z',
        isOwned: true,
        isImported: false,
        isArchived: false,
        isDeleted: false,
        distributionLists: ['work'],
        sharing: {
            isShared: true,
            shareCount: 2,
            sharedWithUsers: ['bob', 'carol'],
            sharePermissions: { bob: { level: 'readOnly' }, carol: { level: 'readOnly' } },
            shareHistory: [{ action: 'shared', targetUser: 'bob' }]
        },
        usage: { accessCount: 12, interactionHistory: [{ action: 'viewed' }] },
        carddav: { etag: '"etag-1"', href: '/x.vcf', source: 'iCloud' },
        ui: { isExpanded: true }
    }
});

describe('IndividualSharingStrategy — recipient projection (SH-02)', () => {
    let db, strategy;
    beforeEach(() => {
        db = new FakeDatabase();
        strategy = new IndividualSharingStrategy(db);
    });

    it('buildRecipientContact strips owner-only metadata and the CATEGORIES:SHARED line', () => {
        const copy = strategy.buildRecipientContact(ownerContact(), 'bob');

        expect(copy.contactId).toBe('contact_abc123');
        expect(copy.cardName).toBe('Alice Example');
        expect(copy.vcard).not.toMatch(/CATEGORIES:SHARED/);
        expect(copy.vcard).toMatch(/FN:Alice Example/);

        expect(copy.metadata.sharing).toBeUndefined();
        expect(copy.metadata.usage).toBeUndefined();
        expect(copy.metadata.carddav).toBeUndefined();
        expect(copy.metadata.ui).toBeUndefined();
        expect(copy.metadata.distributionLists).toBeUndefined();

        expect(copy.metadata.sharedWith).toBe('bob');
        expect(copy.metadata.sharingType).toBe('individual');
        expect(copy.metadata.createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(copy.metadata.isDeleted).toBe(false);
    });

    it('shareContactIndividually stores only the recipient projection', async () => {
        const result = await strategy.shareContactIndividually(ownerContact(), 'bob');

        expect(result.success).toBe(true);
        expect(result.sharedDbName).toBe('shared-contact-abc123-to-bob');

        const stored = db.databases.get('shared-contact-abc123-to-bob')[0];
        expect(JSON.stringify(stored)).not.toMatch(/carol/);
        expect(stored.metadata.sharing).toBeUndefined();
        expect(stored.metadata.sharedBy).toBe('owner');
        expect(stored.metadata.originalContactId).toBe('contact_abc123');

        const share = db.calls.find(c => c[0] === 'safeShareDatabase');
        expect(share).toEqual(['safeShareDatabase', 'shared-contact-abc123-to-bob', 'bob', true, false]);
    });

    it('updateContactAcrossSharedDatabases propagates the projection, not the owner copy', async () => {
        await strategy.shareContactIndividually(ownerContact(), 'bob');
        strategy.getContactSharedDatabases = async () => ['shared-contact-abc123-to-bob'];

        const edited = ownerContact();
        edited.cardName = 'Alice Edited';
        edited.metadata.sharing.sharedWithUsers.push('dave');

        const result = await strategy.updateContactAcrossSharedDatabases(edited);
        expect(result.success).toBe(true);

        const stored = db.databases.get('shared-contact-abc123-to-bob')[0];
        expect(stored.cardName).toBe('Alice Edited');
        expect(JSON.stringify(stored)).not.toMatch(/dave|carol/);
        expect(stored.metadata.sharedWith).toBe('bob');
    });
});

describe('IndividualSharingStrategy — revocation (SH-01)', () => {
    let db, strategy;
    beforeEach(async () => {
        db = new FakeDatabase();
        strategy = new IndividualSharingStrategy(db);
        await strategy.shareContactIndividually(ownerContact(), 'bob');
        db.calls = [];
    });

    it('deletes the recipient copy AND revokes the database permission', async () => {
        const result = await strategy.revokeIndividualAccess('contact_abc123', 'bob');

        expect(result.success).toBe(true);
        expect(result.itemDeleted).toBe(true);
        expect(result.permissionRevoked).toBe(true);
        expect(db.databases.get('shared-contact-abc123-to-bob')).toHaveLength(0);
        expect(db.calls).toContainEqual(['safeDeleteItem', 'shared-contact-abc123-to-bob', 'contact_abc123']);
        expect(db.calls).toContainEqual(['safeModifyDatabasePermissions', 'shared-contact-abc123-to-bob', 'bob', undefined, true]);
    });

    it('is idempotent: a second revoke still revokes permission and succeeds', async () => {
        await strategy.revokeIndividualAccess('contact_abc123', 'bob');
        db.calls = [];

        const result = await strategy.revokeIndividualAccess('contact_abc123', 'bob');

        expect(result.success).toBe(true);
        expect(result.itemDeleted).toBe(false);
        expect(db.calls.some(c => c[0] === 'safeDeleteItem')).toBe(false);
        expect(db.calls).toContainEqual(['safeModifyDatabasePermissions', 'shared-contact-abc123-to-bob', 'bob', undefined, true]);
    });

    it('validates revocation without readOnly and still requires it for permission changes', () => {
        const validate = ContactDatabase.prototype.validateModifyDatabasePermissionsParams;

        expect(validate({
            databaseName: 'shared-contact-abc123-to-bob',
            username: 'bob',
            revoke: true
        }).isValid).toBe(true);
        expect(validate({
            databaseName: 'shared-contact-abc123-to-bob',
            username: 'bob',
            revoke: true,
            readOnly: true
        }).errors[0]).toMatch(/readOnly must be omitted/);
        expect(validate({
            databaseName: 'shared-contact-abc123-to-bob',
            username: 'bob'
        }).errors[0]).toMatch(/readOnly is required/);
    });

    it('treats "recipient no longer has access" as already revoked', async () => {
        db.failPermissionWith = 'UserNotFound';
        const result = await strategy.revokeIndividualAccess('contact_abc123', 'bob');
        expect(result.success).toBe(true);
        expect(result.permissionRevoked).toBe(true);
    });

    it('reports failure when permission revocation fails for another reason', async () => {
        db.failPermissionWith = 'ServiceUnavailable';
        const result = await strategy.revokeIndividualAccess('contact_abc123', 'bob');
        expect(result.success).toBe(false);
        expect(result.itemDeleted).toBe(true);
        expect(result.permissionRevoked).toBe(false);
        expect(result.error).toMatch(/permission/);
    });
});
