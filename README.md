# Contact Management System

**Status:** 🚧 Very much in development!  
This project is not production-ready. Features, structure, and documentation are subject to rapid change.

## Overview

- Your contacts are broken 🤯
- You have 500 contacts. When you change your number, 500 people have the wrong one.
- What if YOUR contact card updated itself in everyone's phone?
- That's what we built ✨
- Never text the wrong number again.
- Try  → [it here](https://e2econtacts.org)

A secure, modular contact management system with:
- **End-to-end encrypted storage on [Userbase](https://github.com/smallbets/userbase)**
- **Real-time sharing and sync**
- **Full RFC 9553 (vCard 4.0) compliance**
- **Distribution lists for group sharing**
- **Cross-device support** (web application)

## Key Features

- Create, edit, and organize contacts
- Share contacts with users or groups (distribution lists)
- Archive, delete, and manage received/shared contacts
- Import/export contacts (vCard)
- Real-time updates and cross-device sync
- **Automated cache busting** (no more manual cache clearing!)

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

- Contributions and feedback are welcome.

### Cache Busting 

# For development (after CSS/JS changes)
./dev-cache-bust.sh

# For production deployment  
./production_zip.sh

# Restore original files
./restore-dev.sh
```

See [CACHE_BUSTING.md](CACHE_BUSTING.md) for detailed documentation.

---
## Roadmap

- [ ] QR-code generation (for easy sharing)
- [ ] Share your profile
- [ ] Bulk operations (Delete, Export etc.)
- [ ] Sharing-List features (Rename, edit, etc)
- [ ] Multi-language support (i18n)
- [ ] Contact backup/restore
- [ ] Advanced sharing permissions (X edit contacts)
- [ ] Stay logged in feature
- [ ] Change password
- [ ] Set passwords rules
- [ ] Dark mode
- [ ] Create e-mail distrubution list
- [ ] Icons improvments (pictures?)

### Ideas
- [ ] Contact merge functionality
- [ ] A Progressive Web App (PWA)
- [ ] An electron App
- [ ] Improve decentralization

---
## Acknowledgements

This project has been developed with assistance from [GitHub Copilot](https://github.com/features/copilot).
