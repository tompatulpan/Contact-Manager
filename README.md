# Contact Management System

A modern, secure contact management system with RFC 9553 (vCard 4.0) compliance and end-to-end encryption using Userbase.com.

## ✨ Features

### Core Functionality
- 📇 **RFC 9553 Compliant**: Native vCard 4.0 format support
- 🔒 **End-to-End Encryption**: All data encrypted via Userbase.com
- 🔄 **Real-Time Sync**: Automatic synchronization across devices
- 👥 **Contact Sharing**: Share contacts with other users
- 📱 **QR Code Generation**: Export contacts as QR codes
- 📂 **Distribution Lists**: Organize contacts into custom groups
- 🗃️ **Archive & Delete**: Soft delete with archive functionality

### Advanced Features  
- 🔍 **Advanced Search**: Full-text search across all contact fields
- 📊 **Contact Analytics**: Usage statistics and interaction tracking
- 📥📤 **Import/Export**: Standard vCard import and export
- 🎨 **Responsive Design**: Works on desktop, tablet, and mobile
- ⌨️ **Keyboard Shortcuts**: Power-user keyboard navigation
- 🌙 **Dark Mode**: Light/dark theme support

### Technical Features
- 🏗️ **Modular Architecture**: Clean separation of concerns
- 🧪 **Comprehensive Testing**: Unit and integration tests included
- 🚀 **Performance Optimized**: Client-side caching and efficient queries
- ♿ **Accessible**: WCAG 2.1 compliance
- 📱 **Progressive Web App**: Offline-capable PWA features

## 🚀 Quick Start

