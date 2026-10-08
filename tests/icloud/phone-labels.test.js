/**
 * iCloud Sync — phone/email label normalization tests
 *
 * Regression tests for the bug where editing a contact on icloud.com and
 * syncing left the app with blank/other field types.
 *
 * iCloud's web address book writes labeled values as Apple item groups:
 *   item1.TEL;TYPE=pref:123-456 78
 *   item1.X-ABLABEL:PHONE
 * The label lives in X-ABLABEL, not in the TEL TYPE parameter. The parser
 * stripped the "item1." prefix but never associated X-ABLABEL with its
 * grouped TEL, so every iCloud-edited phone fell back to "other" (and the
 * edit form's type <select> rendered blank because it had no "other"
 * option).
 *
 * The first fixture below is copied verbatim from a real captured iCloud
 * response (tests/loggs/log2.txt).
 */
import { describe, it, expect } from '@jest/globals';
import { VCard3Processor } from '../../src/core/VCard3Processor.js';

const parsePhones = (vcard) => {
    const processor = new VCard3Processor();
    const parsed = processor.parseVCard3(vcard);
    return processor.convertToDisplayData(parsed).phones;
};

const parseEmails = (vcard) => {
    const processor = new VCard3Processor();
    const parsed = processor.parseVCard3(vcard);
    return processor.convertToDisplayData(parsed).emails;
};

// Verbatim from a real iCloud CardDAV response (log2.txt)
const ICLOUD_EDITED_CARD = `BEGIN:VCARD
VERSION:3.0
UID:1791454298082-dz5nqzret
N:;abraham;;;
FN:abraham
item1.TEL;TYPE=pref:123-456 78
item1.X-ABLABEL:PHONE
item2.TEL:987653421122
item2.X-ABLABEL:PHONE
PRODID:-//Apple Inc.//iCloud Web Address Book 2638B30//EN
REV:2026-10-08T11:44:03Z
END:VCARD`;

const ICLOUD_STANDARD_LABELS_CARD = `BEGIN:VCARD
VERSION:3.0
N:Doe;Jane;;;
FN:Jane Doe
item1.TEL;TYPE=pref:+46701234567
item1.X-ABLABEL:mobile
item2.TEL:+468123456
item2.X-ABLABEL:home
item3.TEL:+468654321
item3.X-ABLABEL:work
item4.TEL:+468999999
item4.X-ABLABEL:work fax
END:VCARD`;

const MAC_ADDRESSBOOK_CARD = `BEGIN:VCARD
VERSION:3.0
N:Doe;John;;;
FN:John Doe
item1.TEL;TYPE=CELL;TYPE=VOICE:+46701112233
item1.X-ABLABEL:_$!<Mobile>!$_
item2.EMAIL;TYPE=INTERNET:john@example.com
item2.X-ABLABEL:_$!<Home>!$_
END:VCARD`;

const ICLOUD_CUSTOM_LABEL_CARD = `BEGIN:VCARD
VERSION:3.0
N:Smith;Ann;;;
FN:Ann Smith
item1.TEL:+46704445566
item1.X-ABLABEL:Assistant
END:VCARD`;

const ICLOUD_TYPE_PARAM_CARD = `BEGIN:VCARD
VERSION:3.0
N:Ericsson;Erik;;;
FN:Erik Ericsson
TEL;type=CELL,VOICE:+46701234567
TEL;type=HOME,VOICE:+468123456
TEL;type=WORK,VOICE:+468654321
TEL;type=IPHONE:+4670999888
TEL;type=HOME,VOICE,FAX:+468555000
END:VCARD`;

describe('VCard3Processor — iCloud X-ABLABEL label parsing (regression)', () => {

    it('recovers the label from a real captured iCloud card instead of "other"', () => {
        const phones = parsePhones(ICLOUD_EDITED_CARD);

        expect(phones).toHaveLength(2);
        expect(phones[0]).toMatchObject({ value: '123-456 78', type: 'voice', primary: true });
        expect(phones[1]).toMatchObject({ value: '987653421122', type: 'voice' });
        expect(phones[1].primary).toBeFalsy();
    });

    it('maps standard iCloud labels mobile/home/work to cell/home/work', () => {
        const phones = parsePhones(ICLOUD_STANDARD_LABELS_CARD);

        expect(phones.map(p => p.type)).toEqual(['cell', 'home', 'work', 'fax']);
        expect(phones[0].primary).toBe(true);
    });

    it('handles Mac Address Book "_$!<Mobile>!$_" wrapped labels for phones and emails', () => {
        const phones = parsePhones(MAC_ADDRESSBOOK_CARD);
        const emails = parseEmails(MAC_ADDRESSBOOK_CARD);

        expect(phones[0].type).toBe('cell');
        expect(emails[0].type).toBe('home');
    });

    it('preserves a custom iCloud label for display', () => {
        const phones = parsePhones(ICLOUD_CUSTOM_LABEL_CARD);

        expect(phones[0]).toMatchObject({ value: '+46704445566', type: 'Assistant' });
    });

    it('still parses TYPE parameters when no item groups are present', () => {
        const phones = parsePhones(ICLOUD_TYPE_PARAM_CARD);

        expect(phones.map(p => p.type)).toEqual(['cell', 'home', 'work', 'cell', 'fax']);
    });

    it('treats "HOME,VOICE,FAX" as a fax, not a home phone', () => {
        const phones = parsePhones(ICLOUD_TYPE_PARAM_CARD);

        expect(phones[4].type).toBe('fax');
    });

    it('does not leak the X-ABLABEL group into the phones list twice', () => {
        const phones = parsePhones(ICLOUD_EDITED_CARD);

        // Only the two itemN.TEL values, no phantom entries from X-ABLABEL lines
        expect(phones.filter(p => !p.value)).toHaveLength(0);
    });
});

