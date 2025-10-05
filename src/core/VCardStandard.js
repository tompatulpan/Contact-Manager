/**
 * VCardStandard - Optimized RFC 9553 vCard 4.0 Standard Implementation
 * 
 * Key Optimizations:
 * - Centralized configuration system
 * - Performance caching
 * - Reduced code duplication
 * - Improved error handling
 * - Streamlined Apple compatibility
 */
export class VCardStandard {
    constructor() {
        this.version = '4.0';
        
        // Centralized configuration for vCard properties
        this.config = this.initializeConfiguration();
        
        // Performance caching
        this.cache = {
            parsedVCards: new Map(),
            displayData: new Map(),
            maxCacheSize: 100
        };
        
        // Pre-compiled regex patterns for performance
        this.patterns = this.initializePatterns();
    }

    /**
     * Initialize centralized configuration for vCard properties
     */
    initializeConfiguration() {
        return {
            // Standard vCard 4.0 properties
            properties: {
                VERSION: { required: true, multiValue: false, type: 'system' },
                FN: { required: true, multiValue: false, type: 'name' },
                N: { required: false, multiValue: false, type: 'name' },
                TEL: { required: false, multiValue: true, type: 'communication' },
                EMAIL: { required: false, multiValue: true, type: 'communication' },
                URL: { required: false, multiValue: true, type: 'communication' },
                ADR: { required: false, multiValue: true, type: 'location' },
                ORG: { required: false, multiValue: false, type: 'organization' },
                TITLE: { required: false, multiValue: false, type: 'organization' },
                NOTE: { required: false, multiValue: true, type: 'metadata' },
                BDAY: { required: false, multiValue: false, type: 'personal' },
                PHOTO: { required: false, multiValue: false, type: 'binary' },
                REV: { required: false, multiValue: false, type: 'system' }
            },

            // Type mappings for different properties
            types: {
                TEL: {
                    standard: ['work', 'home', 'cell', 'mobile', 'fax', 'voice', 'text'],
                    apple: ['WORK', 'HOME', 'MOBILE', 'MAIN', 'OTHER'],
                    validation: /^[+]?[\d\s\-\(\)\.]+$/
                },
                EMAIL: {
                    standard: ['work', 'home', 'other'],
                    apple: ['WORK', 'HOME', 'OTHER'],
                    validation: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                },
                URL: {
                    standard: ['work', 'home', 'other'],
                    apple: ['WORK', 'PERSONAL', 'OTHER', 'SOCIAL'],
                    validation: /^https?:\/\/.+/
                },
                ADR: {
                    standard: ['work', 'home', 'other'],
                    apple: ['WORK', 'HOME', 'OTHER'],
                    validation: null // Complex validation handled separately
                }
            },

            // Apple vCard 3.0 compatibility mappings
            apple: {
                typeMapping: {
                    phone: {
                        'MOBILE': 'cell',
                        'MAIN': 'work',
                        'OTHER': 'other'
                    },
                    email: {
                        'WORK': 'work',
                        'HOME': 'home',
                        'OTHER': 'other'
                    },
                    url: {
                        'PERSONAL': 'home',
                        'SOCIAL': 'other',
                        'OTHER': 'other'
                    },
                    address: {
                        'WORK': 'work',
                        'HOME': 'home',
                        'OTHER': 'other'
                    }
                }
            }
        };
    }

    /**
     * Initialize pre-compiled regex patterns for performance
     */
    initializePatterns() {
        return {
            unfoldContinuation: /^[\s\t]/,
            itemPrefix: /^ITEM\d+\./i,
            phoneValidation: /^[+]?[\d\s\-\(\)\.]+$/,
            emailValidation: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            urlValidation: /^https?:\/\/.+/,
            base64Data: /^[A-Za-z0-9+/=]{500,}$/,
            versionExtract: /VERSION:(.+)/,
            photoProperties: /^(PHOTO[:;]|.*ENCODING=B[ASE64]*[;:]|.*VND-63-SENSITIVE|.*X-SHARED-PHOTO)/i
        };
    }

    /**
     * Enhanced vCard parsing with caching and performance optimizations
     */
    parseVCard(vCardString, useCache = true) {
        if (!this.validateInput(vCardString)) {
            throw new Error('Invalid vCard string provided');
        }

        // Check cache first
        const cacheKey = this.generateCacheKey(vCardString);
        if (useCache && this.cache.parsedVCards.has(cacheKey)) {
            return this.cache.parsedVCards.get(cacheKey);
        }

        try {
            const contact = this.performParsing(vCardString);
            
            // Cache the result
            if (useCache) {
                this.cacheResult(this.cache.parsedVCards, cacheKey, contact);
            }
            
            return contact;
        } catch (error) {
            throw new Error(`vCard parsing failed: ${error.message}`);
        }
    }

