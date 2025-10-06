/**
 * ContactValidator - Enhanced validation for contact data with structured vCard support
 * 
 * This enhanced version works with the new structured vCard handling system:
 * - VCardFormatManager integration for version-specific validation
 * - Support for both vCard 3.0 and 4.0 formats
 * - Enhanced validation rules with format-aware checks
 * - Improved error messaging and warnings
 */
export class ContactValidator {
    constructor(vCardStandard) {
        this.vCardStandard = vCardStandard;
        
        // Validation patterns
        this.patterns = {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            phone: /^[+]?[\d\s\-\(\)\.]+$/,
            phoneUri: /^tel:[+]?[\d\s\-\(\)\.]+$/,
            url: /^https?:\/\/.+/,
            date: /^\d{4}-\d{2}-\d{2}$/
        };

        // Field requirements
        this.fieldRequirements = {
            fn: { required: true, minLength: 1, maxLength: 255 },
            organization: { required: false, maxLength: 255 },
            title: { required: false, maxLength: 255 },
            cardName: { required: true, minLength: 1, maxLength: 100 },
            notes: { required: false, maxLength: 1000 }
        };

        // Version-specific validation rules
        this.versionRules = {
            '3.0': {
                supportedTypes: {
                    TEL: ['WORK', 'HOME', 'MOBILE', 'MAIN', 'OTHER', 'FAX'],
                    EMAIL: ['WORK', 'HOME', 'OTHER', 'INTERNET'],
                    URL: ['WORK', 'HOME', 'PERSONAL', 'SOCIAL', 'OTHER'],
                    ADR: ['WORK', 'HOME', 'OTHER']
                },
                allowsItemPrefixes: true,
                preferenceFormat: 'pref',
                requiredProperties: ['FN']
            },
            '4.0': {
                supportedTypes: {
                    TEL: ['work', 'home', 'cell', 'mobile', 'fax', 'pager', 'voice', 'text'],
                    EMAIL: ['work', 'home', 'internet'],
                    URL: ['work', 'home'],
                    ADR: ['work', 'home', 'other']
                },
                allowsItemPrefixes: false,
                preferenceFormat: 'PREF=1',
                requiredProperties: ['FN']
            }
        };
    }

    /**
     * Validate contact form data with version-aware checking
     */
    validateContactData(formData, vCardVersion = '4.0') {
        const errors = [];
        const warnings = [];

        // Required field validation
        if (!formData.fn || formData.fn.trim() === '') {
            errors.push('Full name is required');
        }

        if (!formData.cardName || formData.cardName.trim() === '') {
            formData.cardName = formData.fn || 'Unnamed Contact';
            warnings.push('Card name was empty, using full name as default');
        }

        // Field length validation
        this.validateFieldLengths(formData, errors);

        // Version-specific validation rules
        const rules = this.versionRules[vCardVersion] || this.versionRules['4.0'];

        // Multi-value field validation with version awareness
        this.validatePhones(formData.phones || [], errors, warnings, rules);
        this.validateEmails(formData.emails || [], errors, warnings, rules);
        this.validateUrls(formData.urls || [], errors, warnings, rules);
        this.validateAddresses(formData.addresses || [], errors, warnings, rules);

        // Birthday validation
        if (formData.birthday && !this.patterns.date.test(formData.birthday)) {
            errors.push('Birthday must be in YYYY-MM-DD format');
        }

        // Version-specific warnings
        if (vCardVersion === '3.0' && formData.photos?.length > 0) {
            warnings.push('Photo support varies in vCard 3.0 - consider using vCard 4.0 for better compatibility');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            sanitizedData: this.sanitizeContactData(formData),
            vCardVersion
        };
    }

    /**
     * Validate required fields
     * @param {Object} contactData - Contact data
     * @param {Array} errors - Errors array
     */
    validateRequiredFields(contactData, errors) {
        // Full name is required
        if (!contactData.fn || typeof contactData.fn !== 'string' || contactData.fn.trim() === '') {
            errors.push('Full name is required');
        }

        // Card name is required for UI purposes
        if (!contactData.cardName || typeof contactData.cardName !== 'string' || contactData.cardName.trim() === '') {
            errors.push('Card name is required');
        }
    }

