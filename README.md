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
- **End-to-end encrypted storage** (userbase.com)
- **Real-time sharing and sync**
- **Full RFC 9553 (vCard 4.0) compliance**
- **Distribution lists for group sharing**
- **Cross-device support** (webb app)

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
index.html          # Main entry point
style.css           # Styles
mobile.css
```

## Development

- **Install dependencies** as needed (see `package.json`)
- **Do not use in production yet!**
- Contributions and feedback are welcome.

---
## Roadmap

- [ ] QR-code generation
- [ ] Share your profile
- [ ] Bulk operations (Delete, Export etc.)
- [ ] Multi-language support
- [ ] Contact backup/restore
- [ ] Advanced sharing permissions (edit contacts)
- [ ] Set passwords rules
- [ ] Change password
- [ ] Dark mode
- [ ] Create e-mail distrubution list
- [ ] Icons improvments

### Ideas
- [ ] Contact merge functionality
- [ ] Mobile app (PWA improvements)
- [ ] Integration with external services
- [ ] Improve decentralization