    /**
     * Optimized vCard generation with template-based approach
     */
    generateVCard(contactData) {
        const generator = new VCardGenerator(this.config);
        return generator.generate(contactData);
    }

    /**
     * Enhanced display data extraction with caching
     */
    extractDisplayData(contact, useCache = true, suppressItemIdWarning = false) {
        // Validate contact has required properties
        if (!contact || !contact.vcard) {
            console.error('🚨 VCardStandard.extractDisplayData: Invalid contact object', contact);
            return null;
        }
        
        // Warn if contact is missing itemId (indicates potential issue)
        // Suppress warning during import operations or when explicitly requested
        if (!contact.itemId && contact.contactId && !suppressItemIdWarning && !contact.metadata?.isImported) {
            console.warn('⚠️ VCardStandard.extractDisplayData: Contact missing itemId:', contact.contactId);
        }
        
        const cacheKey = this.generateCacheKey(contact.vcard + (contact.contactId || contact.itemId || 'unknown'));
        
        if (useCache && this.cache.displayData.has(cacheKey)) {
            const cachedData = this.cache.displayData.get(cacheKey);
            // Ensure cached data also has itemId if source contact has it
            if (contact.itemId && !cachedData.itemId) {
                cachedData.itemId = contact.itemId;
            }
            return cachedData;
        }

        const vCardData = this.parseVCard(contact.vcard, useCache);
        const displayData = this.buildDisplayData(contact, vCardData);
        
        // Double-check that itemId is preserved
        if (contact.itemId && !displayData.itemId) {
            console.error('🚨 CRITICAL: itemId lost during buildDisplayData!', {
                contactId: contact.contactId,
                originalItemId: contact.itemId,
                displayDataKeys: Object.keys(displayData)
            });
            displayData.itemId = contact.itemId; // Emergency preservation
        }
        
        if (useCache) {
            this.cacheResult(this.cache.displayData, cacheKey, displayData);
        }
        
        return displayData;
    }

    /**
     * Streamlined Apple vCard detection and conversion
     */
    isAppleVCard(vCardString) {
        return vCardString.includes('VERSION:3.0') && 
               (this.patterns.itemPrefix.test(vCardString) || 
                vCardString.includes('type=') ||
                vCardString.includes('TYPE=PERSONAL'));
    }

    /**
     * Optimized Apple vCard import with unified processing
     */
    importFromAppleVCard(vCardString, cardName = null, markAsImported = true) {
        const processor = new AppleVCardProcessor(this.config);
        processor.setParentVCardStandard(this);
        return processor.import(vCardString, cardName, markAsImported);
    }

    /**
     * Export contact to Apple/iCloud compatible vCard 3.0 format
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
     * Convert standard vCard 4.0 to Apple vCard 3.0
     */
    convertStandardToApple(displayData) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:3.0\n';

        // Full Name
        if (displayData.fullName) {
            vcard += `FN:${this.escapeValue(displayData.fullName)}\n`;
            
            // Create structured name (N) from full name
            const nameParts = displayData.fullName.split(' ');
            const lastName = nameParts.pop() || '';
            const firstName = nameParts.join(' ') || '';
            vcard += `N:${this.escapeValue(lastName)};${this.escapeValue(firstName)};;;\n`;
        }

        // Convert multi-value properties to Apple format
        vcard += this.convertPropertiesToApple(displayData);

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

