/**
 * VCard3Processor - Specialized processor for vCard 3.0 format (Apple/legacy compatibility)
 * 
 * This class handles the complexities of vCard 3.0 format, which is commonly used by:
 * - Apple/iCloud Contacts
 * - Legacy contact management systems
 * - Older mobile devices
 * 
 * Key Features:
 * - ITEM prefix handling (Apple-specific)
 * - Legacy type parameter formats
 * - Photo encoding compatibility
 * - Proper escaping and unescaping
 * - Apple-specific field mappings
 */

export class VCard3Processor {
    constructor(config) {
        this.config = config;
        this.version = '3.0';
        
        // vCard 3.0 specific patterns
        this.patterns = {
            itemPrefix: /^ITEM\d+\./i,
            unfoldContinuation: /^[\s\t]/,
            photoEncoding: /PHOTO;ENCODING=/i,
            base64Data: /^[A-Za-z0-9+/=]{500,}$/,
            applePref: /type=.*pref|pref/i
        };
        
        // Apple/legacy type mappings
        this.typeMappings = {
            phone: {
                'MOBILE': 'cell',
                'MAIN': 'work',
                'HOME': 'home',
                'WORK': 'work',
                'OTHER': 'other',
                'FAX': 'fax',
                'CELL': 'cell',
                'VOICE': 'voice'  // Added VOICE mapping
            },
            email: {
                'WORK': 'work',
                'HOME': 'home',
                'OTHER': 'other',
                'INTERNET': 'internet'
                // Note: PREF is a parameter, not a type
            },
            url: {
                'WORK': 'work',
                'HOME': 'home',
                'PERSONAL': 'personal',  // Fixed: personal should map to personal, not home
                'SOCIAL': 'social',      // Map social to social instead of other
                'BLOG': 'blog',          // Add blog type mapping
                'OTHER': 'other'
            },
            address: {
                'WORK': 'work',
                'HOME': 'home',
                'OTHER': 'other'
            }
        };
        
        // Custom reverse mappings to ensure proper export type mapping
        this.reverseTypeMappings = this.createCustomReverseMappings();
    }

    /**
     * Import vCard 3.0 content and convert to internal format
     * @param {string} vCardString - Raw vCard 3.0 content
     * @param {string} cardName - Optional card name override
     * @param {boolean} markAsImported - Whether to mark as imported
     * @returns {Object} Processed contact object
     */
    import(vCardString, cardName = null, markAsImported = true) {
        console.log('🍎 Processing vCard 3.0 (Apple/Legacy format)...');
        
        try {
            // Filter out problematic content
            const cleanedVCard = this.preprocessVCard3(vCardString);
            
            // Parse the vCard 3.0 content
            const parsedContact = this.parseVCard3(cleanedVCard);
            
            // Convert to internal display format
            const displayData = this.convertToDisplayData(parsedContact);
            
            // Generate vCard 4.0 for internal storage
            const vCard40String = this.convertTo40Format(displayData);
            
            // Create contact object
            const contact = this.createContactObject(displayData, vCard40String, cardName, markAsImported);
            
            console.log('✅ Successfully imported vCard 3.0');
            return contact;
            
        } catch (error) {
            console.error('❌ vCard 3.0 import failed:', error);
            throw new Error(`vCard 3.0 import failed: ${error.message}`);
        }
    }

    /**
     * Export contact to vCard 3.0 format
     * @param {Object} contact - Contact object to export
     * @returns {Object} Export result with content and metadata
     */
    export(contact) {
        console.log('📤 Exporting to vCard 3.0 (Apple/Legacy format)...');
        
        try {
            // Extract display data from contact
            const displayData = this.extractDisplayData(contact);
            
            // Generate vCard 3.0 content
            const vCard30Content = this.generateVCard3(displayData);
            
            // Create export result
            const filename = `${this.sanitizeFilename(displayData.fullName)}_apple.vcf`;
            
            return {
                filename,
                content: vCard30Content,
                mimeType: 'text/vcard;charset=utf-8',
                format: 'vcard-3.0',
                description: 'Apple/iCloud compatible vCard 3.0'
            };
            
        } catch (error) {
            console.error('❌ vCard 3.0 export failed:', error);
            throw new Error(`vCard 3.0 export failed: ${error.message}`);
        }
    }

