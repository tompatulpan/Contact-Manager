/**
 * VCardStandard - RFC 9553 vCard 4.0 Standard Implementation
 * Handles all vCard operations with native standard compliance
 */
export class VCardStandard {
    constructor() {
        this.version = '4.0';
        this.supportedProperties = new Set([
            'VERSION', 'FN', 'N', 'TEL', 'EMAIL', 'URL', 'ORG', 'TITLE', 
            'NOTE', 'BDAY', 'ADR', 'PHOTO', 'CATEGORIES', 'REV'
        ]);
        this.requiredProperties = new Set(['VERSION', 'FN']);
        
        // Apple/iCloud vCard 3.0 compatibility mappings
        this.appleUrlTypes = new Set([
            'PERSONAL', 'SOCIAL', 'OTHER', 'WORK', 'HOME'
        ]);
        
        this.standardUrlTypes = new Set([
            'work', 'home', 'other'
        ]);
    }

    /**
     * Parse RFC 9553 compliant vCard string
     * @param {string} vCardString - Raw vCard content
     * @returns {Object} Parsed contact data
     */
    parseVCard(vCardString) {
        if (!vCardString || typeof vCardString !== 'string') {
            console.error('❌ Invalid vCard string provided:', vCardString);
            throw new Error('Invalid vCard string provided');
        }
        
        if (vCardString.trim() === '') {
            console.error('❌ Empty vCard string provided');
            throw new Error('Empty vCard string provided');
        }

        const lines = this.unfoldLines(vCardString);
        const contact = { 
            version: '4.0', 
            properties: new Map(),
            rawProperties: new Map() // Store original property lines for debugging
        };

        for (const line of lines) {
            if (line.startsWith('BEGIN:VCARD') || line.startsWith('END:VCARD')) {
                continue;
            }
            
            try {
                const { property, parameters, value } = this.parseLine(line);
                this.addProperty(contact, property, parameters, value);
                
                // Store raw property for debugging
                if (!contact.rawProperties.has(property)) {
                    contact.rawProperties.set(property, []);
                }
                contact.rawProperties.get(property).push(line);
            } catch (error) {
                console.warn(`Failed to parse vCard line: "${line}"`, error);
            }
        }

        return contact;
    }