    convertPropertiesToApple(displayData) {
        let output = '';

        // Phone numbers with Apple formatting
        if (displayData.phones && displayData.phones.length > 0) {
            displayData.phones.forEach(phone => {
                const appleType = this.convertToApplePhoneType(phone.type);
                const pref = phone.primary ? ';pref' : '';
                output += `TEL;type=${appleType}${pref}:${this.escapeValue(phone.value)}\n`;
            });
        }

        // Email addresses with Apple formatting
        if (displayData.emails && displayData.emails.length > 0) {
            displayData.emails.forEach(email => {
                const appleType = this.convertToAppleEmailType(email.type);
                const pref = email.primary ? ';pref' : '';
                output += `EMAIL;type=${appleType}${pref}:${this.escapeValue(email.value)}\n`;
            });
        }

        // URLs with Apple type handling
        if (displayData.urls && displayData.urls.length > 0) {
            displayData.urls.forEach(url => {
                const appleType = this.convertToAppleUrlType(url.type);
                const pref = url.primary ? ';pref' : '';
                output += `URL;type=${appleType}${pref}:${this.escapeValue(url.value)}\n`;
            });
        }

        // Addresses with Apple formatting
        if (displayData.addresses && displayData.addresses.length > 0) {
            displayData.addresses.forEach(address => {
                const appleType = this.convertToAppleAddressType(address.type);
                const pref = address.primary ? ';pref' : '';
                const adrValue = this.formatAddressValue(address);
                output += `ADR;type=${appleType}${pref}:${adrValue}\n`;
            });
        } else {
            // Default empty address for Apple compatibility
            output += 'ADR:;;;;;;;\n';
        }

        return output;
    }

    // Apple type conversion helpers
    convertToApplePhoneType(standardType) {
        const mapping = {
            'work': 'WORK',
            'home': 'HOME',
            'cell': 'MOBILE',
            'mobile': 'MOBILE'
        };
        return mapping[standardType?.toLowerCase()] || 'WORK';
    }

    convertToAppleEmailType(standardType) {
        const mapping = {
            'work': 'WORK',
            'home': 'HOME'
        };
        return mapping[standardType?.toLowerCase()] || 'HOME';
    }

    convertToAppleUrlType(standardType) {
        const mapping = {
            'work': 'WORK',
            'home': 'PERSONAL',
            'other': 'OTHER'
        };
        return mapping[standardType?.toLowerCase()] || 'OTHER';
    }

    convertAppleUrlType(appleType) {
        if (!appleType) return 'other';
        const type = appleType.toLowerCase();
        const mapping = {
            'work': 'work',
            'home': 'home', 
            'personal': 'home',
            'social': 'other',
            'other': 'other'
        };
        
        // Preserve original type if it's a recognized standard type
        if (['work', 'home', 'other'].includes(type)) {
            return type;
        }
        
        return mapping[type] || 'other';
    }

    convertToAppleAddressType(standardType) {
        const mapping = {
            'work': 'WORK',
            'home': 'HOME',
            'other': 'OTHER'
        };
        return mapping[standardType?.toLowerCase()] || 'HOME';
    }

    formatAddressValue(address) {
        const addressParts = [
            address.poBox || '',
            address.extended || '',
            address.street || '',
            address.city || '',
            address.state || '',
            address.postalCode || '',
            address.country || ''
        ];
        
        // Don't escape semicolons in addresses - they are field separators
        return addressParts.map(part => this.escapeAddressValue(part)).join(';');
    }

    escapeAddressValue(value) {
        if (typeof value !== 'string') return String(value);
        // Don't escape semicolons in address values - they are structural separators
        return value
            .replace(/\\/g, '\\\\')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    /**
     * Performance-optimized line unfolding
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
     * Optimized photo filtering with better pattern matching
     */
    filterPhotosFromVCard(vCardString) {
        const lines = this.unfoldLines(vCardString);
        const filteredLines = [];
        let skipProperty = false;
        let skippedCount = 0;

        for (const line of lines) {
            if (skipProperty) {
                if (this.patterns.unfoldContinuation.test(line)) {
                    continue;
                } else {
                    skipProperty = false;
                }
            }

            if (this.patterns.photoProperties.test(line)) {
                skipProperty = true;
                skippedCount++;
                continue;
            }

            filteredLines.push(line);
        }

        if (skippedCount > 0) {
            console.log(`✂️ Filtered ${skippedCount} photo properties`);
        }

        return filteredLines.join('\n');
    }

    // ========== PRIVATE HELPER METHODS ==========

    validateInput(vCardString) {
        return vCardString && 
               typeof vCardString === 'string' && 
               vCardString.trim().length > 0;
    }

    performParsing(vCardString) {
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
                const parsed = this.parseLine(line);
                this.addPropertyToContact(contact, parsed);
            } catch (error) {
                console.warn(`Failed to parse line: "${line}"`, error);
            }
        }