    /**
     * Validate vCard 3.0 content
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
            if (!vCardString.includes('VERSION:3.0')) {
                warnings.push('VERSION:3.0 not found, assuming legacy format');
            }

            // Parse and validate content
            const parsed = this.parseVCard3(vCardString);
            
            // Check for required properties
            if (!parsed.properties.has('FN')) {
                errors.push('Missing required FN (Full Name) property');
            }

            // Check for Apple-specific patterns
            if (this.patterns.itemPrefix.test(vCardString)) {
                warnings.push('Apple ITEM prefixes detected - may need special handling');
            }

            return {
                isValid: errors.length === 0,
                version: '3.0',
                errors,
                warnings,
                format: 'vcard-3.0'
            };

        } catch (error) {
            return {
                isValid: false,
                version: '3.0',
                errors: [`Parse error: ${error.message}`],
                warnings,
                format: 'vcard-3.0'
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Preprocess vCard 3.0 content to handle common issues
     * @param {string} vCardString - Raw vCard content
     * @returns {string} Cleaned vCard content
     */
    preprocessVCard3(vCardString) {
        let cleaned = vCardString;
        
        // Remove problematic photo data
        cleaned = this.filterPhotoData(cleaned);
        
        // Normalize line endings
        cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // Remove empty lines
        cleaned = cleaned.replace(/\n\s*\n/g, '\n');
        
        return cleaned;
    }

