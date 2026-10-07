/**
 * iCloud Sync — Email and phone field sync tests
 *
 * Regression tests for the bug where email values were undefined when pushed,
 * producing malformed vCard lines like:
 *   EMAIL;TYPE=WORK:           ← no value!
 *
 * We test the vCard generation layer (VCard3Processor / VCardStandard) since
 * it's responsible for the correctness of what gets sent to iCloud.
 *
 * We also do an end-to-end push assertion to confirm EMAIL lines are present.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { buildTestService, buildContact } from './setup.js';
import {
    FETCH_EMPTY,
    CREATE_SUCCESS,
    UPDATE_SUCCESS,
} from './fixtures/carddav-responses.js';
import { EMAIL_VCARD } from './fixtures/vcards.js';
import { VCardStandard } from '../../src/core/VCardStandard.js';
import { VCard3Processor } from '../../src/core/VCard3Processor.js';

beforeAll(() => {
    global.userbase = { deleteItem: async () => {} };
});

const DAVE_UID = 'uid-dave-email-003';

// ─── Unit tests: VCard3Processor defensive validation ─────────────────────────

describe('VCard3Processor — email field validation (regression)', () => {

    it('skips an email entry with an undefined value (no malformed line)', () => {
        const processor = new VCard3Processor();

        const displayData = {
            fullName: 'Test User',
            phones: [],
            emails: [
                { value: undefined, type: 'WORK', primary: true },  // ← broken entry
            ],
            urls: [],
            addresses: [],
        };

        // generateVCard should not produce "EMAIL;TYPE=WORK:" with empty value
        const vcard = processor.generateVCard3(displayData);

        // Must not contain an EMAIL line with an empty/undefined value
        const emailLines = (vcard.match(/^EMAIL[^\r\n]*/gm) || []);
        emailLines.forEach(line => {
            const value = line.split(':').slice(1).join(':');
            expect(value.trim()).not.toBe('');
            expect(value.trim()).not.toBe('undefined');
        });
    });

    it('generates a correct EMAIL line when the value is a real address', () => {
        const processor = new VCard3Processor();

        const displayData = {
            fullName: 'Dave WithEmail',
            phones: [],
            emails: [
                { value: 'dave@company.com', type: 'WORK', primary: true },
            ],
            urls: [],
            addresses: [],
        };

        const vcard = processor.generateVCard3(displayData);

        expect(vcard).toContain('EMAIL');
        expect(vcard).toContain('dave@company.com');

        // The line must have a non-empty value after the colon
        const emailLine = vcard.split('\n').find(l => l.startsWith('EMAIL'));
        expect(emailLine).toBeDefined();
        const value = emailLine.split(':').slice(1).join(':').trim();
        expect(value).toBe('dave@company.com');
    });

    it('skips a phone entry with an undefined value', () => {
        const processor = new VCard3Processor();

        const displayData = {
            fullName: 'Test User',
            phones: [
                { value: undefined, type: 'WORK', primary: true },  // ← broken
            ],
            emails: [],
            urls: [],
            addresses: [],
        };

        const vcard = processor.generateVCard3(displayData);

        const telLines = (vcard.match(/^TEL[^\r\n]*/gm) || []);
        telLines.forEach(line => {
            const value = line.split(':').slice(1).join(':');
            expect(value.trim()).not.toBe('');
        });
    });

});

// ─── Integration: email survives the full push pipeline ─────────────────────

describe('pushToICloud() — email fields are preserved in pushed vCard', () => {

    it('includes email lines in the vCard sent to iCloud', async () => {
        const dave = buildContact(DAVE_UID, EMAIL_VCARD, {
            cardName: 'Dave WithEmail',
            metadata: {
                isOwned: true,
                // no carddav → needs initial push via createContact
            },
        });

        const { service, mockClient } = await buildTestService(
            {
                fetchContacts: FETCH_EMPTY,
                createContact: CREATE_SUCCESS,
            },
            [dave],
        );

        await service.pushToICloud();

        expect(mockClient.createContact).toHaveBeenCalledTimes(1);

        const [pushedVCard] = mockClient.createContact.mock.calls[0];

        // The pushed vCard must contain an EMAIL line with a real address
        expect(pushedVCard).toContain('EMAIL');
        const emailLine = pushedVCard.split('\n').find(l => l.toUpperCase().startsWith('EMAIL'));
        expect(emailLine).toBeDefined();
        const emailValue = emailLine.split(':').slice(1).join(':').trim();
        expect(emailValue).toMatch(/@/);   // must look like an email address
        expect(emailValue).not.toBe('');
        expect(emailValue).not.toBe('undefined');
    });

});
