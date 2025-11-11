/**
 * Contact UI Helper Utilities
 * Extracted from ContactUIController.js for better organization
 */
export class ContactUIHelpers {
    /**
     * Escape HTML to prevent XSS attacks
     */
    static escapeHtml(text) {
        if (typeof text !== 'string') return text;
        
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Format phone number for display in E.164 format (international standard)
     * E.164 format: +[country code][subscriber number]
     * Example: +46701234567 (Swedish number)
     */
    static formatPhoneNumber(phone) {
        if (!phone) return '';
        
        // Trim whitespace first
        phone = phone.trim();
        
        // If it already starts with +, clean it and return E.164 format
        if (phone.startsWith('+')) {
            // Remove all non-numeric characters except the leading +
            const cleaned = '+' + phone.substring(1).replace(/\D/g, '');
            return cleaned;
        }
        
        // Remove all non-numeric characters
        const numbers = phone.replace(/\D/g, '');
        
        // If no numbers, return original
        if (!numbers) return phone;
        
        // For numbers without country code, add + and return as-is
        // This makes it clear to users they should include country code
        return '+' + numbers;
    }

    /**
     * Validate field based on type
     */
    static validateField(type, value) {
        if (!value || value.trim() === '') {
            return { isValid: false, message: 'Field is required' };
        }

        switch (type.toLowerCase()) {
            case 'email':
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return {
                    isValid: emailRegex.test(value),
                    message: emailRegex.test(value) ? '' : 'Invalid email format'
                };

            case 'phone':
                const phoneRegex = /^[\+]?[\d\s\-\(\)\.]+$/;
                return {
                    isValid: phoneRegex.test(value),
                    message: phoneRegex.test(value) ? '' : 'Invalid phone format'
                };

            case 'url':
                try {
                    new URL(value);
                    return { isValid: true, message: '' };
                } catch {
                    return { isValid: false, message: 'Invalid URL format' };
                }

            default:
                return { isValid: true, message: '' };
        }
    }

    /**
     * Normalize field types for consistency
     */
    static normalizeFieldType(fieldType, type) {
        const normalizations = {
            phone: {
                'cell': 'mobile',
                'cellular': 'mobile',
                'mobile': 'mobile',
                'work': 'work',
                'home': 'home',
                'fax': 'fax'
            },
            email: {
                'work': 'work',
                'home': 'home',
                'personal': 'home'
            },
            url: {
                'work': 'work',
                'home': 'home',
                'personal': 'home'
            }
        };

        const fieldNormalizations = normalizations[fieldType.toLowerCase()];
        if (fieldNormalizations && fieldNormalizations[type.toLowerCase()]) {
            return fieldNormalizations[type.toLowerCase()];
        }

        return type.toLowerCase();
    }

    /**
     * Capitalize first letter of a string
     */
    static capitalizeFirstLetter(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    /**
     * Generate a random ID
     */
    static generateRandomId(prefix = 'id') {
        return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Debounce function for reducing rapid calls
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Deep clone an object
     */
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }

    /**
     * Remove empty fields from an object
     */
    static removeEmptyFields(obj) {
        const cleaned = {};
        for (const key in obj) {
            if (obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
                if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    const nestedCleaned = this.removeEmptyFields(obj[key]);
                    if (Object.keys(nestedCleaned).length > 0) {
                        cleaned[key] = nestedCleaned;
                    }
                } else if (Array.isArray(obj[key]) && obj[key].length > 0) {
                    cleaned[key] = obj[key];
                } else if (typeof obj[key] !== 'object') {
                    cleaned[key] = obj[key];
                }
            }
        }
        return cleaned;
    }

    /**
     * Format date for display
     */
    static formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        } catch {
            return dateString;
        }
    }

    /**
     * Get initials from a name
     */
    static getInitials(name) {
        if (!name) return '??';
        
        const words = name.trim().split(/\s+/);
        if (words.length === 1) {
            return words[0].substr(0, 2).toUpperCase();
        }
        
        return words.slice(0, 2).map(word => word.charAt(0).toUpperCase()).join('');
    }

    /**
     * Truncate text to specified length
     */
    static truncateText(text, maxLength = 50) {
        if (!text || text.length <= maxLength) return text;
        return text.substr(0, maxLength) + '...';
    }
}

// ES6 module export (see export at class declaration)