    /**
     * Validate field lengths against requirements
     * @param {Object} formData - Form data to validate
     * @param {Array} errors - Errors array to populate
     */
    validateFieldLengths(formData, errors) {
        // Validate string fields
        const stringFields = ['fn', 'organization', 'title', 'cardName'];
        
        for (const field of stringFields) {
            const value = formData[field];
            const requirements = this.fieldRequirements[field];
            
            if (value && typeof value === 'string' && requirements) {
                if (requirements.maxLength && value.length > requirements.maxLength) {
                    errors.push(`${this.getFieldDisplayName(field)} exceeds maximum length of ${requirements.maxLength} characters`);
                }
                if (requirements.minLength && value.length < requirements.minLength) {
                    errors.push(`${this.getFieldDisplayName(field)} must be at least ${requirements.minLength} characters`);
                }
            }
        }

        // Validate notes array
        if (formData.notes && Array.isArray(formData.notes)) {
            const noteRequirements = this.fieldRequirements.notes;
            formData.notes.forEach((note, index) => {
                if (note && typeof note === 'string' && noteRequirements.maxLength) {
                    if (note.length > noteRequirements.maxLength) {
                        errors.push(`Note ${index + 1} exceeds maximum length of ${noteRequirements.maxLength} characters`);
                    }
                }
            });
        }
    }

    /**
     * Get user-friendly field display name
     * @param {string} fieldName - Internal field name
     * @returns {string} Display name
     */
    getFieldDisplayName(fieldName) {
        const displayNames = {
            fn: 'Full name',
            organization: 'Organization',
            title: 'Job title',
            cardName: 'Card name',
            notes: 'Notes'
        };
        return displayNames[fieldName] || fieldName;
    }

    /**
     * Validate phone numbers
     * @param {Array} phones - Array of phone objects
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     * @param {Object} rules - Version-specific validation rules
     */
    validatePhones(phones, errors, warnings, rules = null) {
        if (!phones || !Array.isArray(phones)) {
            return;
        }

        if (phones.length === 0) {
            warnings.push('No phone numbers provided');
            return;
        }

        if (phones.length > 10) {
            warnings.push('Large number of phone numbers (>10) may affect performance');
        }

        phones.forEach((phone, index) => {
            if (!phone || typeof phone !== 'object') {
                errors.push(`Invalid phone object at position ${index + 1}`);
                return;
            }

            if (!phone.value || typeof phone.value !== 'string') {
                errors.push(`Phone number ${index + 1} is missing a value`);
                return;
            }

            if (!this.isValidPhone(phone.value)) {
                errors.push(`Invalid phone number format at position ${index + 1}: "${phone.value}"`);
            }

            // Version-aware type validation
            if (phone.type) {
                if (rules && !this.isValidFieldType('TEL', phone.type, rules)) {
                    const version = this.getVersionFromRules(rules);
                    warnings.push(`Non-standard phone type "${phone.type}" for vCard ${version} at position ${index + 1}`);
                } else if (!rules && !this.isValidPhoneType(phone.type)) {
                    warnings.push(`Non-standard phone type at position ${index + 1}: "${phone.type}"`);
                }
            }
        });

        // Check for duplicates
        this.checkForDuplicates(phones, 'phone numbers', warnings);
    }

    /**
     * Validate email addresses
     * @param {Array} emails - Array of email objects
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     * @param {Object} rules - Version-specific validation rules
     */
    validateEmails(emails, errors, warnings, rules = null) {
        if (!emails || !Array.isArray(emails)) {
            return;
        }

        if (emails.length === 0) {
            warnings.push('No email addresses provided');
            return;
        }

        if (emails.length > 10) {
            warnings.push('Large number of email addresses (>10) may affect performance');
        }

        emails.forEach((email, index) => {
            if (!email || typeof email !== 'object') {
                errors.push(`Invalid email object at position ${index + 1}`);
                return;
            }

            if (!email.value || typeof email.value !== 'string') {
                errors.push(`Email address ${index + 1} is missing a value`);
                return;
            }

            if (!this.isValidEmail(email.value)) {
                errors.push(`Invalid email address format at position ${index + 1}: "${email.value}"`);
            }

            // Version-aware type validation
            if (email.type) {
                if (rules && !this.isValidFieldType('EMAIL', email.type, rules)) {
                    const version = this.getVersionFromRules(rules);
                    warnings.push(`Non-standard email type "${email.type}" for vCard ${version} at position ${index + 1}`);
                } else if (!rules && !this.isValidEmailType(email.type)) {
                    warnings.push(`Non-standard email type at position ${index + 1}: "${email.type}"`);
                }
            }
        });

        // Check for duplicates
        this.checkForDuplicates(emails, 'email addresses', warnings);
    }