describe('VCard3Processor — X-ABLABEL does not break export round-trip', () => {

    it('regenerates a valid vCard with standard types from parsed iCloud data', () => {
        const processor = new VCard3Processor();
        const parsed = processor.parseVCard3(ICLOUD_STANDARD_LABELS_CARD);
        const displayData = processor.convertToDisplayData(parsed);

        const regenerated = processor.generateVCard3(displayData);

        // Apple-style separate TYPE parameters (label, capability, pref)
        expect(regenerated).toMatch(/^TEL;type=CELL(:|;type=pref)/m);
        expect(regenerated).toMatch(/^TEL;type=HOME;type=VOICE/m);
        expect(regenerated).toMatch(/^TEL;type=WORK;type=VOICE/m);
        expect(regenerated).toMatch(/^TEL;type=FAX/m);
        expect(regenerated).not.toMatch(/X-ABLABEL/i);
        // No comma-separated TYPE values — iCloud does not map them to labels
        expect(regenerated).not.toMatch(/;type=[A-Z]+,[A-Z]+/i);
    });
});

describe('VCard3Processor — push format keeps labels visible on iCloud', () => {

    it('generates Apple-style separate TYPE parameters for every field type', () => {
        const processor = new VCard3Processor();
        const vcard = processor.generateVCard3({
            fullName: 'Jane Doe',
            phones: [
                { value: '+46701234567', type: 'home', primary: false },
                { value: '+468123456', type: 'work', primary: true },
                { value: '+4670999999', type: 'cell', primary: false },
                { value: '+468555000', type: 'fax', primary: false }
            ],
            emails: [{ value: 'jane@example.com', type: 'work', primary: false }],
            urls: [{ value: 'https://example.com', type: 'work', primary: false }],
            addresses: [{ street: '1 Main St', city: 'Town', type: 'home', primary: false }]
        });

        expect(vcard).toContain('TEL;type=HOME;type=VOICE:+46701234567');
        expect(vcard).toContain('TEL;type=WORK;type=VOICE;type=pref:+468123456');
        expect(vcard).toContain('TEL;type=CELL:+4670999999');
        expect(vcard).toContain('TEL;type=FAX:+468555000');
        expect(vcard).toContain('EMAIL;type=WORK;type=INTERNET:jane@example.com');
        expect(vcard).toContain('URL;type=WORK:https://example.com');
        expect(vcard).toMatch(/^ADR;type=HOME:/m);
    });
});

describe('ICloudCardDAVClient — TYPE parameter normalization on push', () => {

    const normalize = (vcard) => {
        const { ICloudCardDAVClient } = require('../../src/integrations/ICloudCardDAVClient.js');
        const client = new ICloudCardDAVClient('user@icloud.com', 'app-password');
        return client.normalizeTypeParameters(client.normalizeVCardLineEndings(vcard));
    };

    it('splits comma-separated TYPE values into separate parameters', () => {
        const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nN:;Jane;;;\r\n' +
            'TEL;TYPE=work,voice:+46701234567\r\n' +
            'EMAIL;TYPE=WORK,pref,INTERNET:jane@example.com\r\n' +
            'ADR;TYPE=work,postal,parcel:;;1 Main St;Town;;12345;Country\r\n' +
            'END:VCARD';

        const normalized = normalize(vcard);

        expect(normalized).toContain('TEL;type=work;type=voice:+46701234567');
        expect(normalized).toContain('EMAIL;type=WORK;type=pref;type=INTERNET:jane@example.com');
        expect(normalized).toContain('ADR;type=work;type=postal;type=parcel:;;1 Main St;Town;;12345;Country');
    });

    it('leaves Apple-style and single-value TYPE parameters untouched', () => {
        const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nN:;Jane;;;\r\n' +
            'TEL;type=HOME;type=VOICE;type=pref:+46701234567\r\n' +
            'TEL;TYPE=CELL:+4670999999\r\n' +
            'item1.TEL:+4670333444\r\n' +
            'item1.X-ABLABEL:PHONE\r\n' +
            'NOTE:Type=work,voice in the value must not change\r\n' +
            'END:VCARD';

        expect(normalize(vcard)).toEqual(vcard);
    });

    it('normalizes comma TYPE inside Apple item groups', () => {
        const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nN:;Jane;;;\r\n' +
            'item1.TEL;TYPE=CELL,VOICE:+46701234567\r\n' +
            'item1.X-ABLABEL:mobile\r\n' +
            'END:VCARD';

        const normalized = normalize(vcard);

        expect(normalized).toContain('item1.TEL;type=CELL;type=VOICE:+46701234567');
        expect(normalized).toContain('item1.X-ABLABEL:mobile');
    });
});
