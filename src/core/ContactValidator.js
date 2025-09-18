/**
 * ContactValidator - Simplified validation for contact data
 * Validates form data and vCard compliance
 */
export class ContactValidator {
    constructor(vCardStandard) {
        this.vCardStandard = vCardStandard;
        
        // Validation patterns
        this.patterns = {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            phone: /^[+]?[\d\s\-\(\)\.]+$/,
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
    }

    /**
     * Validate contact data using RFC 9553 standards
     * @param {Object} contactData - Contact data to validate
     * @returns {Object} Validation result
     */
    validateContactData(contactData) {
        const errors = [];
        const warnings = [];

        try {
            // Required field validation
            this.validateRequiredFields(contactData, errors);
            
            // Multi-value field validation
            this.validatePhones(contactData.phones, errors, warnings);
            this.validateEmails(contactData.emails, errors, warnings);
            this.validateUrls(contactData.urls, errors, warnings);
            
            // Single field validation
            this.validateTextField(contactData.organization, 'organization', errors);
            this.validateTextField(contactData.title, 'title', errors);
            this.validateTextField(contactData.cardName, 'cardName', errors);
            
            // Date validation
            if (contactData.birthday) {
                this.validateDate(contactData.birthday, 'birthday', errors);
            }

            // Notes validation
            if (contactData.notes && Array.isArray(contactData.notes)) {
                contactData.notes.forEach((note, index) => {
                    if (typeof note === 'string' && note.length > this.fieldRequirements.notes.maxLength) {
                        errors.push(`Note ${index + 1} exceeds maximum length of ${this.fieldRequirements.notes.maxLength} characters`);
                    }
                });
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings,
                hasWarnings: warnings.length > 0
            };
        } catch (error) {
            return {
                isValid: false,
                errors: [`Validation error: ${error.message}`],
                warnings,
                hasWarnings: false
            };
        }
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
        } else if (contactData.fn.length > this.fieldRequirements.fn.maxLength) {
            errors.push(`Full name exceeds maximum length of ${this.fieldRequirements.fn.maxLength} characters`);
        }

        // Card name is required for UI purposes
        if (!contactData.cardName || typeof contactData.cardName !== 'string' || contactData.cardName.trim() === '') {
            errors.push('Card name is required');
        } else if (contactData.cardName.length > this.fieldRequirements.cardName.maxLength) {
            errors.push(`Card name exceeds maximum length of ${this.fieldRequirements.cardName.maxLength} characters`);
        }
    }

    /**
     * Validate phone numbers
     * @param {Array} phones - Array of phone objects
     * @param {Array} errors - Errors array
     * @param {Array} warnings - Warnings array
     */
    validatePhones(phones, errors, warnings) {
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

            if (phone.type && !this.isValidPhoneType(phone.type)) {
                warnings.push(`Non-standard phone type at position ${index + 1}: "${phone.type}"`);
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
     */
    validateEmails(emails, errors, warnings) {
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

            if (email.type && !this.isValidEmailType(email.type)) {
                warnings.push(`Non-standard email type at position ${index + 1}: "${email.type}"`);
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
     */
    validateUrls(urls, errors, warnings) {
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

            if (url.type && !this.isValidUrlType(url.type)) {
                warnings.push(`Non-standard URL type at position ${index + 1}: "${url.type}"`);
            }
        });

        // Check for duplicates
        this.checkForDuplicates(urls, 'URLs', warnings);
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
     * RFC 9553 vCard validation
     * @param {string} vCardString - vCard string to validate
     * @returns {Object} Validation result
     */
    validateVCard(vCardString) {
        if (!this.vCardStandard) {
            return {
                isValid: false,
                errors: ['VCard standard validator not available'],
                warnings: []
            };
        }

        return this.vCardStandard.validateVCard(vCardString);
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

        const cleaned = phone.replace(/\s/g, '');
        return this.patterns.phone.test(cleaned) && cleaned.length >= 7 && cleaned.length <= 20;
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

        // Sanitize notes
        if (contactData.notes && Array.isArray(contactData.notes)) {
            sanitized.notes = contactData.notes
                .filter(note => typeof note === 'string' && note.trim().length > 0)
                .map(note => note.trim().substring(0, this.fieldRequirements.notes.maxLength))
                .slice(0, 5); // Limit to 5 notes
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
}