    /**
     * Validate URLs
     * @param {Array} urls - Array of URL objects
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     * @param {Object} rules - Version-specific validation rules
     */
    validateUrls(urls, errors, warnings, rules = null) {
        if (!urls || !Array.isArray(urls)) {
            return;
        }

        if (urls.length > 10) {
            warnings.push('Large number of URLs (>10) may affect performance');
        }

        urls.forEach((url, index) => {
            if (!url || typeof url !== 'object') {
                errors.push(`Invalid URL object at position ${index + 1}`);
                return;
            }

            if (!url.value || typeof url.value !== 'string') {
                errors.push(`URL ${index + 1} is missing a value`);
                return;
            }

            if (!this.isValidURL(url.value)) {
                errors.push(`Invalid URL format at position ${index + 1}: "${url.value}"`);
            }

            // Version-aware type validation
            if (url.type) {
                if (rules && !this.isValidFieldType('URL', url.type, rules)) {
                    const version = this.getVersionFromRules(rules);
                    warnings.push(`Non-standard URL type "${url.type}" for vCard ${version} at position ${index + 1}`);
                } else if (!rules && !this.isValidUrlType(url.type)) {
                    warnings.push(`Non-standard URL type at position ${index + 1}: "${url.type}"`);
                }
            }
        });

        // Check for duplicates
        this.checkForDuplicates(urls, 'URLs', warnings);
    }

    /**
     * Validate addresses
     * @param {Array} addresses - Array of address objects
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     * @param {Object} rules - Version-specific validation rules
     */
    validateAddresses(addresses, errors, warnings, rules = null) {
        if (!addresses || !Array.isArray(addresses)) {
            return;
        }

        if (addresses.length > 5) {
            warnings.push('Large number of addresses (>5) may affect performance');
        }

        addresses.forEach((address, index) => {
            if (!address || typeof address !== 'object') {
                errors.push(`Invalid address object at position ${index + 1}`);
                return;
            }

            // Check if at least one meaningful field is provided
            const hasData = ['street', 'city', 'state', 'postalCode', 'country'].some(field => 
                address[field] && typeof address[field] === 'string' && address[field].trim().length > 0
            );

            if (!hasData) {
                warnings.push(`Address ${index + 1} appears to be empty (no street, city, state, postal code, or country)`);
            }

            // Version-aware type validation
            if (address.type) {
                if (rules && !this.isValidFieldType('ADR', address.type, rules)) {
                    const version = this.getVersionFromRules(rules);
                    warnings.push(`Non-standard address type "${address.type}" for vCard ${version} at position ${index + 1}`);
                } else if (!rules && !this.isValidAddressType(address.type)) {
                    warnings.push(`Non-standard address type at position ${index + 1}: "${address.type}"`);
                }
            }

            // Validate field lengths
            const maxLengths = {
                poBox: 100,
                extended: 100,
                street: 255,
                city: 100,
                state: 100,
                postalCode: 20,
                country: 100
            };

            Object.entries(maxLengths).forEach(([field, maxLength]) => {
                if (address[field] && typeof address[field] === 'string' && address[field].length > maxLength) {
                    errors.push(`Address ${index + 1} ${field} exceeds maximum length of ${maxLength} characters`);
                }
            });
        });
    }

    /**
     * Validate text field
     * @param {string} value - Field value
     * @param {string} fieldName - Field name
     * @param {Array} errors - Errors array
     */
    validateTextField(value, fieldName, errors) {
        if (!value) {
            return; // Optional fields can be empty
        }

        if (typeof value !== 'string') {
            errors.push(`${fieldName} must be a string`);
            return;
        }

        const requirements = this.fieldRequirements[fieldName];
        if (!requirements) {
            return;
        }

        if (requirements.required && value.trim() === '') {
            errors.push(`${fieldName} is required`);
        }

        if (requirements.minLength && value.length < requirements.minLength) {
            errors.push(`${fieldName} must be at least ${requirements.minLength} characters`);
        }

        if (requirements.maxLength && value.length > requirements.maxLength) {
            errors.push(`${fieldName} exceeds maximum length of ${requirements.maxLength} characters`);
        }
    }

