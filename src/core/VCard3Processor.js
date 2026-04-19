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
        // LABEL is a valid vCard 3.0 property for formatted address labels
        this.multiValueProperties = new Set(['TEL', 'EMAIL', 'URL', 'ADR', 'LABEL', 'NOTE', 'CATEGORIES']);
        
        // Required properties for vCard 3.0 validation
        this.requiredProperties = new Set(['FN', 'VERSION']);
        
        // Single-value properties (for backwards compatibility and clarity)
        this.singleValueProperties = new Set(['FN', 'N', 'ORG', 'TITLE', 'BDAY', 'UID', 'VERSION', 'REV', 'PRODID', 'NICKNAME', 'PHOTO']);
        
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
            
            // Skip empty or whitespace-only lines
            if (!line || line.trim().length === 0) {
                continue;
            }
            
            // Skip lines that don't have a colon and don't look like vCard properties
            // Allow lines that are very short (likely fragments that will be handled by parser)
            if (!line.includes(':') && !line.includes(';')) {
                // Only warn for lines that look substantial but invalid
                if (line.trim().length > 2 && !/^[A-Z][A-Z0-9-]*$/i.test(line.trim())) {
                    console.warn(`⏭️ Skipping invalid vCard 3.0 line: "${line.substring(0, 50)}"`);
                }
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

        // Smart split: Don't split on semicolons inside quoted values
        const params = [];
        let currentParam = '';
        let inQuotes = false;
        
        for (let i = 0; i < parametersString.length; i++) {
            const char = parametersString[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
                currentParam += char;
            } else if (char === ';' && !inQuotes) {
                if (currentParam.trim()) {
                    params.push(currentParam.trim());
                }
                currentParam = '';
            } else {
                currentParam += char;
            }
        }
        
        if (currentParam.trim()) {
            params.push(currentParam.trim());
        }

        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex);
                let value = param.substring(equalIndex + 1);
                
                // Remove surrounding quotes from value if present
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                }
                
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
            // Suppress warnings for vendor extensions (X- prefix per RFC 2426)
            // and Apple/iCloud vendor properties (VND- prefix)
            if (!property.startsWith('X-') && !property.startsWith('VND-')) {
                console.warn(`⚠️ Unknown vCard 3.0 property "${property}" - treating as multi-value`);
            }
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
        const phones = this.convertMultiValueProperty(parsedContact, 'TEL', 'phone');
        
        // 🔧 Clean up vCard 4.0 tel: prefixes from phone values (RFC 6350 → RFC 2426)
        phones.forEach(phone => {
            if (phone.value && phone.value.startsWith('tel:')) {
                phone.value = phone.value.substring(4);  // Remove 'tel:' prefix
            }
        });
        
        const addresses = this.convertMultiValueProperty(parsedContact, 'ADR', 'address');
        const emails = this.convertMultiValueProperty(parsedContact, 'EMAIL', 'email');
        
        const birthday = parsedContact.properties.get('BDAY') || '';
        
        // Convert birthday format if needed (YYYYMMDD → YYYY-MM-DD)
        let formattedBirthday = birthday;
        if (birthday && birthday.match(/^\d{8}$/)) {
            // Convert YYYYMMDD to YYYY-MM-DD
            formattedBirthday = `${birthday.substring(0, 4)}-${birthday.substring(4, 6)}-${birthday.substring(6, 8)}`;
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


        return values.map((value, index) => {
            const originalType = value.parameters?.TYPE;
            const convertedType = this.convertType(originalType, propertyType);
            
            
            // Extra debug for URL issues
            if (property === 'URL' && !originalType) {
            }
            const baseObj = {
                type: convertedType,
                primary: this.isPrimary(value.parameters)
            };

            if (property === 'ADR') {
                const parsedAddr = this.parseAddressValue(value.value);
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
    generateVCard3(displayData, options = {}) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:3.0\n';

        // Full Name (required)
        if (displayData.fullName) {
            const cleanFullName = displayData.fullName.trim();
            vcard += `FN:${this.escapeValue(cleanFullName)}\n`;
            
            // ✅ Generate structured name (N property) with improved parsing
            // vCard N format: N:LastName;FirstName;MiddleName;Prefix;Suffix
            const nameParts = cleanFullName.split(/\s+/);
            
            if (nameParts.length === 1) {
                // Single name (e.g., "Nemo", "Alice") - use as firstName, no lastName
                vcard += `N:;${this.escapeValue(nameParts[0])};;;\n`;
            } else if (nameParts.length === 2) {
                // Two parts (e.g., "John Doe") - standard FirstName LastName
                const [firstName, lastName] = nameParts;
                vcard += `N:${this.escapeValue(lastName)};${this.escapeValue(firstName)};;;\n`;
            } else {
                // Three or more parts - take last as lastName, rest as firstName
                const lastName = nameParts[nameParts.length - 1];
                const firstName = nameParts.slice(0, nameParts.length - 1).join(' ');
                vcard += `N:${this.escapeValue(lastName)};${this.escapeValue(firstName)};;;\n`;
            }
        } else {
            console.warn('⚠️ VCard3Processor.generateVCard3: Missing fullName, using fallback');
            // Use cardName as fallback if fullName is missing
            const fallbackName = displayData.cardName || 'Unnamed Contact';
            vcard += `FN:${this.escapeValue(fallbackName)}\n`;
            vcard += `N:;${this.escapeValue(fallbackName)};;;\n`;
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
        // NOTE: iCloud strips this from the body but other servers need it
        const uid = this.generateOrRetrieveUID(displayData);
        vcard += `UID:${this.escapeValue(uid)}\n`;

        // Add REV (revision timestamp) - REQUIRED by iCloud for content validation
        // Format: 2025-11-30T12:34:56Z (ISO 8601 timestamp)
        const timestamp = displayData.metadata?.lastUpdated || 
                         displayData.metadata?.createdAt || 
                         new Date().toISOString();
        vcard += `REV:${timestamp}\n`;

        // ⭐ Embed sharing metadata in CATEGORIES for disaster recovery (internal use only)
        // Skip this for external CardDAV sync (iCloud, Baikal, etc.) as some servers reject it
        if (!options.skipInternalMetadata && displayData.metadata?.sharing?.sharedWithUsers?.length > 0) {
            const sharedUsers = displayData.metadata.sharing.sharedWithUsers;
            // Format: SHARED:alice,bob,charlie (compact format supports 1000+ users under 10KB limit)
            // Note: Don't escape the entire string - only escape individual usernames, then join with unescaped commas
            const escapedUsers = sharedUsers.map(u => this.escapeValue(u));
            const sharingCategories = `SHARED:${escapedUsers.join(',')}`;
            vcard += `CATEGORIES:${sharingCategories}\n`;
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
                // Skip phones without values
                if (!phone.value || phone.value.trim() === '') {
                    console.warn('⚠️ Skipping phone without value:', phone);
                    return;
                }
                
                const type = this.convertToVCard3Type(phone.type, 'phone').toUpperCase();
                
                // Build comma-separated TYPE values (RFC 2426 Section 3.3) - UPPERCASE for iCloud
                const typeValues = [type];
                if (phone.primary) typeValues.push('PREF');
                
                // RFC 2426: TEL should always have a capability type (VOICE, FAX, etc.)
                // For CELL/MOBILE, the location type IS the capability
                // For WORK/HOME/OTHER, add VOICE as capability
                const needsVoiceCapability = !['CELL', 'FAX', 'PAGER', 'MSG', 'VIDEO'].includes(type);
                if (needsVoiceCapability) {
                    typeValues.push('VOICE');
                }
                
                // Use single TYPE parameter with comma-separated values (UPPERCASE)
                output += `TEL;TYPE=${typeValues.join(',')}:${this.escapeValue(phone.value)}\n`;
            });
        }

        // Email addresses (with INTERNET type as iCloud expects)
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach(email => {
                // Skip emails without values
                if (!email.value || email.value.trim() === '') {
                    console.warn('⚠️ Skipping email without value:', email);
                    return;
                }
                
                const type = this.convertToVCard3Type(email.type, 'email').toUpperCase();
                
                // Build comma-separated TYPE values (RFC 2426 Section 3.3) - UPPERCASE for iCloud
                const typeValues = [type];
                if (email.primary) typeValues.push('PREF');
                typeValues.push('INTERNET'); // iCloud always adds INTERNET
                
                // Use single TYPE parameter with comma-separated values (UPPERCASE)
                output += `EMAIL;TYPE=${typeValues.join(',')}:${this.escapeValue(email.value)}\n`;
            });
        }

        // URLs (using ITEM format for non-standard types like iCloud)
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach(url => {
                // Skip URLs without values
                if (!url.value || url.value.trim() === '') {
                    console.warn('⚠️ Skipping URL without value:', url);
                    return;
                }
                
                const type = this.convertToVCard3Type(url.type, 'url').toUpperCase();
                
                // Use standard format for WORK, HOME, OTHER
                if (['WORK', 'HOME', 'OTHER'].includes(type)) {
                    // Build comma-separated TYPE values (RFC 2426 Section 3.3) - UPPERCASE for iCloud
                    const typeValues = [type];
                    if (url.primary) typeValues.push('PREF');
                    
                    output += `URL;TYPE=${typeValues.join(',')}:${this.escapeValue(url.value)}\n`;
                } else {
                    // Use ITEM format for PERSONAL, BLOG, etc. (like iCloud does)
                    output += `item${itemCounter}.URL:${this.escapeValue(url.value)}\n`;
                    output += `item${itemCounter}.X-ABLABEL:${type.toUpperCase()}\n`;
                    itemCounter++;
                }
            });
        }

        // Addresses
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach(address => {
                // Skip addresses without meaningful values
                const adrValue = this.formatAddressValue(address);
                if (!adrValue || adrValue === ';;;;;;') {
                    console.warn('⚠️ Skipping empty address:', address);
                    return;
                }
                
                const type = this.convertToVCard3Type(address.type, 'address').toUpperCase();
                
                // Build comma-separated TYPE values (RFC 2426 Section 3.3) - UPPERCASE for iCloud
                const typeValues = [type];
                if (address.primary) typeValues.push('PREF');
                
                output += `ADR;TYPE=${typeValues.join(',')}:${adrValue}\n`;
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
     * CRITICAL: Must preserve literal \n sequences inside quoted LABEL parameters
     * @param {string} vCardString - vCard content
     * @returns {Array} Unfolded lines
     */
    unfoldLines(vCardString) {
        // First, protect literal \n inside quotes by temporarily replacing them
        const protectedString = this.protectQuotedNewlines(vCardString);
        
        const lines = protectedString.split(/\r?\n/);
        const unfolded = [];
        let currentLine = '';

        for (const line of lines) {
            // RFC 2426: Lines starting with space/tab are continuations
            if (this.patterns.unfoldContinuation.test(line)) {
                // Continuation line - append without the leading space/tab
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

        // Restore protected newlines
        return unfolded
            .filter(line => line.trim().length > 0)
            .map(line => this.restoreQuotedNewlines(line));
    }
    
    /**
     * Temporarily replace literal \n inside quoted strings to prevent line splitting
     * @param {string} vCardString - vCard content
     * @returns {string} - Protected vCard content
     */
    protectQuotedNewlines(vCardString) {
        let result = '';
        let inQuotes = false;
        
        for (let i = 0; i < vCardString.length; i++) {
            const char = vCardString[i];
            const nextChar = vCardString[i + 1];
            
            if (char === '"') {
                inQuotes = !inQuotes;
                result += char;
            } else if (inQuotes && char === '\\' && nextChar === 'n') {
                // Replace \n with placeholder inside quotes
                result += '\x00NEWLINE\x00';
                i++; // Skip the 'n'
            } else {
                result += char;
            }
        }
        
        return result;
    }
    
    /**
     * Restore literal \n in quoted strings after unfolding
     * @param {string} line - Unfolded line
     * @returns {string} - Line with restored newlines
     */
    restoreQuotedNewlines(line) {
        return line.replace(/\x00NEWLINE\x00/g, '\\n');
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
                continue;
            }
            
            // If we're in photo mode, check if this is the end
            if (skipPhoto) {
                // Check if this line starts a new vCard property
                if (propertyPattern.test(trimmedLine)) {
                    // This is a new property, stop skipping
                    skipPhoto = false;
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
        // ⭐ CRITICAL FIX: ALWAYS parse vCard if available (it's the source of truth)
        // Contact object may have stale properties from before the update
        // The vCard string always reflects the most recent saved state
        if (contact.vcard) {
            const parsedContact = this.parseVCard3(contact.vcard);
            const displayData = this.convertToDisplayData(parsedContact);
            
            // Preserve itemId if available
            if (contact.itemId) {
                displayData.itemId = contact.itemId;
            }
            
            // ⭐ CRITICAL FIX #3: Prefer contact.uid over vCard extraction
            // PRIORITY: 1) contact.uid (already sanitized), 2) extract from vCard, 3) contactId
            if (contact.uid && typeof contact.uid === 'string') {
                // Use the already-sanitized UID from contact object (best source)
                displayData.uid = contact.uid;
            } else if (!displayData.uid) {
                // Fallback: Extract UID from vCard if contact.uid not available
                const uid = this.extractUIDFromVCard(contact.vcard);
                if (uid) {
                    // ⭐ CRITICAL: Ensure extracted UID is a string, not "[object Object]"
                    const uidValue = typeof uid === 'string' 
                        ? uid 
                        : (uid.value || String(uid));
                    displayData.uid = uidValue;
                }
            }
            
            // Last fallback: contactId
            if (!displayData.uid && contact.contactId) {
                displayData.uid = contact.contactId;
            }
            
            return displayData;
        }
        
        // Fallback: If the contact has direct display properties (from form data), use them
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

            // ⭐ CRITICAL FIX #3: Prefer contact.uid over vCard extraction
            // PRIORITY: 1) contact.uid (already sanitized), 2) extract from vCard, 3) contactId
            if (contact.uid && typeof contact.uid === 'string') {
                // Use the already-sanitized UID from contact object (best source)
                baseData.uid = contact.uid;
            } else if (contact.vcard) {
                // Fallback: Extract UID from vCard if contact.uid not available
                const existingUID = this.extractUIDFromVCard(contact.vcard);
                if (existingUID) {
                    // ⭐ CRITICAL: Ensure extracted UID is a string, not "[object Object]"
                    const uidValue = typeof existingUID === 'string' 
                        ? existingUID 
                        : (existingUID.value || String(existingUID));
                    baseData.uid = uidValue;
                }
            }

            // Last fallback: Use contactId if no UID found
            if (!baseData.uid && contact.contactId) {
                baseData.uid = contact.contactId;
            }

            return baseData;
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
            itemId: contact.itemId,
            uid: contact.contactId  // Use contactId as fallback UID
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
            importSource: 'vcard_3.0_apple',
            isImported: markAsImported ? true : false  // Explicitly set to false when unchecked
        };

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
                // Skip phones without values
                if (!phone.value || phone.value.trim() === '') {
                    console.warn('⚠️ Skipping phone without value:', phone);
                    return;
                }
                
                const type = phone.type || 'voice';
                const typeValues = [type];
                if (index === 0 || phone.primary) typeValues.push('pref');
                vcard += `TEL;TYPE=${typeValues.join(',')}:${this.escapeValue(phone.value)}\n`;
            });
        }
        
        // Email addresses
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach((email, index) => {
                // Skip emails without values
                if (!email.value || email.value.trim() === '') {
                    console.warn('⚠️ Skipping email without value:', email);
                    return;
                }
                
                const type = email.type || 'internet';
                const typeValues = [type];
                if (index === 0 || email.primary) typeValues.push('pref');
                vcard += `EMAIL;TYPE=${typeValues.join(',')}:${this.escapeValue(email.value)}\n`;
            });
        }
        
        // URLs
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach((url, index) => {
                // Skip URLs without values
                if (!url.value || url.value.trim() === '') {
                    console.warn('⚠️ Skipping URL without value:', url);
                    return;
                }
                
                const type = url.type || 'work';
                const typeValues = [type];
                if (index === 0 || url.primary) typeValues.push('pref');
                vcard += `URL;TYPE=${typeValues.join(',')}:${this.escapeValue(url.value)}\n`;
            });
        }
        
        // Addresses
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach((addr, index) => {
                // Skip addresses without meaningful values
                const addrValue = `${addr.poBox || ''};${addr.extended || ''};${addr.street || ''};${addr.city || ''};${addr.state || ''};${addr.postalCode || ''};${addr.country || ''}`;
                if (!addrValue || addrValue === ';;;;;;') {
                    console.warn('⚠️ Skipping empty address:', addr);
                    return;
                }
                
                const type = addr.type || 'home';
                const typeValues = [type];
                if (index === 0 || addr.primary) typeValues.push('pref');
                // Use correct field names from parseAddressValue
                vcard += `ADR;TYPE=${typeValues.join(',')}:${addrValue}\n`;
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
        const uid = this.generateOrRetrieveUID(displayData);
        vcard += `UID:${this.escapeValue(uid)}\n`;
        
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

    /**
     * Generate or retrieve UID for vCard
     * Centralizes UID handling to avoid code duplication
     * @param {Object} displayData - Display data with possible uid or contactId
     * @returns {string} UID value for vCard
     */
    generateOrRetrieveUID(displayData) {
        if (displayData.uid) {
            // Convert UID to string if it's an object (handles {value: "uuid"} format)
            return typeof displayData.uid === 'string' 
                ? displayData.uid 
                : (displayData.uid.value || displayData.uid.toString());
        } else {
            // Generate stable UID based on contactId or random UUID
            return displayData.contactId || 
                   `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
    }

    /**
     * Extract sharing metadata from vCard CATEGORIES field
     * Used for disaster recovery - restores sharing relationships from backup
     * Format: CATEGORIES:SHARED:user1,user2,user3
     * @param {string} vcard - vCard 3.0 content
     * @returns {Array} Array of usernames this contact is shared with
     */
    extractSharingFromVCard(vcard) {
        const sharedUsers = [];
        const lines = vcard.split('\n');
        
        for (const line of lines) {
            if (line.startsWith('CATEGORIES:')) {
                const categoriesValue = line.substring(11).trim();
                
                // Optimized format: CATEGORIES:SHARED:user1,user2,user3
                if (categoriesValue.startsWith('SHARED:')) {
                    const userList = categoriesValue.substring(7); // Remove "SHARED:"
                    const users = userList.split(',').map(u => u.trim()).filter(u => u);
                    sharedUsers.push(...users);
                }
            }
        }
        
        return sharedUsers;
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