### Prerequisites
- Modern web browser with ES6 module support
- Local web server (for development)
- Userbase.com account (for production)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd contact-management-system
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure Userbase**
- Sign up at [userbase.com](https://userbase.com)
- Create a new app and get your App ID
- Update the App ID in `src/config/app.config.js`:
```javascript
export const USERBASE_CONFIG = {
    appId: 'your-userbase-app-id-here',
    // ...
};
```

4. **Start the development server**
```bash
npm run dev
```

5. **Open in browser**
Navigate to `http://localhost:3000`

### First Run

1. Click "Sign Up" to create a new account
2. Sign in with your credentials
3. Create your first contact using the "New Contact" button
4. Explore features like search, filtering, and organization

## 🏗️ Architecture

### Project Structure
```
contact-management-system/
├── src/                          # Source code
│   ├── core/                     # Business logic (framework-agnostic)
│   │   ├── ContactManager.js     # Main contact operations
│   │   ├── ContactDatabase.js    # Database abstraction
│   │   ├── VCardStandard.js     # RFC 9553 implementation
│   │   └── ContactValidator.js   # Data validation
│   ├── ui/                       # User interface
│   │   ├── ContactUIController.js # UI coordination
│   │   └── components/           # UI components (future)
│   ├── utils/                    # Utilities
│   │   ├── EventBus.js          # Event system
│   │   └── TestHelpers.js       # Testing utilities
│   ├── config/                   # Configuration
│   │   └── app.config.js        # App settings
│   └── app.js                   # Application entry point
├── tests/                        # Test files
├── style.css                    # Application styles
├── index.html                   # Main HTML file
└── package.json                 # Dependencies and scripts
```

### Key Architectural Principles

1. **Clean Architecture**: Business logic separated from UI concerns
2. **Event-Driven**: Components communicate via EventBus pattern
3. **Modular Design**: Each module has a single responsibility
4. **RFC 9553 Compliance**: Native vCard 4.0 as single source of truth
5. **Security First**: End-to-end encryption for all operations

## 📋 Data Model

### Contact Structure
```javascript
const contact = {
    contactId: "unique-identifier",
    cardName: "User-friendly display name",
    vcard: "RFC 9553 compliant vCard 4.0 string",
    metadata: {
        // System metadata for sharing, archiving, etc.
        createdAt: "ISO timestamp",
        lastUpdated: "ISO timestamp",
        isOwned: boolean,
        isArchived: boolean,
        sharing: { /* sharing details */ },
        usage: { /* access tracking */ }
    }
}
```

### Supported vCard Fields
- **FN** (Full Name) - Required
- **TEL** (Phone Numbers) - Multiple, with types and preferences
- **EMAIL** (Email Addresses) - Multiple, with types and preferences  
- **URL** (Websites) - Multiple, with types and preferences
- **ORG** (Organization)
- **TITLE** (Job Title)
- **NOTE** (Notes) - Multiple
- **BDAY** (Birthday)

### Metadata Features
- **Sharing Control**: Per-user permissions and tracking
- **Distribution Lists**: Custom contact groupings
- **Usage Analytics**: Access counts and interaction history
- **Sync Management**: Version control and conflict resolution
- **Archive/Delete States**: Soft delete with restoration

## 🔧 Configuration

### Environment Variables
Create appropriate configuration in `src/config/app.config.js`:

```javascript
export const USERBASE_CONFIG = {
    appId: 'your-userbase-app-id',     // Required
    databases: {
        contacts: 'contacts',           // Contact database name
        settings: 'user-settings',     // Settings database name
        activity: 'activity-log'       // Activity log database name
    }
};
```

### Feature Flags
Enable/disable features in the configuration:

```javascript
export const FEATURE_FLAGS = {
    enableContactSharing: true,
    enableDistributionLists: true,
    enableQRCodeGeneration: true,
    enableVCardImportExport: true,
    enableContactArchiving: true
};
```

## 🧪 Testing

### Run Tests
```bash
# Run integration tests
npm test

# Run tests in browser (development)
# Open http://localhost:3000 and click "Run Tests" button
```

### Test Coverage
- ✅ EventBus communication
- ✅ RFC 9553 vCard generation and parsing
- ✅ Contact validation (phones, emails, URLs)
- ✅ CRUD operations (Create, Read, Update, Delete)
- ✅ Search and filtering
- ✅ Import/Export functionality
- ✅ Complete workflow integration

### Adding New Tests
```javascript
// In tests/integration.test.js
runner.test('Your test name', async () => {
    // Test implementation
    runner.assert(condition, 'Error message');
});
```

## 🚀 Development

### Available Scripts
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run tests
npm run lint         # Run linter
npm run format       # Format code
```

### Development Workflow
1. **Feature Development**
   - Create feature branch
   - Implement in appropriate module (core vs ui)
   - Add tests
   - Update documentation

2. **Testing**
   - Run integration tests
   - Test in multiple browsers
   - Verify mobile responsiveness

3. **Code Quality**
   - Follow ESLint configuration
   - Maintain test coverage
   - Document public APIs

### Adding New Features
1. **Core Features**: Add to appropriate module in `src/core/`
2. **UI Features**: Add to `src/ui/` or components
3. **Configuration**: Update `src/config/app.config.js`
4. **Tests**: Add to `tests/` directory

## 📱 Usage

### Basic Operations
- **Create Contact**: Click "New Contact" button
- **Search**: Type in search box (searches all fields)
- **Edit**: Click contact, then "Edit" button
- **Delete**: Click contact, then delete button
- **Archive**: Use contact menu options

### Advanced Features
- **Share Contact**: Use share button (requires recipient username)
- **Export vCard**: Click "Export" on any contact
- **Import vCard**: Drag and drop .vcf files
- **QR Code**: Generate QR code for easy mobile sharing
- **Distribution Lists**: Create custom contact groups

### Keyboard Shortcuts
- **Ctrl/Cmd + N**: New contact
- **Ctrl/Cmd + F**: Focus search
- **Escape**: Close modals
- **Arrow Keys**: Navigate contact list

## 🔒 Security & Privacy

### Data Protection
- **End-to-End Encryption**: All data encrypted by Userbase.com
- **Zero-Knowledge Architecture**: Server cannot read your data
- **Local-First**: Data cached locally, works offline
- **Secure Sharing**: Encrypted sharing between users

### Privacy Features
- **No Tracking**: No analytics or user tracking
- **Data Ownership**: You own and control your data
- **GDPR Compliant**: Right to export and delete data
- **Minimal Permissions**: Only requests necessary permissions

## 🤝 Contributing

### Getting Started
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

### Contribution Guidelines
- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure backwards compatibility
- Test across browsers

### Bug Reports
- Use GitHub Issues
- Include reproduction steps
- Specify browser and OS
- Include error messages/screenshots

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **RFC 9553**: vCard 4.0 specification compliance
- **Userbase.com**: End-to-end encrypted database service
- **Font Awesome**: Icons used throughout the application
- **Modern Web Standards**: Built with ES6 modules and modern APIs

## 📞 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: GitHub Issues for bugs and feature requests
- **Discussions**: GitHub Discussions for questions and ideas

## 🗺️ Roadmap

### Version 1.1
- [ ] Mobile app (PWA improvements)
- [ ] Bulk operations (import multiple contacts)
- [ ] Advanced filtering options
- [ ] Contact merge functionality

### Version 1.2
- [ ] Contact photos and avatars
- [ ] Integration with external services
- [ ] Advanced sharing permissions
- [ ] Contact backup/restore

### Version 2.0
- [ ] Team collaboration features
- [ ] API for third-party integrations
- [ ] Advanced analytics dashboard
- [ ] Multi-language support

---

Made with ❤️ using modern web technologies and RFC 9553 compliance.