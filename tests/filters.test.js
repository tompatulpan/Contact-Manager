/**
 * Sidebar filter combination tests
 *
 * My Contacts / Shared with Me / Imported Contacts are treated as three
 * disjoint buckets. "My + Shared" must therefore exclude imported contacts,
 * matching what each filter shows on its own (regression: the combination
 * previously dropped the ownership filter entirely and showed everything).
 */
import { describe, it, expect } from '@jest/globals';
import { ContactManager } from '../src/core/ContactManager.js';

function buildCM() {
    const eventBus = { on: () => {}, emit: () => {} };
    return new ContactManager(eventBus, null, null, null);
}

const seed = [
    { contactId: 'created-1', metadata: { isOwned: true, isImported: false } },
    { contactId: 'created-2', metadata: { isOwned: true } },
    { contactId: 'imported-1', metadata: { isOwned: true, isImported: true } },
    { contactId: 'shared-1', metadata: { isOwned: false } }
];

const ids = (cm, filters) =>
    cm.applyFilters(seed, filters).map(c => c.contactId).sort();

describe('ContactManager.applyFilters — sidebar checkbox combinations', () => {
    const cm = buildCM();

    it('no filter (All Contacts) shows everything active, including imported', () => {
        expect(ids(cm, {})).toEqual(['created-1', 'created-2', 'imported-1', 'shared-1']);
    });

    it('My Contacts only shows user-created contacts, excluding imported', () => {
        expect(ids(cm, { ownership: 'owned' })).toEqual(['created-1', 'created-2']);
    });

    it('Shared with Me only shows contacts from other users', () => {
        expect(ids(cm, { ownership: 'shared' })).toEqual(['shared-1']);
    });

    it('Imported Contacts only shows imported contacts', () => {
        expect(ids(cm, { importedOnly: true })).toEqual(['imported-1']);
    });

    it('My + Shared (excludeImported) shows both groups but not imported', () => {
        expect(ids(cm, { excludeImported: true })).toEqual(['created-1', 'created-2', 'shared-1']);
    });

    it('My + Imported shows user-created contacts plus all imported', () => {
        expect(ids(cm, { ownership: 'owned', includeImported: true }))
            .toEqual(['created-1', 'created-2', 'imported-1']);
    });

    it('Shared + Imported shows shared contacts plus all imported', () => {
        expect(ids(cm, { ownership: 'shared', includeImported: true }))
            .toEqual(['imported-1', 'shared-1']);
    });
});
