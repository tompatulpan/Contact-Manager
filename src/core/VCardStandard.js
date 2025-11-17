/**
 * VCardStandard - Simplified Delegation Layer for vCard 3.0 Operations
 * 
 * This simplified version delegates all vCard parsing/generation to VCard3Processor.
 * VCardStandard serves as a thin wrapper providing:
 * - Backward compatibility with existing ContactManager API
 * - Photo filtering for privacy/performance
 * - UID extraction for CardDAV sync
 * - Simple delegation to the authoritative VCard3Processor
 * 
 * Key architectural principle: Single Source of Truth
 * - VCard3Processor handles ALL vCard parsing with correct type priorities
 * - No duplicate parsing logic in VCardStandard
 * - Type conversion: "WORK,INTERNET" → "work" (proper priority-based)
 */

import { VCardFormatManager } from './VCardFormatManager.js';

export class VCardStandard {
    constructor() {
        this.version = '3.0';  // ✅ Using vCard 3.0 (Baikal/iCloud standard)
        
        // Initialize format manager (provides access to VCard3Processor)
        this.formatManager = new VCardFormatManager();
        
        // Photo size limits for privacy/performance
        this.photoConfig = {
            maxPhotoSize: 100000,  // 100KB limit
            stripPhotosEnabled: true
        };
    }

    /**
     * Generate vCard 3.0 string from contact data
     * Delegates to VCard3Processor for correct formatting
     */
    generateVCard(contactData) {
        try {
            return this.formatManager.vCard3Processor.generateVCard3(contactData);
        } catch (error) {
            console.error('🚨 VCardStandard.generateVCard failed:', error);
            console.error('   Contact data was:', contactData);
            throw error;
        }
    }

    /**
     * Parse vCard string to structured contact object
     * Delegates to VCard3Processor for correct parsing
     */
    parseVCard(vCardString) {
        try {
            return this.formatManager.vCard3Processor.parseVCard3(vCardString);
        } catch (error) {
            console.error('🚨 VCardStandard.parseVCard failed:', error);
            throw error;
        }
    }

    /**
     * Extract display-friendly data from contact
     * 
     * 🔧 CRITICAL FIX (2025-01-XX): Delegates to VCard3Processor
     * VCard3Processor.extractDisplayData() properly handles:
     * - "WORK,INTERNET" → "work" (priority-based type conversion)
     * - "WORK,VOICE" → "work" (for phones)
     * - All property types with correct priorities
     * 
     * This fixes the bug where email type "work" was displaying as "internet"
     */
    extractDisplayData(contact, useCache = true, suppressItemIdWarning = false) {
        if (!contact || !contact.vcard) {
            console.error('🚨 VCardStandard.extractDisplayData: Invalid contact object', contact);
            return null;
        }
        
        // Warn about missing itemId (needed for Userbase)
        if (!contact.itemId && contact.contactId && !suppressItemIdWarning && !contact.metadata?.isImported) {
            console.warn('⚠️ VCardStandard.extractDisplayData: Contact missing itemId, using contactId:', contact.contactId);
        }
        
        // � CRITICAL FIX: Delegate to VCard3Processor which has correct type parsing logic
        // VCard3Processor.extractDisplayData() properly handles "WORK,INTERNET" → "work"
        const displayData = this.formatManager.vCard3Processor.extractDisplayData(contact);
        
        return displayData;
    }

