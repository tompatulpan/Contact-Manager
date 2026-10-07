/**
 * Dedup logic unit tests
 *
 * Covers the two bugs fixed in April 2026:
 *   1. Context-qualifier guard — "Maria Berg (work)" must never merge with "Maria Berg"
 *   2. Richness preference — incoming richer vCard should UPDATE existing rather than be blocked
 *
 * Uses the same setup pattern as tests/icloud/*.test.js
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { EventBus } from '../src/utils/EventBus.js';
import { VCardStandard } from '../src/core/VCardStandard.js';
import { ContactValidator } from '../src/core/ContactValidator.js';
import { ContactManager } from '../src/core/ContactManager.js';
import { MockDatabase } from '../src/utils/TestHelpers.js';

beforeAll(() => {
    // Some paths in ContactManager reference userbase
    global.userbase = { deleteItem: async () => {} };
});

/** Build a bare ContactManager wired to an in-memory MockDatabase */
async function buildCM(seedVCards = []) {
    const eventBus = new EventBus();
    const db = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator();
    await db.initialize();
    const cm = new ContactManager(eventBus, db, vCardStandard, validator);

    for (const vcardStr of seedVCards) {
        // Parse the vCard into a contact object
        const parsed = vCardStandard.importFromVCard(vcardStr);
        if (!parsed.success) throw new Error('Seed vCard parse failed: ' + parsed.error);
        const contact = parsed.contact;
        if (!contact.contactId) contact.contactId = vCardStandard.generateUID();
        // Inject directly into the Map (same pattern as iCloud test setup.js)
        // so findSimilarContacts() can see it without waiting for DB async events.
        cm.contacts.set(contact.contactId, contact);
        await db.saveContact(contact);
    }
    return cm;
}

// ─── vCard helpers ───────────────────────────────────────────────────────────

function vcardPersonal(name, phone, extra = '') {
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name}`,
        `N:${name.split(' ').reverse().join(';')};;;`,
        `TEL;type=MOBILE;pref:${phone}`,
        extra,
        'END:VCARD',
    ].filter(Boolean).join('\n');
}

function vcardWork(name, phone, org = 'Acme AB') {
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name} (work)`,
        `N:(work);${name};;;`,
        `TEL;type=WORK;pref:${phone}`,
        `ORG:${org}`,
        'END:VCARD',
    ].join('\n');
}

function vcardRich(name, phone) {
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name}`,
        `N:${name.split(' ').reverse().join(';')};;;`,
        `TEL;type=MOBILE;pref:${phone}`,
        `TEL;type=HOME:+4686999001`,
        `EMAIL;type=HOME;pref:${name.toLowerCase().replace(' ', '.')}@gmail.com`,
        `EMAIL;type=WORK:${name.toLowerCase().replace(' ', '.')}@work.se`,
        `ADR;type=HOME;pref:;;Testgatan 1;Stockholm;;111 22;Sverige`,
        `ORG:Testbolaget AB`,
        `TITLE:Testare`,
        'END:VCARD',
    ].join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('isDuplicateContact() — qualifier guard', () => {

    it('saves both "Maria Berg (work)" and "Maria Berg" when they share a phone', async () => {
        const phone = '+46709002001';
        const cm = await buildCM([vcardWork('Maria Berg', phone)]);

        const result = await cm.importContactFromVCard(vcardPersonal('Maria Berg', phone));

        // Personal card must be accepted (not blocked as duplicate)
        expect(result.success).toBe(true);
        expect(result.isDuplicate).toBeFalsy();

        // Work card must still be in the store (not evicted)
        const workCard = [...cm.contacts.values()].find(c => c.cardName?.includes('(work)'));
        expect(workCard).toBeDefined();
        // Personal card is confirmed saved by result.success + result.contact
        expect(result.contact?.cardName || result.contact?.vcard).toBeTruthy();
    });

    it('blocks a plain duplicate without qualifier (same name + same phone)', async () => {
        const phone = '+46709003001';
        const cm = await buildCM([vcardPersonal('Johan Lindqvist', phone)]);

        const result = await cm.importContactFromVCard(vcardPersonal('Johan Lindqvist', phone));

        expect(result.success).toBe(false);
        expect(result.isDuplicate).toBe(true);
    });

    it('saves two contacts with same first name but different last names', async () => {
        const cm = await buildCM([vcardPersonal('Johan Lindqvist', '+46709005001')]);

        const result = await cm.importContactFromVCard(
            vcardPersonal('Johan Lindström', '+46709005002')
        );

        expect(result.success).toBe(true);
        expect(result.isDuplicate).toBeFalsy();
    });

    it('saves both "(privat)" and plain variant when they share a phone', async () => {
        const phone = '+46709010001';
        const privatVCard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            'FN:Karl Persson (privat)',
            'N:(privat);Karl Persson;;;',
            `TEL;type=MOBILE;pref:${phone}`,
            'END:VCARD',
        ].join('\n');

        const cm = await buildCM([vcardPersonal('Karl Persson', phone)]);
        const result = await cm.importContactFromVCard(privatVCard);

        expect(result.success).toBe(true);
        expect(result.isDuplicate).toBeFalsy();
    });
});

describe('importContactFromVCard() — richness preference', () => {

    it('updates existing contact when incoming is 30%+ richer', async () => {
        const phone = '+46709004001';
        // Seed with simple card (only phone)
        const cm = await buildCM([vcardPersonal('Henrik Sund', phone)]);

        // Import much richer card with same phone
        const result = await cm.importContactFromVCard(vcardRich('Henrik Sund', phone));

        // Should succeed and mark as enriched
        expect(result.success).toBe(true);
        expect(result.enriched).toBe(true);

        // Only one Henrik Sund in store (update, not duplicate)
        const henriks = [...cm.contacts.values()].filter(c =>
            c.cardName?.toLowerCase().includes('henrik')
        );
        expect(henriks).toHaveLength(1);
    });

    it('blocks incoming when both contacts have equal richness', async () => {
        const phone = '+46709006001';
        const cm = await buildCM([vcardPersonal('Kerstin Test', phone,
            'EMAIL;type=HOME;pref:kerstin@test.se'
        )]);

        // Incoming has same richness (same phone + same email count)
        const result = await cm.importContactFromVCard(
            vcardPersonal('Kerstin Test', phone, 'EMAIL;type=HOME;pref:kerstin@annan.se')
        );

        expect(result.success).toBe(false);
        expect(result.isDuplicate).toBe(true);
    });
});

describe('contactRichnessScore()', () => {

    it('scores a contact with more fields higher', async () => {
        const cm = await buildCM();
        const simple = cm.vCardStandard.importFromVCard(
            vcardPersonal('Test Person', '+46701234567')
        ).contact;
        const rich = cm.vCardStandard.importFromVCard(
            vcardRich('Test Person', '+46701234567')
        ).contact;

        const simpleScore = cm.contactRichnessScore(simple);
        const richScore   = cm.contactRichnessScore(rich);

        expect(richScore).toBeGreaterThan(simpleScore * 1.3);
    });
});
