/**
 * ICloudCardDAVClient.fetchContacts() — snapshot completeness guard (IS-08)
 *
 * When the addressbook is empty, iCloud returns a multistatus document with
 * zero <d:response> entries. The guard must accept every legitimate empty
 * form (prefixed, self-closing, default-namespace) while still refusing
 * non-multistatus bodies (error pages, redirects, truncations) — treating
 * those as empty would delete every tracked contact locally.
 *
 * parseContactsFromXML needs DOMParser (browser-only), so a minimal stub is
 * installed that reports zero parsed contacts; the guard runs after parsing.
 */
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import { ICloudCardDAVClient } from '../../src/integrations/ICloudCardDAVClient.js';

beforeAll(() => {
    // Minimal DOMParser stub: any body "parses" to zero responses.
    global.DOMParser = class {
        parseFromString() {
            return { getElementsByTagNameNS: () => [] };
        }
    };
});

beforeEach(() => {
    global.fetch = jest.fn();
});

function stubFetch(body, ok = true, status = 200) {
    global.fetch.mockImplementation(async () => ({ ok, status, text: async () => body }));
}

function connectedClient() {
    const client = new ICloudCardDAVClient('user@icloud.com', 'app-password');
    client.isConnected = true;
    client.addressBookUrl = '/12345/card/';
    return client;
}

describe('fetchContacts() — empty-snapshot completeness guard', () => {

    it('accepts an empty addressbook: normal prefixed multistatus', async () => {
        stubFetch('<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:"></d:multistatus>');
        const contacts = await connectedClient().fetchContacts();
        expect(contacts).toEqual([]);
    });

    it('accepts an empty addressbook: self-closing multistatus (regression)', async () => {
        // iCloud's observed form for an empty addressbook — the original
        // guard regex missed the '/' after the tag name and treated this as
        // an unparseable body.
        stubFetch('<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:"/>');
        const contacts = await connectedClient().fetchContacts();
        expect(contacts).toEqual([]);
    });

    it('accepts an empty addressbook: default-namespace multistatus', async () => {
        stubFetch('<?xml version="1.0"?>\n<multistatus xmlns="DAV:"></multistatus>');
        const contacts = await connectedClient().fetchContacts();
        expect(contacts).toEqual([]);
    });

    it('refuses a non-multistatus body (error page)', async () => {
        stubFetch('<html><head><title>Error</title></head><body>Server error</body></html>');
        await expect(connectedClient().fetchContacts())
            .rejects.toThrow(/not a parseable multistatus/);
    });

    it('refuses an empty/truncated body', async () => {
        stubFetch('');
        await expect(connectedClient().fetchContacts())
            .rejects.toThrow(/not a parseable multistatus/);
    });

    it('throws on a failed REPORT regardless of body', async () => {
        stubFetch('<d:multistatus xmlns:d="DAV:"/>', false, 500);
        await expect(connectedClient().fetchContacts())
            .rejects.toThrow(/REPORT failed: 500/);
    });

});
