/**
 * VCardFormatManager - Centralized vCard format handling and version management
 * 
 * This class provides a unified interface for handling different vCard versions (3.0 and 4.0)
 * with proper format detection, conversion, and processing capabilities.
 * 
 * Key Features:
 * - Automatic version detection
 * - Format-specific processing
 * - Centralized conversion logic
 * - Error handling and validation
 * - Performance optimization
 */

import { VCard3Processor } from './VCard3Processor.js';
import { VCard4Processor } from './VCard4Processor.js';

export class VCardFormatManager {
    constructor(config) {
        this.config = config;
        
        // Initialize format processors
        this.vCard3Processor = new VCard3Processor(config);
        this.vCard4Processor = new VCard4Processor(config);
        
        // Version detection patterns
        this.patterns = {
            version3: /VERSION:3\.0/i,
            version4: /VERSION:4\.0/i,
            appleIndicators: /(?:ITEM\d+\.|TYPE=PERSONAL|X-APPLE|X-ABUID|X-ABADR|vnd\.apple)/i,
            beginVCard: /BEGIN:VCARD/i,
            endVCard: /END:VCARD/i
        };
        
        // Supported formats registry
        this.formats = {
            'vcard-3.0': {
                version: '3.0',
                processor: this.vCard3Processor,
                description: 'vCard 3.0 (Apple/iCloud compatible)',
                fileExtension: 'vcf',
                mimeType: 'text/vcard;charset=utf-8'
            },
            'vcard-4.0': {
                version: '4.0',
                processor: this.vCard4Processor,
                description: 'vCard 4.0 (RFC 9553 standard)',
                fileExtension: 'vcf',
                mimeType: 'text/vcard;charset=utf-8'
            }
        };
        
        // Performance cache
        this.cache = {
            detectedVersions: new Map(),
            maxCacheSize: 50
        };
    }

    /**
     * Detect vCard format and version from string content
     * @param {string} vCardString - Raw vCard content
     * @returns {Object} Detection result with version, format, and confidence
     */
    detectFormat(vCardString) {
        if (!this.isValidVCard(vCardString)) {
            return {
                isValid: false,
                version: null,
                format: null,
                confidence: 0,
                errors: ['Invalid vCard structure: missing BEGIN/END:VCARD']
            };
        }

        // Check cache first
        const cacheKey = this.generateCacheKey(vCardString);
        if (this.cache.detectedVersions.has(cacheKey)) {
            return this.cache.detectedVersions.get(cacheKey);
        }

        const result = this.performFormatDetection(vCardString);
        
        // Cache the result
        this.cacheResult(cacheKey, result);
        
        return result;
    }

    /**
     * Import vCard from string with automatic format detection
     * @param {string} vCardString - Raw vCard content
     * @param {string} cardName - Optional card name override
     * @param {boolean} markAsImported - Whether to mark as imported
     * @returns {Object} Processed contact object
     */
    importVCard(vCardString, cardName = null, markAsImported = true) {
        const detection = this.detectFormat(vCardString);
        
        console.log(`📥 Importing ${detection.format} vCard (confidence: ${detection.confidence}%)`);
        
        if (!detection.isValid) {
            return {
                success: false,
                error: `Invalid vCard format: ${detection.errors.join(', ')}`,
                contact: null
            };
        }

        try {
            const processor = this.getProcessorForVersion(detection.version);
            console.log(`� Using processor for version ${detection.version}`);
            
            const contact = processor.import(vCardString, cardName, markAsImported);
            
            console.log(`✅ Successfully parsed contact: ${contact.cardName}`);
            
            // Debug: Check the contact's actual vCard content
            console.log('🔍 Contact vCard content after processing:', {
                hasVCard: !!contact.vcard,
                vCardLength: contact.vcard?.length || 0,
                vCardPreview: contact.vcard?.substring(0, 200) + (contact.vcard?.length > 200 ? '...' : ''),
                originalLength: vCardString.length
            });
            
            // Create a simple preview by parsing the vCard directly
            const vCardPreview = this.createVCardPreview(contact.vcard || vCardString);
            console.log('📊 Parsed contact data preview:', vCardPreview);

            return {
                success: true,
                contact: contact,
                detection: detection
            };
        } catch (error) {
            console.error(`❌ Import failed for ${detection.format}:`, error);
            return {
                success: false,
                error: error.message,
                contact: null,
                detection: detection
            };
        }
    }

    /**
     * Export contact to specific vCard format
     * @param {Object} contact - Contact object to export
     * @param {string} targetFormat - Target format ('vcard-3.0' or 'vcard-4.0')
     * @returns {Object} Export result with content and metadata
     */
    exportVCard(contact, targetFormat = 'vcard-4.0') {
        const formatInfo = this.formats[targetFormat];
        if (!formatInfo) {
            throw new Error(`Unsupported export format: ${targetFormat}`);
        }

        console.log(`📤 Exporting to ${formatInfo.description}`);
        
        const processor = formatInfo.processor;
        return processor.export(contact);
    }

