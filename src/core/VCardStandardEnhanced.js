/**
 * Enhanced VCardStandard - Comprehensive RFC 9553 vCard 4.0 Implementation
 * 
 * High Priority Improvements:
 * 1. ✅ Comprehensive vCard parser with proper line folding/unfolding
 * 2. ✅ Robust error handling and validation 
 * 3. ✅ Enhanced address (ADR) property support
 * 4. ✅ Proper escaping/unescaping per RFC 9553
 * 5. ✅ Line folding for long vCard properties
 * 6. ✅ Multi-value property handling with TYPE and PREF parameters
 */

export class VCardStandardEnhanced {
    constructor() {
        this.version = '4.0';
        
        // RFC 9553 Property Configuration
        this.propertyConfig = {
            // Required properties
            VERSION: { required: true, multiValue: false, category: 'system' },
            FN: { required: true, multiValue: false, category: 'identification' },
            
            // Optional identification properties
            N: { required: false, multiValue: false, category: 'identification' },
            NICKNAME: { required: false, multiValue: true, category: 'identification' },
            
            // Communication properties
            TEL: { required: false, multiValue: true, category: 'communication', types: ['work', 'home', 'cell', 'fax', 'voice', 'text'] },
            EMAIL: { required: false, multiValue: true, category: 'communication', types: ['work', 'home', 'internet'] },
            URL: { required: false, multiValue: true, category: 'communication', types: ['work', 'home'] },
            
            // Address properties
            ADR: { required: false, multiValue: true, category: 'geographical', types: ['work', 'home', 'postal'] },
            
            // Organizational properties
            ORG: { required: false, multiValue: false, category: 'organizational' },
            TITLE: { required: false, multiValue: false, category: 'organizational' },
            ROLE: { required: false, multiValue: false, category: 'organizational' },
            
            // Personal properties
            BDAY: { required: false, multiValue: false, category: 'personal' },
            ANNIVERSARY: { required: false, multiValue: false, category: 'personal' },
            
            // Note properties
            NOTE: { required: false, multiValue: true, category: 'explanatory' },
            
            // System properties
            REV: { required: false, multiValue: false, category: 'system' },
            UID: { required: false, multiValue: false, category: 'system' },
            
            // Media properties
            PHOTO: { required: false, multiValue: false, category: 'media' }
        };

        // RFC 9553 validation patterns
        this.validationPatterns = {
            phone: /^[+]?[\d\s\-\(\)\.ext]+$/i,
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            url: /^https?:\/\/.+/i,
            date: /^\d{4}-\d{2}-\d{2}$/,
            dateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?$/,
            versionLine: /^VERSION:\s*(\d+\.\d+)$/,
            propertyLine: /^([A-Z][A-Z0-9\-]*)((?:;[^:]*)*):(.*)$/,
            parameterPair: /([A-Z][A-Z0-9\-]*)=([^;]+)/g,
            continuation: /^[ \t]/,
            base64: /^[A-Za-z0-9+/]+=*$/
        };

        // Line folding configuration per RFC 9553
        this.foldingConfig = {
            maxLineLength: 75,
            continuationPrefix: ' ',
            foldingEnabled: true
        };
    }