    /**
     * Validate date field
     * @param {string} date - Date string
     * @param {string} fieldName - Field name
     * @param {Array} errors - Errors array
     */
    validateDate(date, fieldName, errors) {
        if (!this.patterns.date.test(date)) {
            errors.push(`${fieldName} must be in YYYY-MM-DD format`);
            return;
        }

        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            errors.push(`${fieldName} is not a valid date`);
            return;
        }

        // Additional date validation
        if (fieldName === 'birthday') {
            const now = new Date();
            if (dateObj > now) {
                errors.push('Birthday cannot be in the future');
            }

            const hundredYearsAgo = new Date();
            hundredYearsAgo.setFullYear(now.getFullYear() - 150);
            if (dateObj < hundredYearsAgo) {
                errors.push('Birthday seems unreasonably old');
            }
        }
    }

    /**
     * Check for duplicate values in array
     * @param {Array} items - Items to check
     * @param {string} itemType - Type of items for error message
     * @param {Array} warnings - Warnings array
     */
    checkForDuplicates(items, itemType, warnings) {
        const values = items.map(item => item.value.toLowerCase());
        const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
        
        if (duplicates.length > 0) {
            warnings.push(`Duplicate ${itemType} detected: ${[...new Set(duplicates)].join(', ')}`);
        }
    }

    /**
     * Enhanced vCard validation using format-aware processors
     * @param {string} vCardString - vCard string to validate
     * @returns {Object} Validation result
     */
    validateVCard(vCardString) {
        // Use the enhanced validation with processors
        return this.validateVCardWithProcessors(vCardString);
    }

    /**
     * Validate contact data for a specific vCard version
     * @param {Object} contactData - Contact data to validate
     * @param {string} targetVersion - Target vCard version ('3.0' or '4.0')
     * @returns {Object} Validation result with version compatibility
     */
    validateForVersion(contactData, targetVersion = '4.0') {
        const rules = this.versionRules[targetVersion] || this.versionRules['4.0'];
        const result = this.validateContactData(contactData, targetVersion);
        
        // Add version-specific compatibility checks
        if (targetVersion === '3.0' && contactData.photos?.length > 0) {
            result.warnings.push('Photo support in vCard 3.0 varies by implementation');
        }
        
        if (targetVersion === '4.0' && contactData.legacy?.length > 0) {
            result.warnings.push('Legacy fields may not be supported in vCard 4.0');
        }

        return {
            ...result,
            targetVersion,
            versionRules: rules,
            isVersionCompatible: result.isValid
        };
    }

    /**
     * Validate phone number format
     * @param {string} phone - Phone number
     * @returns {boolean} Is valid
     */
    isValidPhone(phone) {
        if (!phone || typeof phone !== 'string') {
            return false;
        }

        // Handle vCard 4.0 tel: URI format
        if (phone.startsWith('tel:')) {
            const telNumber = phone.substring(4); // Remove 'tel:' prefix
            const cleaned = telNumber.replace(/\s/g, '');
            console.log(`🔍 Validating tel: URI phone: "${phone}" → cleaned: "${cleaned}"`);
            const isValid = this.patterns.phone.test(cleaned) && cleaned.length >= 7 && cleaned.length <= 20;
            console.log(`📞 Tel URI validation result: ${isValid} (pattern: ${this.patterns.phone.test(cleaned)}, length: ${cleaned.length})`);
            return isValid;
        }

        // Handle standard phone number format
        const cleaned = phone.replace(/\s/g, '');
        console.log(`🔍 Validating standard phone: "${phone}" → cleaned: "${cleaned}"`);
        const isValid = this.patterns.phone.test(cleaned) && cleaned.length >= 7 && cleaned.length <= 20;
        console.log(`📞 Standard validation result: ${isValid} (pattern: ${this.patterns.phone.test(cleaned)}, length: ${cleaned.length})`);
        return isValid;
    }

    /**
     * Validate email format
     * @param {string} email - Email address
     * @returns {boolean} Is valid
     */
    isValidEmail(email) {
        if (!email || typeof email !== 'string') {
            return false;
        }

        return this.patterns.email.test(email) && email.length <= 320; // RFC 5321 limit
    }

    /**
     * Validate URL format
     * @param {string} url - URL
     * @returns {boolean} Is valid
     */
    isValidURL(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }

    /**
     * Check if phone type is standard
     * @param {string} type - Phone type
     * @returns {boolean} Is valid type
     */
    isValidPhoneType(type) {
        const standardTypes = ['work', 'home', 'cell', 'mobile', 'fax', 'pager', 'voice', 'text'];
        return standardTypes.includes(type.toLowerCase());
    }

    /**
     * Check if email type is standard
     * @param {string} type - Email type
     * @returns {boolean} Is valid type
     */
    isValidEmailType(type) {
        const standardTypes = ['work', 'home', 'internet', 'personal'];
        return standardTypes.includes(type.toLowerCase());
    }

    /**
     * Check if URL type is standard
     * @param {string} type - URL type
     * @returns {boolean} Is valid type
     */
    isValidUrlType(type) {
        const standardTypes = ['work', 'home', 'personal', 'website', 'blog', 'portfolio'];
        return standardTypes.includes(type.toLowerCase());
    }

    /**
     * Check if address type is valid
     * @param {string} type - Address type
     * @returns {boolean} Is valid type
     */
    isValidAddressType(type) {
        const standardTypes = ['home', 'work', 'office', 'mailing', 'postal', 'other'];
        return standardTypes.includes(type.toLowerCase());
    }

    /**
     * Sanitize contact data for security
     * @param {Object} contactData - Contact data
     * @returns {Object} Sanitized contact data
     */
    sanitizeContactData(contactData) {
        const sanitized = {};

        // Sanitize string fields
        ['fn', 'organization', 'title', 'cardName', 'birthday'].forEach(field => {
            if (contactData[field] && typeof contactData[field] === 'string') {
                sanitized[field] = contactData[field].trim().substring(0, this.fieldRequirements[field]?.maxLength || 255);
            }
        });

        // Sanitize multi-value fields
        ['phones', 'emails', 'urls'].forEach(field => {
            if (contactData[field] && Array.isArray(contactData[field])) {
                sanitized[field] = contactData[field]
                    .slice(0, 10) // Limit to 10 items
                    .map(item => ({
                        value: typeof item.value === 'string' ? item.value.trim() : '',
                        type: typeof item.type === 'string' ? item.type.toLowerCase() : 'other',
                        primary: Boolean(item.primary)
                    }))
                    .filter(item => item.value.length > 0);
            }
        });

        // Sanitize addresses
        if (contactData.addresses && Array.isArray(contactData.addresses)) {
            sanitized.addresses = contactData.addresses
                .slice(0, 5) // Limit to 5 addresses
                .map(addr => ({
                    poBox: typeof addr.poBox === 'string' ? addr.poBox.trim().substring(0, 100) : '',
                    extended: typeof addr.extended === 'string' ? addr.extended.trim().substring(0, 100) : '',
                    street: typeof addr.street === 'string' ? addr.street.trim().substring(0, 255) : '',
                    city: typeof addr.city === 'string' ? addr.city.trim().substring(0, 100) : '',
                    state: typeof addr.state === 'string' ? addr.state.trim().substring(0, 100) : '',
                    postalCode: typeof addr.postalCode === 'string' ? addr.postalCode.trim().substring(0, 20) : '',
                    country: typeof addr.country === 'string' ? addr.country.trim().substring(0, 100) : '',
                    type: typeof addr.type === 'string' ? addr.type.toLowerCase() : 'home',
                    primary: Boolean(addr.primary)
                }))
                .filter(addr => 
                    // Keep address if at least one meaningful field is filled
                    addr.street.length > 0 || addr.city.length > 0 || 
                    addr.state.length > 0 || addr.postalCode.length > 0 || 
                    addr.country.length > 0
                );
        }

        // Sanitize notes
        if (contactData.notes && Array.isArray(contactData.notes)) {
            sanitized.notes = contactData.notes
                .filter(note => typeof note === 'string' && note.trim().length > 0)
                .map(note => note.trim().substring(0, this.fieldRequirements.notes.maxLength))
                .slice(0, 5); // Limit to 5 notes
        }

        // Sanitize boolean metadata fields
        if (typeof contactData.isImported === 'boolean') {
            sanitized.isImported = contactData.isImported;
        }

        // Sanitize distribution lists
        if (contactData.distributionLists && Array.isArray(contactData.distributionLists)) {
            sanitized.distributionLists = contactData.distributionLists
                .filter(list => typeof list === 'string' && list.trim().length > 0)
                .map(list => list.trim())
                .slice(0, 10); // Limit to 10 distribution lists
        }

        return sanitized;
    }

    /**
     * Get validation summary
     * @param {Object} validationResult - Result from validateContactData
     * @returns {Object} Summary object
     */
    getValidationSummary(validationResult) {
        return {
            isValid: validationResult.isValid,
            errorCount: validationResult.errors.length,
            warningCount: validationResult.warnings.length,
            hasErrors: validationResult.errors.length > 0,
            hasWarnings: validationResult.warnings.length > 0,
            criticalErrors: validationResult.errors.filter(error => 
                error.includes('required') || error.includes('Invalid')
            ).length,
            summary: validationResult.isValid 
                ? 'Contact data is valid' 
                : `${validationResult.errors.length} errors found`
        };
    }

    /**
     * Version-aware field type validation
     * @param {string} property - vCard property (TEL, EMAIL, URL, ADR)
     * @param {string} type - Type value to validate
     * @param {Object} rules - Version-specific rules
     * @returns {boolean} True if type is valid for the property and version
     */
    isValidFieldType(property, type, rules) {
        if (!rules || !rules.supportedTypes || !rules.supportedTypes[property]) {
            return true; // Default to allowing unknown types
        }

        const supportedTypes = rules.supportedTypes[property];
        
        // Case-insensitive comparison for flexibility
        return supportedTypes.some(supportedType => 
            supportedType.toLowerCase() === type.toLowerCase()
        );
    }

    /**
     * Get version string from rules object
     * @param {Object} rules - Version-specific rules
     * @returns {string} Version string
     */
    getVersionFromRules(rules) {
        for (const [version, versionRules] of Object.entries(this.versionRules)) {
            if (versionRules === rules) {
                return version;
            }
        }
        return '4.0'; // Default fallback
    }

    /**
     * Validate vCard format and version
     * @param {string} vCardString - Raw vCard string
     * @returns {Object} Validation result with version info
     */
    validateVCardFormat(vCardString) {
        if (!vCardString || typeof vCardString !== 'string') {
            return {
                isValid: false,
                errors: ['vCard string is required'],
                warnings: [],
                detectedVersion: null
            };
        }

        const errors = [];
        const warnings = [];

        // Check for required BEGIN/END markers
        if (!vCardString.includes('BEGIN:VCARD')) {
            errors.push('Missing BEGIN:VCARD marker');
        }

        if (!vCardString.includes('END:VCARD')) {
            errors.push('Missing END:VCARD marker');
        }

        // Detect version
        let detectedVersion = null;
        const versionMatch = vCardString.match(/VERSION:(\d\.\d)/);
        if (versionMatch) {
            detectedVersion = versionMatch[1];
        } else {
            warnings.push('No VERSION property found, assuming vCard 4.0');
            detectedVersion = '4.0';
        }

        // Check for required FN property
        if (!vCardString.includes('FN:')) {
            errors.push('Missing required FN (Full Name) property');
        }

        // Version-specific validation
        if (detectedVersion === '3.0') {
            // Check for ITEM prefixes (common in Apple vCards)
            if (vCardString.includes('item1.') || vCardString.includes('ITEM1.')) {
                warnings.push('Apple-style ITEM prefixes detected - ensure proper v3.0 handling');
            }
        } else if (detectedVersion === '4.0') {
            // Check for RFC 9553 compliance
            if (vCardString.includes('TYPE=pref')) {
                warnings.push('Found TYPE=pref parameter - consider using PREF=1 for RFC 9553 compliance');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            detectedVersion,
            versionRules: this.versionRules[detectedVersion] || this.versionRules['4.0']
        };
    }

    /**
     * Enhanced vCard validation using structured processors
     * @param {string} vCardString - Raw vCard string
     * @returns {Object} Comprehensive validation result
     */
    validateVCardWithProcessors(vCardString) {
        // First check basic format
        const formatValidation = this.validateVCardFormat(vCardString);
        
        if (!formatValidation.isValid) {
            return formatValidation;
        }

        // Use the VCardStandard to parse and validate structure
        try {
            if (this.vCardStandard && this.vCardStandard.formatManager) {
                const detectedFormat = this.vCardStandard.formatManager.detectFormat(vCardString);
                const parseResult = this.vCardStandard.formatManager.importVCard(vCardString);

                return {
                    ...formatValidation,
                    detectedFormat,
                    parsedData: parseResult.success ? parseResult.contact : null,
                    parseErrors: parseResult.success ? [] : [parseResult.error],
                    structureValid: parseResult.success
                };
            }
        } catch (error) {
            return {
                ...formatValidation,
                parseErrors: [error.message],
                structureValid: false
            };
        }

        return formatValidation;
    }
}