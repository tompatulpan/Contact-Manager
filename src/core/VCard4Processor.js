/**
 * VCard4Processor - Specialized processor for vCard 4.0 format (RFC 9553 standard)
 * 
 * This class handles the vCard 4.0 standard format as defined in RFC 9553, which is:
 * - The current vCard standard
 * - Used by modern contact management systems
 * - Supports advanced features like preference parameters
 * - Has proper type handling and multi-value support
 * 
 * Key Features:
 * - RFC 9553 compliance
 * - PREF parameter handling
 * - Standard type values
 * - Proper escaping/unescaping
 * - Address (ADR) property support
 * - Birthday (BDAY) validation
 */

export class VCard4Processor {
    constructor(config) {
        this.config = config;
        this.version = '4.0';
        
        // vCard 4.0 specific patterns
        this.patterns = {
            unfoldContinuation: /^[\s\t]/,
            prefParameter: /PREF=(\d+)/i,
            typeParameter: /TYPE=([^;]+)/i,
            validDate: /^\d{4}-\d{2}-\d{2}$/,
            validDateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/
        };
        
        // RFC 9553 standard type values
        this.standardTypes = {
            TEL: ['work', 'home', 'cell', 'mobile', 'fax', 'pager', 'voice', 'text'],
            EMAIL: ['work', 'home', 'internet'],
            URL: ['work', 'home'],
            ADR: ['work', 'home', 'other']
        };
        
        // Required properties per RFC 9553
        this.requiredProperties = new Set(['FN']);
        
        // Multi-value properties
        this.multiValueProperties = new Set(['TEL', 'EMAIL', 'URL', 'ADR', 'NOTE']);
    }

    /**
     * Import vCard 4.0 content and convert to internal format
     * @param {string} vCardString - Raw vCard 4.0 content
     * @param {string} cardName - Optional card name override
     * @param {boolean} markAsImported - Whether to mark as imported
     * @returns {Object} Processed contact object
     */
    import(vCardString, cardName = null, markAsImported = true) {
        console.log('📄 Processing vCard 4.0 (RFC 9553 standard)...');
        
        try {
            // Validate basic structure
            this.validateBasicStructure(vCardString);
            
            // Parse the vCard 4.0 content
            const parsedContact = this.parseVCard4(vCardString);
            
            // Validate against RFC 9553
            this.validateRFC9553Compliance(parsedContact);
            
            // Convert to internal display format
            const displayData = this.convertToDisplayData(parsedContact);
            
            // Create contact object
            const contact = this.createContactObject(displayData, vCardString, cardName, markAsImported);
            
            console.log('✅ Successfully imported vCard 4.0');
            return contact;
            
        } catch (error) {
            console.error('❌ vCard 4.0 import failed:', error);
            throw new Error(`vCard 4.0 import failed: ${error.message}`);
        }
    }

    /**
     * Export contact to vCard 4.0 format
     * @param {Object} contact - Contact object to export
     * @returns {Object} Export result with content and metadata
     */
    export(contact) {
        console.log('📤 Exporting to vCard 4.0 (RFC 9553 standard)...');
        
        try {
            // Extract display data from contact
            const displayData = this.extractDisplayData(contact);
            
            // Validate display data
            this.validateDisplayData(displayData);
            
            // Generate vCard 4.0 content
            const vCard40Content = this.generateVCard4(displayData);
            
            // Create export result
            const filename = `${this.sanitizeFilename(displayData.fullName)}.vcf`;
            
            return {
                filename,
                content: vCard40Content,
                mimeType: 'text/vcard;charset=utf-8',
                format: 'vcard-4.0',
                description: 'Standard vCard 4.0 (RFC 9553)'
            };
            
        } catch (error) {
            console.error('❌ vCard 4.0 export failed:', error);
            throw new Error(`vCard 4.0 export failed: ${error.message}`);
        }
    }