    /**
     * Convert vCard from one version to another
     * @param {string} vCardString - Source vCard content
     * @param {string} targetVersion - Target version ('3.0' or '4.0')
     * @returns {Object} Conversion result
     */
    convertVCard(vCardString, targetVersion) {
        const sourceDetection = this.detectFormat(vCardString);
        
        if (!sourceDetection.isValid) {
            throw new Error(`Cannot convert invalid vCard: ${sourceDetection.errors.join(', ')}`);
        }

        if (sourceDetection.version === targetVersion) {
            return {
                converted: false,
                content: vCardString,
                sourceVersion: sourceDetection.version,
                targetVersion,
                message: 'No conversion needed - already in target format'
            };
        }

        console.log(`🔄 Converting vCard ${sourceDetection.version} → ${targetVersion}`);
        
        // Import with source processor
        const sourceProcessor = this.getProcessorForVersion(sourceDetection.version);
        const contact = sourceProcessor.import(vCardString, null, false);
        
        // Export with target processor
        const targetFormat = targetVersion === '3.0' ? 'vcard-3.0' : 'vcard-4.0';
        const targetProcessor = this.formats[targetFormat].processor;
        const exportResult = targetProcessor.export(contact);
        
        return {
            converted: true,
            content: exportResult.content,
            sourceVersion: sourceDetection.version,
            targetVersion,
            filename: exportResult.filename,
            mimeType: exportResult.mimeType,
            message: `Successfully converted from vCard ${sourceDetection.version} to ${targetVersion}`
        };
    }

    /**
     * Get supported format information
     * @returns {Object} Available formats and their capabilities
     */
    getSupportedFormats() {
        return {
            import: Object.keys(this.formats),
            export: Object.keys(this.formats),
            conversion: [
                { from: '3.0', to: '4.0', description: 'Apple/Legacy to RFC 9553' },
                { from: '4.0', to: '3.0', description: 'RFC 9553 to Apple/Legacy' }
            ],
            formats: this.formats
        };
    }

    /**
     * Validate vCard content and structure
     * @param {string} vCardString - vCard content to validate
     * @returns {Object} Validation result
     */
    validateVCard(vCardString) {
        const detection = this.detectFormat(vCardString);
        
        if (!detection.isValid) {
            return {
                isValid: false,
                version: null,
                errors: detection.errors,
                warnings: []
            };
        }

        const processor = this.getProcessorForVersion(detection.version);
        return processor.validate(vCardString);
    }

