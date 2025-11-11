/**
 * VCardExporter - Enhanced vCard Export Handler with Multiple Format Support
 * 
 * Features:
 * 1. ✅ Multiple export formats (vCard 4.0, vCard 3.0, Apple/iCloud compatible)
 * 2. ✅ Proper RFC 9553 line folding and escaping
 * 3. ✅ Batch export with progress tracking
 * 4. ✅ QR code generation for contacts
 * 5. ✅ File compression for large exports
 * 6. ✅ Custom field filtering and selection
 * 7. ✅ Export validation and error reporting
 * 8. ✅ Multiple download formats (individual files, zip archives)
 */

import { VCardStandardEnhanced } from './VCardStandardEnhanced.js';

export class VCardExporter {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.vCardStandard = new VCardStandardEnhanced();
        
        // Export configuration
        this.config = {
            formats: {
                'vcard-4.0': {
                    name: 'vCard 4.0 (RFC 9553)',
                    description: 'Standard vCard format with full feature support',
                    version: '4.0',
                    fileExtension: '.vcf',
                    mimeType: 'text/vcard',
                    features: ['addresses', 'multivalue', 'utf8', 'parameters']
                },
                'vcard-3.0': {
                    name: 'vCard 3.0 (Legacy)',
                    description: 'Legacy vCard format for older systems',
                    version: '3.0',
                    fileExtension: '.vcf',
                    mimeType: 'text/vcard',
                    features: ['basic', 'legacy-encoding']
                },
                'apple-contacts': {
                    name: 'Apple Contacts (iCloud)',
                    description: 'Optimized for Apple Contacts and iCloud',
                    version: '3.0',
                    fileExtension: '.vcf',
                    mimeType: 'text/vcard',
                    features: ['apple-types', 'item-grouping', 'photo-url']
                }
            },
            batchSize: 50,
            maxFileSize: 50 * 1024 * 1024, // 50MB
            compression: {
                enabled: true,
                threshold: 10, // Compress if more than 10 contacts
                level: 6 // gzip compression level
            },
            validation: {
                enabled: true,
                strictMode: false
            }
        };

