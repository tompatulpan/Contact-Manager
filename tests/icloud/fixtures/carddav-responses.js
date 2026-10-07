/**
 * Mock CardDAV HTTP responses used in iCloud sync tests.
 *
 * Each factory returns a value that the mocked ICloudCardDAVClient method resolves with.
 * Keep shape in sync with the real ICloudCardDAVClient return values.
 */
import {
    OWNED_VCARD,
    OWNED_VCARD_UPDATED,
    ICLOUD_ONLY_VCARD,
    SHARED_VCARD,
    EMAIL_VCARD,
    DELETED_VCARD,
    MALFORMED_VCARD,
} from './vcards.js';

// ─── connect() responses ───────────────────────────────────────────────

export const CONNECT_SUCCESS = {
    success: true,
    principalUrl: 'https://contacts.icloud.com/123456789/principal/',
    addressBookUrl: 'https://contacts.icloud.com/123456789/carddavhome/card/',
};

export const CONNECT_FAILURE = {
    success: false,
    error: 'Authentication failed (401)',
};

// ─── fetchContacts() responses (arrays of contact descriptors) ─────────

/** Empty address book on iCloud. */
export const FETCH_EMPTY = [];

/** iCloud has one owned contact that matches the local one (same ETag → no update needed). */
export const FETCH_OWNED_IN_SYNC = [
    {
        uid: 'uid-alice-owned-001',
        etag: '"etag-alice-v1"',
        href: '/123456789/carddavhome/card/uid-alice-owned-001.vcf',
        fullName: 'Alice Owned',
        vcard: OWNED_VCARD,
        phones: ['+46701234567'],
    },
];

/** iCloud has an updated version of the owned contact (different ETag → pull needed). */
export const FETCH_OWNED_UPDATED_REMOTELY = [
    {
        uid: 'uid-alice-owned-001',
        etag: '"etag-alice-v2"',      // ← differs from local etag-alice-v1
        href: '/123456789/carddavhome/card/uid-alice-owned-001.vcf',
        fullName: 'Alice Owned',
        vcard: OWNED_VCARD_UPDATED,
        phones: ['+46701234567', '+46709999999'],
    },
];

/** iCloud has a contact that does NOT exist locally → should be pulled in. */
export const FETCH_NEW_REMOTE_CONTACT = [
    {
        uid: 'uid-carol-remote-002',
        etag: '"etag-carol-v1"',
        href: '/123456789/carddavhome/card/uid-carol-remote-002.vcf',
        fullName: 'Carol Remote',
        vcard: ICLOUD_ONLY_VCARD,
        phones: ['+46731111111'],
    },
];

/** iCloud returns a mix: one in-sync + one new remote contact. */
export const FETCH_MIXED = [
    ...FETCH_OWNED_IN_SYNC,
    ...FETCH_NEW_REMOTE_CONTACT,
];

/** iCloud has a contact with email. */
export const FETCH_WITH_EMAIL = [
    {
        uid: 'uid-dave-email-003',
        etag: '"etag-dave-v1"',
        href: '/123456789/carddavhome/card/uid-dave-email-003.vcf',
        fullName: 'Dave WithEmail',
        vcard: EMAIL_VCARD,
        phones: ['+46701112222'],
    },
];

/** iCloud has a malformed contact. */
export const FETCH_MALFORMED = [
    {
        uid: 'uid-malformed-000',
        etag: '"etag-bad-v1"',
        href: '/123456789/carddavhome/card/uid-malformed-000.vcf',
        fullName: '',
        vcard: MALFORMED_VCARD,
        phones: [],
    },
];

/** iCloud has the shared contact. */
export const FETCH_SHARED = [
    {
        uid: 'uid-bob-shared-001',
        etag: '"etag-bob-v1"',
        href: '/123456789/carddavhome/card/uid-bob-shared-001.vcf',
        fullName: 'Bob Shared',
        vcard: SHARED_VCARD,
        phones: ['+46707654321'],
    },
];

// ─── updateContact() responses ─────────────────────────────────────────

export const UPDATE_SUCCESS = {
    success: true,
    etag: '"etag-alice-v3"',
    href: '/123456789/carddavhome/card/uid-alice-owned-001.vcf',
    status: 204,
};

export const UPDATE_412_STALE_ETAG = {
    success: false,
    error: '412 Precondition Failed',
    status: 412,
};

export const UPDATE_SUCCESS_AFTER_REFRESH = {
    success: true,
    etag: '"etag-alice-v4"',
    href: '/123456789/carddavhome/card/uid-alice-owned-001.vcf',
    status: 204,
};

// ─── createContact() responses ─────────────────────────────────────────

export const CREATE_SUCCESS = {
    success: true,
    uid: 'uid-carol-remote-002',
    etag: '"etag-carol-created-v1"',
    href: '/123456789/carddavhome/card/uid-carol-remote-002.vcf',
    status: 201,
};

// ─── deleteContact() responses ────────────────────────────────────────

export const DELETE_SUCCESS = {
    success: true,
    status: 204,
};

export const DELETE_FAILURE_404 = {
    success: false,
    error: '404 Not Found',
    status: 404,
};

// ─── getContactByUID() responses ─────────────────────────────────────

export const GET_CONTACT_SUCCESS = {
    success: true,
    etag: '"etag-alice-v2"',     // ← the fresh server ETag
    vcard: OWNED_VCARD_UPDATED,
    href: '/123456789/carddavhome/card/uid-alice-owned-001.vcf',
};

export const GET_CONTACT_NOT_FOUND = {
    success: false,
    error: '404 Not Found',
    status: 404,
};