    /**
     * Get format-specific processor
     * @param {string} version - vCard version ('3.0' or '4.0')
     * @returns {Object} Processor instance
     */
    getProcessorForVersion(version) {
        switch (version) {
            case '3.0':
                return this.vCard3Processor;
            case '4.0':
                return this.vCard4Processor;
            default:
                throw new Error(`Unsupported vCard version: ${version}`);
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Perform actual format detection logic
     * @param {string} vCardString - vCard content
     * @returns {Object} Detection result
     */
    performFormatDetection(vCardString) {
        const result = {
            isValid: true,
            version: null,
            format: null,
            confidence: 0,
            errors: [],
            indicators: []
        };

        console.log('🔍 VCardFormatManager: Starting format detection...');
        console.log('📄 vCard content preview:', vCardString.substring(0, 200));

        // Check for explicit version declaration
        if (this.patterns.version3.test(vCardString)) {
            result.version = '3.0';
            result.format = 'vcard-3.0';
            result.confidence = 90;
            result.indicators.push('VERSION:3.0 found');
            console.log('✅ Detected VERSION:3.0 explicitly');
        } else if (this.patterns.version4.test(vCardString)) {
            result.version = '4.0';
            result.format = 'vcard-4.0';
            result.confidence = 90;
            result.indicators.push('VERSION:4.0 found');
            console.log('✅ Detected VERSION:4.0 explicitly');
        } else {
            console.log('⚠️ No explicit version found, checking patterns...');
            console.log('🧪 Version 3.0 pattern test:', this.patterns.version3.test(vCardString));
            console.log('🧪 Version 4.0 pattern test:', this.patterns.version4.test(vCardString));
        }

        // Check for Apple-specific indicators (suggests 3.0)
        if (this.patterns.appleIndicators.test(vCardString)) {
            result.indicators.push('Apple-specific properties found');
            console.log('🍎 Apple indicators found');
            if (!result.version) {
                result.version = '3.0';
                result.format = 'vcard-3.0';
                result.confidence = 75;
                console.log('🔄 Set version to 3.0 based on Apple indicators');
            } else if (result.version === '3.0') {
                result.confidence = Math.min(result.confidence + 10, 95);
            }
        }

        // Fallback detection based on common patterns
        if (!result.version) {
            console.log('🔄 Using fallback content detection...');
            result.version = this.detectVersionFromContent(vCardString);
            result.format = result.version === '3.0' ? 'vcard-3.0' : 'vcard-4.0';
            result.confidence = 60;
            result.indicators.push('Version inferred from content patterns');
            console.log(`🔄 Fallback detected version: ${result.version}`);
        }

        // Additional confidence adjustments
        if (vCardString.includes('ITEM1.') || vCardString.includes('type=')) {
            result.confidence = Math.min(result.confidence + 5, 100);
            result.indicators.push('ITEM prefix or lowercase type found');
        }

        console.log(`📊 Final detection result: version=${result.version}, format=${result.format}, confidence=${result.confidence}%`);
        
        return result;
    }

    /**
     * Detect version from content patterns when VERSION property is missing
     * @param {string} vCardString - vCard content
     * @returns {string} Detected version
     */
    detectVersionFromContent(vCardString) {
        // vCard 3.0 indicators
        const v3Indicators = [
            /ITEM\d+\./i,           // Apple ITEM prefixes
            /type=[^;]*/i,          // Lowercase type parameters
            /TYPE=PERSONAL/i,       // Apple-specific types
            /X-[A-Z]/i,             // X- properties more common in 3.0
            /PHOTO;ENCODING=/i      // Photo encoding syntax
        ];

        // vCard 4.0 indicators
        const v4Indicators = [
            /TYPE=[a-z]+/i,         // Standard type values
            /PREF=\d+/i,            // Preference parameters
            /KIND:/i,               // KIND property (4.0 only)
            /GENDER:/i,             // GENDER property (4.0 only)
            /LANG=/i                // Language parameters
        ];

        const v3Score = v3Indicators.reduce((score, pattern) => 
            score + (pattern.test(vCardString) ? 1 : 0), 0);
        const v4Score = v4Indicators.reduce((score, pattern) => 
            score + (pattern.test(vCardString) ? 1 : 0), 0);

        // Default to 4.0 if tie or no clear indicators
        return v3Score > v4Score ? '3.0' : '4.0';
    }

    /**
     * Check if string has basic vCard structure
     * @param {string} vCardString - Content to check
     * @returns {boolean} Has valid structure
     */
    isValidVCard(vCardString) {
        if (!vCardString || typeof vCardString !== 'string') {
            return false;
        }

        return this.patterns.beginVCard.test(vCardString) && 
               this.patterns.endVCard.test(vCardString);
    }

    /**
     * Generate cache key for content
     * @param {string} content - Content to hash
     * @returns {string} Cache key
     */
    generateCacheKey(content) {
        // Simple hash for caching
        let hash = 0;
        const str = content.substring(0, 200); // Use first 200 chars for hashing
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Cache detection result
     * @param {string} key - Cache key
     * @param {Object} result - Detection result
     */
    cacheResult(key, result) {
        if (this.cache.detectedVersions.size >= this.cache.maxCacheSize) {
            const firstKey = this.cache.detectedVersions.keys().next().value;
            this.cache.detectedVersions.delete(firstKey);
        }
        this.cache.detectedVersions.set(key, result);
    }

    /**
     * Clear format detection cache
     */
    clearCache() {
        this.cache.detectedVersions.clear();
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.detectedVersions.size,
            maxSize: this.cache.maxCacheSize,
            hitRate: this.cache.hits / (this.cache.hits + this.cache.misses) || 0
        };
    }

    /**
     * Create a simple preview of vCard content for debugging
     */
    createVCardPreview(vCardString) {
        if (!vCardString) return { error: 'No vCard content' };

        try {
            const lines = vCardString.split('\n');
            const preview = {
                hasVCard: vCardString.includes('BEGIN:VCARD'),
                vCardLength: vCardString.length,
                fn: null,
                organization: null,
                phones: 0,
                emails: 0,
                urls: 0,
                addresses: 0
            };

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('FN:')) {
                    preview.fn = trimmed.substring(3);
                } else if (trimmed.startsWith('ORG:')) {
                    preview.organization = trimmed.substring(4);
                } else if (trimmed.startsWith('TEL')) {
                    preview.phones++;
                } else if (trimmed.startsWith('EMAIL')) {
                    preview.emails++;
                } else if (trimmed.startsWith('URL')) {
                    preview.urls++;
                } else if (trimmed.startsWith('ADR')) {
                    preview.addresses++;
                }
            }

            return preview;
        } catch (error) {
            return { error: `Preview failed: ${error.message}` };
        }
    }
}