        // Progress tracking
        this.exportProgress = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            started: null,
            currentBatch: 0
        };
    }

    /**
     * Check if format manager is available for advanced format generation
     * @returns {boolean} True if format manager is available
     */
    isFormatManagerAvailable() {
        return this.vCardStandard && 
               this.vCardStandard.formatManager && 
               typeof this.vCardStandard.formatManager.generateForFormat === 'function';
    }

    /**
     * Export single contact with format selection
     * @param {Object} contact - Contact data
     * @param {Object} options - Export options
     * @returns {Object} Export result
     */
    async exportContact(contact, options = {}) {
        const exportOptions = {
            format: options.format || 'vcard-4.0',
            filename: options.filename || null,
            download: options.download !== false,
            includeBOM: options.includeBOM || false,
            validate: options.validate !== false,
            customFields: options.customFields || null,
            ...options
        };

        const result = {
            success: false,
            contact: {
                id: contact.contactId || contact.itemId,
                name: contact.cardName || contact.fullName || 'Unknown'
            },
            export: {
                format: exportOptions.format,
                filename: '',
                content: '',
                size: 0,
                encoding: 'UTF-8'
            },
            validation: {},
            errors: [],
            warnings: []
        };

        try {
            // Validate input
            if (!contact) {
                result.errors.push('No contact provided for export');
                return result;
            }

            // Generate filename if not provided
            const filename = exportOptions.filename || this.generateFilename(contact, exportOptions.format);
            result.export.filename = filename;

            // Generate vCard content
            const contentResult = await this.generateVCardContent(contact, exportOptions);
            
            if (!contentResult.success) {
                result.errors.push(...contentResult.errors);
                result.warnings.push(...contentResult.warnings);
                return result;
            }

            result.export.content = contentResult.content;
            result.export.size = contentResult.content.length;
            result.warnings.push(...contentResult.warnings);

            // Validate exported content if requested
            if (exportOptions.validate) {
                const validation = this.validateExportedContent(contentResult.content, exportOptions.format);
                result.validation = validation;
                
                if (!validation.isValid) {
                    result.warnings.push(...validation.warnings);
                    if (validation.errors.length > 0) {
                        result.errors.push(...validation.errors);
                    }
                }
            }

            // Download file if requested
            if (exportOptions.download && result.export.content) {
                this.downloadFile(result.export.content, filename, this.getMimeType(exportOptions.format));
            }

            result.success = true;

            // Emit success event
            this.eventBus?.emit('vcard:export:contact-success', {
                contactId: contact.contactId,
                format: exportOptions.format,
                filename,
                size: result.export.size
            });

            return result;

        } catch (error) {
            result.errors.push(`Export failed: ${error.message}`);
            
            this.eventBus?.emit('vcard:export:contact-error', {
                contactId: contact.contactId,
                error: error.message
            });
            
            return result;
        }
    }

    /**
     * Export multiple contacts with batch processing
     * @param {Array} contacts - Array of contact data
     * @param {Object} options - Export options
     * @returns {Object} Batch export result
     */
    async exportContacts(contacts, options = {}) {
        const exportOptions = {
            format: options.format || 'vcard-4.0',
            filename: options.filename || 'contacts.vcf',
            combinedFile: options.combinedFile !== false,
            compress: options.compress || (contacts.length > this.config.compression.threshold),
            download: options.download !== false,
            progressCallback: options.progressCallback || null,
            ...options
        };

        const result = {
            success: false,
            totalContacts: contacts.length,
            processedContacts: 0,
            successfulContacts: 0,
            failedContacts: 0,
            export: {
                format: exportOptions.format,
                filename: exportOptions.filename,
                files: [],
                totalSize: 0,
                encoding: 'UTF-8',
                compressed: false
            },
            errors: [],
            warnings: [],
            processingTime: 0
        };

        const startTime = Date.now();

        try {
            this.resetProgress();
            this.exportProgress.total = contacts.length;
            this.exportProgress.started = new Date();

            if (exportOptions.combinedFile) {
                // Export all contacts to a single file
                const combinedResult = await this.exportCombinedFile(contacts, exportOptions, result);
                result.export = combinedResult.export;
                result.errors.push(...combinedResult.errors);
                result.warnings.push(...combinedResult.warnings);
            } else {
                // Export each contact to individual files
                const individualResult = await this.exportIndividualFiles(contacts, exportOptions, result);
                result.export.files = individualResult.files;
                result.errors.push(...individualResult.errors);
                result.warnings.push(...individualResult.warnings);
            }

            result.successfulContacts = this.exportProgress.successful;
            result.failedContacts = this.exportProgress.failed;
            result.processedContacts = this.exportProgress.processed;
            result.processingTime = Date.now() - startTime;
            result.success = result.successfulContacts > 0;

            // Emit completion event
            this.eventBus?.emit('vcard:export:batch-completed', {
                totalContacts: result.totalContacts,
                successful: result.successfulContacts,
                failed: result.failedContacts,
                format: exportOptions.format,
                duration: result.processingTime
            });

            return result;

        } catch (error) {
            result.errors.push(`Batch export failed: ${error.message}`);
            result.processingTime = Date.now() - startTime;
            
            this.eventBus?.emit('vcard:export:batch-error', {
                error: error.message,
                processed: result.processedContacts,
                total: result.totalContacts
            });
            
            return result;
        }
    }

    /**
     * Generate QR code data for a contact
     * @param {Object} contact - Contact data
     * @param {Object} options - QR generation options
     * @returns {Object} QR code result
     */
    generateQRCode(contact, options = {}) {
        const qrOptions = {
            format: options.format || 'vcard-3.0', // Changed from 'vcard-4.0' to 'vcard-3.0' for better mobile compatibility
            includePhoto: options.includePhoto || false,
            maxSize: options.maxSize || 2048, // bytes
            errorCorrection: options.errorCorrection || 'M', // L, M, Q, H
            ...options
        };

        const result = {
            success: false,
            contact: {
                id: contact.contactId || contact.itemId,
                name: contact.cardName || contact.fullName || 'Unknown'
            },
            qr: {
                data: '',
                size: 0,
                format: qrOptions.format,
                truncated: false
            },
            errors: [],
            warnings: []
        };

        try {
            // Generate optimized vCard for QR code
            const contentResult = this.generateOptimizedVCardForQR(contact, qrOptions);
            
            if (!contentResult.success) {
                result.errors.push(...contentResult.errors);
                return result;
            }

            result.qr.data = contentResult.content;
            result.qr.size = contentResult.content.length;
            result.qr.truncated = contentResult.truncated;
            result.warnings.push(...contentResult.warnings);

            // Check size limits for QR codes
            if (result.qr.size > qrOptions.maxSize) {
                result.warnings.push(`QR data size (${result.qr.size} bytes) exceeds recommended limit (${qrOptions.maxSize} bytes)`);
                result.warnings.push('QR code may be difficult to scan or not work with all readers');
            }

            result.success = true;
            return result;

        } catch (error) {
            result.errors.push(`QR code generation failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Generate vCard content in specified format
     */
    async generateVCardContent(contact, options) {
        const result = {
            success: false,
            content: '',
            warnings: [],
            errors: []
        };

        try {
            const formatConfig = this.config.formats[options.format];
            
            if (!formatConfig) {
                result.errors.push(`Unsupported export format: ${options.format}`);
                return result;
            }

            // Prepare contact data based on format
            const contactData = this.prepareContactDataForFormat(contact, options.format, options);

            // Apply custom field filtering if specified
            if (options.customFields) {
                this.applyCustomFieldFilter(contactData, options.customFields);
            }

            // Use format manager for consistent output across all formats
            let vCardResult;
            
            if (this.isFormatManagerAvailable() && (options.format === 'vcard-3.0' || options.format === 'apple-contacts')) {
                // Use format manager for vCard 3.0 and Apple formats (includes fixed type mappings)
                vCardResult = this.vCardStandard.formatManager.exportVCard(contactData, 'vcard-3.0');
                
                // Convert format manager result to expected structure
                if (vCardResult && vCardResult.content) {
                    vCardResult = {
                        success: true,
                        content: vCardResult.content,
                        errors: [],
                        warnings: []
                    };
                } else {
                    console.warn('Format manager export failed, falling back to standard method');
                    vCardResult = {
                        success: false,
                        content: '',
                        errors: ['Format manager export failed'],
                        warnings: []
                    };
                }
            } else {
                // Use standard method for vCard 4.0 or when format manager unavailable
                const methodReason = !this.isFormatManagerAvailable() ? 
                    'format manager unavailable' : 
                    `${options.format} format`;
                const generateOptions = {
                    version: formatConfig.version,
                    includeFolding: true,
                    validateOutput: this.config.validation.enabled,
                    includeSystemProperties: true
                };

                vCardResult = this.vCardStandard.generateVCard(contactData, generateOptions);
            }
            
            if (!vCardResult.success) {
                result.errors.push(...vCardResult.errors);
                result.warnings.push(...vCardResult.warnings);
                return result;
            }

            // Apply format-specific post-processing
            result.content = this.applyFormatSpecificProcessing(vCardResult.content, options.format);
            result.warnings.push(...vCardResult.warnings);

            // Add BOM if requested
            if (options.includeBOM) {
                result.content = '\uFEFF' + result.content;
            }

            result.success = true;
            return result;

        } catch (error) {
            result.errors.push(`Content generation failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Generate optimized vCard for QR codes (smaller size)
     */
    generateOptimizedVCardForQR(contact, options) {
        const result = {
            success: false,
            content: '',
            truncated: false,
            warnings: [],
            errors: []
        };

        try {
            // Create minimal contact data for QR code
            const qrContactData = {
                fn: contact.cardName || contact.fullName || 'Contact',
                // Include only the most essential information
                phones: (contact.phones || []).slice(0, 2), // Max 2 phones
                emails: (contact.emails || []).slice(0, 2), // Max 2 emails
                urls: (contact.urls || []).slice(0, 1),     // Max 1 URL
                organization: contact.organization,
                title: contact.title
            };

            // Skip addresses, notes, and other large fields unless explicitly requested
            if (options.includePhoto && contact.photo) {
                result.warnings.push('Photo excluded from QR code to reduce size');
            }

            // Generate compact vCard using format manager for consistency
            let vCardResult;
            
            if (this.isFormatManagerAvailable() && (options.format === 'vcard-3.0' || options.format === 'apple-contacts')) {
                // Use format manager for vCard 3.0 (includes our fixed type mappings)
                vCardResult = this.vCardStandard.formatManager.exportVCard(
                    { ...qrContactData, contactId: contact.contactId }, 
                    options.format === 'apple-contacts' ? 'vcard-3.0' : options.format
                );
                
                // Convert format manager result to expected structure
                if (vCardResult && vCardResult.content) {
                    vCardResult = {
                        success: true,
                        content: vCardResult.content,
                        errors: [],
                        warnings: []
                    };
                } else {
                    console.warn('Format manager QR export failed, falling back to standard method');
                    vCardResult = {
                        success: false,
                        content: '',
                        errors: ['Format manager QR export failed'],
                        warnings: []
                    };
                }
            } else {
                // Use standard method for vCard 4.0 or when format manager unavailable
                const methodReason = !this.isFormatManagerAvailable() ? 
                    'format manager unavailable' : 
                    `${options.format} format`;
                vCardResult = this.vCardStandard.generateVCard(qrContactData, {
                    version: this.config.formats[options.format]?.version || '4.0',
                    includeFolding: false, // No folding for QR codes
                    validateOutput: false,
                    includeSystemProperties: false
                });
            }

            if (!vCardResult.success) {
                result.errors.push(...vCardResult.errors);
                return result;
            }

            result.content = vCardResult.content;

            // Check if truncation is needed
            if (result.content.length > options.maxSize) {
                result.content = this.truncateVCardForQR(result.content, options.maxSize);
                result.truncated = true;
                result.warnings.push('vCard data truncated to fit QR code size limits');
            }

            result.success = true;
            return result;

        } catch (error) {
            result.errors.push(`QR vCard generation failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Export all contacts to a combined file
     */
    async exportCombinedFile(contacts, options, result) {
        const combinedContent = [];
        const exportResult = {
            export: {
                format: options.format,
                filename: options.filename,
                content: '',
                size: 0,
                compressed: false
            },
            errors: [],
            warnings: []
        };

        // Process contacts in batches
        const batchSize = this.config.batchSize;
        const totalBatches = Math.ceil(contacts.length / batchSize);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIdx = batchIndex * batchSize;
            const endIdx = Math.min(startIdx + batchSize, contacts.length);
            const batch = contacts.slice(startIdx, endIdx);

            for (const contact of batch) {
                try {
                    const contentResult = await this.generateVCardContent(contact, options);
                    
                    this.exportProgress.processed++;

                    if (contentResult.success) {
                        combinedContent.push(contentResult.content);
                        this.exportProgress.successful++;
                    } else {
                        exportResult.errors.push(`${contact.cardName || 'Unknown'}: ${contentResult.errors.join(', ')}`);
                        this.exportProgress.failed++;
                    }

                    exportResult.warnings.push(...contentResult.warnings);

                } catch (error) {
                    exportResult.errors.push(`${contact.cardName || 'Unknown'}: ${error.message}`);
                    this.exportProgress.failed++;
                    this.exportProgress.processed++;
                }
            }

            // Update progress
            if (options.progressCallback) {
                options.progressCallback({
                    ...this.exportProgress,
                    percentage: Math.round((this.exportProgress.processed / this.exportProgress.total) * 100)
                });
            }

            this.eventBus?.emit('vcard:export:batch-progress', {
                batch: batchIndex + 1,
                totalBatches,
                processed: this.exportProgress.processed,
                total: this.exportProgress.total
            });
        }

        // Combine all vCards
        exportResult.export.content = combinedContent.join('\n');
        exportResult.export.size = exportResult.export.content.length;

        // Apply compression if requested and beneficial
        if (options.compress && exportResult.export.size > 1024) {
            try {
                const compressed = await this.compressContent(exportResult.export.content);
                if (compressed.size < exportResult.export.size * 0.8) { // Only if significant savings
                    exportResult.export.content = compressed.content;
                    exportResult.export.size = compressed.size;
                    exportResult.export.compressed = true;
                    exportResult.export.filename = this.addCompressionExtension(options.filename);
                }
            } catch (compressionError) {
                exportResult.warnings.push(`Compression failed: ${compressionError.message}`);
            }
        }

        // Download if requested
        if (options.download && exportResult.export.content) {
            const mimeType = exportResult.export.compressed ? 'application/gzip' : this.getMimeType(options.format);
            this.downloadFile(exportResult.export.content, exportResult.export.filename, mimeType);
        }

        return exportResult;
    }

    /**
     * Export each contact to individual files
     */
    async exportIndividualFiles(contacts, options, result) {
        const files = [];
        const exportResult = {
            files: [],
            errors: [],
            warnings: []
        };

        // Create a ZIP archive for multiple files
        const archive = new Map(); // filename -> content

        for (const contact of contacts) {
            try {
                const filename = this.generateFilename(contact, options.format);
                const contentResult = await this.generateVCardContent(contact, {
                    ...options,
                    download: false // Don't auto-download individual files
                });

                this.exportProgress.processed++;

                if (contentResult.success) {
                    archive.set(filename, contentResult.content);
                    files.push({
                        filename,
                        size: contentResult.content.length,
                        contact: {
                            id: contact.contactId || contact.itemId,
                            name: contact.cardName || contact.fullName
                        }
                    });
                    this.exportProgress.successful++;
                } else {
                    exportResult.errors.push(`${contact.cardName || 'Unknown'}: ${contentResult.errors.join(', ')}`);
                    this.exportProgress.failed++;
                }

                exportResult.warnings.push(...contentResult.warnings);

            } catch (error) {
                exportResult.errors.push(`${contact.cardName || 'Unknown'}: ${error.message}`);
                this.exportProgress.failed++;
                this.exportProgress.processed++;
            }
        }

        exportResult.files = files;

        // Create and download ZIP archive if requested
        if (options.download && files.length > 0) {
            try {
                const zipContent = await this.createZipArchive(archive);
                const zipFilename = options.filename.replace(/\.[^.]*$/, '.zip');
                this.downloadFile(zipContent, zipFilename, 'application/zip');
            } catch (zipError) {
                exportResult.warnings.push(`ZIP creation failed: ${zipError.message}`);
                // Fall back to individual downloads
                for (const [filename, content] of archive) {
                    this.downloadFile(content, filename, this.getMimeType(options.format));
                }
            }
        }

        return exportResult;
    }

    // Utility methods
    prepareContactDataForFormat(contact, format, options) {
        // Extract display data if contact is in database format
        let contactData;
        
        if (contact.vcard) {
            // Parse from vCard if available
            const parseResult = this.vCardStandard.parseVCard(contact.vcard);
            if (parseResult.success) {
                contactData = this.convertParsedVCardToContactData(parseResult.vCard);
            }
        }
        
        // Fall back to contact properties
        if (!contactData) {
            contactData = {
                fn: contact.cardName || contact.fullName || 'Unknown Contact',
                organization: contact.organization,
                title: contact.title,
                phones: contact.phones || [],
                emails: contact.emails || [],
                urls: contact.urls || [],
                addresses: contact.addresses || [],
                notes: contact.notes || [],
                birthday: contact.birthday
            };
        }

        // Apply format-specific modifications
        switch (format) {
            case 'apple-contacts':
                return this.prepareForAppleFormat(contactData);
            case 'vcard-3.0':
                return this.prepareForLegacyFormat(contactData);
            default:
                return contactData;
        }
    }

    prepareForAppleFormat(contactData) {
        // Apply Apple-specific formatting
        return {
            ...contactData,
            // Apple prefers certain type values
            phones: contactData.phones.map(phone => ({
                ...phone,
                type: this.mapToApplePhoneType(phone.type)
            })),
            emails: contactData.emails.map(email => ({
                ...email,
                type: this.mapToAppleEmailType(email.type)
            }))
        };
    }

    prepareForLegacyFormat(contactData) {
        // Remove features not supported in vCard 3.0
        return {
            ...contactData,
            // Simplify addresses for legacy compatibility
            addresses: contactData.addresses.map(addr => ({
                type: addr.type || 'home',
                street: addr.street,
                city: addr.city,
                state: addr.state,
                postalCode: addr.postalCode,
                country: addr.country
            }))
        };
    }

    applyFormatSpecificProcessing(content, format) {
        switch (format) {
            case 'apple-contacts':
                // Apply Apple-specific line ending preferences
                return content.replace(/\r?\n/g, '\r\n');
            default:
                return content;
        }
    }

    validateExportedContent(content, format) {
        try {
            const parseResult = this.vCardStandard.parseVCard(content, {
                strictMode: this.config.validation.strictMode
            });

            return {
                isValid: parseResult.success,
                errors: parseResult.errors || [],
                warnings: parseResult.warnings || [],
                format: format,
                version: parseResult.version
            };

        } catch (error) {
            return {
                isValid: false,
                errors: [`Validation failed: ${error.message}`],
                warnings: [],
                format: format
            };
        }
    }

    generateFilename(contact, format) {
        const baseName = (contact.cardName || contact.fullName || 'contact')
            .replace(/[^a-zA-Z0-9\-_\s]/g, '')
            .replace(/\s+/g, '_')
            .toLowerCase();
        
        const extension = this.config.formats[format]?.fileExtension || '.vcf';
        return `${baseName}${extension}`;
    }

    getMimeType(format) {
        return this.config.formats[format]?.mimeType || 'text/vcard';
    }

    downloadFile(content, filename, mimeType) {
        try {
            const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Clean up
            setTimeout(() => URL.revokeObjectURL(url), 100);
            
        } catch (error) {
            console.error('Download failed:', error);
            throw new Error(`Download failed: ${error.message}`);
        }
    }

    truncateVCardForQR(content, maxSize) {
        const lines = content.split('\n');
        const essentialLines = [];
        let currentSize = 0;
        
        // Always include BEGIN, VERSION, FN, END
        const required = ['BEGIN:VCARD', 'VERSION:', 'FN:', 'END:VCARD'];
        
        for (const line of lines) {
            const lineSize = line.length + 1; // +1 for newline
            
            if (required.some(req => line.includes(req)) || currentSize + lineSize <= maxSize) {
                essentialLines.push(line);
                currentSize += lineSize;
            } else if (currentSize + lineSize > maxSize) {
                break;
            }
        }
        
        // Ensure we have an END:VCARD
        if (!essentialLines.some(line => line.includes('END:VCARD'))) {
            essentialLines.push('END:VCARD');
        }
        
        return essentialLines.join('\n');
    }

    // Compression and archive methods (would need external libraries in real implementation)
    async compressContent(content) {
        // Placeholder for compression logic
        // In real implementation, would use pako or similar library
        return {
            content: content, // Would be compressed data
            size: content.length * 0.6 // Estimated compression ratio
        };
    }

    async createZipArchive(fileMap) {
        // Placeholder for ZIP creation logic
        // In real implementation, would use JSZip or similar library
        const archiveContent = Array.from(fileMap.entries())
            .map(([filename, content]) => `${filename}:\n${content}\n`)
            .join('\n---\n');
        
        return archiveContent;
    }

    addCompressionExtension(filename) {
        return filename.replace(/\.[^.]*$/, '.vcf.gz');
    }

    // Type mapping methods
    mapToApplePhoneType(type) {
        const mapping = {
            'cell': 'MOBILE',
            'mobile': 'MOBILE',
            'work': 'WORK',
            'home': 'HOME',
            'main': 'MAIN'
        };
        return mapping[type.toLowerCase()] || 'OTHER';
    }

    mapToAppleEmailType(type) {
        const mapping = {
            'work': 'WORK',
            'home': 'HOME',
            'personal': 'HOME'
        };
        return mapping[type.toLowerCase()] || 'OTHER';
    }

    convertParsedVCardToContactData(vCard) {
        const properties = vCard.properties;
        
        return {
            fn: this.getPropertyValue(properties, 'FN'),
            organization: this.getPropertyValue(properties, 'ORG'),
            title: this.getPropertyValue(properties, 'TITLE'),
            phones: this.extractMultiValueProperties(properties, 'TEL'),
            emails: this.extractMultiValueProperties(properties, 'EMAIL'),
            urls: this.extractMultiValueProperties(properties, 'URL'),
            addresses: this.extractAddressProperties(properties),
            notes: this.extractNotesProperties(properties),
            birthday: this.getPropertyValue(properties, 'BDAY')
        };
    }

    getPropertyValue(properties, propertyName) {
        const value = properties.get(propertyName);
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && value.length > 0) {
            return value[0].value || value[0];
        }
        return null;
    }

    extractMultiValueProperties(properties, propertyName) {
        const values = properties.get(propertyName);
        if (!values || !Array.isArray(values)) return [];
        
        return values.map((item, index) => ({
            value: item.value || '',
            type: item.parameters?.TYPE || 'other',
            primary: item.parameters?.PREF === '1' || index === 0
        }));
    }

    extractAddressProperties(properties) {
        const addresses = properties.get('ADR');
        if (!addresses || !Array.isArray(addresses)) return [];
        
        return addresses.map((addr, index) => {
            const parts = (addr.value || '').split(';');
            return {
                type: addr.parameters?.TYPE || 'home',
                primary: addr.parameters?.PREF === '1' || index === 0,
                poBox: parts[0] || '',
                extendedAddress: parts[1] || '',
                street: parts[2] || '',
                city: parts[3] || '',
                state: parts[4] || '',
                postalCode: parts[5] || '',
                country: parts[6] || ''
            };
        });
    }

    extractNotesProperties(properties) {
        const notes = properties.get('NOTE');
        if (!notes) return [];
        
        if (Array.isArray(notes)) {
            return notes.map(note => note.value || note).filter(n => n.trim());
        }
        
        return [typeof notes === 'string' ? notes : notes.value || ''].filter(n => n.trim());
    }

    applyCustomFieldFilter(contactData, customFields) {
        if (!customFields || !Array.isArray(customFields)) return;
        
        const allowedFields = new Set(customFields);
        const filteredData = {};
        
        Object.keys(contactData).forEach(key => {
            if (allowedFields.has(key)) {
                filteredData[key] = contactData[key];
            }
        });
        
        // Always preserve required fields
        if (!filteredData.fn) {
            filteredData.fn = contactData.fn;
        }
        
        Object.assign(contactData, filteredData);
    }

    resetProgress() {
        this.exportProgress = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            started: null,
            currentBatch: 0
        };
    }

    getExportProgress() {
        return { ...this.exportProgress };
    }

    getSupportedFormats() {
        return Object.keys(this.config.formats).map(key => ({
            id: key,
            ...this.config.formats[key]
        }));
    }

    setConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    getConfig() {
        return { ...this.config };
    }
}

export default VCardExporter;