    /**
     * Generate unique identifier for contact
     * Used as both contactId and vCard UID
     */
    generateUID() {
        return `contact_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Extract UID from vCard string
     * Used for CardDAV sync matching
     */
    extractUID(vCardString) {
        if (!vCardString) return null;
        
        const match = vCardString.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Extract sharing metadata from vCard CATEGORIES field
     * Used for disaster recovery - restores sharing relationships from backup
     * @param {string} vcard - vCard content
     * @returns {Array} Array of usernames this contact is shared with
     */
    extractSharingFromVCard(vcard) {
        return this.formatManager.vCard3Processor.extractSharingFromVCard(vcard);
    }

    /**
     * Filter out photos from vCard for privacy/performance
     * Useful when syncing to external services
     */
    filterPhotos(vCardString, options = {}) {
        if (!vCardString) return vCardString;
        
        const maxSize = options.maxPhotoSize || this.photoConfig.maxPhotoSize;
        const stripAll = options.stripAll || false;
        
        // Strip sensitive/large photo properties
        const photoPattern = /^(PHOTO[:;]|.*ENCODING=B[ASE64]*[;:]|.*VND-63-SENSITIVE|.*X-SHARED-PHOTO).*$/gim;
        
        if (stripAll) {
            return vCardString.replace(photoPattern, '');
        }
        
        // Check photo size
        const photoMatch = vCardString.match(photoPattern);
        if (photoMatch && photoMatch[0].length > maxSize) {
            return vCardString.replace(photoPattern, '');
        }
        
        return vCardString;
    }

    /**
     * Validate vCard format
     * Delegates to VCard3Processor for validation logic
     */
    validateVCard(vCardString) {
        try {
            const parsed = this.parseVCard(vCardString);
            
            // Basic validation: Must have VERSION and FN
            // Properties are stored in a Map, so use .get() or .has()
            const hasVersion = parsed.properties && (parsed.properties.get('VERSION') || parsed.properties.VERSION);
            const hasFN = parsed.properties && (parsed.properties.get('FN') || parsed.properties.FN);
            
            if (!hasVersion || !hasFN) {
                return {
                    isValid: false,
                    version: parsed.version || 'unknown',
                    errors: [`Missing required fields: ${!hasVersion ? 'VERSION ' : ''}${!hasFN ? 'FN' : ''}`]
                };
            }
            
            return {
                isValid: true,
                version: parsed.version || '3.0',
                errors: []
            };
        } catch (error) {
            console.error('🚨 validateVCard error:', error);
            return {
                isValid: false,
                version: 'unknown',
                errors: [error.message]
            };
        }
    }

    /**
     * Import vCard string to contact object
     * Delegates to VCard3Processor for parsing
     */
    importVCard(vCardString, options = {}) {
        try {
            const parsed = this.parseVCard(vCardString);
            const displayData = this.formatManager.vCard3Processor.convertToDisplayData(parsed);
            
            // Use markAsImported from options, default to true for backward compatibility
            const markAsImported = options.markAsImported !== undefined ? options.markAsImported : true;
            
            // Use cardName from options if provided, otherwise derive from fullName or use default
            const cardName = options.cardName || displayData.fullName || 'New Contact';
            
            const now = new Date().toISOString();
            return {
                success: true,
                contact: {
                    vcard: vCardString,
                    cardName: cardName,  // Set cardName explicitly
                    ...displayData,
                    metadata: {
                        createdAt: now,
                        lastUpdated: now,  // Add lastUpdated for recent activity sorting
                        lastAccessedAt: now,  // Add lastAccessedAt for recent activity sorting
                        isImported: markAsImported,  // Use the parameter instead of hardcoded true
                        importSource: options.source || 'vcard-file'
                    }
                }
            };
        } catch (error) {
            console.error('🚨 VCardStandard.importVCard failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Alias for importVCard - backward compatibility with ContactManager
     * @param {string} vCardString - vCard content
     * @param {string} cardName - Optional card name
     * @param {boolean} markAsImported - Whether to mark as imported
     */
    importFromVCard(vCardString, cardName = null, markAsImported = true) {
        const options = {
            source: 'vcard-file',
            cardName: cardName,
            markAsImported: markAsImported
        };
        
        const result = this.importVCard(vCardString, options);
        
        // If cardName provided, override the extracted name
        if (result.success && cardName) {
            result.contact.cardName = cardName;
        }
        
        return result;
    }

    /**
     * Export contact to vCard string
     * Delegates to VCard3Processor for generation
     */
    exportVCard(contact, options = {}) {
        try {
            let vCardString = contact.vcard;
            
            // Filter photos if requested
            if (options.stripPhotos) {
                vCardString = this.filterPhotos(vCardString, { stripAll: true });
            }
            
            return {
                success: true,
                vcard: vCardString,
                filename: this.generateFilename(contact)
            };
        } catch (error) {
            console.error('🚨 VCardStandard.exportVCard failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate filename for vCard export
     */
    generateFilename(contact) {
        const displayData = this.extractDisplayData(contact, false, true);
        const name = displayData?.fullName || contact.cardName || 'contact';
        const sanitized = name.replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_');
        return `${sanitized}.vcf`;
    }

    /**
     * Backward compatibility: Generate cache key
     * (Simplified - VCard3Processor handles caching internally)
     */
    generateCacheKey(contact, operation = 'parse') {
        const contactId = contact.itemId || contact.contactId || 'unknown';
        const vcardHash = this.simpleHash(contact.vcard || '');
        return `${operation}_${contactId}_${vcardHash}`;
    }

    /**
     * Simple hash function for cache keys
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Check if vCard is version 3.0
     */
    isVCard3(vCardString) {
        const versionMatch = vCardString.match(/VERSION:(.+)/);
        return versionMatch && versionMatch[1].trim() === '3.0';
    }

    /**
     * Check if vCard is version 4.0
     */
    isVCard4(vCardString) {
        const versionMatch = vCardString.match(/VERSION:(.+)/);
        return versionMatch && versionMatch[1].trim() === '4.0';
    }

    /**
     * Backward compatibility alias for Apple/iCloud vCard detection
     * (vCard 3.0 is the Apple/iCloud standard)
     */
    isAppleVCard(vCardString) {
        return this.isVCard3(vCardString);
    }
}
