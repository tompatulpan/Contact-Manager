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
            contactData.phones.forEach((phone, index) => {
                const params = this.buildParameters({
                    type: phone.type,
                    pref: index === 0 || phone.primary
                });
                vcard += `TEL${params}:${this.escapeValue(phone.value)}\n`;
            });
        }

        if (contactData.emails && contactData.emails.length > 0) {
            contactData.emails.forEach((email, index) => {
                const params = this.buildParameters({
                    type: email.type,
                    pref: index === 0 || email.primary
                });
                vcard += `EMAIL${params}:${this.escapeValue(email.value)}\n`;
            });
        }

        if (contactData.urls && contactData.urls.length > 0) {
            contactData.urls.forEach((url, index) => {
                const params = this.buildParameters({
                    type: url.type,
                    pref: index === 0 || url.primary
                });
                vcard += `URL${params}:${this.escapeValue(url.value)}\n`;
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
        
        return {
            contactId: contact.contactId,
            cardName: contact.cardName,
            fullName: vCardData.properties.get('FN') || 'Unnamed Contact',
            organization: vCardData.properties.get('ORG') || '',
            title: vCardData.properties.get('TITLE') || '',
            phones: this.extractMultiValueProperty(vCardData, 'TEL'),
            emails: this.extractMultiValueProperty(vCardData, 'EMAIL'),
            urls: this.extractMultiValueProperty(vCardData, 'URL'),
            notes: vCardData.properties.get('NOTE') || [],
            birthday: vCardData.properties.get('BDAY') || '',
            lastUpdated: contact.metadata?.lastUpdated || '',
            isOwned: contact.metadata?.isOwned || false
        };
    }

    /**
     * Extract multi-value property with type and preference information
     * @param {Object} vCardData - Parsed vCard data
     * @param {string} property - Property name (TEL, EMAIL, URL)
     * @returns {Array} Array of property objects
     */
    extractMultiValueProperty(vCardData, property) {
        const values = vCardData.properties.get(property) || [];
        if (!Array.isArray(values)) {
            return [values].map(this.normalizePropertyValue.bind(this));
        }
        return values.map(this.normalizePropertyValue.bind(this));
    }

    /**
     * Normalize property value to consistent format
     * @param {*} value - Property value
     * @returns {Object} Normalized property object
     */
    normalizePropertyValue(value) {
        if (typeof value === 'string') {
            return { value, type: 'other', primary: false };
        }
        
        return {
            value: value.value || '',
            type: value.parameters?.TYPE || 'other',
            primary: value.parameters?.PREF === '1' || value.parameters?.PREF === 1
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
     * @returns {Object} Contact object
     */
    importFromVCard(vCardString, cardName = null) {
        const validation = this.validateVCard(vCardString);
        if (!validation.isValid) {
            throw new Error(`Invalid vCard: ${validation.errors.join(', ')}`);
        }

        const displayData = this.extractDisplayData({ vcard: vCardString });
        
        return {
            contactId: this.generateContactId(),
            cardName: cardName || displayData.fullName || 'Imported Contact',
            vcard: vCardString,
            metadata: {
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                isOwned: true,
                isArchived: false,
                sharedWith: []
            }
        };
    }

    /**
     * Generate unique contact ID
     * @returns {string} UUID v4
     */
    generateContactId() {
        return 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}