    /**
     * Generate RFC 9553 compliant vCard string
     * @param {Object} contactData - Contact data object
     * @returns {string} RFC 9553 vCard string
     */
    generateVCard(contactData) {
        
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:4.0\n';

        // Essential properties first
        if (contactData.fn) {
            vcard += `FN:${this.escapeValue(contactData.fn)}\n`;
        }

        // Multi-value properties with RFC 9553 parameters
        if (contactData.phones && contactData.phones.length > 0) {
            // Check if any phone is explicitly marked as primary
            const hasPrimary = contactData.phones.some(phone => phone.primary);
            contactData.phones.forEach((phone, index) => {
                const params = this.buildParameters({
                    type: phone.type,
                    pref: phone.primary || (!hasPrimary && index === 0) // First item as fallback if no explicit primary
                });
                vcard += `TEL${params}:${this.escapeValue(phone.value)}\n`;
            });
        }

        if (contactData.emails && contactData.emails.length > 0) {
            // Check if any email is explicitly marked as primary
            const hasPrimary = contactData.emails.some(email => email.primary);
            contactData.emails.forEach((email, index) => {
                const params = this.buildParameters({
                    type: email.type,
                    pref: email.primary || (!hasPrimary && index === 0) // First item as fallback if no explicit primary
                });
                vcard += `EMAIL${params}:${this.escapeValue(email.value)}\n`;
            });
        }

        if (contactData.urls && contactData.urls.length > 0) {
            // Check if any URL is explicitly marked as primary
            const hasPrimary = contactData.urls.some(url => url.primary);
            contactData.urls.forEach((url, index) => {
                const params = this.buildParameters({
                    type: url.type,
                    pref: url.primary || (!hasPrimary && index === 0) // First item as fallback if no explicit primary
                });
                vcard += `URL${params}:${this.escapeValue(url.value)}\n`;
            });
        }

        // Addresses (ADR)
        if (contactData.addresses && contactData.addresses.length > 0) {
            // Check if any address is explicitly marked as primary
            const hasPrimary = contactData.addresses.some(address => address.primary);
            contactData.addresses.forEach((address, index) => {
                const params = this.buildParameters({
                    type: address.type,
                    pref: address.primary || (!hasPrimary && index === 0) // First item as fallback if no explicit primary
                });
                
                // Build ADR value: postOfficeBox;;street;locality;region;postalCode;country
                const adrParts = [
                    address.postOfficeBox || '',
                    '', // Extended address (typically empty)
                    address.street || '',
                    address.city || '',
                    address.region || '',
                    address.postalCode || '',
                    address.country || ''
                ];
                
                vcard += `ADR${params}:${adrParts.map(part => this.escapeValue(part)).join(';')}\n`;
            });
        }

        // Single-value properties
        if (contactData.organization) {
            vcard += `ORG:${this.escapeValue(contactData.organization)}\n`;
        }
        
        if (contactData.title) {
            vcard += `TITLE:${this.escapeValue(contactData.title)}\n`;
        }

        if (contactData.birthday) {
            vcard += `BDAY:${contactData.birthday}\n`;
        }

        if (contactData.notes && contactData.notes.length > 0) {
            contactData.notes.forEach(note => {
                vcard += `NOTE:${this.escapeValue(note)}\n`;
            });
        }

        // Add revision timestamp
        vcard += `REV:${new Date().toISOString()}\n`;

        vcard += 'END:VCARD';
        return vcard;
    }

    /**
     * Extract display data from vCard for UI
     * @param {Object} contact - Contact object with vCard property
     * @returns {Object} Display-friendly contact data
     */
    extractDisplayData(contact) {
        const vCardData = this.parseVCard(contact.vcard);
        
        // Extract address information
        const addresses = this.extractMultiValueProperty(vCardData, 'ADR');
        
        return {
            contactId: contact.contactId,
            cardName: contact.cardName,
            fullName: vCardData.properties.get('FN') || 'Unnamed Contact',
            organization: vCardData.properties.get('ORG') || '',
            title: vCardData.properties.get('TITLE') || '',
            phones: this.extractMultiValueProperty(vCardData, 'TEL'),
            emails: this.extractMultiValueProperty(vCardData, 'EMAIL'),
            urls: this.extractMultiValueProperty(vCardData, 'URL'),
            addresses: addresses,
            notes: this.extractNotesProperty(vCardData),
            birthday: vCardData.properties.get('BDAY') || '',
            lastUpdated: contact.metadata?.lastUpdated || '',
            isOwned: contact.metadata?.isOwned || false
        };
    }

    /**
     * Extract notes property specifically  
     * @param {Object} vCardData - Parsed vCard data
     * @returns {Array} Array of note strings
     */
    extractNotesProperty(vCardData) {
        const noteValues = vCardData.properties.get('NOTE') || [];
        
        if (!Array.isArray(noteValues)) {
            // Single note - extract the value
            if (typeof noteValues === 'string') {
                return [noteValues];
            } else if (noteValues && noteValues.value) {
                return [noteValues.value];
            }
            return [];
        }
        
        // Multiple notes - extract values from each
        return noteValues.map(note => {
            if (typeof note === 'string') {
                return note;
            } else if (note && note.value) {
                return note.value;
            }
            return '';
        }).filter(note => note.length > 0);
    }

    /**
     * Extract multi-value property with type and preference information
     * @param {Object} vCardData - Parsed vCard data
     * @param {string} property - Property name (TEL, EMAIL, URL, ADR)
     * @returns {Array} Array of property objects
     */
    extractMultiValueProperty(vCardData, property) {
        const values = vCardData.properties.get(property) || [];
        if (!Array.isArray(values)) {
            return [values].map(value => this.normalizePropertyValue(value, property));
        }
        return values.map(value => this.normalizePropertyValue(value, property));
    }

