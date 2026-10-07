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
- Using vCard 3.0 (RFC 2426) for storage and CardDAV sync
- Distribution lists for group sharing
- Cross-device support (web application)

## Key Features

- Create, edit, and organize contacts
- Share contacts with users or groups (distribution lists)
- Archive, delete, and manage received/shared contacts
- Import/export contacts (vCard 3.0)
- QR code generation - Scan to easely import contacts
- Real-time updates and cross-device sync
- **🆕 Baikal CardDAV Integration** - Sync with any CardDAV server

## Project Structure

```
src/                # Core business logic and UI components
lib/                # Third-party SDKs (e.g., userbase.js)
tests/              # Jest test suite (tests/icloud/), manual debug pages (tests/manual/)
scripts/            # Development, cache-busting and deployment shell scripts
docs/               # Historical design notes and fix documentation (docs/archive/)
index.html          # Main entry point
style.css           # Styles
mobile.css
```
---
## Development

- Contributions and feedback are welcome!

### Setup
```bash
# Install development dependencies (testing framework, dev server)
npm install

# Start development server with live reload
npm run serve

# 🆕 Baikal CardDAV integration setup
cd ../contact-carddav-bridge && npm start  # Start bridge server (port 3001)
npm run serve                               # Start contact manager (port 8080)
```
### Cache Busting 
```bash
# For development (after CSS/JS changes)
./scripts/dev-cache-bust.sh

# For production deployment  
./scripts/production_zip.sh

# Restore original files
./scripts/restore-dev.sh
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
- [x] **Baikal CardDAV Integration** (sync with any CardDAV server)
- [ ] Group list features (Rename, edit, copy, etc)
- [ ] Create e-mail distrubution list
- [x] Bulk operations (Delete)
- [ ] Multi-language support (i18n)
- [ ] Advanced sharing permissions (cross edit contacts)
- [x] Stay logged in feature
- [ ] Change password
- [ ] Set passwords rules
- [x] Dark mode
- [ ] Pictures as avatars
- [x] Complete disaster recovery system via vCards

### Ideas
- [ ] A Progressive Web App (PWA)
- [ ] An Electron or Tauri App
- [(x)] Better integration on phones, CardDAV support
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
### Sync Flow Details with Baikal

**Push (Contact Manager → Baikal)**
- User updates contact in web app
- Bridge uploads vCard via CardDAV PUT
- Baikal stores and serves to other devices

**Pull (Baikal → Contact Manager)**  
- Other devices update contact via CardDAV
- Bridge polls Baikal for changes (PROPFIND)
- Contact Manager updates local storage

```
┌─────────────────────────────────────────────────────────┐
│            User's Contact Manager Account               │
│                                                         │
│  ┌───────────────────┐        ┌──────────────────┐      │
│  │ Userbase Storage  │        │  User's Bridge   │      │
│  │  (E2E Encrypted)  │◄──────►│   Component      │      │
│  │                   │        │  (Per-User)      │      │
│  │ - My Contacts     │        │                  │      │
│  │ - Shared Contacts │        │  User Config:    │      │
│  └───────────────────┘        │  • Baikal URL    │      │
│                               │  • Username      │      │
│                               │  • Password      │      │
│                               │  • Sync Settings │      │
│                               └────────┬─────────┘      │
└────────────────────────────────────────┼────────────────┘
                                         │
                                         │ CardDAV Protocol
                                         │ (Bidirectional Sync)
                              ┌──────────────────────┐
                              │  Baikal Server       │
                              │  (CardDAV Endpoint)  │
                              │                      │
                              │  /dav.php/           │
                              │  addressbooks/       │
                              │  username/contacts/  │
                              └──────────────────────┘


┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │ Contact Manager │    │ Userbase.com    │
│ (iOS, Android,  │◄──►│                 │◄──►│   (E2E Encrypted│
│  Thunderbird)   │    │                 │    │    Storage)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       │
         └───────────────────────▼
         ┌─────────────────────────────────────┐
         │         Baikal Server               │
         │    (CardDAV/CalDAV Server)          │
         │                                     │
         │  ┌─────────────────────────────┐    │
         │  │    Bridge Component         │    │
         │  │  (Sync Userbase ↔ Baikal)   │    │
         │  └─────────────────────────────┘    │
         └─────────────────────────────────────┘



┌─────────────────────────────┐
│    Contact Manager          │ ← Real-time sharing, E2E encryption
│ (Userbase.com storage)      │ ← Advanced features: distribution lists, 
│                             │   individual sharing, revocation
└─────────────┬───────────────┘
              │ Bridge Component
              ▼
┌─────────────────────────────┐
│       Baikal Server         │ ← Standard CardDAV server
│    (CardDAV endpoint)       │ ← Compatible with ALL devices
└─────────────┬───────────────┘
              │ Standard CardDAV Protocol
              ▼
┌─────────────────────────────┐
│     Native Device Apps      │
│ • iPhone Contacts           │
│ • Android Contacts          │
│ • Thunderbird Address Book  │
│ • macOS Contacts            │
│ • Any CardDAV client        │
└─────────────────────────────┘
```
---
## 🔗 Baikal CardDAV Integration

The contact manager now supports synchronization with any CardDAV server (Baikal, Nextcloud, etc.). This enables:

- **Universal Device Sync**: Access contacts on iPhone, Android, Thunderbird, etc.
- **Standard Protocol**: Uses industry-standard CardDAV for maximum compatibility
- **Bidirectional Sync**: Changes sync both ways between contact manager and CardDAV server
- **Self-Service Setup**: No admin required - users configure their own connections

### Quick Start
```bash
# Start CardDAV bridge server (separate project)
cd ../contact-carddav-bridge && npm start  # Port 3001

# Start contact manager
npm run serve  # Port 8080

# Open http://localhost:8080, click "Baikal" button
```

See **[BAIKAL_INTEGRATION.md](docs/archive/BAIKAL_INTEGRATION.md)** for complete setup and configuration guide.

## Acknowledgements

This project has been developed with assistance from [GitHub Copilot](https://github.com/features/copilot).