    /**
     * Validate vCard 4.0 content against RFC 9553
     * @param {string} vCardString - vCard content to validate
     * @returns {Object} Validation result
     */
    validate(vCardString) {
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

            // Version validation
            if (!vCardString.includes('VERSION:4.0')) {
                errors.push('Missing or incorrect VERSION:4.0');
            }

            // Parse and validate content
            const parsed = this.parseVCard4(vCardString);
            
            // Check required properties
            this.requiredProperties.forEach(prop => {
                if (!parsed.properties.has(prop)) {
                    errors.push(`Missing required property: ${prop}`);
                }
            });

            // Validate property formats
            this.validatePropertyFormats(parsed, errors, warnings);

            // Check for RFC 9553 compliance
            this.validateRFC9553Compliance(parsed, errors, warnings);

            return {
                isValid: errors.length === 0,
                version: '4.0',
                errors,
                warnings,
                format: 'vcard-4.0'
            };

        } catch (error) {
            return {
                isValid: false,
                version: '4.0',
                errors: [`Parse error: ${error.message}`],
                warnings,
                format: 'vcard-4.0'
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Validate basic vCard structure
     * @param {string} vCardString - vCard content
     */
    validateBasicStructure(vCardString) {
        if (!vCardString || typeof vCardString !== 'string') {
            throw new Error('Invalid vCard content: not a string');
        }
        
        if (!vCardString.includes('BEGIN:VCARD')) {
            throw new Error('Invalid vCard: missing BEGIN:VCARD');
        }
        
        if (!vCardString.includes('END:VCARD')) {
            throw new Error('Invalid vCard: missing END:VCARD');
        }
    }

    /**
     * Parse vCard 4.0 content into structured data
     * @param {string} vCardString - vCard content
     * @returns {Object} Parsed contact data
     */
    parseVCard4(vCardString) {
        const lines = this.unfoldLines(vCardString);
        const contact = {
            version: '4.0',
            properties: new Map(),
            rawProperties: new Map()
        };

        for (const line of lines) {
            if (line.startsWith('BEGIN:VCARD') || line.startsWith('END:VCARD')) {
                continue;
            }
            
            try {
                const parsed = this.parseLine4(line);
                this.addPropertyToContact(contact, parsed);
            } catch (error) {
                console.warn(`Failed to parse vCard 4.0 line: "${line}"`, error);
            }
        }

        return contact;
    }

    /**
     * Parse individual vCard 4.0 line
     * @param {string} line - vCard line to parse
     * @returns {Object} Parsed line data
     */
    parseLine4(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`Invalid vCard 4.0 line: ${line}`);
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

        const parameters = this.parseParameters4(parametersString);

        return {
            property: property.toUpperCase(),
            parameters,
            value: this.unescapeValue(value)
        };
    }

    /**
     * Parse vCard 4.0 parameters
     * @param {string} parametersString - Parameter string
     * @returns {Object} Parsed parameters
     */
    parseParameters4(parametersString) {
        const parameters = {};
        if (!parametersString) return parameters;

        const params = parametersString.split(';');
        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex).toUpperCase();
                const value = param.substring(equalIndex + 1);
                
                // Filter out CHARSET parameter as it's a parsing hint, not contact data
                if (key === 'CHARSET') {
                    continue; // Skip adding CHARSET to parameters
                }
                
                // 🐛 FIX: Concatenate multiple TYPE values (same fix as VCard3Processor)
                // vCard 4.0 can have: TEL;TYPE=home;TYPE=pref → TYPE should be "home,pref"
                if (key === 'TYPE') {
                    if (parameters['TYPE']) {
                        parameters['TYPE'] += ',' + value.toUpperCase();
                    } else {
                        parameters['TYPE'] = value.toUpperCase();
                    }
                } else {
                    // Store parameter with proper casing
                    parameters[key] = value;
                }
            }
        }

        return parameters;
    }

    /**
     * Add property to contact object with vCard 4.0 rules
     * @param {Object} contact - Contact object
     * @param {Object} parsed - Parsed property data
     */
    addPropertyToContact(contact, parsed) {
        const { property, parameters, value } = parsed;
        
        if (!contact.properties.has(property)) {
            contact.properties.set(property, []);
        }

        const propertyValue = { value, parameters };
        
        // Handle single vs multi-value properties
        if (!this.multiValueProperties.has(property)) {
            // Single value property
            contact.properties.set(property, value);
        } else {
            // Multi-value property
            contact.properties.get(property).push(propertyValue);
        }

        // Store raw property for debugging
        if (!contact.rawProperties.has(property)) {
            contact.rawProperties.set(property, []);
        }
        contact.rawProperties.get(property).push(`${property}:${value}`);
    }

    /**
     * Convert parsed vCard 4.0 to display data format
     * @param {Object} parsedContact - Parsed vCard 4.0 data
     * @returns {Object} Display data format
     */
    convertToDisplayData(parsedContact) {
        return {
            fullName: parsedContact.properties.get('FN') || 'Unnamed Contact',
            structuredName: this.normalizeStructuredName(parsedContact.properties.get('N')),
            organization: this.normalizeOrganizationValue(parsedContact.properties.get('ORG')),
            title: parsedContact.properties.get('TITLE') || '',
            phones: this.convertMultiValueProperty(parsedContact, 'TEL'),
            emails: this.convertMultiValueProperty(parsedContact, 'EMAIL'),
            urls: this.convertMultiValueProperty(parsedContact, 'URL'),
            addresses: this.convertMultiValueProperty(parsedContact, 'ADR'),
            notes: this.convertNotesProperty(parsedContact),
            birthday: this.validateAndFormatBirthday(parsedContact.properties.get('BDAY')),
            uid: parsedContact.properties.get('UID') || null  // ⭐ PRESERVE UID from original vCard
        };
    }

    /**
     * Convert multi-value property from vCard 4.0 to display format
     * @param {Object} parsedContact - Parsed contact
     * @param {string} property - Property name
     * @returns {Array} Converted property values
     */
    convertMultiValueProperty(parsedContact, property) {
        const values = parsedContact.properties.get(property) || [];
        if (!Array.isArray(values)) return [];

        return values.map((value, index) => {
            const baseObj = {
                type: this.normalizeType(value.parameters?.TYPE, property),
                primary: this.isPrimary(value.parameters, index)
            };

            if (property === 'ADR') {
                return { ...this.parseAddressValue(value.value), ...baseObj };
            } else {
                return { value: value.value, ...baseObj };
            }
        });
    }

    /**
     * Check if property is marked as primary using PREF parameter
     * @param {Object} parameters - Property parameters
     * @param {number} index - Property index
     * @returns {boolean} Is primary
     */
    isPrimary(parameters, index) {
        if (!parameters) return index === 0; // First item is primary by default
        
        // Check for PREF=1 (highest preference)
        const pref = parameters.PREF;
        if (pref) {
            return pref === '1' || pref === 1;
        }
        
        return index === 0; // Default to first item if no PREF
    }

    /**
     * Generate vCard 4.0 content from display data
     * @param {Object} displayData - Display data format
     * @returns {string} vCard 4.0 content
     */
    generateVCard4(displayData) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:4.0\n';

        // Full Name (required)
        if (displayData.fullName) {
            vcard += `FN:${this.escapeValue(displayData.fullName)}\n`;
            
            // Generate structured name if available
            if (displayData.structuredName && displayData.structuredName.trim()) {
                vcard += `N:${this.escapeValue(displayData.structuredName)}\n`;
            } else {
                // Generate from full name
                const nameParts = displayData.fullName.split(' ');
                const lastName = nameParts.pop() || '';
                const firstName = nameParts.join(' ') || '';
                vcard += `N:${this.escapeValue(lastName)};${this.escapeValue(firstName)};;;\n`;
            }
        }

        // Multi-value properties with vCard 4.0 formatting
        vcard += this.generateMultiValueProperties4(displayData);

        // Single-value properties
        if (displayData.organization) {
            vcard += `ORG:${this.escapeValue(displayData.organization)}\n`;
        }
        if (displayData.title) {
            vcard += `TITLE:${this.escapeValue(displayData.title)}\n`;
        }
        if (displayData.birthday) {
            vcard += `BDAY:${this.escapeValue(displayData.birthday)}\n`;
        }

        // Notes
        if (displayData.notes && displayData.notes.length > 0) {
            displayData.notes.forEach(note => {
                vcard += `NOTE:${this.escapeValue(note)}\n`;
            });
        }

        // Add revision timestamp
        vcard += `REV:${new Date().toISOString()}\n`;
        
        // Add UID if available, otherwise generate one
        // UID is REQUIRED by RFC 6350 (vCard 4.0) for CardDAV servers
        if (displayData.uid) {
            // FIX: Convert UID to string if it's an object (handles {value: "uuid"} format)
            const uidValue = typeof displayData.uid === 'string' 
                ? displayData.uid 
                : (displayData.uid.value || displayData.uid.toString());
            vcard += `UID:${this.escapeValue(uidValue)}\n`;
        } else {
            // Generate stable UID based on contactId or random UUID
            const uid = displayData.contactId || 
                        `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            vcard += `UID:${this.escapeValue(uid)}\n`;
        }
        
        vcard += 'END:VCARD';
        
        return vcard;
    }

    /**
     * Generate multi-value properties in vCard 4.0 format
     * @param {Object} displayData - Display data
     * @returns {string} vCard 4.0 formatted properties
     */
    generateMultiValueProperties4(displayData) {
        let output = '';

        // Phone numbers with RFC 9553 formatting
        if (displayData.phones && displayData.phones.length > 0) {
            displayData.phones.forEach((phone, index) => {
                const params = this.buildParameters4(phone.type, phone.primary || index === 0);
                output += `TEL${params}:${this.escapeValue(phone.value)}\n`;
            });
        }

        // Email addresses with RFC 9553 formatting
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach((email, index) => {
                const params = this.buildParameters4(email.type, email.primary || index === 0);
                output += `EMAIL${params}:${this.escapeValue(email.value)}\n`;
            });
        }

        // URLs with RFC 9553 formatting
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach((url, index) => {
                const params = this.buildParameters4(url.type, url.primary || index === 0);
                output += `URL${params}:${this.escapeValue(url.value)}\n`;
            });
        }

        // Addresses with RFC 9553 formatting
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach((address, index) => {
                const params = this.buildParameters4(address.type, address.primary || index === 0);
                const adrValue = this.formatAddressValue(address);
                output += `ADR${params}:${adrValue}\n`;
            });
        }

        return output;
    }

    /**
     * Build RFC 9553 compliant parameter string
     * @param {string} type - Property type
     * @param {boolean} isPrimary - Is primary value
     * @returns {string} Parameter string
     */
    buildParameters4(type, isPrimary) {
        const params = [];
        
        if (type && type !== 'other') {
            params.push(`TYPE=${type.toLowerCase()}`);
        }
        
        if (isPrimary) {
            params.push('PREF=1');
        }

        return params.length > 0 ? `;${params.join(';')}` : '';
    }

    /**
     * Validate RFC 9553 compliance
     * @param {Object} parsedContact - Parsed contact
     * @param {Array} errors - Errors array (optional)
     * @param {Array} warnings - Warnings array (optional)
     */
    validateRFC9553Compliance(parsedContact, errors = [], warnings = []) {
        // Check required properties
        this.requiredProperties.forEach(prop => {
            if (!parsedContact.properties.has(prop)) {
                errors.push(`RFC 9553 violation: Missing required property ${prop}`);
            }
        });

        // Validate property types
        this.validatePropertyTypes(parsedContact, warnings);

        // Validate PREF parameters
        this.validatePrefParameters(parsedContact, warnings);
    }

    /**
     * Validate property types against RFC 9553 standards
     * @param {Object} parsedContact - Parsed contact
     * @param {Array} warnings - Warnings array
     */
    validatePropertyTypes(parsedContact, warnings) {
        Object.entries(this.standardTypes).forEach(([property, validTypes]) => {
            const values = parsedContact.properties.get(property) || [];
            if (Array.isArray(values)) {
                values.forEach((value, index) => {
                    const type = value.parameters?.TYPE;
                    if (type && !validTypes.includes(type.toLowerCase())) {
                        warnings.push(`Non-standard ${property} type at position ${index + 1}: "${type}"`);
                    }
                });
            }
        });
    }

    /**
     * Validate PREF parameters
     * @param {Object} parsedContact - Parsed contact
     * @param {Array} warnings - Warnings array
     */
    validatePrefParameters(parsedContact, warnings) {
        ['TEL', 'EMAIL', 'URL', 'ADR'].forEach(property => {
            const values = parsedContact.properties.get(property) || [];
            if (Array.isArray(values)) {
                const prefs = values
                    .map(v => parseInt(v.parameters?.PREF))
                    .filter(p => !isNaN(p));
                
                if (prefs.length > 1) {
                    const duplicates = prefs.filter((p, i) => prefs.indexOf(p) !== i);
                    if (duplicates.length > 0) {
                        warnings.push(`Duplicate PREF values in ${property}: ${duplicates.join(', ')}`);
                    }
                }
            }
        });
    }

    /**
     * Validate property formats
     * @param {Object} parsedContact - Parsed contact
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     */
    validatePropertyFormats(parsedContact, errors, warnings) {
        // Validate birthday format
        const bday = parsedContact.properties.get('BDAY');
        if (bday && !this.patterns.validDate.test(bday) && !this.patterns.validDateTime.test(bday) && !/^\d{8}$/.test(bday)) {
            errors.push('Invalid BDAY format: must be YYYY-MM-DD, YYYYMMDD, or full datetime');
        }

        // Validate email formats
        const emails = parsedContact.properties.get('EMAIL') || [];
        if (Array.isArray(emails)) {
            emails.forEach((email, index) => {
                if (!this.isValidEmail(email.value)) {
                    errors.push(`Invalid email format at position ${index + 1}: "${email.value}"`);
                }
            });
        }

        // Validate URL formats
        const urls = parsedContact.properties.get('URL') || [];
        if (Array.isArray(urls)) {
            urls.forEach((url, index) => {
                if (!this.isValidURL(url.value)) {
                    errors.push(`Invalid URL format at position ${index + 1}: "${url.value}"`);
                }
            });
        }
    }

    /**
     * Validate display data before export
     * @param {Object} displayData - Display data to validate
     */
    validateDisplayData(displayData) {
        if (!displayData.fullName || displayData.fullName.trim() === '') {
            throw new Error('Full name (FN) is required for vCard 4.0 export');
        }
    }

    // ========== UTILITY METHODS ==========

    /**
     * Unfold vCard lines (handle line continuation)
     * @param {string} vCardString - vCard content
     * @returns {Array} Unfolded lines
     */
    unfoldLines(vCardString) {
        const lines = vCardString.split(/\r?\n/);
        const unfolded = [];
        let currentLine = '';

        for (const line of lines) {
            if (this.patterns.unfoldContinuation.test(line)) {
                currentLine += line.substring(1);
            } else {
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
     * Extract display data from contact object
     * @param {Object} contact - Contact object
     * @returns {Object} Display data
     */
    extractDisplayData(contact) {
        // If the contact has direct display properties (from form data), use them
        if (contact.fullName || contact.fn || contact.phones || contact.emails) {
            const baseData = {
                fullName: contact.fullName || contact.fn || contact.cardName || 'Unnamed Contact',
                structuredName: contact.structuredName || '',
                organization: contact.organization || '',
                title: contact.title || '',
                phones: contact.phones || [],
                emails: contact.emails || [],
                urls: contact.urls || [],
                addresses: contact.addresses || [],
                notes: contact.notes || [],
                birthday: contact.birthday || ''
            };

            // Preserve itemId if available
            if (contact.itemId) {
                baseData.itemId = contact.itemId;
            }

            // ⭐ CRITICAL: Preserve UID from original vCard when editing
            // This prevents duplicate contacts after sync/push
            if (contact.vcard) {
                const existingUID = this.extractUIDFromVCard(contact.vcard);
                if (existingUID) {
                    baseData.uid = existingUID;
                    console.log(`🔑 Preserved existing UID from vCard: ${existingUID}`);
                }
            }

            // Fallback: Use contactId if no UID found
            if (!baseData.uid && contact.contactId) {
                baseData.uid = contact.contactId;
                console.log(`🔑 Using contactId as UID: ${contact.contactId}`);
            }

            return baseData;
        }

        // If the contact has a vCard string, parse it to extract display data
        if (contact.vcard) {
            console.log('🔍 Extracting display data from vCard string...');
            const parsedContact = this.parseVCard4(contact.vcard);
            const displayData = this.convertToDisplayData(parsedContact);
            
            // Preserve itemId if available
            if (contact.itemId) {
                displayData.itemId = contact.itemId;
            }
            
            // Ensure UID is preserved
            if (!displayData.uid) {
                const uid = this.extractUIDFromVCard(contact.vcard);
                if (uid) {
                    displayData.uid = uid;
                }
            }
            
            return displayData;
        }

        // Fallback: create minimal display data
        console.warn('⚠️ Contact has neither display properties nor vCard string, using fallback');
        return {
            fullName: contact.cardName || 'Unnamed Contact',
            structuredName: '',
            organization: '',
            title: '',
            phones: [],
            emails: [],
            urls: [],
            addresses: [],
            notes: [],
            birthday: '',
            itemId: contact.itemId,
            uid: contact.contactId  // Use contactId as fallback UID
        };
    }

    /**
     * Extract UID from vCard string
     * @param {string} vCardString - vCard content
     * @returns {string|null} UID value or null
     */
    extractUIDFromVCard(vCardString) {
        if (!vCardString || typeof vCardString !== 'string') {
            return null;
        }

        const match = vCardString.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Create contact object from processed data
     * @param {Object} displayData - Display data
     * @param {string} vCardString - vCard 4.0 content
     * @param {string} cardName - Card name
     * @param {boolean} markAsImported - Mark as imported
     * @returns {Object} Contact object
     */
    createContactObject(displayData, vCardString, cardName, markAsImported) {
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: [],
            importSource: 'vcard_4.0_rfc9553'
        };

        if (markAsImported) {
            metadata.isImported = true;
        }

        const contact = {
            contactId: this.generateContactId(),
            cardName: cardName || displayData.fullName || 'vCard 4.0 Import',
            vcard: vCardString,
            metadata
        };

        // Preserve itemId if available in displayData
        if (displayData.itemId) {
            contact.itemId = displayData.itemId;
        }

        return contact;
    }

    // Data processing helper methods
    normalizeType(type, property) {
        if (!type) return 'other';
        
        // 🐛 FIX: Handle compound TYPE values (e.g., "HOME,PREF,VOICE")
        // Similar to VCard3Processor.convertType() - extract the most specific type
        if (type.includes(',')) {
            const types = type.split(',').map(t => t.trim().toUpperCase());
            const validTypes = this.standardTypes[property] || [];
            
            // Priority order for phone types (most specific first)
            const priorityOrder = ['WORK', 'HOME', 'CELL', 'MOBILE', 'FAX', 'PAGER', 'MAIN', 'OTHER', 'VOICE', 'TEXT'];
            
            // Find first type that matches priority order
            for (const priority of priorityOrder) {
                if (types.includes(priority)) {
                    const lowerPriority = priority.toLowerCase();
                    return validTypes.includes(lowerPriority) ? lowerPriority : 'other';
                }
            }
        }
        
        // Single type value - normalize as before
        const lowerType = type.toLowerCase();
        const validTypes = this.standardTypes[property] || [];
        
        return validTypes.includes(lowerType) ? lowerType : 'other';
    }

    normalizeStructuredName(nValue) {
        if (!nValue || typeof nValue !== 'string') return '';
        return nValue;
    }

    normalizeOrganizationValue(orgValue) {
        if (!orgValue || typeof orgValue !== 'string') return '';
        const parts = orgValue.split(';');
        const mainOrganization = parts[0]?.trim() || '';
        const department = parts[1]?.trim();
        
        if (department && mainOrganization) {
            return `${mainOrganization} - ${department}`;
        }
        return mainOrganization;
    }

    convertNotesProperty(parsedContact) {
        const notes = parsedContact.properties.get('NOTE') || [];
        if (!Array.isArray(notes)) return typeof notes === 'string' ? [notes] : [];
        return notes.map(note => typeof note === 'string' ? note : note.value || '');
    }

    validateAndFormatBirthday(bday) {
        if (!bday || typeof bday !== 'string') return '';
        
        // Validate ISO format YYYY-MM-DD
        if (this.patterns.validDate.test(bday)) {
            return bday;
        }
        
        // Validate datetime format and extract date part
        if (this.patterns.validDateTime.test(bday)) {
            return bday.substring(0, 10);
        }
        
        // Validate compact format YYYYMMDD and convert to YYYY-MM-DD
        if (/^\d{8}$/.test(bday)) {
            const year = bday.substring(0, 4);
            const month = bday.substring(4, 6);
            const day = bday.substring(6, 8);
            return `${year}-${month}-${day}`;
        }
        
        console.warn(`Invalid birthday format: ${bday}, ignoring`);
        return '';
    }

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

    formatAddressValue(address) {
        const parts = [
            address.poBox || '',
            address.extended || '',
            address.street || '',
            address.city || '',
            address.state || '',
            address.postalCode || '',
            address.country || ''
        ];
        return parts.map(part => this.escapeValue(part)).join(';');
    }

    isValidEmail(email) {
        if (!email || typeof email !== 'string') return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    isValidURL(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }

    escapeValue(value) {
        if (typeof value !== 'string') return String(value);
        return value
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    unescapeValue(value) {
        if (typeof value !== 'string') return String(value);
        return value
            .replace(/\\n/g, '\n')
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\\\/g, '\\');
    }

    sanitizeFilename(filename) {
        return filename.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    generateContactId() {
        return 'contact_' + this.generateUUIDv4();
    }

    generateUUIDv4() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}