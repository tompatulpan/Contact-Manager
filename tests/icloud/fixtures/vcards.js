/**
 * Sample vCard strings used across iCloud sync tests.
 * All UIDs are stable strings so tests can assert on them.
 */

export const OWNED_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Alice Owned
N:Owned;Alice;;;
UID:uid-alice-owned-001
TEL;TYPE=WORK;PREF=1:+46701234567
EMAIL;TYPE=WORK;PREF=1:alice@example.com
REV:2025-11-01T10:00:00Z
END:VCARD`;

// vCard with no UID — models the IS-16 bug: a file import whose cards lack
// a UID cannot be matched by CardDAV sync and churned create/re-import/delete.
export const UIDLESS_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Ulf UID-less
N:UID-less;Ulf;;;
TEL;TYPE=WORK;PREF=1:+46701111111
EMAIL;TYPE=WORK;PREF=1:ulf@example.com
REV:2025-11-01T10:00:00Z
END:VCARD`;

export const OWNED_VCARD_UPDATED = `BEGIN:VCARD
VERSION:3.0
FN:Alice Owned
N:Owned;Alice;;;
UID:uid-alice-owned-001
TEL;TYPE=WORK;PREF=1:+46701234567
TEL;TYPE=CELL:+46709999999
EMAIL;TYPE=WORK;PREF=1:alice.updated@example.com
REV:2025-11-02T12:00:00Z
END:VCARD`;

export const SHARED_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Bob Shared
N:Shared;Bob;;;
UID:uid-bob-shared-001
TEL;TYPE=CELL;PREF=1:+46707654321
EMAIL;TYPE=HOME;PREF=1:bob@personal.com
REV:2025-11-01T10:00:00Z
END:VCARD`;

/** Contact that exists only on iCloud — will be pulled in. */
export const ICLOUD_ONLY_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Carol Remote
N:Remote;Carol;;;
UID:uid-carol-remote-002
TEL;TYPE=WORK:+46731111111
EMAIL;TYPE=WORK:carol@remote.com
REV:2025-11-01T10:00:00Z
END:VCARD`;

/** Contact with deliberately malformed/missing properties — for resilience tests. */
export const MALFORMED_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:
UID:uid-malformed-000
END:VCARD`;

/** Contact where email value is a real address (regression test for missing email bug). */
export const EMAIL_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Dave WithEmail
N:WithEmail;Dave;;;
UID:uid-dave-email-003
TEL;TYPE=WORK;PREF=1:+46701112222
EMAIL;TYPE=WORK;PREF=1:dave@company.com
EMAIL;TYPE=HOME:dave@home.se
REV:2025-11-01T10:00:00Z
END:VCARD`;

/** Contact that has been soft-deleted locally. */
export const DELETED_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Eve Deleted
N:Deleted;Eve;;;
UID:uid-eve-deleted-004
TEL;TYPE=WORK;PREF=1:+46702223333
REV:2025-11-01T10:00:00Z
END:VCARD`;