    /**
     * Parse vCard with comprehensive RFC 9553 compliance
     * @param {string} vCardString - Raw vCard content
     * @param {Object} options - Parsing options
     * @returns {Object} Parsed vCard data with validation results
     */
    parseVCard(vCardString, options = {}) {
        const parseOptions = {
            strictMode: options.strictMode || false,
            validateTypes: options.validateTypes !== false,
            allowEmptyValues: options.allowEmptyValues || false,
            maxErrors: options.maxErrors || 10,
            ...options
        };

        const result = {
            success: false,
            vCard: null,
            errors: [],
            warnings: [],
            version: null,
            properties: new Map(),
            rawProperties: [],
            statistics: {
                totalLines: 0,
                validProperties: 0,
                invalidProperties: 0,
                continuationLines: 0
            }
        };

        try {
            // Input validation
            if (!this.validateInput(vCardString)) {
                result.errors.push('Invalid input: vCard string is empty or not a string');
                return result;
            }

            // Step 1: Unfold lines per RFC 9553
            const unfoldedLines = this.unfoldLines(vCardString);
            result.statistics.totalLines = unfoldedLines.length;

            // Step 2: Validate vCard structure
            const structureValidation = this.validateStructure(unfoldedLines);
            if (!structureValidation.isValid) {
                result.errors.push(...structureValidation.errors);
                if (parseOptions.strictMode) {
                    return result;
                }
            }

            // Step 3: Parse individual properties
            let insideVCard = false;
            let lineNumber = 0;

            for (const line of unfoldedLines) {
                lineNumber++;

                if (line.trim() === 'BEGIN:VCARD') {
                    insideVCard = true;
                    continue;
                }

                if (line.trim() === 'END:VCARD') {
                    insideVCard = false;
                    break;
                }

                if (!insideVCard) {
                    result.warnings.push(`Line ${lineNumber}: Content outside vCard boundaries ignored`);
                    continue;
                }

                try {
                    const propertyResult = this.parseProperty(line, lineNumber, parseOptions);
                    
                    if (propertyResult.success) {
                        this.addPropertyToResult(result, propertyResult.property);
                        result.statistics.validProperties++;
                    } else {
                        result.errors.push(...propertyResult.errors);
                        result.statistics.invalidProperties++;
                        
                        if (result.errors.length >= parseOptions.maxErrors) {
                            result.warnings.push('Maximum error limit reached, stopping parsing');
                            break;
                        }
                    }
                } catch (error) {
                    result.errors.push(`Line ${lineNumber}: Unexpected parsing error - ${error.message}`);
                    result.statistics.invalidProperties++;
                }
            }

            // Step 4: Validate required properties
            const requiredValidation = this.validateRequiredProperties(result.properties);
            if (!requiredValidation.isValid) {
                result.errors.push(...requiredValidation.errors);
            }

            // Step 5: Post-processing validation
            if (parseOptions.validateTypes) {
                const typeValidation = this.validatePropertyTypes(result.properties);
                result.warnings.push(...typeValidation.warnings);
                result.errors.push(...typeValidation.errors);
            }

            // Determine success
            result.success = result.errors.length === 0 || !parseOptions.strictMode;
            result.version = this.extractVersion(result.properties);
            
            if (result.success) {
                result.vCard = {
                    version: result.version,
                    properties: result.properties,
                    rawProperties: result.rawProperties
                };
            }

            return result;

        } catch (error) {
            result.errors.push(`Critical parsing error: ${error.message}`);
            return result;
        }
    }