    /**
     * Parse vCard 3.0 content into structured data
     * @param {string} vCardString - Cleaned vCard content
     * @returns {Object} Parsed contact data
     */
    parseVCard3(vCardString) {
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
                const parsed = this.parseLine3(line);
                this.addPropertyToContact(contact, parsed);
            } catch (error) {
                console.warn(`Failed to parse vCard 3.0 line: "${line}"`, error);
            }
        }

        return contact;
    }

    /**
     * Parse individual vCard 3.0 line
     * @param {string} line - vCard line to parse
     * @returns {Object} Parsed line data
     */
    parseLine3(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            throw new Error(`Invalid vCard 3.0 line: ${line}`);
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

        // Handle Apple ITEM prefixes
        let cleanProperty = property.toUpperCase();
        if (this.patterns.itemPrefix.test(cleanProperty)) {
            cleanProperty = cleanProperty.replace(this.patterns.itemPrefix, '');
        }

        const parameters = this.parseParameters3(parametersString);

        return {
            property: cleanProperty,
            parameters,
            value: this.unescapeValue(value),
            originalProperty: property
        };
    }

    /**
     * Parse vCard 3.0 parameters (handles lowercase type=)
     * @param {string} parametersString - Parameter string
     * @returns {Object} Parsed parameters
     */
    parseParameters3(parametersString) {
        const parameters = {};
        if (!parametersString) return parameters;

        const params = parametersString.split(';');
        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex);
                const value = param.substring(equalIndex + 1);
                
                // Handle vCard 3.0 specific parameter formats
                if (key.toLowerCase() === 'type') {
                    parameters['TYPE'] = value.toUpperCase();
                } else if (key.toLowerCase() === 'pref') {
                    parameters['PREF'] = value;
                } else if (key.toLowerCase() === 'encoding') {
                    parameters['ENCODING'] = value.toUpperCase();
                } else if (key.toLowerCase() === 'charset') {
                    // Filter out CHARSET parameter as it's a parsing hint, not contact data
                    continue; // Skip adding CHARSET to parameters
                } else {
                    parameters[key.toUpperCase()] = value;
                }
            } else {
                // Handle standalone parameters (like 'pref')
                if (param.toLowerCase() === 'pref') {
                    parameters['PREF'] = '1';
                } else {
                    parameters[param.toUpperCase()] = '';
                }
            }
        }

        return parameters;
    }

    /**
     * Add property to contact object
     * @param {Object} contact - Contact object
     * @param {Object} parsed - Parsed property data
     */
    addPropertyToContact(contact, parsed) {
        const { property, parameters, value } = parsed;
        
        if (!contact.properties.has(property)) {
            contact.properties.set(property, []);
        }

        const propertyValue = { value, parameters };
        const singleValueProps = ['FN', 'N', 'ORG', 'TITLE', 'BDAY'];
        
        if (singleValueProps.includes(property)) {
            contact.properties.set(property, value);
        } else {
            contact.properties.get(property).push(propertyValue);
        }

        // Store raw property for debugging
        if (!contact.rawProperties.has(property)) {
            contact.rawProperties.set(property, []);
        }
        contact.rawProperties.get(property).push(`${property}:${value}`);
    }

    /**
     * Convert parsed vCard 3.0 to display data format
     * @param {Object} parsedContact - Parsed vCard 3.0 data
     * @returns {Object} Display data format
     */
    convertToDisplayData(parsedContact) {
        console.log('🔍 VCard3Processor.convertToDisplayData - Parsing phones...');
        const phones = this.convertMultiValueProperty(parsedContact, 'TEL', 'phone');
        console.log('📞 Converted phones:', phones);
        
        const addresses = this.convertMultiValueProperty(parsedContact, 'ADR', 'address');
        console.log('🏠 Converted addresses:', addresses);
        
        const birthday = parsedContact.properties.get('BDAY') || '';
        console.log('🎂 Raw birthday from vCard:', birthday);
        
        // Convert birthday format if needed (YYYYMMDD → YYYY-MM-DD)
        let formattedBirthday = birthday;
        if (birthday && birthday.match(/^\d{8}$/)) {
            // Convert YYYYMMDD to YYYY-MM-DD
            formattedBirthday = `${birthday.substring(0, 4)}-${birthday.substring(4, 6)}-${birthday.substring(6, 8)}`;
            console.log('🎂 Converted birthday format:', formattedBirthday);
        }
        
        return {
            fullName: parsedContact.properties.get('FN') || 'Unnamed Contact',
            structuredName: this.normalizeStructuredName(parsedContact.properties.get('N')),
            organization: this.normalizeOrganizationValue(parsedContact.properties.get('ORG')),
            title: parsedContact.properties.get('TITLE') || '',
            phones,
            emails: this.convertMultiValueProperty(parsedContact, 'EMAIL', 'email'),
            urls: this.convertMultiValueProperty(parsedContact, 'URL', 'url'),
            addresses,
            notes: this.convertNotesProperty(parsedContact),
            birthday: formattedBirthday
        };
    }

    /**
     * Convert multi-value property from vCard 3.0 to display format
     * @param {Object} parsedContact - Parsed contact
     * @param {string} property - Property name
     * @param {string} propertyType - Property type for mapping
     * @returns {Array} Converted property values
     */
    convertMultiValueProperty(parsedContact, property, propertyType) {
        const values = parsedContact.properties.get(property) || [];
        if (!Array.isArray(values)) return [];

        console.log(`🔍 Converting ${property} values:`, values);

        return values.map((value, index) => {
            const originalType = value.parameters?.TYPE;
            const convertedType = this.convertType(originalType, propertyType);
            
            console.log(`📋 ${property}[${index}]: "${originalType || 'undefined'}" → "${convertedType}"`);
            
            // Extra debug for URL issues
            if (property === 'URL' && !originalType) {
                console.log(`⚠️ URL missing TYPE parameter - defaulting to 'other':`, value);
            }
            const baseObj = {
                type: convertedType,
                primary: this.isPrimary(value.parameters)
            };

            if (property === 'ADR') {
                const parsedAddr = this.parseAddressValue(value.value);
                console.log(`🏠 Parsed address:`, parsedAddr);
                return { ...parsedAddr, ...baseObj };
            } else {
                return { value: value.value, ...baseObj };
            }
        });
    }

    /**
     * Convert vCard 3.0 type to standard type
     * @param {string} originalType - Original type value
     * @param {string} propertyType - Property category
     * @returns {string} Converted type
     */
    convertType(originalType, propertyType) {
        if (!originalType) return 'other';
        
        const mapping = this.typeMappings[propertyType];
        if (!mapping) return 'other';
        
        const upperType = originalType.toUpperCase();
        
        // Handle compound types like "WORK,VOICE" or "CELL,VOICE" by checking individual components
        if (upperType.includes(',')) {
            const types = upperType.split(',').map(t => t.trim());
            
            // Priority order based on property type
            let priorityOrder;
            if (propertyType === 'phone') {
                // For phones: specific types first, then generic
                priorityOrder = ['WORK', 'HOME', 'CELL', 'MOBILE', 'FAX', 'MAIN', 'OTHER', 'VOICE'];
            } else if (propertyType === 'email') {
                // For emails: specific types first, then INTERNET
                priorityOrder = ['WORK', 'HOME', 'OTHER', 'INTERNET'];
            } else {
                // Default priority
                priorityOrder = ['WORK', 'HOME', 'OTHER'];
            }
            
            for (const priority of priorityOrder) {
                if (types.includes(priority) && mapping[priority]) {
                    return mapping[priority];
                }
            }
        }
        
        return mapping[upperType] || 'other';
    }

    /**
     * Check if property is marked as primary in vCard 3.0
     * @param {Object} parameters - Property parameters
     * @returns {boolean} Is primary
     */
    isPrimary(parameters) {
        if (!parameters) return false;
        
        // Check for explicit PREF parameter
        if (parameters.PREF) return true;
        
        // Check for 'pref' in TYPE parameter
        const type = parameters.TYPE;
        return type && this.patterns.applePref.test(type);
    }

    /**
     * Generate vCard 3.0 content from display data
     * @param {Object} displayData - Display data format
     * @returns {string} vCard 3.0 content
     */
    generateVCard3(displayData) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:3.0\n';

        // Full Name (required)
        if (displayData.fullName) {
            vcard += `FN:${this.escapeValue(displayData.fullName)}\n`;
            
            // Generate structured name
            const nameParts = displayData.fullName.split(' ');
            const lastName = nameParts.pop() || '';
            const firstName = nameParts.join(' ') || '';
            vcard += `N:${this.escapeValue(lastName)};${this.escapeValue(firstName)};;;\n`;
        }

        // Multi-value properties with vCard 3.0 formatting
        vcard += this.generateMultiValueProperties3(displayData);

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

        vcard += 'END:VCARD';
        return vcard;
    }

    /**
     * Generate multi-value properties in vCard 3.0 format (iCloud-compatible)
     * @param {Object} displayData - Display data
     * @returns {string} vCard 3.0 formatted properties
     */
    generateMultiValueProperties3(displayData) {
        let output = '';
        let itemCounter = 1;

        // Phone numbers (with VOICE type as iCloud expects)
        if (displayData.phones && displayData.phones.length > 0) {
            displayData.phones.forEach(phone => {
                const type = this.convertToVCard3Type(phone.type, 'phone');
                const prefType = phone.primary ? ';TYPE=pref' : '';
                // iCloud always adds VOICE to phone numbers
                output += `TEL;TYPE=${type}${prefType};TYPE=VOICE:${this.escapeValue(phone.value)}\n`;
            });
        }

        // Email addresses (with INTERNET type as iCloud expects)
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach(email => {
                const type = this.convertToVCard3Type(email.type, 'email');
                const prefType = email.primary ? ';TYPE=pref' : '';
                // iCloud always adds INTERNET to email addresses
                output += `EMAIL;TYPE=${type}${prefType};TYPE=INTERNET:${this.escapeValue(email.value)}\n`;
            });
        }

        // URLs (using ITEM format for non-standard types like iCloud)
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach(url => {
                const type = this.convertToVCard3Type(url.type, 'url');
                const prefType = url.primary ? ';TYPE=pref' : '';
                
                // Use standard format for WORK, HOME, OTHER
                if (['WORK', 'HOME', 'OTHER'].includes(type)) {
                    output += `URL;TYPE=${type}${prefType}:${this.escapeValue(url.value)}\n`;
                } else {
                    // Use ITEM format for PERSONAL, BLOG, etc. (like iCloud does)
                    output += `item${itemCounter}.URL:${this.escapeValue(url.value)}\n`;
                    output += `item${itemCounter}.X-ABLABEL:${type}\n`;
                    itemCounter++;
                }
            });
        }

        // Addresses
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach(address => {
                const type = this.convertToVCard3Type(address.type, 'address');
                const prefType = address.primary ? ';TYPE=pref' : '';
                const adrValue = this.formatAddressValue(address);
                output += `ADR;TYPE=${type}${prefType}:${adrValue}\n`;
            });
        }

        return output;
    }

    /**
     * Convert standard type to vCard 3.0 type
     * @param {string} standardType - Standard type value
     * @param {string} propertyType - Property category
     * @returns {string} vCard 3.0 type
     */
    convertToVCard3Type(standardType, propertyType) {
        const reverseMapping = this.reverseTypeMappings[propertyType];
        if (!reverseMapping) return 'OTHER';
        
        return reverseMapping[standardType] || 'OTHER';
    }

    // ========== UTILITY METHODS ==========

    /**
     * Create custom reverse type mappings for export with proper URL type handling
     * @returns {Object} Reverse mappings
     */
    createCustomReverseMappings() {
        const reverse = {};
        
        Object.keys(this.typeMappings).forEach(propertyType => {
            reverse[propertyType] = {};
            Object.entries(this.typeMappings[propertyType]).forEach(([vcard3Type, standardType]) => {
                reverse[propertyType][standardType] = vcard3Type;
            });
        });
        
        // Custom mappings to ensure correct type export
        reverse.url = {
            'work': 'WORK',
            'home': 'HOME',           // Ensure home maps to HOME, not PERSONAL
            'personal': 'PERSONAL',   // Keep personal as PERSONAL
            'blog': 'BLOG',           // iCloud supports BLOG as default type
            'social': 'OTHER',        // Map social to OTHER (not available in UI, but handle imports)
            'other': 'OTHER'
        };
        
        reverse.phone = {
            'work': 'WORK',
            'home': 'HOME', 
            'cell': 'CELL',           // Prefer CELL over MOBILE for mobile phones
            'mobile': 'CELL',         // mobile also maps to CELL
            'fax': 'FAX',
            'voice': 'VOICE',
            'other': 'OTHER'
        };
        
        return reverse;
    }

    /**
     * Create reverse type mappings for export (legacy method)
     * @returns {Object} Reverse mappings
     */
    createReverseMappings() {
        const reverse = {};
        
        Object.keys(this.typeMappings).forEach(propertyType => {
            reverse[propertyType] = {};
            Object.entries(this.typeMappings[propertyType]).forEach(([vcard3Type, standardType]) => {
                reverse[propertyType][standardType] = vcard3Type;
            });
        });
        
        return reverse;
    }

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
     * Filter out photo data to avoid size issues
     * @param {string} vCardString - vCard content
     * @returns {string} Filtered content
     */
    filterPhotoData(vCardString) {
        const lines = this.unfoldLines(vCardString);
        const filteredLines = [];
        let skipPhoto = false;

        for (const line of lines) {
            if (this.patterns.photoEncoding.test(line) || line.startsWith('PHOTO:')) {
                skipPhoto = true;
                continue;
            }
            
            if (skipPhoto && this.patterns.unfoldContinuation.test(line)) {
                continue;
            }
            
            if (skipPhoto && !this.patterns.unfoldContinuation.test(line)) {
                skipPhoto = false;
            }
            
            if (!skipPhoto) {
                filteredLines.push(line);
            }
        }

        return filteredLines.join('\n');
    }

    /**
     * Extract display data from contact object
     * @param {Object} contact - Contact object
     * @returns {Object} Display data
     */
    extractDisplayData(contact) {
        // If the contact has direct display properties (from form data), use them
        if (contact.fullName || contact.phones || contact.emails) {
            const baseData = {
                fullName: contact.fullName || contact.cardName || 'Unnamed Contact',
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

            return baseData;
        }

        // If the contact has a vCard string, parse it to extract display data
        if (contact.vcard) {
            console.log('🔍 VCard3Processor: Extracting display data from vCard string...');
            const parsedContact = this.parseVCard3(contact.vcard);
            const displayData = this.convertToDisplayData(parsedContact);
            
            // Preserve itemId if available
            if (contact.itemId) {
                displayData.itemId = contact.itemId;
            }
            
            return displayData;
        }

        // Fallback: create minimal display data
        console.warn('⚠️ VCard3Processor: Contact has neither display properties nor vCard string, using fallback');
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
            itemId: contact.itemId
        };
    }

    /**
     * Parse contact vCard for display data
     * @param {Object} contact - Contact with vcard property
     * @returns {Object} Display data
     */
    parseContactVCard(contact) {
        // This would typically use the parent VCardStandard's extractDisplayData
        // For now, return basic structure
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
            birthday: ''
        };
    }

    /**
     * Create contact object from processed data
     * @param {Object} displayData - Display data
     * @param {string} vCard40String - vCard 4.0 content
     * @param {string} cardName - Card name
     * @param {boolean} markAsImported - Mark as imported
     * @returns {Object} Contact object
     */
    createContactObject(displayData, vCard40String, cardName, markAsImported) {
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: [],
            importSource: 'vcard_3.0_apple'
        };

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
     * Convert display data to vCard 4.0 format
     * @param {Object} displayData - Display data
     * @returns {string} vCard 4.0 content
     */
    convertTo40Format(displayData) {
        // Generate comprehensive vCard 4.0 from display data
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:4.0\n';
        
        // Required field
        if (displayData.fullName) {
            vcard += `FN:${this.escapeValue(displayData.fullName)}\n`;
        }
        
        // Structured name (already structured, don't escape)
        if (displayData.structuredName) {
            vcard += `N:${displayData.structuredName}\n`;
        }
        
        // Organization (already structured, don't escape)
        if (displayData.organization) {
            vcard += `ORG:${displayData.organization}\n`;
        }
        
        // Title
        if (displayData.title) {
            vcard += `TITLE:${this.escapeValue(displayData.title)}\n`;
        }
        
        // Phone numbers
        if (displayData.phones && displayData.phones.length > 0) {
            displayData.phones.forEach((phone, index) => {
                const type = phone.type || 'voice';
                const pref = (index === 0 || phone.primary) ? ';PREF=1' : '';
                vcard += `TEL;TYPE=${type}${pref}:${this.escapeValue(phone.value)}\n`;
            });
        }
        
        // Email addresses
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach((email, index) => {
                const type = email.type || 'internet';
                const pref = (index === 0 || email.primary) ? ';PREF=1' : '';
                vcard += `EMAIL;TYPE=${type}${pref}:${this.escapeValue(email.value)}\n`;
            });
        }
        
        // URLs
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach((url, index) => {
                const type = url.type || 'work';
                const pref = (index === 0 || url.primary) ? ';PREF=1' : '';
                vcard += `URL;TYPE=${type}${pref}:${this.escapeValue(url.value)}\n`;
            });
        }
        
        // Addresses
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach((addr, index) => {
                const type = addr.type || 'home';
                const pref = (index === 0 || addr.primary) ? ';PREF=1' : '';
                // Use correct field names from parseAddressValue
                const addrValue = `${addr.poBox || ''};${addr.extended || ''};${addr.street || ''};${addr.city || ''};${addr.state || ''};${addr.postalCode || ''};${addr.country || ''}`;
                vcard += `ADR;TYPE=${type}${pref}:${addrValue}\n`;
            });
        }
        
        // Birthday
        if (displayData.birthday) {
            vcard += `BDAY:${displayData.birthday}\n`;
        }
        
        // Notes
        if (displayData.notes && displayData.notes.length > 0) {
            displayData.notes.forEach(note => {
                if (note && note.trim()) {
                    vcard += `NOTE:${this.escapeValue(note)}\n`;
                }
            });
        }
        
        vcard += 'END:VCARD';
        return vcard;
    }

    // Helper methods for data processing
    normalizeStructuredName(nValue) {
        if (!nValue || typeof nValue !== 'string') return '';
        return nValue;
    }

    normalizeOrganizationValue(orgValue) {
        if (!orgValue || typeof orgValue !== 'string') return '';
        return orgValue;
    }

    convertNotesProperty(parsedContact) {
        const notes = parsedContact.properties.get('NOTE') || [];
        if (!Array.isArray(notes)) return typeof notes === 'string' ? [notes] : [];
        return notes.map(note => typeof note === 'string' ? note : note.value || '');
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