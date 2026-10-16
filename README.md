# Contact Management System

**Status:** 🚧 In development!  
This project is not production-ready. Features, structure, and documentation are subject to rapid change.

## Background

I started this project because I was frustrated with how messy and inaccurate my contact lists had become. I couldn’t find a simple, secure way to share **MY OWN** contact info and keep it up to date. So I built a tool that makes exchanging these details safe, automatic, and effortless.

## Overview

- Your contacts are broken 🤯
- You have 200 contacts. When you change your number, 200 people then might have the wrong one.
- What if YOUR contact card updated itself in everyone's phone?
- That's what we built ✨
- Never text the wrong number again.
- Try  → [it here](https://e2econtacts.org)

A secure, modular contact management system with:
- End-to-end encrypted storage on [Userbase](https://github.com/smallbets/userbase)
- Real-time sharing and sync
- vCard 3.0 (RFC 2426) for storage, export and iCloud sync (imports vCard 3.0 and 4.0)
- Distribution lists for group sharing
- Cross-device support (web application)

## Key Features

- Create, edit, and organize contacts
- Share contacts with users or groups (distribution lists)
- Archive, delete, and manage received/shared contacts
- Import contacts (vCard 3.0/4.0), export as vCard 3.0
- QR code generation - Scan to easely import contacts
- Real-time updates and cross-device sync
- **iCloud Sync** - Bidirectional CardDAV sync with Apple iCloud via a Cloudflare proxy Worker

## Project Structure

```
src/                # Core business logic and UI components
lib/                # Third-party SDKs (e.g., userbase.js)
tests/              # Jest test suite (tests/icloud/, tests/worker/, tests/sharing/), manual debug pages (tests/manual/)
scripts/            # Development and deployment shell scripts
docs/               # Historical design notes and fix documentation (docs/archive/)
cloudflare-worker/  # CardDAV CORS proxy Worker (iCloud sync)
index.html          # Main entry point
404.html            # Landing page for unknown routes
style.css           # Styles
mobile.css
manifest.webmanifest # PWA manifest (home screen install)
```
---
## Development

- Contributions and feedback are welcome!

### Setup
```bash
# Install development dependencies (testing framework, dev server)
npm install

# Start the development server on http://localhost:8080
# (requires Python 3; serves static files only, no live reload)
npm run serve
```
### Caching & Versioning
Browser caching is handled entirely by the `Cache-Control: no-cache` rule in
`_headers`: Cloudflare Pages serves assets with ETags, so browsers revalidate
on every load and unchanged files come back as cheap 304 responses. There is
no build-time cache busting.

The packaging script injects a build stamp (`<git-sha>-<yyyymmdd>`) into
`src/version.js`, shown in the app footer so you can verify which deploy is
live. In development the footer shows `v0.3.0 (dev)`.

```bash
# For production deployment
./scripts/production_zip.sh
```

### Deploy to Cloudflare Pages

The app is hosted at [e2econtacts.org](https://e2econtacts.org) via Cloudflare Pages (project name: `kontakt`).

```bash
# Run from: contact-management-system/
fish scripts/production_zip.sh && \
  rm -rf _deploy_tmp && mkdir _deploy_tmp && \
  unzip -q production.zip -d _deploy_tmp && \
  cd cloudflare-worker && \
  node_modules/.bin/wrangler pages deploy ../_deploy_tmp --project-name=kontakt
```

> **Important:**
> - Project name is `kontakt` (not `contact-management-system`)
> - `wrangler pages deploy` requires a **folder**, not a zip — always unzip first
> - The CardDAV proxy Worker is deployed separately:
>   ```bash
>   cd cloudflare-worker && node_modules/.bin/wrangler deploy
>   ```

---
## Roadmap

- [x] QR code generation (for easy contact sharing with iOS/Android compatibility)
- [x] Share your profile
- [x] Revoke sharing per recipient (Individual Databases)
- [ ] Improve phone menu UI
- [ ] Add some missing export functionality
- [ ] Improved import duplicate and merge functionality
- [x] Sharing-lists (for better control and bulk sharing)
- [x] **iCloud Sync** (bidirectional CardDAV, via proxy Worker)
- [ ] Generic CardDAV servers (Baikal, Nextcloud, Radicale) — removed 2026-10-14; the old path was broken in production and untested. Re-adding it needs a generic proxy allowlist and tests.
- [ ] Group list features (Rename, edit, copy, etc)
- [ ] Create e-mail distrubution list
- [x] Bulk operations (Delete)
- [ ] Multi-language support (i18n)
- [ ] Advanced sharing permissions (cross edit contacts)
- [x] Stay logged in feature
- [ ] Change password
- [ ] Set passwords rules
- [x] Dark mode
- [x] Colour themes (6 selectable looks, each with light + dark; see `themes.css` and the sidebar "Appearance" section)
- [ ] Pictures as avatars
- [x] Complete disaster recovery system via vCards

### Ideas
- [x] A Progressive Web App (PWA)
- [ ] An Electron or Tauri App
- [x] Better integration on phones, iCloud/CardDAV support
- [ ] Improve decentralization using userbase

```  
┌────────────────────────────────────────────────────┐
│          Shared Userbase Application               │
│              AppID: "contact-manager"              │
│                                                    │
│  ┌──────────────┐            ┌──────────────┐      │
│  │  Instance A  │            │  Instance B  │      │
│  │  domain-a.com│            │  domain-b.com│      │
│  │              │            │              │      │
│  │ User: alice  │◄──────────►│ User: bob    │      │
│  │ Contacts DB  │   Native   │ Contacts DB  │      │
│  │              │  Userbase  │              │      │
│  └──────────────┘  Sharing   └──────────────┘      │
│                                                    │
│     Same AppID = Native Sharing Works!             │
└────────────────────────────────────────────────────┘


┌─────────────────────┐         ┌─────────────────────┐
│   Instance A        │         │   Instance B        │
│   (Userbase App 1)  │         │   (Userbase App 2)  │
│                     │         │                     │
│  User: alice@A      │         │  User: bob@B        │
│  Contact DB         │         │  Contact DB         │
└──────────┬──────────┘         └──────────┬──────────┘
           │                               │
           │     Encrypted Export          │
           └───────────┐     ┌─────────────┘
                       ▼     ▼
                ┌──────────────────┐
                │  Bridge Service  │
                │  (Server)        │
                │                  │
                │  • User mapping  │
                │  • Data relay    │
                │  • Permissions   │
                └──────────────────┘


┌─────────────────────┐         ┌─────────────────────┐
│   Browser A         │         │   Browser B         │
│   (Alice)           │◄───────►│   (Bob)             │
│                     │ WebRTC  │                     │
│  Userbase: app-a    │  P2P    │  Userbase: app-b    │
│                     │ Channel │                     │
└─────────────────────┘         └─────────────────────┘
           │                               │
           └───────────┐     ┐─────────────┘
                       ▼     ▼
                ┌──────────────────┐
                │  Signaling       │
                │  Server          │
                │  (WebSocket)     │
                └──────────────────┘


┌─────────────────────┐         ┌─────────────────────┐
│   Instance A        │         │   Instance B        │
│   AppID: "app-a"    │         │   AppID: "app-b"    │
│   domain-a.com      │◄───────►│   domain-b.com      │
│                     │WebFinger│                     │
│  alice@domain-a.com │  +      │  bob@domain-b.com   │
│                     │ Signed  │                     │
│                     │ vCards  │                     │
└─────────────────────┘         └─────────────────────┘


```                
### iCloud sync flow

**Push (Contact Manager → iCloud)**
- You create or edit a contact in the web app
- `ICloudSyncService` PUTs the vCard 3.0 through the proxy Worker with `If-Match`/`If-None-Match`
- iCloud serves it to your iPhone/iPad/Mac

**Pull (iCloud → Contact Manager)**
- You edit a contact on an Apple device
- The periodic cycle REPORTs the addressbook, matches by vCard UID and ETag
- Owned/imported cards are updated locally; shared cards are never overwritten (owner authority) and are force-pushed back

```
┌─────────────────────┐   HTTPS    ┌─────────────────────┐  CardDAV  ┌──────────────────┐
│  Contact Manager    │ ─────────► │  Cloudflare Worker  │ ────────► │  iCloud CardDAV  │
│  (browser, E2E      │ ◄───────── │  carddav-proxy      │ ◄──────── │  contacts.icloud │
│   encrypted store)  │            │  CORS + allowlist   │           │  .com            │
└─────────────────────┘            └─────────────────────┘           └──────────────────┘
```
---
## 🔗 iCloud Sync

The only external sync target is Apple iCloud. Because iCloud's CardDAV endpoint does not send CORS headers, requests go through a small Cloudflare Worker (`cloudflare-worker/`) that only forwards to `contacts.icloud.com` / `caldav.icloud.com`, checks the request origin, and forwards conditional (ETag) headers so edits are never silently overwritten.

### Quick Start
```bash
npm run serve   # http://localhost:8080
```

Open http://localhost:8080, sign in, and use the **iCloud Sync** button with your Apple ID email and an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords). Credentials can be stored encrypted in the browser so auto-sync resumes after a reload.

The proxy Worker is deployed separately:
```bash
cd cloudflare-worker && node_modules/.bin/wrangler deploy
```

See [ICLOUD_SYNC_REVIEW.md](ICLOUD_SYNC_REVIEW.md) for the sync rules and [FEATURE_CLEANUP_AND_REVIEW.md](FEATURE_CLEANUP_AND_REVIEW.md) for the cleanup plan.

## Acknowledgements

This project has been developed with assistance from [GitHub Copilot](https://github.com/features/copilot).