    /**
     * Normalize property value to consistent format
     * @param {*} value - Property value
     * @param {string} property - Property type (for special handling)
     * @returns {Object} Normalized property object
     */
    normalizePropertyValue(value, property = '') {
        if (typeof value === 'string') {
            // Handle ADR (address) property specially
            if (property === 'ADR') {
                return {
                    ...this.parseAddressValue(value),
                    type: 'other',
                    primary: false
                };
            }
            return { value, type: 'other', primary: false };
        }
        
        const baseObj = {
            type: value.parameters?.TYPE || 'other',
            primary: value.parameters?.PREF === '1' || value.parameters?.PREF === 1
        };

        // Handle ADR (address) property specially
        if (property === 'ADR') {
            return {
                ...this.parseAddressValue(value.value || ''),
                ...baseObj
            };
        }
        
        return {
            value: value.value || '',
            ...baseObj
        };
    }

    /**
     * Build RFC 9553 parameter string
     * @param {Object} params - Parameter object
     * @returns {string} Parameter string
     */
    buildParameters(params) {
        const paramStrings = [];
        
        if (params.type && params.type !== 'other') {
            paramStrings.push(`TYPE=${params.type.toLowerCase()}`);
        }
        
        if (params.pref) {
            paramStrings.push('PREF=1');
        }

        return paramStrings.length > 0 ? `;${paramStrings.join(';')}` : '';
    }

    /**
     * Format address value for vCard ADR property
     * RFC 9553 ADR format: PO Box;Extended Address;Street;City;State/Province;Postal Code;Country
     * @param {Object} address - Address object
     * @returns {string} Formatted address string
     */
    formatAddressValue(address) {
        const addressParts = [
            address.poBox || '',           // PO Box
            address.extended || '',        // Extended Address
            address.street || '',          // Street
            address.city || '',            // City
            address.state || '',           // State/Province
            address.postalCode || '',      // Postal Code
            address.country || ''          // Country
        ];
        
        return addressParts.map(part => this.escapeValue(part)).join(';');
    }

    /**
     * Parse address value from vCard ADR property
     * @param {string} addressValue - Raw address value from vCard
     * @returns {Object} Parsed address object
     */
    parseAddressValue(addressValue) {
        const parts = addressValue.split(';');
        
        return {
            poBox: this.unescapeValue(parts[0] || ''),
            extended: this.unescapeValue(parts[1] || ''),
            street: this.unescapeValue(parts[2] || ''),
            city: this.unescapeValue(parts[3] || ''),
            state: this.unescapeValue(parts[4] || ''),
            postalCode: this.unescapeValue(parts[5] || ''),
            country: this.unescapeValue(parts[6] || '')
        };
    }

    /**
     * Unfold vCard lines according to RFC 9553
     * @param {string} vCardString - Raw vCard string
     * @returns {Array<string>} Array of unfolded lines
     */
    unfoldLines(vCardString) {
        const lines = vCardString.split(/\r?\n/);
        const unfolded = [];
        let currentLine = '';

        for (const line of lines) {
            if (line.startsWith(' ') || line.startsWith('\t')) {
                // Continuation line - remove the leading whitespace and append
                currentLine += line.substring(1);
            } else {
                // New property line
                if (currentLine) {
                    unfolded.push(currentLine);
                }
                currentLine = line;
            }
        }

        if (currentLine) {
            unfolded.push(currentLine);
        }

        return unfolded.filter(line => line.trim().length > 0);
    }

