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
        
        // Multi-value properties (consistent with VCard4Processor architecture)
        this.multiValueProperties = new Set(['TEL', 'EMAIL', 'URL', 'ADR', 'NOTE']);
        
        // Required properties for vCard 3.0 validation
        this.requiredProperties = new Set(['FN', 'VERSION']);
        
        // Single-value properties (for backwards compatibility and clarity)
        this.singleValueProperties = new Set(['FN', 'N', 'ORG', 'TITLE', 'BDAY', 'UID', 'VERSION', 'REV']);
        
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
            
            // Generate vCard 3.0 for internal storage (keep original format)
            const vCard30String = this.generateVCard3(displayData);
            
            // Create contact object
            const contact = this.createContactObject(displayData, vCard30String, cardName, markAsImported);
            
            console.log('✅ Successfully imported vCard 3.0 (kept as vCard 3.0)');
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
     * Validate vCard 3.0 content (improved with required properties check)
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
            
            // ⭐ IMPROVED: Check all required properties using Set
            for (const requiredProp of this.requiredProperties) {
                if (!parsed.properties.has(requiredProp)) {
                    errors.push(`Missing required property: ${requiredProp}`);
                }
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
        let colonIndex = line.indexOf(':');
        
        // Handle malformed vCard where value is appended to parameter without colon
        // Example: "EMAIL;TYPE=INTERNET,WORK,email@example.com" instead of "EMAIL;TYPE=INTERNET,WORK:email@example.com"
        if (colonIndex === -1) {
            // Try to find the property and fix the format
            const semicolonIndex = line.indexOf(';');
            if (semicolonIndex !== -1) {
                // Find where the value starts (after last comma in TYPE parameter)
                const afterProperty = line.substring(semicolonIndex + 1);
                const lastCommaIndex = afterProperty.lastIndexOf(',');
                
                if (lastCommaIndex !== -1) {
                    // Reconstruct the line with proper colon
                    const propertyAndParams = line.substring(0, semicolonIndex + 1 + lastCommaIndex);
                    const value = afterProperty.substring(lastCommaIndex + 1);
                    line = propertyAndParams + ':' + value;
                    colonIndex = line.indexOf(':');
                    console.warn(`⚠️ Fixed malformed vCard line: "${line}"`);
                } else {
                    throw new Error(`Invalid vCard 3.0 line: ${line}`);
                }
            } else {
                throw new Error(`Invalid vCard 3.0 line: ${line}`);
            }
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
                    // 🐛 FIX: Concatenate multiple TYPE values instead of overwriting
                    // Example: TEL;TYPE=work;TYPE=VOICE → TYPE="WORK,VOICE"
                    if (parameters['TYPE']) {
                        parameters['TYPE'] += ',' + value.toUpperCase();
                    } else {
                        parameters['TYPE'] = value.toUpperCase();
                    }
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
     * Add property to contact object (improved architecture)
     * @param {Object} contact - Contact object
     * @param {Object} parsed - Parsed property data
     */
    addPropertyToContact(contact, parsed) {
        const { property, parameters, value } = parsed;
        
        if (!contact.properties.has(property)) {
            contact.properties.set(property, []);
        }

        const propertyValue = { value, parameters };
        
        // ⭐ IMPROVED: Use Sets for better maintainability (consistent with VCard4Processor)
        if (this.singleValueProperties.has(property)) {
            // Single value property - store as string
            contact.properties.set(property, value);
        } else if (this.multiValueProperties.has(property)) {
            // Multi-value property - store as array of objects
            contact.properties.get(property).push(propertyValue);
        } else {
            // Unknown property - default to multi-value for safety
            console.warn(`⚠️ Unknown vCard 3.0 property "${property}" - treating as multi-value`);
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
        
        console.log('📧 VCard3Processor.convertToDisplayData - Parsing emails...');
        const emails = this.convertMultiValueProperty(parsedContact, 'EMAIL', 'email');
        console.log('📧 Converted emails:', emails);
        
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
            emails,
            urls: this.convertMultiValueProperty(parsedContact, 'URL', 'url'),
            addresses,
            notes: this.convertNotesProperty(parsedContact),
            birthday: formattedBirthday,
            uid: parsedContact.properties.get('UID') || null  // ⭐ PRESERVE UID from original vCard (like VCard4Processor)
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
            console.log(`🔍 ${property}[${index}] - originalType from parameters:`, originalType);
            
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
        console.log(`🔄 convertType called: originalType="${originalType}", propertyType="${propertyType}"`);
        
        if (!originalType) return 'other';
        
        const mapping = this.typeMappings[propertyType];
        if (!mapping) {
            console.warn(`⚠️ No type mapping for propertyType: ${propertyType}`);
            return 'other';
        }
        
        const upperType = originalType.toUpperCase();
        console.log(`🔄 upperType: "${upperType}"`);
        
        // Handle compound types like "WORK,VOICE" or "CELL,VOICE" by checking individual components
        if (upperType.includes(',')) {
            const types = upperType.split(',').map(t => t.trim());
            console.log(`🔄 Compound type detected, split into:`, types);
            
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
            
            console.log(`🔄 Priority order for ${propertyType}:`, priorityOrder);
            
            for (const priority of priorityOrder) {
                console.log(`🔍 Checking priority "${priority}": types.includes=${types.includes(priority)}, mapping[priority]="${mapping[priority]}"`);
                if (types.includes(priority) && mapping[priority]) {
                    console.log(`✅ convertType result: "${priority}" → "${mapping[priority]}"`);
                    return mapping[priority];
                }
            }
            console.log(`❌ No priority match found, falling through to default`);
        }
        
        const result = mapping[upperType] || 'other';
        console.log(`✅ convertType result (direct): "${upperType}" → "${result}"`);
        return result;
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

        // Add UID if available, otherwise generate one
        // UID is REQUIRED by CardDAV servers (even for vCard 3.0)
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
                const prefParam = phone.primary ? ';PREF=1' : '';
                
                // � Sanitize phone number to E.164 international format
                const sanitizedPhone = this.sanitizePhoneNumber(phone.value);
                
                // �🐛 FIX: Only add VOICE for generic "voice" type or "other"
                // Do NOT add VOICE for specific types (WORK, HOME, CELL, etc.)
                // This prevents type corruption when re-importing from iCloud
                const needsVoice = (type === 'VOICE' || type === 'OTHER');
                const voiceType = needsVoice ? ';TYPE=VOICE' : '';
                
                output += `TEL;TYPE=${type}${voiceType}${prefParam}:${this.escapeValue(sanitizedPhone)}\n`;
            });
        }

        // Email addresses (with INTERNET type as iCloud expects)
        if (displayData.emails && displayData.emails.length > 0) {
            console.log('📧 Generating email vCard properties:', displayData.emails);
            displayData.emails.forEach(email => {
                console.log(`   Processing email: type="${email.type}", primary=${email.primary}`);
                const type = this.convertToVCard3Type(email.type, 'email');
                console.log(`   Converted to vCard type: ${type}`);
                const prefParam = email.primary ? ';PREF=1' : '';
                // iCloud always adds INTERNET to email addresses
                const vcardLine = `EMAIL;TYPE=${type};TYPE=INTERNET${prefParam}:${this.escapeValue(email.value)}`;
                console.log(`   Generated vCard line: ${vcardLine}`);
                output += vcardLine + '\n';
            });
        }

        // URLs (using ITEM format for non-standard types like iCloud)
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach(url => {
                const type = this.convertToVCard3Type(url.type, 'url');
                const prefParam = url.primary ? ';PREF=1' : '';
                
                // Use standard format for WORK, HOME, OTHER
                if (['WORK', 'HOME', 'OTHER'].includes(type)) {
                    output += `URL;TYPE=${type}${prefParam}:${this.escapeValue(url.value)}\n`;
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
                const prefParam = address.primary ? ';PREF=1' : '';
                const adrValue = this.formatAddressValue(address);
                output += `ADR;TYPE=${type}${prefParam}:${adrValue}\n`;
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
        if (!reverseMapping) {
            console.warn(`⚠️ No reverse mapping for propertyType: ${propertyType}`);
            return 'OTHER';
        }
        
        const result = reverseMapping[standardType] || 'OTHER';
        console.log(`🔄 convertToVCard3Type: ${standardType} (${propertyType}) → ${result}`);
        console.log(`   Available mappings:`, Object.keys(reverseMapping));
        
        return result;
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
        
        // 🔧 FIX: Explicit email type mappings to prevent 'work' → 'internet' bug
        reverse.email = {
            'work': 'WORK',
            'home': 'HOME',
            'other': 'OTHER',
            'internet': 'INTERNET'
        };
        
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
        const lines = vCardString.split(/\r?\n/);
        const filteredLines = [];
        let skipPhoto = false;
        
        // Pattern to detect base64 data lines (lines that look like photo continuation)
        const base64Pattern = /^[A-Za-z0-9+/=]{40,}$/;
        
        // Pattern to detect vCard property lines (start with PROPERTY: or PROPERTY;)
        const propertyPattern = /^[A-Z][A-Z0-9-]*[;:]/i;

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip empty lines
            if (!trimmedLine) {
                continue;
            }
            
            // Detect start of PHOTO property
            if (this.patterns.photoEncoding.test(trimmedLine) || 
                trimmedLine.startsWith('PHOTO:') || 
                trimmedLine.startsWith('PHOTO;')) {
                skipPhoto = true;
                console.log('📸 Detected PHOTO property start, filtering photo data...');
                continue;
            }
            
            // If we're in photo mode, check if this is the end
            if (skipPhoto) {
                // Check if this line starts a new vCard property
                if (propertyPattern.test(trimmedLine)) {
                    // This is a new property, stop skipping
                    skipPhoto = false;
                    console.log('✅ Photo filtering complete, resuming vCard parsing');
                    filteredLines.push(line);
                } else {
                    // Still in photo data, skip this line
                    // (could be continuation line with space, or raw base64)
                    continue;
                }
            } else {
                // Not in photo mode, keep the line
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
        console.log('🔍 VCard3Processor.extractDisplayData - Input contact:', {
            hasFullName: !!contact.fullName,
            hasPhones: !!contact.phones,
            hasEmails: !!contact.emails,
            hasVcard: !!contact.vcard,
            hasUid: !!contact.uid,
            uidType: typeof contact.uid,
            uidValue: contact.uid
        });
        
        // � DEBUG: Log stale cached properties if they exist
        if (contact.emails && Array.isArray(contact.emails) && contact.emails.length > 0) {
            console.log('⚠️ VCard3: Contact has cached emails property (may be stale):', JSON.stringify(contact.emails));
        }
        
        // �🔑 CRITICAL: vCard is the authoritative source of truth
        // Always parse vCard if it exists (cached properties may be stale)
        if (contact.vcard) {
            console.log('✅ VCard3: Parsing vCard (source of truth)');
            try {
                const parsedContact = this.parseVCard3(contact.vcard);
                const displayData = this.convertToDisplayData(parsedContact);
                
                // 🚨 DEBUG: Log displayData right after conversion
                console.log('🎯 VCard3: displayData from convertToDisplayData:', JSON.stringify(displayData.emails));
                
                // Preserve contact identifiers
                displayData.contactId = contact.contactId || contact.itemId;
                displayData.cardName = contact.cardName;
                
                console.log('🎯 VCard3: Final displayData.emails before return:', JSON.stringify(displayData.emails));
                
                return displayData;
            } catch (parseError) {
                console.error('❌ VCard3: Failed to parse vCard, falling back to cached properties:', parseError);
                // Fall through to cached properties as fallback
            }
        }
        
        // Fallback: If no vCard or parsing failed, use cached properties (from form data)
        if (contact.fullName || contact.phones || contact.emails) {
            console.log('⚠️ VCard3: Using cached properties (no vCard or parse failed)');
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

            // Handle UID for contacts without vCard
            if (contact.uid && typeof contact.uid === 'string') {
                baseData.uid = contact.uid;
                console.log(`🔑 VCard3: Using contact.uid (sanitized): ${contact.uid}`);
            } else if (contact.contactId) {
                baseData.uid = contact.contactId;
                console.log(`🔑 VCard3: Using contactId as UID: ${contact.contactId}`);
            }

            return baseData;
        }

        // Last fallback: Return minimal data
        console.warn('⚠️ VCard3: No vCard or cached properties - returning minimal data');
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
            contactId: contact.contactId || contact.itemId,
            cardName: contact.cardName,
            uid: contact.uid || contact.contactId
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
                // ⚠️ CRITICAL FIX: Must escape all address components to prevent \n from breaking vCard format
                console.log('🔍 VCard3Processor.convertTo40Format - Address before escaping:', {
                    street: addr.street,
                    hasNewline: addr.street && addr.street.includes('\n'),
                    streetLength: addr.street ? addr.street.length : 0
                });
                const addrValue = `${this.escapeValue(addr.poBox || '')};${this.escapeValue(addr.extended || '')};${this.escapeValue(addr.street || '')};${this.escapeValue(addr.city || '')};${this.escapeValue(addr.state || '')};${this.escapeValue(addr.postalCode || '')};${this.escapeValue(addr.country || '')}`;
                console.log('🔍 VCard3Processor.convertTo40Format - After escaping:', {
                    addrValue: addrValue,
                    hasBackslashN: addrValue.includes('\\n'),
                    hasRawNewline: addrValue.includes('\n')
                });
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

    /**
     * Sanitize phone number to E.164 international format
     * Examples:
     * - "+46701234567" (Sweden) ✓
     * - "+1-555-123-4567" (US) → "+15551234567"
     * - "0701234567" (Sweden local) → "+46701234567"
     * - "070-123 45 67" → "+46701234567"
     * 
     * @param {string} phone - Raw phone number
     * @returns {string} Sanitized E.164 format
     */
    sanitizePhoneNumber(phone) {
        if (!phone) return '';
        
        // Remove all non-digit/plus characters
        let cleaned = phone.replace(/[^\d+]/g, '');
        
        // If starts with 00, replace with +
        if (cleaned.startsWith('00')) {
            cleaned = '+' + cleaned.substring(2);
        }
        
        // If starts with 0 (local number), add default country code
        // TODO: Make country code configurable (default: +46 for Sweden)
        if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
            cleaned = '+46' + cleaned.substring(1);
        }
        
        // Ensure starts with +
        if (!cleaned.startsWith('+')) {
            cleaned = '+' + cleaned;
        }
        
        return cleaned;
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

    /**
     * Check if a property is a multi-value property
     * @param {string} property - Property name
     * @returns {boolean} True if multi-value
     */
    isMultiValueProperty(property) {
        return this.multiValueProperties.has(property);
    }

    /**
     * Check if a property is a single-value property
     * @param {string} property - Property name
     * @returns {boolean} True if single-value
     */
    isSingleValueProperty(property) {
        return this.singleValueProperties.has(property);
    }

    /**
     * Check if a property is required
     * @param {string} property - Property name
     * @returns {boolean} True if required
     */
    isRequiredProperty(property) {
        return this.requiredProperties.has(property);
    }
}