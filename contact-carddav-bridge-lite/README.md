# Simple CardDAV Bridge - Lite

Lightweight CardDAV synchronization library inspired by [immich-carddav-bridge](https://github.com/flokuep/immich-carddav-bridge).

## Philosophy

- ✅ **Simple**: ~200 lines of code (vs 6,000+ in old bridge)
- ✅ **Direct**: No HTTP server, no REST API, just function calls
- ✅ **Effective**: Does what's needed without over-engineering
- ✅ **Maintainable**: Easy to understand entire codebase

## Features

- Connect to CardDAV servers (Baikal, Nextcloud, iCloud)
- Fetch contacts from addressbook
- Push contacts (create or update)
- Delete contacts
- Two-way sync
- Discover addressbooks

## Installation

```bash
npm install
```

## Usage

### Basic Example

```javascript
const SimpleCardDAVBridge = require('./index.js');

const bridge = new SimpleCardDAVBridge({
    serverUrl: 'https://baikal.example.com/dav.php/',
    username: 'myuser',
    password: 'mypassword'
});

// Connect
await bridge.connect();

// Fetch contacts
const result = await bridge.fetchContacts(
    'https://baikal.example.com/dav.php/addressbooks/myuser/contacts/'
);
console.log(`Fetched ${result.contacts.length} contacts`);

// Push contact
await bridge.pushContact(addressbookUrl, vcardString, uid);

// Two-way sync
const syncResult = await bridge.sync(addressbookUrl, localContacts);

// Disconnect
bridge.disconnect();
```

### Integration with Contact Manager

```javascript
// In src/integrations/BaikalConnector.js

const SimpleCardDAVBridge = require('../../contact-carddav-bridge-lite');

class BaikalConnector {
    async connect(profile) {
        this.bridge = new SimpleCardDAVBridge({
            serverUrl: profile.serverUrl,
            username: profile.username,
            password: profile.password
        });
        
        return await this.bridge.connect();
    }
    
    async pushContactToBaikal(contact, profileName) {
        const profile = this.profiles.get(profileName);
        return await this.bridge.pushContact(
            profile.addressbookUrl,
            contact.vcard,
            contact.uid
        );
    }
}
```

## API Reference

### `new SimpleCardDAVBridge(config)`

Create new bridge instance.

**Parameters:**
- `config.serverUrl` - CardDAV server URL
- `config.username` - Username
- `config.password` - Password

### `connect(credentials?)`

Connect to CardDAV server.

**Returns:** `{ success: boolean, error?: string }`

### `fetchContacts(addressbookUrl)`

Fetch all contacts from addressbook.

**Returns:** `{ success: boolean, contacts?: Array, error?: string }`

### `pushContact(addressbookUrl, vcard, uid)`

Create or update contact.

**Returns:** `{ success: boolean, action: 'created'|'updated', uid: string, error?: string }`

### `deleteContact(vcardUrl)`

Delete contact from server.

**Returns:** `{ success: boolean, error?: string }`

### `sync(addressbookUrl, localContacts)`

Two-way sync (fetch + push).

**Parameters:**
- `addressbookUrl` - Addressbook URL
- `localContacts` - Array of `{uid, vcard}` objects

**Returns:** 
```javascript
{
    success: boolean,
    serverContacts: Array,
    pushedCount: number,
    failedCount: number,
    results: Array
}
```

### `discoverAddressbooks()`

Discover all addressbooks for user.

**Returns:** `{ success: boolean, addressbooks?: Array, error?: string }`

## Testing

Update credentials in `test.js`:

```javascript
const config = {
    serverUrl: 'https://your-baikal.com/dav.php/',
    username: 'your-username',
    password: 'your-password',
    addressbookUrl: 'https://your-baikal.com/dav.php/addressbooks/your-username/contacts/'
};
```

Run tests:

```bash
npm test
```

## Comparison to Old Bridge

| Aspect | Old Bridge | Simple Bridge | Reduction |
|--------|-----------|---------------|-----------|
| **Lines of Code** | ~6,000+ | ~200 | **97%** ↓ |
| **Files** | 20+ | 1 | **95%** ↓ |
| **Dependencies** | Express, CORS, cron, etc. | tsdav only | **80%** ↓ |
| **HTTP Server** | Yes | No | ✅ |
| **Complexity** | High | Low | ✅ |
| **Maintainability** | Difficult | Easy | ✅ |

## Why This Approach?

**Lessons learned from over-engineering:**

1. **Hash Optimization** (282 lines) - Caused more bugs than it solved
2. **StructuredLogger** (266 lines) - console.log works fine
3. **HealthCheckManager** (298 lines) - Unnecessary for local library
4. **BatchSyncManager** (314 lines) - No performance gain for 5-20 contacts
5. **HTTP Server** (1,485 lines) - Function calls are simpler

**KISS Principle: Keep It Simple, Stupid**

## License

MIT
