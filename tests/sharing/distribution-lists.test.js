import { describe, expect, it, jest } from '@jest/globals';
import { ContactManager } from '../../src/core/ContactManager.js';
import { EventBus } from '../../src/utils/EventBus.js';

class FakeDatabase {
    constructor() {
        this.currentUser = { username: 'owner' };
        this.settings = {
            distributionLists: {
                Work: { name: 'Work', usernames: ['alice'] }
            }
        };
        this.updateSettingsResult = true;
        this.updateCalls = 0;
        this.revokeIndividualContactAccess = jest.fn();
    }

    async getSettings() {
        return structuredClone(this.settings);
    }

    async updateSettings(settings) {
        this.updateCalls++;
        if (this.updateSettingsResult) {
            this.settings = structuredClone(settings);
        }
        return this.updateSettingsResult;
    }
}

function createManager(database = new FakeDatabase()) {
    return new ContactManager(new EventBus(), database, {}, {});
}

describe('ContactManager distribution lists', () => {
    it('adds a username without sharing existing contacts', async () => {
        const database = new FakeDatabase();
        const manager = createManager(database);
        manager.shareContact = jest.fn();

        const result = await manager.addUsernameToDistributionList('Work', '  bob  ');

        expect(result.success).toBe(true);
        expect(database.settings.distributionLists.Work.usernames).toEqual(['alice', 'bob']);
        expect(database.updateCalls).toBe(1);
        expect(manager.shareContact).not.toHaveBeenCalled();
    });

    it('rejects blank and duplicate usernames without writing settings', async () => {
        const database = new FakeDatabase();
        const manager = createManager(database);

        expect(await manager.addUsernameToDistributionList('Work', '  '))
            .toEqual({ success: false, error: 'Username is required' });
        expect(await manager.addUsernameToDistributionList('Work', 'alice'))
            .toEqual({ success: true, alreadyExists: true });
        expect(database.updateCalls).toBe(0);
    });

    it('removes a list member without revoking their existing individual share', async () => {
        const database = new FakeDatabase();
        const manager = createManager(database);
        manager.shareContact = jest.fn();

        const result = await manager.removeUsernameFromDistributionList('Work', ' alice ');

        expect(result.success).toBe(true);
        expect(database.settings.distributionLists.Work.usernames).toEqual([]);
        expect(database.updateCalls).toBe(1);
        expect(database.revokeIndividualContactAccess).not.toHaveBeenCalled();
        expect(manager.shareContact).not.toHaveBeenCalled();
    });

    it('expands the current membership into individual shares only when requested', async () => {
        const database = new FakeDatabase();
        database.settings.distributionLists.Work.usernames = ['alice', 'owner', 'bob'];
        const manager = createManager(database);
        manager.contacts.set('contact-1', { contactId: 'contact-1', cardName: 'Example' });
        manager.shareContact = jest.fn(async (_contactId, username) => ({
            success: true,
            wasAlreadyShared: username === 'bob'
        }));

        const result = await manager.shareContactWithDistributionList('contact-1', 'Work');

        expect(result.success).toBe(true);
        expect(result.successCount).toBe(1);
        expect(result.alreadySharedCount).toBe(1);
        expect(result.results.map(({ username }) => username)).toEqual(['alice', 'bob']);
        expect(manager.shareContact.mock.calls).toEqual([
            ['contact-1', 'alice'],
            ['contact-1', 'bob']
        ]);
    });

    it('reports a failed result when every member share fails', async () => {
        const database = new FakeDatabase();
        database.settings.distributionLists.Work.usernames = ['alice'];
        const manager = createManager(database);
        manager.contacts.set('contact-1', { contactId: 'contact-1', cardName: 'Example' });
        manager.shareContact = jest.fn(async () => ({
            success: false,
            error: 'UserNotFound'
        }));

        const result = await manager.shareContactWithDistributionList('contact-1', 'Work');

        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.errors).toEqual(['alice: UserNotFound']);
    });
});
