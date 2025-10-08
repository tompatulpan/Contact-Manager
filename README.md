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
- Using RFC9553 for storage
- Distribution lists for group sharing
- Cross-device support (web application)

## Key Features

- Create, edit, and organize contacts
- Share contacts with users or groups (distribution lists)
- Archive, delete, and manage received/shared contacts
- Import/export contacts (vCard 3.0 and 4.0)
- QR code generation - Scan to easely import contacts
- Real-time updates and cross-device sync

## Project Structure

```
src/                # Core business logic and UI components
lib/                # Third-party SDKs (e.g., userbase.js)
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
```
### Cache Busting 
```bash
# For development (after CSS/JS changes)
./dev-cache-bust.sh

# For production deployment  
./production_zip.sh

# Restore original files
./restore-dev.sh
```

---
## Roadmap

- [x] QR code generation (for easy contact sharing with iOS/Android compatibility)
- [x] Share your profile
- [x] Revoke sharing per recipient (Individual Databases)
- [ ] Add some missing export functionality
- [ ] Improved import duplicate and merge functionality
- [x] Sharing-lists (for better control and bulk sharing)
- [ ] Create e-mail distrubution list
- [ ] Bulk operations (Delete, Export etc.)
- [ ] Sharing-List features (Rename, edit, copy, etc)
- [ ] Multi-language support (i18n)
- [ ] Advanced sharing permissions (cross edit contacts)
- [x] Stay logged in feature
- [ ] Change password
- [ ] Set passwords rules
- [ ] Dark mode
- [ ] Icons improvments (pictures?)

### Ideas
- [ ] A Progressive Web App (PWA)
- [ ] An Electron App
- [ ] Improve decentralization using userbase
- [ ] Better integration on phones, CardDAV support
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │ Contact Manager │    │ Userbase.com    │
│ (iOS, Android,  │◄──►│                 │◄──►│   (E2E Encrypted│
│  Thunderbird)   │    │                 │    │    Storage)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       │
         └───────────────────────▼
         ┌─────────────────────────────────────┐
         │         Baïcal Server               │
         │    (CardDAV/CalDAV Server)          │
         │                                     │
         │  ┌─────────────────────────────┐    │
         │  │    Bridge Component         │    │
         │  │  (Sync Userbase ↔ Baïcal)   │    │
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
│       Baïcal Server         │ ← Standard CardDAV server
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
## Acknowledgements

This project has been developed with assistance from [GitHub Copilot](https://github.com/features/copilot).