        return contact;
    }

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

        // Clean property name
        let cleanProperty = property.toUpperCase();
        if (this.patterns.itemPrefix.test(cleanProperty)) {
            cleanProperty = cleanProperty.replace(this.patterns.itemPrefix, '');
        }

        return {
            property: cleanProperty,
            parameters: this.parseParameters(parametersString),
            value: this.unescapeValue(value)
        };
    }

    parseParameters(parametersString) {
        const parameters = {};
        if (!parametersString) return parameters;

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

    addPropertyToContact(contact, { property, parameters, value }) {
        if (!contact.properties.has(property)) {
            contact.properties.set(property, []);
        }

        const propertyConfig = this.config.properties[property];
        const propertyValue = { value, parameters };

        if (propertyConfig && !propertyConfig.multiValue) {
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

    buildDisplayData(contact, vCardData) {
        // CRITICAL: Always preserve itemId when available
        const baseData = {
            contactId: contact.contactId,
            cardName: contact.cardName,
            fullName: vCardData.properties.get('FN') || 'Unnamed Contact',
            structuredName: this.normalizeStructuredName(vCardData.properties.get('N')) || '', // Properly normalize N property
            organization: this.normalizeOrganizationValue(vCardData.properties.get('ORG')) || '',
            title: vCardData.properties.get('TITLE') || '',
            phones: this.extractMultiValueProperty(vCardData, 'TEL'),
            emails: this.extractMultiValueProperty(vCardData, 'EMAIL'),
            urls: this.extractMultiValueProperty(vCardData, 'URL'),
            addresses: this.extractMultiValueProperty(vCardData, 'ADR'),
            notes: this.extractNotesProperty(vCardData),
            birthday: vCardData.properties.get('BDAY') || '',
            lastUpdated: contact.metadata?.lastUpdated || '',
            isOwned: contact.metadata?.isOwned || false
        };
        
        // CRITICAL: Preserve Userbase itemId if present
        if (contact.itemId) {
            baseData.itemId = contact.itemId;
        }
        
        return baseData;
    }

    extractMultiValueProperty(vCardData, property) {
        const values = vCardData.properties.get(property) || [];
        if (!Array.isArray(values)) {
            return [this.normalizePropertyValue(values, property)];
        }
        return values.map(value => this.normalizePropertyValue(value, property));
    }

    normalizePropertyValue(value, property) {
        if (typeof value === 'string') {
            if (property === 'ADR') {
                return { ...this.parseAddressValue(value), type: 'other', primary: false };
            }
            return { value, type: 'other', primary: false };
        }
        
        const baseObj = {
            type: this.normalizeTypeValue(value.parameters?.TYPE || 'other'),
            primary: value.parameters?.PREF === '1' || value.parameters?.PREF === 1
        };

        if (property === 'ADR') {
            return { ...this.parseAddressValue(value.value || ''), ...baseObj };
        }
        
        return { value: value.value || '', ...baseObj };
    }

    normalizeTypeValue(type) {
        if (!type) return 'other';
        
        const lowerType = type.toLowerCase();
        if (lowerType === 'pref') return 'other';
        
        if (lowerType.includes(',')) {
            const types = lowerType.split(',').map(t => t.trim());
            if (types.includes('mobile') || types.includes('cell')) return 'cell';
            if (types.includes('home')) return 'home';
            if (types.includes('work')) return 'work';
            return 'other';
        }
        
        return lowerType;
    }

    // ========== CACHING METHODS ==========

    generateCacheKey(input) {
        // Simple hash function for cache keys
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    cacheResult(cache, key, value) {
        if (cache.size >= this.cache.maxCacheSize) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        cache.set(key, value);
    }

    clearCache() {
        this.cache.parsedVCards.clear();
        this.cache.displayData.clear();
    }

    // ========== UTILITY METHODS (Preserved from original) ==========

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

    normalizeStructuredName(nValue) {
        console.log('🔧 normalizeStructuredName input:', {
            nValue,
            type: typeof nValue,
            isArray: Array.isArray(nValue),
            hasValue: nValue && nValue.value,
            toString: nValue ? nValue.toString() : 'null'
        });
        
        if (!nValue) {
            console.log('❌ normalizeStructuredName: null/undefined value');
            return '';
        }
        
        // If it's already a string, return it (but check for [object Object])
        if (typeof nValue === 'string') {
            if (nValue === '[object Object]') {
                console.log('❌ normalizeStructuredName: found [object Object] string');
                return '';
            }
            console.log('✅ normalizeStructuredName: returning string value:', nValue);
            return nValue;
        }
        
        // If it's an object with a value property, use that
        if (typeof nValue === 'object' && nValue.value) {
            const result = String(nValue.value);
            console.log('✅ normalizeStructuredName: extracted value property:', result);
            return result;
        }
        
        // If it's an array (multiple N properties), take the first one
        if (Array.isArray(nValue) && nValue.length > 0) {
            const firstN = nValue[0];
            if (typeof firstN === 'string') {
                console.log('✅ normalizeStructuredName: using first array element:', firstN);
                return firstN;
            }
            if (firstN && firstN.value) {
                const result = String(firstN.value);
                console.log('✅ normalizeStructuredName: using first array element value:', result);
                return result;
            }
        }
        
        // Last resort: convert to string but avoid [object Object]
        const stringResult = String(nValue);
        if (stringResult === '[object Object]') {
            console.log('❌ normalizeStructuredName: String() produced [object Object], returning empty');
            return '';
        }
        
        console.log('⚠️ normalizeStructuredName: fallback string conversion:', stringResult);
        return stringResult;
    }

    extractNotesProperty(vCardData) {
        const noteValues = vCardData.properties.get('NOTE') || [];
        if (!Array.isArray(noteValues)) {
            if (typeof noteValues === 'string') return [noteValues];
            if (noteValues && noteValues.value) return [noteValues.value];
            return [];
        }
        return noteValues.map(note => {
            if (typeof note === 'string') return note;
            if (note && note.value) return note.value;
            return '';
        }).filter(note => note.length > 0);
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

    validateVCard(vCardString) {
        const errors = [];
        const warnings = [];

        try {
            if (!vCardString.includes('BEGIN:VCARD')) {
                errors.push('Missing BEGIN:VCARD');
            }
            if (!vCardString.includes('END:VCARD')) {
                errors.push('Missing END:VCARD');
            }

            const contact = this.parseVCard(vCardString);
            
            // Check required properties
            for (const [property, config] of Object.entries(this.config.properties)) {
                if (config.required && !contact.properties.has(property)) {
                    errors.push(`Missing required property: ${property}`);
                }
            }

            const version = this.extractVersion(vCardString);
            if (version !== '4.0') {
                warnings.push(`Non-standard version: ${version}, expected 4.0`);
            }

            return { isValid: errors.length === 0, version, errors, warnings };
        } catch (error) {
            return {
                isValid: false,
                version: null,
                errors: [`Parse error: ${error.message}`],
                warnings
            };
        }
    }

    extractVersion(vCardString) {
        const match = vCardString.match(this.patterns.versionExtract);
        return match ? match[1].trim() : null;
    }

    exportAsVCard(contact) {
        // Generate fresh vCard from display data instead of using raw contact.vcard
        const displayData = this.extractDisplayData(contact);
        
        // Convert displayData to contactData format for VCardGenerator
        const contactData = this.convertDisplayDataToContactData(displayData);
        
        const freshVCard = this.generateVCard(contactData);
        const filename = `${displayData.fullName.replace(/[^a-zA-Z0-9]/g, '_')}.vcf`;
        
        return {
            filename,
            content: freshVCard,
            mimeType: 'text/vcard;charset=utf-8'
        };
    }

    /**
     * Convert display data format to contact data format for VCardGenerator
     */
    convertDisplayDataToContactData(displayData) {
        console.log('🔄 convertDisplayDataToContactData input:', displayData);
        console.log('🔍 displayData.fullName:', displayData.fullName, 'type:', typeof displayData.fullName);
        console.log('🔍 displayData.structuredName:', displayData.structuredName, 'type:', typeof displayData.structuredName);
        
        const contactData = {
            fn: displayData.fullName,
            structuredName: displayData.structuredName || '', // Preserve structured name
            organization: displayData.organization,
            title: displayData.title,
            birthday: displayData.birthday,
            phones: displayData.phones || [],
            emails: displayData.emails || [],
            urls: displayData.urls || [],
            addresses: displayData.addresses || [],
            notes: displayData.notes || []
        };
        
        console.log('🔄 convertDisplayDataToContactData output:', contactData);
        console.log('🔍 contactData.fn:', contactData.fn, 'type:', typeof contactData.fn);
        console.log('🔍 contactData.structuredName:', contactData.structuredName, 'type:', typeof contactData.structuredName);
        
        return contactData;
    }

    generateQRCodeData(contact) {
        return contact.vcard;
    }

    importFromVCard(vCardString, cardName = null, markAsImported = true) {
        const filteredVCardString = this.filterPhotosFromVCard(vCardString);
        
        if (this.isAppleVCard(filteredVCardString)) {
            return this.importFromAppleVCard(filteredVCardString, cardName, markAsImported);
        }

        const validation = this.validateVCard(filteredVCardString);
        if (!validation.isValid) {
            throw new Error(`Invalid vCard: ${validation.errors.join(', ')}`);
        }

        const displayData = this.extractDisplayData({ vcard: filteredVCardString });
        
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: [],
            photosFiltered: filteredVCardString !== vCardString
        };

        if (markAsImported) {
            metadata.isImported = true;
        }
        
        return {
            contactId: this.generateContactId(),
            cardName: cardName || displayData.fullName || 'Imported Contact',
            vcard: filteredVCardString,
            metadata
        };
    }
}

/**
 * Separate class for vCard generation to reduce main class complexity
 */
class VCardGenerator {
    constructor(config) {
        this.config = config;
    }

    generate(contactData) {
        let vcard = 'BEGIN:VCARD\n';
        vcard += 'VERSION:4.0\n';

        // Essential properties
        if (contactData.fn) {
            // Ensure fn is a string (handle cases where it might be an object)
            const fullName = typeof contactData.fn === 'string' ? contactData.fn : String(contactData.fn);
            vcard += `FN:${this.escapeValue(fullName)}\n`;
            
            // Debug structured name handling
            console.log('🔧 VCardGenerator structuredName debug:', {
                structuredName: contactData.structuredName,
                type: typeof contactData.structuredName,
                isString: typeof contactData.structuredName === 'string',
                trimmed: contactData.structuredName?.trim ? contactData.structuredName.trim() : 'no-trim'
            });
            
            // Use existing structured name if available and valid, otherwise generate from full name
            if (contactData.structuredName && 
                typeof contactData.structuredName === 'string' && 
                contactData.structuredName.trim() &&
                contactData.structuredName !== '[object Object]') {
                
                console.log('✅ Using existing structured name:', contactData.structuredName);
                vcard += `N:${this.escapeValue(contactData.structuredName)}\n`;
            } else {
                console.log('⚠️ Generating structured name from full name due to invalid structured name:', contactData.structuredName);
                // Generate structured name (N) from full name as fallback
                const nameParts = fullName.split(' ');
                const lastName = nameParts.pop() || '';
                const firstName = nameParts.join(' ') || '';
                
                const escapedLastName = this.escapeValue(lastName);
                const escapedFirstName = this.escapeValue(firstName);
                
                const generatedN = `${escapedLastName};${escapedFirstName};;;`;
                console.log('🔧 Generated N property:', generatedN);
                vcard += `N:${generatedN}\n`;
            }
        }

        // Multi-value properties
        vcard += this.generateMultiValueProperties(contactData);
        
        // Single-value properties
        vcard += this.generateSingleValueProperties(contactData);

        // System properties
        vcard += `REV:${new Date().toISOString()}\n`;
        vcard += 'END:VCARD';
        
        return vcard;
    }

    generateMultiValueProperties(contactData) {
        let output = '';
        
        const multiValueProps = ['phones', 'emails', 'urls', 'addresses'];
        const vCardProps = ['TEL', 'EMAIL', 'URL', 'ADR'];
        
        for (let i = 0; i < multiValueProps.length; i++) {
            const propName = multiValueProps[i];
            const vCardProp = vCardProps[i];
            
            if (contactData[propName] && contactData[propName].length > 0) {
                output += this.generatePropertyGroup(contactData[propName], vCardProp);
            }
        }
        
        return output;
    }

    generatePropertyGroup(properties, vCardProp) {
        let output = '';
        const hasPrimary = properties.some(prop => prop.primary);
        
        properties.forEach((prop, index) => {
            const params = this.buildParameters({
                type: prop.type,
                pref: prop.primary || (!hasPrimary && index === 0)
            });
            
            let value;
            if (vCardProp === 'ADR') {
                value = this.formatAddressValue(prop);
            } else {
                value = this.escapeValue(prop.value);
            }
            
            output += `${vCardProp}${params}:${value}\n`;
        });
        
        return output;
    }

    generateSingleValueProperties(contactData) {
        let output = '';
        
        const singleProps = {
            'organization': 'ORG',
            'title': 'TITLE',
            'birthday': 'BDAY'
        };
        
        for (const [dataKey, vCardProp] of Object.entries(singleProps)) {
            if (contactData[dataKey]) {
                output += `${vCardProp}:${this.escapeValue(contactData[dataKey])}\n`;
            }
        }
        
        // Handle notes array
        if (contactData.notes && contactData.notes.length > 0) {
            contactData.notes.forEach(note => {
                output += `NOTE:${this.escapeValue(note)}\n`;
            });
        }
        
        return output;
    }

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

    formatAddressValue(address) {
        const addressParts = [
            address.poBox || '',
            address.extended || '',
            address.street || '',
            address.city || '',
            address.state || '',
            address.postalCode || '',
            address.country || ''
        ];
        
        // Don't escape semicolons in addresses - they are field separators
        return addressParts.map(part => this.escapeAddressValue(part)).join(';');
    }

    escapeAddressValue(value) {
        if (typeof value !== 'string') return String(value);
        // Don't escape semicolons in address values - they are structural separators
        return value
            .replace(/\\/g, '\\\\')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    escapeValue(value) {
        if (typeof value !== 'string') return String(value);
        return value
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }
}

/**
 * Separate class for Apple vCard processing to reduce main class complexity
 */
class AppleVCardProcessor {
    constructor(config) {
        this.config = config;
        this.vCardStandard = null; // Will be set by parent class
    }

    setParentVCardStandard(vCardStandard) {
        this.vCardStandard = vCardStandard;
    }

    import(vCardString, cardName = null, markAsImported = true) {
        console.log('🍎 Importing Apple/iCloud vCard 3.0...');
        
        // Filter photos before processing
        const filteredVCardString = this.vCardStandard ? 
            this.vCardStandard.filterPhotosFromVCard(vCardString) : vCardString;
        
        // Parse Apple vCard
        const appleContact = this.parseAppleVCard(filteredVCardString);
        
        // Convert to standard vCard 4.0
        const vCard40String = this.convertToStandard(appleContact);
        
        // Extract display data
        const displayData = this.vCardStandard ? 
            this.vCardStandard.extractDisplayData({ vcard: vCard40String }) :
            { fullName: 'Apple Import' };
        
        const metadata = {
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            isOwned: true,
            isArchived: false,
            sharedWith: [],
            importSource: 'apple_icloud_3.0',
            photosFiltered: filteredVCardString !== vCardString
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
                const parsed = this.parseAppleLine(line);
                this.addPropertyToContact(contact, parsed);
            } catch (error) {
                console.warn(`Failed to parse Apple vCard line: "${line}"`, error);
            }
        }

        return contact;
    }

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

        // Handle Apple item prefixes
        let cleanProperty = property.toUpperCase();
        if (cleanProperty.match(/^ITEM\d+\./)) {
            cleanProperty = cleanProperty.replace(/^ITEM\d+\./, '');
        }

        return {
            property: cleanProperty,
            parameters,
            value: this.unescapeValue(value)
        };
    }

    parseAppleParameters(parametersString) {
        const parameters = {};
        if (!parametersString) return parameters;

        const params = parametersString.split(';');
        for (const param of params) {
            const equalIndex = param.indexOf('=');
            if (equalIndex !== -1) {
                const key = param.substring(0, equalIndex).toLowerCase();
                const value = param.substring(equalIndex + 1);
                
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

    convertToStandard(appleContact) {
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
            console.log('🔧 Apple convertToStandard N property:', { type: typeof n, value: n, toString: String(n) });
            
            let nValue = n;
            if (typeof n === 'object' && n !== null) {
                if (Array.isArray(n) && n.length > 0) {
                    nValue = n[0].value || n[0]; // Extract from array of objects
                } else if (n.value) {
                    nValue = n.value; // Extract from single object
                }
            }
            
            console.log('🔧 Apple N final value:', { nValue, type: typeof nValue });
            vcard += `N:${this.escapeValue(nValue)}\n`;
        }

        // Convert Apple properties to standard
        vcard += this.convertAppleProperties(appleContact);

        // Add revision timestamp
        vcard += `REV:${new Date().toISOString()}\n`;
        vcard += 'END:VCARD';
        
        return vcard;
    }

    convertAppleProperties(appleContact) {
        let output = '';

        // Phone numbers
        const phones = appleContact.properties.get('TEL') || [];
        phones.forEach(phone => {
            const type = this.convertApplePhoneType(phone.parameters?.TYPE);
            const isPref = this.isApplePref(phone.parameters);
            const pref = isPref ? ';PREF=1' : '';
            output += `TEL;TYPE=${type}${pref}:${this.escapeValue(phone.value)}\n`;
        });

        // Email addresses
        const emails = appleContact.properties.get('EMAIL') || [];
        emails.forEach(email => {
            const type = this.convertAppleEmailType(email.parameters?.TYPE);
            const isPref = this.isApplePref(email.parameters);
            const pref = isPref ? ';PREF=1' : '';
            output += `EMAIL;TYPE=${type}${pref}:${this.escapeValue(email.value)}\n`;
        });

        // URLs
        const urls = appleContact.properties.get('URL') || [];
        urls.forEach(url => {
            const type = this.convertAppleUrlType(url.parameters?.TYPE);
            const pref = url.parameters?.PREF ? ';PREF=1' : '';
            output += `URL;TYPE=${type}${pref}:${this.escapeValue(url.value)}\n`;
        });

        // Addresses
        const addresses = appleContact.properties.get('ADR') || [];
        addresses.forEach(addr => {
            const addressValue = addr.value || addr;
            const type = this.convertAppleAddressType(addr.parameters?.TYPE);
            const pref = addr.parameters?.PREF ? ';PREF=1' : '';
            
            const formattedAddress = typeof addressValue === 'string' ? 
                addressValue.replace(/\\n/g, '\\,') : addressValue;
            
            if (type && type !== 'other') {
                output += `ADR;TYPE=${type}${pref}:${this.escapeValue(formattedAddress)}\n`;
            } else {
                output += `ADR${pref}:${this.escapeValue(formattedAddress)}\n`;
            }
        });

        // Organization and other single properties
        const org = appleContact.properties.get('ORG');
        if (org) output += `ORG:${this.escapeValue(org)}\n`;

        const title = appleContact.properties.get('TITLE');
        if (title) output += `TITLE:${this.escapeValue(title)}\n`;

        // Birthday
        const bday = appleContact.properties.get('BDAY');
        if (bday) output += `BDAY:${this.escapeValue(bday)}\n`;

        // Notes
        const notes = appleContact.properties.get('NOTE') || [];
        if (Array.isArray(notes)) {
            notes.forEach(note => {
                output += `NOTE:${this.escapeValue(note.value || note)}\n`;
            });
        } else if (notes) {
            output += `NOTE:${this.escapeValue(notes)}\n`;
        }

        return output;
    }

    // Type conversion methods
    convertApplePhoneType(appleType) {
        if (!appleType) return 'other';
        const types = appleType.toLowerCase().split(',').map(t => t.trim());
        if (types.includes('mobile') || types.includes('cell')) return 'cell';
        if (types.includes('home')) return 'home';
        if (types.includes('work')) return 'work';
        return 'other';
    }

    convertAppleEmailType(appleType) {
        if (!appleType) return 'other';
        const type = appleType.toLowerCase();
        return ['work', 'home'].includes(type) ? type : 'other';
    }

    convertAppleUrlType(appleType) {
        if (!appleType) return 'other';
        const type = appleType.toLowerCase();
        const mapping = {
            'work': 'work',
            'home': 'home', 
            'personal': 'home',
            'social': 'other',
            'other': 'other'
        };
        
        // Preserve original type if it's a recognized standard type
        if (['work', 'home', 'other'].includes(type)) {
            return type;
        }
        
        return mapping[type] || 'other';
    }

    convertAppleAddressType(appleType) {
        if (!appleType) return 'home';
        const mapping = {
            'work': 'work',
            'home': 'home',
            'pref': 'home',
            'other': 'other'
        };
        return mapping[appleType.toLowerCase()] || 'home';
    }

    isApplePref(parameters) {
        if (!parameters) return false;
        if (parameters.PREF) return true;
        const type = parameters.TYPE;
        return type && typeof type === 'string' && type.toLowerCase().includes('pref');
    }
    unfoldLines(vCardString) {
        const lines = vCardString.split(/\r?\n/);
        const unfolded = [];
        let currentLine = '';

        for (const line of lines) {
            if (line.startsWith(' ') || line.startsWith('\t')) {
                currentLine += line.substring(1);
            } else {
                if (currentLine) unfolded.push(currentLine);
                currentLine = line;
            }
        }

        if (currentLine) unfolded.push(currentLine);
        return unfolded.filter(line => line.trim().length > 0);
    }

    addPropertyToContact(contact, { property, parameters, value }) {
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

        // Store raw property
        if (!contact.rawProperties.has(property)) {
            contact.rawProperties.set(property, []);
        }
        contact.rawProperties.get(property).push(`${property}:${value}`);
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

    generateContactId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return 'contact_' + crypto.randomUUID();
        }
        return 'contact_' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}