    /**
     * Parse a single vCard property line
     * @param {string} line - Property line
     * @returns {Object} Parsed property data
     */
    parseLine(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`Invalid property line: ${line}`);
        }

        const propertyPart = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);

        const semicolonIndex = propertyPart.indexOf(';');
        let property, parametersString;

        if (semicolonIndex === -1) {
            property = propertyPart;
            parametersString = '';
        } else {
            property = propertyPart.substring(0, semicolonIndex);
            parametersString = propertyPart.substring(semicolonIndex + 1);
        }

        const parameters = this.parseParameters(parametersString);

        return {
            property: property.toUpperCase(),
            parameters,
            value: this.unescapeValue(value)
        };
    }

    /**
     * Parse property parameters
     * @param {string} parametersString - Parameter string
     * @returns {Object} Parameters object
     */
    parseParameters(parametersString) {
        const parameters = {};
        
        if (!parametersString) {
            return parameters;
        }

        const params = parametersString.split(';');
        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex).toUpperCase();
                const value = param.substring(equalIndex + 1);
                parameters[key] = value;
            }
        }

        return parameters;
    }

    /**
     * Add property to contact object
     * @param {Object} contact - Contact object
     * @param {string} property - Property name
     * @param {Object} parameters - Property parameters
     * @param {string} value - Property value
     */
    addProperty(contact, property, parameters, value) {
        if (!contact.properties.has(property)) {
            contact.properties.set(property, []);
        }

        const propertyValue = {
            value,
            parameters
        };

        const existingValues = contact.properties.get(property);
        
        // For single-value properties, replace; for multi-value, append
        if (['FN', 'ORG', 'TITLE', 'BDAY'].includes(property)) {
            contact.properties.set(property, value);
        } else {
            existingValues.push(propertyValue);
        }
    }

    /**
     * Validate RFC 9553 compliance
     * @param {string} vCardString - vCard to validate
     * @returns {Object} Validation result
     */
    validateVCard(vCardString) {
        const errors = [];
        const warnings = [];

        try {
            // Basic structure validation
            if (!vCardString.includes('BEGIN:VCARD')) {
                errors.push('Missing BEGIN:VCARD');
            }
            
            if (!vCardString.includes('END:VCARD')) {
                errors.push('Missing END:VCARD');
            }

            // Parse and validate properties
            const contact = this.parseVCard(vCardString);
            
            // Check required properties
            for (const required of this.requiredProperties) {
                if (!contact.properties.has(required)) {
                    errors.push(`Missing required property: ${required}`);
                }
            }

            // Version validation
            const version = this.extractVersion(vCardString);
            if (version !== '4.0') {
                warnings.push(`Non-standard version: ${version}, expected 4.0`);
            }

            return {
                isValid: errors.length === 0,
                version,
                errors,
                warnings
            };
        } catch (error) {
            return {
                isValid: false,
                version: null,
                errors: [`Parse error: ${error.message}`],
                warnings
            };
        }
    }

    /**
     * Extract version from vCard string
     * @param {string} vCardString - vCard string
     * @returns {string} Version number
     */
    extractVersion(vCardString) {
        const match = vCardString.match(/VERSION:(.+)/);
        return match ? match[1].trim() : null;
    }

    /**
     * Escape special characters in vCard values
     * @param {string} value - Value to escape
     * @returns {string} Escaped value
     */
    escapeValue(value) {
        if (typeof value !== 'string') {
            return String(value);
        }
        
        return value
            .replace(/\\/g, '\\\\')  // Escape backslashes
            .replace(/;/g, '\\;')    // Escape semicolons
            .replace(/,/g, '\\,')    // Escape commas
            .replace(/\n/g, '\\n');  // Escape newlines
    }

    /**
     * Unescape special characters in vCard values
     * @param {string} value - Value to unescape
     * @returns {string} Unescaped value
     */
    unescapeValue(value) {
        if (typeof value !== 'string') {
            return String(value);
        }
        
        return value
            .replace(/\\n/g, '\n')   // Unescape newlines
            .replace(/\\,/g, ',')    // Unescape commas
            .replace(/\\;/g, ';')    // Unescape semicolons
            .replace(/\\\\/g, '\\'); // Unescape backslashes
    }

    /**
     * Generate QR code data from vCard
     * @param {Object} contact - Contact object
     * @returns {string} vCard string for QR code
     */
    generateQRCodeData(contact) {
        return contact.vcard;
    }

    /**
     * Export contact as standard vCard file data
     * @param {Object} contact - Contact object
     * @returns {Object} Export data
     */
    exportAsVCard(contact) {
        const displayData = this.extractDisplayData(contact);
        const filename = `${displayData.fullName.replace(/[^a-zA-Z0-9]/g, '_')}.vcf`;
        
        return {
            filename,
            content: contact.vcard,
            mimeType: 'text/vcard;charset=utf-8'
        };
    }

    /**
     * Import vCard from string and create contact object
     * @param {string} vCardString - vCard string
     * @param {string} cardName - User-friendly card name
     * @param {boolean} markAsImported - Whether to mark contact as imported (default: true)
     * @returns {Object} Contact object
     */
    importFromVCard(vCardString, cardName = null, markAsImported = true) {
        // Auto-detect Apple/iCloud vCard 3.0 format
        if (this.isAppleVCard(vCardString)) {
            console.log('🍎 Detected Apple/iCloud vCard 3.0 format - using Apple import');
            return this.importFromAppleVCard(vCardString, cardName, markAsImported);
        }

        // Standard vCard 4.0 validation and import
        const validation = this.validateVCard(vCardString);
        if (!validation.isValid) {
            throw new Error(`Invalid vCard: ${validation.errors.join(', ')}`);
        }

        const displayData = this.extractDisplayData({ vcard: vCardString });
        
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: []
        };

        // Only add isImported flag if markAsImported is true
        if (markAsImported) {
            metadata.isImported = true;
        }
        
        return {
            contactId: this.generateContactId(),
            cardName: cardName || displayData.fullName || 'Imported Contact',
            vcard: vCardString,
            metadata
        };
    }

    /**
     * Generate unique contact ID using UUID v4
     * @returns {string} UUID v4 with contact prefix
     */
    generateContactId() {
        // Generate proper UUID v4
        return 'contact_' + this.generateUUIDv4();
    }

    /**
     * Generate UUID v4 (RFC 4122 compliant)
     * @returns {string} UUID v4
     */
    generateUUIDv4() {
        // Use crypto.randomUUID if available (modern browsers)
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        
        // Fallback implementation for older browsers
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Import Apple/iCloud vCard 3.0 format and convert to vCard 4.0
     * @param {string} vCardString - Apple vCard 3.0 string
     * @param {string} cardName - User-friendly card name
     * @param {boolean} markAsImported - Whether to mark contact as imported (default: true)
     * @returns {Object} Contact object with vCard 4.0 format
     */
    importFromAppleVCard(vCardString, cardName = null, markAsImported = true) {
        console.log('🍎 Importing Apple/iCloud vCard 3.0...');
        
        // Parse the Apple vCard 3.0
        const appleContact = this.parseAppleVCard(vCardString);
        
        // Convert to vCard 4.0 format
        const vCard40String = this.convertAppleToStandard(appleContact);
        
        // Create contact object
        const displayData = this.extractDisplayData({ vcard: vCard40String });
        
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: [],
            importSource: 'apple_icloud_3.0'
        };

        // Only add isImported flag if markAsImported is true
        if (markAsImported) {
            metadata.isImported = true;
        }
        
        return {
            contactId: this.generateContactId(),
            cardName: cardName || displayData.fullName || 'Apple Import',
            vcard: vCard40String,
            metadata
        };
    }

    /**
     * Export contact to Apple/iCloud compatible vCard 3.0 format
     * @param {Object} contact - Contact object
     * @returns {Object} Export data with Apple vCard 3.0
     */
    exportAsAppleVCard(contact) {
        console.log('🍎 Exporting to Apple/iCloud vCard 3.0...');
        
        const displayData = this.extractDisplayData(contact);
        const appleVCard = this.convertStandardToApple(displayData);
        const filename = `${displayData.fullName.replace(/[^a-zA-Z0-9]/g, '_')}_apple.vcf`;
        
        return {
            filename,
            content: appleVCard,
            mimeType: 'text/vcard;charset=utf-8',
            format: 'apple_3.0'
        };
    }

    /**
     * Parse Apple vCard 3.0 format
     * @param {string} vCardString - Apple vCard string
     * @returns {Object} Parsed Apple contact data
     */
    parseAppleVCard(vCardString) {
        const lines = this.unfoldLines(vCardString);
        const contact = { 
            version: '3.0', 
            properties: new Map(),
            rawProperties: new Map()
        };

        for (const line of lines) {
            if (line.startsWith('BEGIN:VCARD') || line.startsWith('END:VCARD')) {
                continue;
            }
            
            try {
                const { property, parameters, value } = this.parseAppleLine(line);
                this.addProperty(contact, property, parameters, value);
                
                // Store raw property for debugging
                if (!contact.rawProperties.has(property)) {
                    contact.rawProperties.set(property, []);
                }
                contact.rawProperties.get(property).push(line);
            } catch (error) {
                console.warn(`Failed to parse Apple vCard line: "${line}"`, error);
            }
        }

        return contact;
    }

    /**
     * Parse Apple vCard 3.0 property line
     * @param {string} line - Apple property line
     * @returns {Object} Parsed property data
     */
    parseAppleLine(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`Invalid Apple property line: ${line}`);
        }

        const propertyPart = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);

        const semicolonIndex = propertyPart.indexOf(';');
        let property, parametersString;

        if (semicolonIndex === -1) {
            property = propertyPart;
            parametersString = '';
        } else {
            property = propertyPart.substring(0, semicolonIndex);
            parametersString = propertyPart.substring(semicolonIndex + 1);
        }

        const parameters = this.parseAppleParameters(parametersString);

        return {
            property: property.toUpperCase(),
            parameters,
            value: this.unescapeValue(value)
        };
    }

    /**
     * Parse Apple vCard 3.0 parameters (lowercase 'type')
     * @param {string} parametersString - Apple parameter string
     * @returns {Object} Parameters object
     */
    parseAppleParameters(parametersString) {
        const parameters = {};
        
        if (!parametersString) {
            return parameters;
        }

        const params = parametersString.split(';');
        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex).toLowerCase(); // Keep lowercase for Apple
                const value = param.substring(equalIndex + 1);
                
                // Convert to standard format
                if (key === 'type') {
                    parameters['TYPE'] = value.toUpperCase();
                } else if (key === 'pref') {
                    parameters['PREF'] = value;
                } else {
                    parameters[key.toUpperCase()] = value;
                }
            }
        }

        return parameters;
    }

    /**
     * Convert Apple vCard 3.0 to standard vCard 4.0
     * @param {Object} appleContact - Parsed Apple contact
     * @returns {string} vCard 4.0 string
     */
    convertAppleToStandard(appleContact) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:4.0\n';

        // Full Name
        const fn = appleContact.properties.get('FN');
        if (fn) {
            vcard += `FN:${this.escapeValue(fn)}\n`;
        }

        // Structured Name (N)
        const n = appleContact.properties.get('N');
        if (n) {
            vcard += `N:${this.escapeValue(n)}\n`;
        }

        // Phone numbers
        const phones = appleContact.properties.get('TEL') || [];
        phones.forEach(phone => {
            const type = this.convertApplePhoneType(phone.parameters?.TYPE);
            const pref = phone.parameters?.PREF ? ';PREF=1' : '';
            vcard += `TEL;TYPE=${type}${pref}:${this.escapeValue(phone.value)}\n`;
        });

        // Email addresses
        const emails = appleContact.properties.get('EMAIL') || [];
        emails.forEach(email => {
            const type = this.convertAppleEmailType(email.parameters?.TYPE);
            const pref = email.parameters?.PREF ? ';PREF=1' : '';
            vcard += `EMAIL;TYPE=${type}${pref}:${this.escapeValue(email.value)}\n`;
        });

        // URLs with Apple type conversion
        const urls = appleContact.properties.get('URL') || [];
        urls.forEach(url => {
            const type = this.convertAppleUrlType(url.parameters?.TYPE);
            const pref = url.parameters?.PREF ? ';PREF=1' : '';
            vcard += `URL;TYPE=${type}${pref}:${this.escapeValue(url.value)}\n`;
        });

        // Address (ADR)
        const addresses = appleContact.properties.get('ADR') || [];
        addresses.forEach(addr => {
            vcard += `ADR:${this.escapeValue(addr.value || addr)}\n`;
        });

        // Organization
        const org = appleContact.properties.get('ORG');
        if (org) {
            vcard += `ORG:${this.escapeValue(org)}\n`;
        }

        // Title
        const title = appleContact.properties.get('TITLE');
        if (title) {
            vcard += `TITLE:${this.escapeValue(title)}\n`;
        }

        // Notes
        const notes = appleContact.properties.get('NOTE') || [];
        if (Array.isArray(notes)) {
            notes.forEach(note => {
                vcard += `NOTE:${this.escapeValue(note.value || note)}\n`;
            });
        } else if (notes) {
            vcard += `NOTE:${this.escapeValue(notes)}\n`;
        }

        // Add revision timestamp
        vcard += `REV:${new Date().toISOString()}\n`;

        vcard += 'END:VCARD';
        return vcard;
    }

    /**
     * Convert standard vCard 4.0 to Apple vCard 3.0
     * @param {Object} displayData - Standard contact display data
     * @returns {string} Apple vCard 3.0 string
     */
    convertStandardToApple(displayData) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:3.0\n';

        // Full Name
        if (displayData.fullName) {
            vcard += `FN:${this.escapeValue(displayData.fullName)}\n`;
            
            // Create structured name (N) from full name if not present
            const nameParts = displayData.fullName.split(' ');
            const lastName = nameParts.pop() || '';
            const firstName = nameParts.join(' ') || '';
            vcard += `N:${lastName};${firstName};;;\n`;
        }

        // Phone numbers with Apple formatting
        if (displayData.phones && displayData.phones.length > 0) {
            displayData.phones.forEach(phone => {
                const appleType = this.convertToApplePhoneType(phone.type);
                const pref = phone.primary ? ';pref' : '';
                vcard += `TEL;type=${appleType}${pref}:${this.escapeValue(phone.value)}\n`;
            });
        }

        // Email addresses with Apple formatting
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach(email => {
                const appleType = this.convertToAppleEmailType(email.type);
                const pref = email.primary ? ';pref' : '';
                vcard += `EMAIL;type=${appleType}${pref}:${this.escapeValue(email.value)}\n`;
            });
        }

        // URLs with Apple type handling
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach(url => {
                const appleType = this.convertToAppleUrlType(url.type);
                const pref = url.primary ? ';pref' : '';
                vcard += `URL;type=${appleType}${pref}:${this.escapeValue(url.value)}\n`;
            });
        }

        // Addresses with Apple formatting
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach(address => {
                const appleType = this.convertToAppleAddressType(address.type);
                const pref = address.primary ? ';pref' : '';
                const adrValue = this.formatAddressValue(address);
                vcard += `ADR;type=${appleType}${pref}:${adrValue}\n`;
            });
        } else {
            // Default empty address for Apple compatibility
            vcard += 'ADR:;;;;;;;\n';
        }

        // Organization
        if (displayData.organization) {
            vcard += `ORG:${this.escapeValue(displayData.organization)}\n`;
        }

        // Title
        if (displayData.title) {
            vcard += `TITLE:${this.escapeValue(displayData.title)}\n`;
        }

        // Notes
        if (displayData.notes && displayData.notes.length > 0) {
            displayData.notes.forEach(note => {
                vcard += `NOTE:${this.escapeValue(note)}\n`;
            });
        }

        vcard += 'END:VCARD';
        return vcard;
    }

    /**
     * Convert Apple phone type to standard
     * @param {string} appleType - Apple phone type
     * @returns {string} Standard phone type
     */
    convertApplePhoneType(appleType) {
        if (!appleType) return 'other';
        
        const type = appleType.toLowerCase();
        switch (type) {
            case 'work': return 'work';
            case 'home': return 'home';
            case 'mobile': return 'cell';
            case 'cell': return 'cell';
            default: return 'other';
        }
    }

    /**
     * Convert standard phone type to Apple
     * @param {string} standardType - Standard phone type
     * @returns {string} Apple phone type
     */
    convertToApplePhoneType(standardType) {
        if (!standardType) return 'WORK';
        
        const type = standardType.toLowerCase();
        switch (type) {
            case 'work': return 'WORK';
            case 'home': return 'HOME';
            case 'cell': return 'MOBILE';
            case 'mobile': return 'MOBILE';
            default: return 'WORK';
        }
    }

    /**
     * Convert Apple email type to standard
     * @param {string} appleType - Apple email type
     * @returns {string} Standard email type
     */
    convertAppleEmailType(appleType) {
        if (!appleType) return 'other';
        
        const type = appleType.toLowerCase();
        switch (type) {
            case 'work': return 'work';
            case 'home': return 'home';
            default: return 'other';
        }
    }

    /**
     * Convert standard email type to Apple
     * @param {string} standardType - Standard email type
     * @returns {string} Apple email type
     */
    convertToAppleEmailType(standardType) {
        if (!standardType) return 'HOME';
        
        const type = standardType.toLowerCase();
        switch (type) {
            case 'work': return 'WORK';
            case 'home': return 'HOME';
            default: return 'HOME';
        }
    }

    /**
     * Convert Apple URL type to standard
     * @param {string} appleType - Apple URL type (PERSONAL, SOCIAL, OTHER, etc.)
     * @returns {string} Standard URL type
     */
    convertAppleUrlType(appleType) {
        if (!appleType) return 'other';
        
        const type = appleType.toLowerCase();
        switch (type) {
            case 'work': return 'work';
            case 'home': return 'home';
            case 'personal': return 'home';
            case 'social': return 'other';
            case 'other': return 'other';
            default: return 'other';
        }
    }

    /**
     * Convert standard URL type to Apple
     * @param {string} standardType - Standard URL type
     * @returns {string} Apple URL type
     */
    convertToAppleUrlType(standardType) {
        if (!standardType) return 'OTHER';
        
        const type = standardType.toLowerCase();
        switch (type) {
            case 'work': return 'WORK';
            case 'home': return 'PERSONAL';
            case 'other': return 'OTHER';
            default: return 'OTHER';
        }
    }

    /**
     * Convert standard address type to Apple
     * @param {string} standardType - Standard address type
     * @returns {string} Apple address type
     */
    convertToAppleAddressType(standardType) {
        if (!standardType) return 'HOME';
        
        const type = standardType.toLowerCase();
        switch (type) {
            case 'work': return 'WORK';
            case 'home': return 'HOME';
            case 'other': return 'OTHER';
            default: return 'HOME';
        }
    }

    /**
     * Detect if vCard is Apple/iCloud format
     * @param {string} vCardString - vCard string
     * @returns {boolean} True if Apple format
     */
    isAppleVCard(vCardString) {
        return vCardString.includes('VERSION:3.0') && 
               (vCardString.includes('type=') || 
                vCardString.includes('TYPE=PERSONAL') ||
                vCardString.includes('TYPE=SOCIAL'));
    }
}