    /**
     * Generate RFC 9553 compliant vCard from contact data
     * @param {Object} contactData - Contact information
     * @param {Object} options - Generation options
     * @returns {Object} Generated vCard result
     */
    generateVCard(contactData, options = {}) {
        const genOptions = {
            version: options.version || '4.0',
            includeFolding: options.includeFolding !== false,
            validateOutput: options.validateOutput !== false,
            includeSystemProperties: options.includeSystemProperties !== false,
            ...options
        };

        const result = {
            success: false,
            content: '',
            errors: [],
            warnings: [],
            statistics: {
                propertiesAdded: 0,
                propertiesSkipped: 0,
                totalLines: 0
            }
        };

        try {
            // Input validation
            const inputValidation = this.validateContactData(contactData);
            if (!inputValidation.isValid) {
                result.errors.push(...inputValidation.errors);
                result.warnings.push(...inputValidation.warnings);
                
                if (inputValidation.errors.length > 0) {
                    return result;
                }
            }

            const lines = [];

            // Begin vCard
            lines.push('BEGIN:VCARD');

            // Version property
            lines.push(`VERSION:${genOptions.version}`);

            // Required FN property
            if (contactData.fn || contactData.fullName) {
                const fullName = contactData.fn || contactData.fullName;
                lines.push(`FN:${this.escapeValue(fullName)}`);
                result.statistics.propertiesAdded++;
            } else {
                result.errors.push('Missing required FN (Full Name) property');
                return result;
            }

            // Optional N (structured name) property
            if (contactData.structuredName || contactData.n) {
                const nValue = this.formatStructuredName(contactData.structuredName || contactData.n);
                if (nValue) {
                    lines.push(`N:${nValue}`);
                    result.statistics.propertiesAdded++;
                }
            }

            // Multi-value communication properties
            this.addMultiValueProperties(lines, 'TEL', contactData.phones, result.statistics);
            this.addMultiValueProperties(lines, 'EMAIL', contactData.emails, result.statistics);
            this.addMultiValueProperties(lines, 'URL', contactData.urls, result.statistics);

            // Address properties (ADR)
            this.addAddressProperties(lines, contactData.addresses, result.statistics);

            // Organization properties
            if (contactData.organization || contactData.org) {
                lines.push(`ORG:${this.escapeValue(contactData.organization || contactData.org)}`);
                result.statistics.propertiesAdded++;
            }

            if (contactData.title) {
                lines.push(`TITLE:${this.escapeValue(contactData.title)}`);
                result.statistics.propertiesAdded++;
            }

            // Personal properties
            if (contactData.birthday || contactData.bday) {
                const formattedBday = this.formatBirthday(contactData.birthday || contactData.bday);
                if (formattedBday) {
                    lines.push(`BDAY:${formattedBday}`);
                    result.statistics.propertiesAdded++;
                }
            }

            // Notes
            if (contactData.notes && Array.isArray(contactData.notes)) {
                contactData.notes.forEach(note => {
                    if (note.trim()) {
                        lines.push(`NOTE:${this.escapeValue(note.trim())}`);
                        result.statistics.propertiesAdded++;
                    }
                });
            } else if (typeof contactData.notes === 'string' && contactData.notes.trim()) {
                lines.push(`NOTE:${this.escapeValue(contactData.notes.trim())}`);
                result.statistics.propertiesAdded++;
            }

            // System properties
            if (genOptions.includeSystemProperties) {
                if (contactData.uid) {
                    // FIX: Convert UID to string if it's an object (handles {value: "uuid"} format)
                    const uidValue = typeof contactData.uid === 'string' 
                        ? contactData.uid 
                        : (contactData.uid.value || contactData.uid.toString());
                    lines.push(`UID:${this.escapeValue(uidValue)}`);
                    result.statistics.propertiesAdded++;
                }
                
                // Add REV (revision) timestamp
                const revTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
                lines.push(`REV:${revTimestamp}`);
                result.statistics.propertiesAdded++;
            }

            // End vCard
            lines.push('END:VCARD');

            result.statistics.totalLines = lines.length;

            // Apply line folding if enabled
            let vCardContent = lines.join('\n');
            if (genOptions.includeFolding) {
                vCardContent = this.foldLines(vCardContent);
            }

            // Validate output if requested
            if (genOptions.validateOutput) {
                const validation = this.parseVCard(vCardContent, { strictMode: false });
                if (!validation.success) {
                    result.warnings.push('Generated vCard failed validation');
                    result.warnings.push(...validation.errors);
                }
            }

            result.content = vCardContent;
            result.success = true;

            return result;

        } catch (error) {
            result.errors.push(`vCard generation failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Enhanced line unfolding per RFC 9553 Section 3.2
     * Handles space and tab continuation characters
     */
    unfoldLines(vCardString) {
        const rawLines = vCardString.split(/\r?\n/);
        const unfoldedLines = [];
        let currentLine = '';
        let continuationCount = 0;

        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            
            // Check if this line is a continuation (starts with space or tab)
            if (this.validationPatterns.continuation.test(line)) {
                if (currentLine) {
                    // Remove the continuation character and append
                    currentLine += line.substring(1);
                    continuationCount++;
                } else {
                    // Continuation line without a preceding line - treat as regular line
                    currentLine = line;
                }
            } else {
                // Regular line
                if (currentLine) {
                    unfoldedLines.push(currentLine);
                }
                currentLine = line;
            }
        }

        // Don't forget the last line
        if (currentLine) {
            unfoldedLines.push(currentLine);
        }

        // Filter out empty lines
        return unfoldedLines.filter(line => line.trim().length > 0);
    }

    /**
     * Enhanced line folding per RFC 9553 Section 3.2
     * Folds lines longer than 75 characters with proper continuation
     */
    foldLines(vCardContent) {
        if (!this.foldingConfig.foldingEnabled) {
            return vCardContent;
        }

        const lines = vCardContent.split('\n');
        const foldedLines = [];

        for (const line of lines) {
            if (line.length <= this.foldingConfig.maxLineLength) {
                foldedLines.push(line);
            } else {
                // Fold the line
                let remaining = line;
                let firstLine = true;

                while (remaining.length > this.foldingConfig.maxLineLength) {
                    if (firstLine) {
                        foldedLines.push(remaining.substring(0, this.foldingConfig.maxLineLength));
                        remaining = this.foldingConfig.continuationPrefix + remaining.substring(this.foldingConfig.maxLineLength);
                        firstLine = false;
                    } else {
                        foldedLines.push(remaining.substring(0, this.foldingConfig.maxLineLength));
                        remaining = this.foldingConfig.continuationPrefix + remaining.substring(this.foldingConfig.maxLineLength);
                    }
                }

                // Add the final part
                if (remaining.length > 0) {
                    foldedLines.push(remaining);
                }
            }
        }

        return foldedLines.join('\n');
    }

    /**
     * Parse individual vCard property with comprehensive validation
     */
    parseProperty(line, lineNumber, options) {
        const result = {
            success: false,
            property: null,
            errors: [],
            warnings: []
        };

        try {
            // Match property pattern: PROPERTY[;PARAMS]:VALUE
            const match = line.match(this.validationPatterns.propertyLine);
            
            if (!match) {
                result.errors.push(`Line ${lineNumber}: Invalid property format - ${line}`);
                return result;
            }

            const [, propertyName, paramString, value] = match;
            const cleanPropertyName = propertyName.toUpperCase();

            // Parse parameters
            const parameters = this.parseParameters(paramString);

            // Validate property name
            const propertyConfig = this.propertyConfig[cleanPropertyName];
            if (!propertyConfig && options.strictMode) {
                result.warnings.push(`Line ${lineNumber}: Unknown property ${cleanPropertyName}`);
            }

            // Validate value
            if (!value && !options.allowEmptyValues) {
                result.warnings.push(`Line ${lineNumber}: Empty value for property ${cleanPropertyName}`);
            }

            // Unescape value
            const unescapedValue = this.unescapeValue(value || '');

            // Type-specific validation
            if (propertyConfig && options.validateTypes) {
                const typeValidation = this.validatePropertyValue(cleanPropertyName, unescapedValue, parameters);
                if (!typeValidation.isValid) {
                    result.warnings.push(...typeValidation.warnings);
                    if (typeValidation.errors.length > 0 && options.strictMode) {
                        result.errors.push(...typeValidation.errors);
                        return result;
                    }
                }
            }

            result.property = {
                name: cleanPropertyName,
                value: unescapedValue,
                parameters: parameters,
                rawLine: line,
                lineNumber: lineNumber
            };

            result.success = true;
            return result;

        } catch (error) {
            result.errors.push(`Line ${lineNumber}: Property parsing error - ${error.message}`);
            return result;
        }
    }

    /**
     * Enhanced parameter parsing with proper handling of quoted values
     */
    parseParameters(paramString) {
        const parameters = {};
        
        if (!paramString || paramString.trim() === '') {
            return parameters;
        }

        // Remove leading semicolon if present
        const cleanParamString = paramString.startsWith(';') ? paramString.substring(1) : paramString;
        
        // Use regex to match parameter pairs, handling quoted values
        let match;
        while ((match = this.validationPatterns.parameterPair.exec(cleanParamString)) !== null) {
            let [, paramName, paramValue] = match;
            
            // Clean parameter name
            paramName = paramName.toUpperCase();
            
            // Handle quoted values
            if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
                paramValue = paramValue.slice(1, -1);
            }
            
            // Handle comma-separated values (for TYPE parameter)
            if (paramName === 'TYPE' && paramValue.includes(',')) {
                paramValue = paramValue.split(',').map(v => v.trim().toLowerCase()).join(',');
            } else {
                paramValue = paramValue.toLowerCase();
            }
            
            // Filter out CHARSET parameter as it's a parsing hint, not a contact data attribute
            if (paramName === 'CHARSET') {
                continue; // Skip adding CHARSET to parameters
            }
            
            parameters[paramName] = paramValue;
        }
        
        return parameters;
    }

    /**
     * Enhanced address property handling with full ADR format support
     */
    addAddressProperties(lines, addresses, statistics) {
        if (!addresses || !Array.isArray(addresses)) {
            return;
        }

        addresses.forEach((address, index) => {
            if (!address || typeof address !== 'object') {
                statistics.propertiesSkipped++;
                return;
            }

            // Build ADR parameter string
            const params = [];
            
            if (address.type) {
                params.push(`TYPE=${address.type.toLowerCase()}`);
            }
            
            if (address.primary === true || index === 0) {
                params.push('PREF=1');
            }

            const paramString = params.length > 0 ? `;${params.join(';')}` : '';

            // Format ADR value per RFC 9553: post-office-box;extended-address;street-address;locality;region;postal-code;country-name
            const adrParts = [
                this.escapeValue(address.poBox || address.postOfficeBox || ''),
                this.escapeValue(address.extendedAddress || address.extended || ''),
                this.escapeValue(address.street || address.streetAddress || ''),
                this.escapeValue(address.city || address.locality || ''),
                this.escapeValue(address.state || address.region || ''),
                this.escapeValue(address.postalCode || address.zip || ''),
                this.escapeValue(address.country || address.countryName || '')
            ];

            const adrValue = adrParts.join(';');
            
            // Only add if there's actual address content
            if (adrParts.some(part => part.trim().length > 0)) {
                lines.push(`ADR${paramString}:${adrValue}`);
                statistics.propertiesAdded++;
            } else {
                statistics.propertiesSkipped++;
            }
        });
    }

    /**
     * Add multi-value properties (TEL, EMAIL, URL) with proper TYPE and PREF handling
     */
    addMultiValueProperties(lines, propertyName, values, statistics) {
        if (!values || !Array.isArray(values)) {
            return;
        }

        values.forEach((item, index) => {
            if (!item) {
                statistics.propertiesSkipped++;
                return;
            }

            let value, type, primary;

            // Handle both string values and object values
            if (typeof item === 'string') {
                value = item;
                type = 'other';
                primary = index === 0;
            } else {
                value = item.value || item.number || item.url || item.email || '';
                type = item.type || 'other';
                primary = item.primary === true || (index === 0 && item.primary !== false);
            }

            if (!value.trim()) {
                statistics.propertiesSkipped++;
                return;
            }

            // Build parameters
            const params = [];
            
            if (type && type !== 'other') {
                params.push(`TYPE=${type.toLowerCase()}`);
            }
            
            if (primary) {
                params.push('PREF=1');
            }

            const paramString = params.length > 0 ? `;${params.join(';')}` : '';
            
            lines.push(`${propertyName}${paramString}:${this.escapeValue(value)}`);
            statistics.propertiesAdded++;
        });
    }

    /**
     * Validate vCard structure (BEGIN/END, VERSION)
     */
    validateStructure(lines) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Check for BEGIN:VCARD
        if (!lines.some(line => line.trim() === 'BEGIN:VCARD')) {
            result.errors.push('Missing BEGIN:VCARD');
            result.isValid = false;
        }

        // Check for END:VCARD
        if (!lines.some(line => line.trim() === 'END:VCARD')) {
            result.errors.push('Missing END:VCARD');
            result.isValid = false;
        }

        // Check for VERSION
        const versionLine = lines.find(line => this.validationPatterns.versionLine.test(line));
        if (!versionLine) {
            result.errors.push('Missing VERSION property');
            result.isValid = false;
        } else {
            const versionMatch = versionLine.match(this.validationPatterns.versionLine);
            const version = versionMatch ? versionMatch[1] : null;
            
            if (version !== '3.0' && version !== '4.0') {
                result.warnings.push(`Unsupported vCard version: ${version}`);
            }
        }

        return result;
    }

    /**
     * Validate required properties are present
     */
    validateRequiredProperties(properties) {
        const result = {
            isValid: true,
            errors: []
        };

        // Check for required FN property
        if (!properties.has('FN')) {
            result.errors.push('Missing required FN (Full Name) property');
            result.isValid = false;
        }

        return result;
    }

    /**
     * Validate property values against their expected types
     */
    validatePropertyTypes(properties) {
        const result = {
            errors: [],
            warnings: []
        };

        // Validate phone numbers
        if (properties.has('TEL')) {
            const phones = properties.get('TEL');
            const phoneArray = Array.isArray(phones) ? phones : [phones];
            
            phoneArray.forEach((phone, index) => {
                const value = typeof phone === 'string' ? phone : phone.value;
                if (value && !this.validationPatterns.phone.test(value)) {
                    result.warnings.push(`Invalid phone number format at index ${index}: ${value}`);
                }
            });
        }

        // Validate email addresses
        if (properties.has('EMAIL')) {
            const emails = properties.get('EMAIL');
            const emailArray = Array.isArray(emails) ? emails : [emails];
            
            emailArray.forEach((email, index) => {
                const value = typeof email === 'string' ? email : email.value;
                if (value && !this.validationPatterns.email.test(value)) {
                    result.warnings.push(`Invalid email format at index ${index}: ${value}`);
                }
            });
        }

        // Validate URLs
        if (properties.has('URL')) {
            const urls = properties.get('URL');
            const urlArray = Array.isArray(urls) ? urls : [urls];
            
            urlArray.forEach((url, index) => {
                const value = typeof url === 'string' ? url : url.value;
                if (value && !this.validationPatterns.url.test(value)) {
                    result.warnings.push(`Invalid URL format at index ${index}: ${value}`);
                }
            });
        }

        // Validate birthday format
        if (properties.has('BDAY')) {
            const bday = properties.get('BDAY');
            const value = typeof bday === 'string' ? bday : bday.value;
            
            if (value && !this.validationPatterns.date.test(value) && !this.validationPatterns.dateTime.test(value)) {
                result.warnings.push(`Invalid birthday format: ${value} (expected YYYY-MM-DD or ISO datetime)`);
            }
        }

        return result;
    }

    /**
     * Enhanced value escaping per RFC 9553
     */
    escapeValue(value) {
        if (!value || typeof value !== 'string') {
            return String(value || '');
        }

        return value
            .replace(/\\/g, '\\\\')    // Escape backslashes first
            .replace(/;/g, '\\;')      // Escape semicolons
            .replace(/,/g, '\\,')      // Escape commas
            .replace(/\n/g, '\\n')     // Escape newlines
            .replace(/\r/g, '\\r');    // Escape carriage returns
    }

    /**
     * Enhanced value unescaping per RFC 9553
     */
    unescapeValue(value) {
        if (!value || typeof value !== 'string') {
            return String(value || '');
        }

        return value
            .replace(/\\r/g, '\r')     // Unescape carriage returns
            .replace(/\\n/g, '\n')     // Unescape newlines
            .replace(/\\,/g, ',')      // Unescape commas
            .replace(/\\;/g, ';')      // Unescape semicolons
            .replace(/\\\\/g, '\\');   // Unescape backslashes last
    }

    /**
     * Utility methods
     */
    validateInput(vCardString) {
        return vCardString && 
               typeof vCardString === 'string' && 
               vCardString.trim().length > 0;
    }

    validateContactData(contactData) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        if (!contactData || typeof contactData !== 'object') {
            result.errors.push('Contact data must be an object');
            result.isValid = false;
            return result;
        }

        // Check for required FN or fullName
        if (!contactData.fn && !contactData.fullName) {
            result.errors.push('Contact must have fn or fullName property');
            result.isValid = false;
        }

        return result;
    }

    addPropertyToResult(result, property) {
        const { name, value, parameters } = property;
        
        // Store in properties map
        if (!result.properties.has(name)) {
            result.properties.set(name, []);
        }

        const propertyConfig = this.propertyConfig[name];
        const propertyValue = { value, parameters };

        if (propertyConfig && !propertyConfig.multiValue) {
            result.properties.set(name, value);
        } else {
            result.properties.get(name).push(propertyValue);
        }

        // Store raw property
        result.rawProperties.push(property);
    }

    extractVersion(properties) {
        const version = properties.get('VERSION');
        if (typeof version === 'string') {
            return version;
        }
        return this.version; // Default to 4.0
    }

    formatStructuredName(structuredName) {
        if (!structuredName) return '';
        
        if (typeof structuredName === 'string') {
            return this.escapeValue(structuredName);
        }

        // Handle structured name object: family;given;additional;prefixes;suffixes
        const parts = [
            structuredName.family || '',
            structuredName.given || '',
            structuredName.additional || '',
            structuredName.prefixes || '',
            structuredName.suffixes || ''
        ];

        return parts.map(part => this.escapeValue(part)).join(';');
    }

    formatBirthday(birthday) {
        if (!birthday) return '';
        
        // If already in correct format, return as-is
        if (this.validationPatterns.date.test(birthday)) {
            return birthday;
        }

        // Try to parse and format common date formats
        try {
            const date = new Date(birthday);
            if (!isNaN(date.getTime())) {
                // Format as YYYY-MM-DD
                return date.toISOString().split('T')[0];
            }
        } catch (error) {
            // Invalid date, return empty
        }

        return '';
    }

    validatePropertyValue(propertyName, value, parameters) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        switch (propertyName) {
            case 'TEL':
                if (!this.validationPatterns.phone.test(value)) {
                    result.warnings.push(`Invalid phone number format: ${value}`);
                }
                break;
                
            case 'EMAIL':
                if (!this.validationPatterns.email.test(value)) {
                    result.warnings.push(`Invalid email format: ${value}`);
                }
                break;
                
            case 'URL':
                if (!this.validationPatterns.url.test(value)) {
                    result.warnings.push(`Invalid URL format: ${value}`);
                }
                break;
                
            case 'BDAY':
                if (!this.validationPatterns.date.test(value) && !this.validationPatterns.dateTime.test(value)) {
                    result.warnings.push(`Invalid birthday format: ${value}`);
                }
                break;
        }

        return result;
    }
}