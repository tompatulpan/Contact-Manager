/**
 * VCardStandard - Modernized RFC 9553 vCard Implementation with Structured Format Handling
 * 
 * This refactored version uses a structured approach with dedicated format managers:
 * - VCardFormatManager: Centralized version detection and format routing
 * - VCard3Processor: Specialized Apple/legacy vCard 3.0 handling
 * - VCard4Processor: RFC 9553 compliant vCard 4.0 processing
 * - Performance caching and optimized operations
 * - Clean separation of concerns
 */

import { VCardFormatManager } from './VCardFormatManager.js';

export class VCardStandard {
    constructor() {
        this.version = '3.0';  // ✅ Using vCard 3.0 (Baikal/iCloud standard)
        
        // Centralized configuration for vCard properties
        this.config = this.initializeConfiguration();
        
        // Initialize the format manager with structured processors
        this.formatManager = new VCardFormatManager(this.config);
        
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
            // Detect format and use appropriate processor
            const detection = this.formatManager.detectFormat(vCardString);
            
            if (!detection.isValid) {
                throw new Error(`Invalid vCard format: ${detection.errors.join(', ')}`);
            }
            
            // For backward compatibility, we need to parse using the legacy method
            const contact = this.performLegacyParsing(vCardString);
            
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
     * Generate vCard content (backward compatibility)
     * @param {Object} contactData - Contact data
     * @returns {string} Generated vCard content
     */
    generateVCard(contactData) {
        console.log('🔧 Generating vCard 3.0 (Baikal/iCloud standard)...');
        
        try {
            // Create a temporary contact object for the format manager
            const tempContact = {
                ...contactData,
                cardName: contactData.cardName || contactData.fn || 'Generated Contact'
            };
            
            const exportResult = this.formatManager.exportVCard(tempContact, 'vcard-3.0');
            return exportResult.content;
            
        } catch (error) {
            console.error('❌ vCard generation failed:', error);
            throw new Error(`vCard generation failed: ${error.message}`);
        }
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
        
        // 🔧 CRITICAL FIX: Delegate to VCard3Processor which has correct type parsing logic
        // VCard3Processor.extractDisplayData() properly handles "WORK,INTERNET" → "work"
        const displayData = this.formatManager.vCard3Processor.extractDisplayData(contact);
        
        return displayData;
    }

    /**
     * Detect if vCard is Apple/legacy format (backward compatibility)
     * @param {string} vCardString - vCard content
     * @returns {boolean} Is Apple vCard format
     */
    isAppleVCard(vCardString) {
        const detection = this.formatManager.detectFormat(vCardString);
        return detection.isValid && detection.version === '3.0';
    }

    /**
     * Import Apple vCard format (backward compatibility)
     * @param {string} vCardString - Apple vCard content
     * @param {string} cardName - Optional card name
     * @param {boolean} markAsImported - Mark as imported
     * @returns {Object} Processed contact
     */
    importFromAppleVCard(vCardString, cardName = null, markAsImported = true) {
        console.log('🍎 Importing Apple vCard via format manager...');
        return this.importFromVCard(vCardString, cardName, markAsImported);
    }

    importFromVCard(vCardString, cardName = null, markAsImported = true) {
        console.log('📥 Importing vCard using structured format manager...');
        
        try {
            // Filter photos before processing
            const filteredVCardString = this.filterPhotosFromVCard(vCardString);
            
            // Use format manager for automatic version detection and processing
            const result = this.formatManager.importVCard(filteredVCardString, cardName, markAsImported);
            
            // Handle the structured result from formatManager
            if (!result.success) {
                throw new Error(result.error || 'Import failed');
            }
            
            const contact = result.contact;
            
            // Add photo filtering metadata
            if (contact.metadata) {
                contact.metadata.photosFiltered = filteredVCardString !== vCardString;
            } else {
                contact.metadata = {
                    photosFiltered: filteredVCardString !== vCardString
                };
            }
            
            console.log('✅ vCard import completed via format manager');
            return contact;
            
        } catch (error) {
            console.error('❌ Structured vCard import failed:', error);
            throw new Error(`vCard import failed: ${error.message}`);
        }
    }

    exportAsVCard(contact) {
        console.log('📤 Exporting vCard using structured format manager...');
        
        try {
            // Use format manager for vCard 3.0 export (Baikal/iCloud standard)
            const exportResult = this.formatManager.exportVCard(contact, 'vcard-3.0');
            
            console.log('✅ vCard 3.0 export completed via format manager');
            return exportResult;
            
        } catch (error) {
            console.error('❌ Structured vCard export failed:', error);
            throw new Error(`vCard export failed: ${error.message}`);
        }
    }

    exportAsAppleVCard(contact) {
        console.log('🍎 Exporting to Apple/iCloud vCard 3.0 using format manager...');
        
        try {
            // Use format manager for vCard 3.0 export (Apple/legacy)
            const exportResult = this.formatManager.exportVCard(contact, 'vcard-3.0');
            
            console.log('✅ Apple vCard 3.0 export completed via format manager');
            return exportResult;
            
        } catch (error) {
            console.error('❌ Structured Apple vCard export failed:', error);
            throw new Error(`Apple vCard export failed: ${error.message}`);
        }
    }

    validateVCard(vCardString) {
        console.log('🔍 Validating vCard using structured format manager...');
        
        try {
            // Use format manager for comprehensive validation
            const validation = this.formatManager.validateVCard(vCardString);
            
            console.log(`✅ vCard validation completed: ${validation.isValid ? 'VALID' : 'INVALID'}`);
            return validation;
            
        } catch (error) {
            console.error('❌ vCard validation failed:', error);
            return {
                isValid: false,
                version: null,
                errors: [`Validation error: ${error.message}`],
                warnings: []
            };
        }
    }

    generateQRCodeData(contact) {
        return contact.vcard;
    }

    /**
     * Get supported vCard formats and their capabilities
     * @returns {Object} Format information
     */
    getSupportedFormats() {
        return this.formatManager.getSupportedFormats();
    }

    /**
     * Convert vCard from one format to another
     * @param {string} vCardString - Source vCard content
     * @param {string} targetVersion - Target version ('3.0' or '4.0')
     * @returns {Object} Conversion result
     */
    convertVCardFormat(vCardString, targetVersion) {
        return this.formatManager.convertVCard(vCardString, targetVersion);
    }

    /**
     * Detect vCard format and version
     * @param {string} vCardString - vCard content to analyze
     * @returns {Object} Detection result
     */
    detectVCardFormat(vCardString) {
        return this.formatManager.detectFormat(vCardString);
    }

    /**
     * Clear format manager caches
     */
    clearCache() {
        this.cache.parsedVCards.clear();
        this.cache.displayData.clear();
        this.formatManager.clearCache();
    }

    /**
     * Get cache statistics from format manager and local caches
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            local: {
                parsedVCards: this.cache.parsedVCards.size,
                displayData: this.cache.displayData.size,
                maxSize: this.cache.maxCacheSize
            },
            formatManager: this.formatManager.getCacheStats()
        };
    }

    /**
     * RFC 6350 compliant line unfolding
     * Lines starting with space or tab are continuations of the previous line
     * This fixes multi-line vCard properties from Apple/iCloud exports
     * 
     * CRITICAL: Preserves escaped newlines (\n) in property values during unfolding
     */
    unfoldLines(vCardString) {
        if (!vCardString) return [];
        
        // Step 1: Protect escaped newlines by replacing them with a placeholder
        // This prevents them from being treated as actual line breaks
        const NEWLINE_PLACEHOLDER = '\u0000ESCAPED_NEWLINE\u0000';
        const protectedStr = vCardString.replace(/\\n/g, NEWLINE_PLACEHOLDER);
        
        // Step 2: Split on actual line breaks (not escaped \n)
        const lines = protectedStr.split(/\r\n|\r|\n/);
        const unfolded = [];
        let currentLine = '';

        for (const line of lines) {
            // RFC 6350: Lines starting with space/tab are continuations
            if (line.startsWith(' ') || line.startsWith('\t')) {
                // Remove leading whitespace and append to current line
                currentLine += line.substring(1);
            } else {
                // New property line
                if (currentLine) {
                    unfolded.push(currentLine);
                }
                currentLine = line;
            }
        }

        // Add last line
        if (currentLine) {
            unfolded.push(currentLine);
        }

        // Step 3: Restore escaped newlines in the unfolded lines
        const restored = unfolded
            .filter(line => line.trim().length > 0)
            .map(line => line.replace(new RegExp(NEWLINE_PLACEHOLDER, 'g'), '\\n'));
        
        return restored;
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

    performLegacyParsing(vCardString) {
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
                const parsed = this.parseLine(line);
                if (parsed) { // Only add if parsing was successful and returned a result
                    this.addPropertyToContact(contact, parsed);
                }
            } catch (error) {
                console.warn(`Failed to parse line: "${line}"`, error);
            }
        }

        return contact;
    }

