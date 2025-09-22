# Contact Management System

**Status:** 🚧 Very much in development!  
This project is not production-ready. Features, structure, and documentation are subject to rapid change.

## Overview

- Your contacts are broken 🤯
- You have 500 contacts. When you change your number, 500 people have the wrong one.
- What if YOUR contact card updated itself in everyone's phone?
- That's what we built ✨
- Never text the wrong number again.
- Try  → https://e2econtacts.org

A secure, modular contact management system with:
- **End-to-end encrypted storage** (Userbase)
- **Real-time sharing and sync**
- **Full RFC 9553 (vCard 4.0) compliance**
- **Distribution lists for group sharing**
- **Cross-device support**

## Key Features

- Create, edit, and organize contacts (vCard 4.0)
- Share contacts with users or groups (distribution lists)
- Archive, delete, and manage received/shared contacts
- Import/export contacts (vCard, QR code)
- Real-time updates and cross-device sync

## Project Structure

```
src/                # Core business logic and UI components
lib/                # Third-party SDKs (e.g., userbase.js)
config/             # App configuration
tests/              # Automated tests
index.html          # Main entry point
style.css           # Styles
production_zip.sh   # Production packaging script
```

## Development

- **Install dependencies** as needed (see `package.json`)
- **Do not use in production yet!**
- Contributions and feedback are welcome.

---

*For detailed architecture and RFC 9553 compliance, see `.github/copilot-instructions.md`.*