    parseLine(line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            // Check if this might be a malformed address component (common in imported vCards)
            if (this.isMalformedAddressComponent(line)) {
                // Skip malformed address components gracefully
                console.warn(`Skipping malformed address component: "${line}"`);
                return null;
            }
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
                
                // Filter out CHARSET parameter as it's a parsing hint, not contact data
                if (key === 'CHARSET') {
                    continue; // Skip adding CHARSET to parameters
                }
                
                parameters[key] = value;
            }
        }

        return parameters;
    }

    /**
     * Check if a line appears to be a malformed address component
     * Common patterns from imported vCards that break parsing
     */
    isMalformedAddressComponent(line) {
        const trimmedLine = line.trim();
        
        // Skip empty lines
        if (!trimmedLine) return true;
        
        // Common malformed address patterns:
        // - City names without property prefix: "STOCKHOLM", "TÄBY", "EKERÖ"
        // - Postal codes with semicolons: "187 76;;;;", "178 34;;;;"
        // - Standalone postal codes: "112 23", "182 54"
        // - Country names: "Sweden;;;;"
        
        // Pattern 1: Lines that end with multiple semicolons (malformed address components)
        if (/;;;;\s*$/.test(trimmedLine)) {
            return true;
        }
        
        // Pattern 2: Lines that look like Swedish postal codes (5 digits with space)
        if (/^\d{3}\s\d{2}$/.test(trimmedLine)) {
            return true;
        }
        
        // Pattern 3: Lines that look like city names (all caps, Swedish characters)
        if (/^[A-ZÅÄÖ\s]+$/.test(trimmedLine) && trimmedLine.length > 2 && trimmedLine.length < 30) {
            return true;
        }
        
        // Pattern 4: Lines that look like country names followed by semicolons
        if (/^[A-Za-zÅÄÖåäö\s]+;;;;\s*$/.test(trimmedLine)) {
            return true;
        }
        
        return false;
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
            structuredName: this.normalizeStructuredName(vCardData.properties.get('N')) || '',
            organization: this.normalizeOrganizationValue(vCardData.properties.get('ORG')) || '',
            title: vCardData.properties.get('TITLE') || '',
            phones: this.extractMultiValueProperty(vCardData, 'TEL'),
            emails: this.extractMultiValueProperty(vCardData, 'EMAIL'),
            urls: this.extractMultiValueProperty(vCardData, 'URL'),
            addresses: this.extractMultiValueProperty(vCardData, 'ADR'),
            notes: this.extractNotesProperty(vCardData),
            birthday: this.validateAndFormatBirthday(vCardData.properties.get('BDAY') || ''),
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

    // ========== UTILITY METHODS ==========

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
        
        // Extract and unescape street component
        let street = this.unescapeValue(parts[2] || '');
        
        // Extract raw components
        let postalCode = this.unescapeValue(parts[5] || '');
        let city = this.unescapeValue(parts[3] || '');
        let country = this.unescapeValue(parts[6] || '');
        
        // Handle newlines in street address (e.g., "Bergsgatan 5\n112 23 Stockholm")
        // This occurs when vCards have escaped newlines that should be parsed as separate components
        if (street && street.includes('\n')) {
            const streetLines = street.split('\n').map(s => s.trim()).filter(s => s);
            
            if (streetLines.length > 1) {
                // Try to extract postal code, city, and country from the newline-separated components
                const lastLine = streetLines[streetLines.length - 1];
                const secondLastLine = streetLines.length > 2 ? streetLines[streetLines.length - 2] : null;
                
                // Pattern 1: Last line is "Postal City" (e.g., "112 23 Stockholm")
                // Swedish postal: 3 digits + space + 2 digits, then city name
                const postalCityMatch = lastLine.match(/^(\d{3}\s\d{2})\s+(.+)$/) || 
                                       lastLine.match(/^(\d{5,6})\s+(.+)$/);
                
                if (postalCityMatch && !postalCode) {
                    // Extract postal code and city from last line
                    postalCode = postalCityMatch[1];
                    city = postalCityMatch[2];
                    streetLines.pop();
                } 
                // Pattern 2: Last line is just postal code (e.g., "179 63" or "17963")
                else if (lastLine.match(/^\d{3}\s\d{2}$/) || lastLine.match(/^\d{5,6}$/)) {
                    if (!postalCode) {
                        postalCode = lastLine;
                        streetLines.pop();
                        
                        // Check if second-last line is the city (not a number)
                        if (secondLastLine && !secondLastLine.match(/^\d/) && !city) {
                            city = secondLastLine;
                            streetLines.pop();
                        }
                    }
                }
                // Pattern 3: Last line might be country/city without postal code
                else if (!lastLine.match(/^\d/) && !city) {
                    // If it's likely a city or country name (no numbers at start)
                    // and city is empty, use it as city
                    city = lastLine;
                    streetLines.pop();
                }
                
                // Join remaining lines as street address
                street = streetLines.join(', ');
            }
        }
        
        // Fix malformed postal codes from Apple/iCloud exports
        // Swedish format: "123 45" or sometimes "12345 CITYNAME"
        if (postalCode) {
            // Extract postal code pattern: digits with optional space/dash
            const postalMatch = postalCode.match(/^(\d[\d\s-]*\d|\d+)/);
            if (postalMatch) {
                const extractedPostal = postalMatch[1];
                // Remaining text after postal code goes to city if city is empty
                const remainingText = postalCode.substring(extractedPostal.length).trim();
                if (remainingText && !city) {
                    city = remainingText;
                }
                postalCode = extractedPostal;
            }
        }
        
        return {
            poBox: this.unescapeValue(parts[0] || ''),
            extended: this.unescapeValue(parts[1] || ''),
            street: street,
            city: city,
            state: this.unescapeValue(parts[4] || ''),
            postalCode: postalCode,
            country: country
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
        if (!nValue) return '';
        
        // If it's already a string, return it
        if (typeof nValue === 'string') {
            if (nValue === '[object Object]') return '';
            return nValue;
        }
        
        // If it's an object with a value property, use that
        if (typeof nValue === 'object' && nValue.value) {
            return String(nValue.value);
        }
        
        // If it's an array, take the first one
        if (Array.isArray(nValue) && nValue.length > 0) {
            const firstN = nValue[0];
            if (typeof firstN === 'string') return firstN;
            if (firstN && firstN.value) return String(firstN.value);
        }
        
        const stringResult = String(nValue);
        return stringResult === '[object Object]' ? '' : stringResult;
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

    /**
     * Generate UID for new contact
     * This is the primary identifier for contacts (replaces contactId)
     * UID is embedded in the vCard and used for CardDAV sync
     */
    generateUID() {
        return 'contact_' + this.generateUUIDv4();
    }

    /**
     * @deprecated Use generateUID() instead
     * Kept for backward compatibility during migration
     */
    generateContactId() {
        console.warn('⚠️ generateContactId() is deprecated, use generateUID() instead');
        return this.generateUID();
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

    extractVersion(vCardString) {
        const match = vCardString.match(this.patterns.versionExtract);
        return match ? match[1].trim() : null;
    }

    convertDisplayDataToContactData(displayData) {
        return {
            fn: displayData.fullName,
            structuredName: displayData.structuredName || '',
            organization: displayData.organization,
            title: displayData.title,
            birthday: displayData.birthday,
            phones: displayData.phones || [],
            emails: displayData.emails || [],
            urls: displayData.urls || [],
            addresses: displayData.addresses || [],
            notes: displayData.notes || []
        };
    }

    /**
     * Extract UID from vCard content
     * Works with both vCard 3.0 and 4.0 formats
     * Essential for CardDAV sync and contact matching
     * @param {string} vcard - vCard content string
     * @returns {string|null} UID value or null if not found
     */
    extractUIDFromVCard(vcard) {
        if (!vcard || typeof vcard !== 'string') return null;
        
        const match = vcard.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Find contact by UID (used for sync matching)
     * This is the preferred method for CardDAV synchronization
     * @param {Map} contacts - Map of contacts
     * @param {string} uid - UID to search for
     * @returns {Object|null} Contact object or null
     */
    findContactByUID(contacts, uid) {
        if (!uid) return null;
        
        for (const contact of contacts.values()) {
            const contactUID = this.extractUIDFromVCard(contact.vcard);
            if (contactUID === uid) {
                return contact;
            }
        }
        return null;
    }

    /**
     * Validate and format birthday from vCard BDAY property
     * Handles multiple formats: YYYY-MM-DD, YYYYMMDD, datetime
     * @param {string} bday - Raw birthday value from vCard
     * @returns {string} Formatted birthday (YYYY-MM-DD) or empty string
     */
    validateAndFormatBirthday(bday) {
        if (!bday || typeof bday !== 'string') return '';
        
        // Already in ISO format YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(bday)) {
            return bday;
        }
        
        // DateTime format - extract date part
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(bday)) {
            return bday.substring(0, 10);
        }
        
        // Compact format YYYYMMDD - convert to YYYY-MM-DD
        if (/^\d{8}$/.test(bday)) {
            const year = bday.substring(0, 4);
            const month = bday.substring(4, 6);
            const day = bday.substring(6, 8);
            return `${year}-${month}-${day}`;
        }
        
        console.warn(`Invalid birthday format: ${bday}, ignoring`);
        return '';
    }
}