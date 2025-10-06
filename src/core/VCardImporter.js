/**
 * VCardImporter - Robust vCard Import Handler with Comprehensive Error Reporting
 * 
 * Features:
 * 1. ✅ Multi-vCard file support (multiple contacts in one file)
 * 2. ✅ Detailed error reporting and validation
 * 3. ✅ File type validation and drag-and-drop support
 * 4. ✅ Duplicate detection and handling
 * 5. ✅ Progress tracking for large imports
 * 6. ✅ Format detection (vCard 3.0/4.0, Apple/standard)
 * 7. ✅ Batch processing with error recovery
 * 8. ✅ Import statistics and reporting
 */

import { VCardStandardEnhanced } from './VCardStandardEnhanced.js';

export class VCardImporter {
    constructor(contactManager, eventBus) {
        this.contactManager = contactManager;
        this.eventBus = eventBus;
        this.vCardStandard = new VCardStandardEnhanced();
        
        // Import configuration
        this.config = {
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxContactsPerFile: 1000,
            supportedExtensions: ['.vcf', '.vcard'],
            supportedMimeTypes: ['text/vcard', 'text/x-vcard', 'text/plain'],
            batchSize: 10, // Process in batches for UI responsiveness
            duplicateHandling: 'skip', // 'skip', 'merge', 'replace', 'ask'
            strictValidation: false
        };

        // Progress tracking
        this.importProgress = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            started: null,
            currentBatch: 0
        };
    }

    /**
     * Import vCard from file with comprehensive validation and error handling
     * @param {File} file - File object from input or drag-and-drop
     * @param {Object} options - Import options
     * @returns {Promise<Object>} Import result with detailed statistics
     */
    async importFromFile(file, options = {}) {
        const importOptions = {
            cardName: options.cardName || null,
            markAsImported: options.markAsImported !== false,
            duplicateHandling: options.duplicateHandling || this.config.duplicateHandling,
            validateFormat: options.validateFormat !== false,
            strictMode: options.strictMode || false,
            progressCallback: options.progressCallback || null,
            ...options
        };

        const result = {
            success: false,
            file: {
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified
            },
            validation: {},
            statistics: {
                totalContacts: 0,
                imported: 0,
                failed: 0,
                skipped: 0,
                duplicates: 0,
                processingTime: 0
            },
            contacts: [],
            errors: [],
            warnings: [],
            duplicateReport: []
        };

        const startTime = Date.now();

        try {
            // Step 1: File validation
            const fileValidation = this.validateFile(file);
            result.validation = fileValidation;
            
            if (!fileValidation.isValid) {
                result.errors.push(...fileValidation.errors);
                return result;
            }

            result.warnings.push(...fileValidation.warnings);

            // Step 2: Read file content
            const content = await this.readFileContent(file);
            
            if (!content || content.trim().length === 0) {
                result.errors.push('File is empty or could not be read');
                return result;
            }

            // Step 3: Extract individual vCards
            const extractionResult = this.extractMultipleVCards(content);
            result.statistics.totalContacts = extractionResult.vCards.length;
            
            if (extractionResult.vCards.length === 0) {
                result.errors.push('No valid vCard data found in file');
                return result;
            }

            result.warnings.push(...extractionResult.warnings);

            // Step 4: Process vCards in batches
            const batchResult = await this.processBatchedImport(
                extractionResult.vCards,
                importOptions,
                result
            );

            // Step 5: Generate final statistics
            result.statistics.processingTime = Date.now() - startTime;
            result.success = result.statistics.imported > 0;

            // Emit completion event
            this.eventBus?.emit('vcard:import:completed', {
                result,
                file: file.name,
                duration: result.statistics.processingTime
            });

            return result;

        } catch (error) {
            result.errors.push(`Import failed: ${error.message}`);
            result.statistics.processingTime = Date.now() - startTime;
            
            this.eventBus?.emit('vcard:import:error', {
                error: error.message,
                file: file.name,
                duration: result.statistics.processingTime
            });
            
            return result;
        }
    }

    /**
     * Import multiple vCard files simultaneously
     * @param {FileList|Array} files - Array of File objects
     * @param {Object} options - Import options
     * @returns {Promise<Object>} Batch import result
     */
    async importMultipleFiles(files, options = {}) {
        const fileArray = Array.from(files);
        const batchResult = {
            success: false,
            totalFiles: fileArray.length,
            processedFiles: 0,
            successfulFiles: 0,
            failedFiles: 0,
            totalContacts: 0,
            importedContacts: 0,
            fileResults: [],
            overallErrors: [],
            overallWarnings: [],
            processingTime: 0
        };

        const startTime = Date.now();

        try {
            // Process files sequentially to avoid overwhelming the system
            for (const file of fileArray) {
                try {
                    const fileResult = await this.importFromFile(file, options);
                    batchResult.fileResults.push(fileResult);
                    batchResult.processedFiles++;
                    
                    if (fileResult.success) {
                        batchResult.successfulFiles++;
                        batchResult.importedContacts += fileResult.statistics.imported;
                    } else {
                        batchResult.failedFiles++;
                        batchResult.overallErrors.push(`${file.name}: ${fileResult.errors.join(', ')}`);
                    }
                    
                    batchResult.totalContacts += fileResult.statistics.totalContacts;
                    batchResult.overallWarnings.push(...fileResult.warnings);

                    // Emit progress update
                    this.eventBus?.emit('vcard:import:file-progress', {
                        current: batchResult.processedFiles,
                        total: batchResult.totalFiles,
                        fileName: file.name,
                        fileResult
                    });

                } catch (error) {
                    batchResult.failedFiles++;
                    batchResult.processedFiles++;
                    batchResult.overallErrors.push(`${file.name}: ${error.message}`);
                }
            }

            batchResult.success = batchResult.successfulFiles > 0;
            batchResult.processingTime = Date.now() - startTime;

            return batchResult;

        } catch (error) {
            batchResult.overallErrors.push(`Batch import failed: ${error.message}`);
            batchResult.processingTime = Date.now() - startTime;
            return batchResult;
        }
    }

    /**
     * Extract multiple vCards from file content
     * Handles both single and multi-contact files
     */
    extractMultipleVCards(content) {
        const result = {
            vCards: [],
            warnings: [],
            statistics: {
                totalLines: 0,
                vCardBlocks: 0,
                malformedBlocks: 0
            }
        };

        try {
            const lines = content.split(/\r?\n/);
            result.statistics.totalLines = lines.length;

            let currentVCard = [];
            let insideVCard = false;
            let vCardCount = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line === 'BEGIN:VCARD') {
                    if (insideVCard) {
                        result.warnings.push(`Line ${i + 1}: BEGIN:VCARD found inside existing vCard block`);
                    }
                    insideVCard = true;
                    currentVCard = [line];
                    vCardCount++;
                } else if (line === 'END:VCARD') {
                    if (!insideVCard) {
                        result.warnings.push(`Line ${i + 1}: END:VCARD found without matching BEGIN:VCARD`);
                        continue;
                    }
                    
                    currentVCard.push(line);
                    const vCardString = currentVCard.join('\n');
                    
                    // Validate the extracted vCard
                    if (this.isValidVCardStructure(vCardString)) {
                        result.vCards.push(vCardString);
                        result.statistics.vCardBlocks++;
                    } else {
                        result.warnings.push(`vCard block ${vCardCount} is malformed, skipping`);
                        result.statistics.malformedBlocks++;
                    }
                    
                    currentVCard = [];
                    insideVCard = false;
                } else if (insideVCard) {
                    currentVCard.push(line);
                } else if (line.length > 0) {
                    // Content outside vCard blocks
                    if (line.includes(':') && !line.startsWith('#') && !line.startsWith('//')) {
                        result.warnings.push(`Line ${i + 1}: Property outside vCard block ignored: ${line.substring(0, 50)}...`);
                    }
                }
            }

            // Handle incomplete vCard block
            if (insideVCard && currentVCard.length > 0) {
                result.warnings.push('Incomplete vCard block at end of file, missing END:VCARD');
                result.statistics.malformedBlocks++;
            }

            // Check if no vCards were found but content exists
            if (result.vCards.length === 0 && result.statistics.totalLines > 0) {
                // Try to detect if this might be a single contact without proper BEGIN/END
                if (content.includes('FN:') || content.includes('EMAIL:') || content.includes('TEL:')) {
                    result.warnings.push('File contains contact properties but no proper vCard structure');
                }
            }

            return result;

        } catch (error) {
            result.warnings.push(`vCard extraction failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Process vCards in batches for better UI responsiveness
     */
    async processBatchedImport(vCards, options, result) {
        this.resetProgress();
        this.importProgress.total = vCards.length;
        this.importProgress.started = new Date();

        const batchSize = Math.min(this.config.batchSize, vCards.length);
        const totalBatches = Math.ceil(vCards.length / batchSize);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIdx = batchIndex * batchSize;
            const endIdx = Math.min(startIdx + batchSize, vCards.length);
            const batch = vCards.slice(startIdx, endIdx);

            this.importProgress.currentBatch = batchIndex + 1;

            // Process batch
            await this.processBatch(batch, startIdx, options, result);

            // Update progress and emit event
            if (options.progressCallback) {
                options.progressCallback({
                    ...this.importProgress,
                    percentage: Math.round((this.importProgress.processed / this.importProgress.total) * 100)
                });
            }

            this.eventBus?.emit('vcard:import:batch-progress', {
                batch: batchIndex + 1,
                totalBatches,
                processed: this.importProgress.processed,
                total: this.importProgress.total
            });

            // Small delay for UI responsiveness
            if (batchIndex < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        return result;
    }

    /**
     * Process a single batch of vCards
     */
    async processBatch(vCardBatch, baseIndex, options, result) {
        for (let i = 0; i < vCardBatch.length; i++) {
            const vCardString = vCardBatch[i];
            const contactIndex = baseIndex + i + 1;

            try {
                const importResult = await this.processIndividualVCard(
                    vCardString,
                    contactIndex,
                    options
                );

                this.importProgress.processed++;

                if (importResult.success) {
                    if (importResult.action === 'imported') {
                        result.statistics.imported++;
                        result.contacts.push(importResult.contact);
                        this.importProgress.successful++;
                    } else if (importResult.action === 'skipped') {
                        result.statistics.skipped++;
                        result.duplicateReport.push(importResult.duplicateInfo);
                        this.importProgress.skipped++;
                    }
                } else {
                    result.statistics.failed++;
                    result.errors.push(`Contact ${contactIndex}: ${importResult.error}`);
                    this.importProgress.failed++;
                }

                result.warnings.push(...(importResult.warnings || []));

            } catch (error) {
                this.importProgress.processed++;
                this.importProgress.failed++;
                result.statistics.failed++;
                result.errors.push(`Contact ${contactIndex}: Processing failed - ${error.message}`);
            }
        }
    }

    /**
     * Process individual vCard with duplicate detection
     */
    async processIndividualVCard(vCardString, index, options) {
        const result = {
            success: false,
            action: null, // 'imported', 'skipped', 'failed'
            contact: null,
            error: null,
            warnings: [],
            duplicateInfo: null
        };

        try {
            // Parse vCard
            const parseResult = this.vCardStandard.parseVCard(vCardString, {
                strictMode: options.strictMode,
                validateTypes: true
            });

            if (!parseResult.success) {
                result.error = `Parsing failed: ${parseResult.errors.join(', ')}`;
                return result;
            }

            result.warnings.push(...parseResult.warnings);

            // Convert to contact data format
            const contactData = this.convertVCardToContactData(parseResult.vCard, options);

            // Check for duplicates
            if (options.duplicateHandling !== 'replace') {
                const duplicateCheck = await this.checkForDuplicate(contactData);
                
                if (duplicateCheck.isDuplicate) {
                    result.duplicateInfo = {
                        newContact: contactData,
                        existingContact: duplicateCheck.existingContact,
                        matchType: duplicateCheck.matchType,
                        confidence: duplicateCheck.confidence
                    };

                    if (options.duplicateHandling === 'skip') {
                        result.success = true;
                        result.action = 'skipped';
                        return result;
                    } else if (options.duplicateHandling === 'merge') {
                        // Merge logic would go here
                        contactData = this.mergeContactData(duplicateCheck.existingContact, contactData);
                    }
                }
            }

            // Import the contact
            const saveResult = await this.contactManager.createContact(contactData);

            if (saveResult.success) {
                result.success = true;
                result.action = 'imported';
                result.contact = saveResult.contact;
            } else {
                result.error = saveResult.error || 'Unknown save error';
            }

            return result;

        } catch (error) {
            result.error = error.message;
            return result;
        }
    }

    /**
     * Convert parsed vCard to contact data format
     */
    convertVCardToContactData(vCard, options) {
        const properties = vCard.properties;
        
        const contactData = {
            // Required fields
            fn: this.getPropertyValue(properties, 'FN') || 'Imported Contact',
            
            // Optional fields
            structuredName: this.getPropertyValue(properties, 'N'),
            organization: this.getPropertyValue(properties, 'ORG'),
            title: this.getPropertyValue(properties, 'TITLE'),
            
            // Multi-value fields
            phones: this.extractMultiValueProperties(properties, 'TEL'),
            emails: this.extractMultiValueProperties(properties, 'EMAIL'),
            urls: this.extractMultiValueProperties(properties, 'URL'),
            addresses: this.extractAddressProperties(properties),
            
            // Notes
            notes: this.extractNotesProperties(properties),
            
            // Personal
            birthday: this.formatBirthdayProperty(this.getPropertyValue(properties, 'BDAY')),
            
            // Card name generation
            cardName: options.cardName || this.generateCardName(properties)
        };

        // Mark as imported if requested
        if (options.markAsImported) {
            contactData.metadata = {
                isImported: true,
                importedAt: new Date().toISOString(),
                importSource: 'vcard-file'
            };
        }

        return contactData;
    }

    /**
     * Extract multi-value properties with proper type handling
     */
    extractMultiValueProperties(properties, propertyName) {
        const values = properties.get(propertyName);
        if (!values || !Array.isArray(values)) {
            return [];
        }

        return values.map((item, index) => ({
            value: item.value || '',
            type: this.normalizeType(item.parameters?.TYPE || 'other'),
            primary: item.parameters?.PREF === '1' || index === 0
        }));
    }

    /**
     * Extract address properties with proper ADR parsing
     */
    extractAddressProperties(properties) {
        const addresses = properties.get('ADR');
        if (!addresses || !Array.isArray(addresses)) {
            return [];
        }

        return addresses.map((addr, index) => {
            const parts = (addr.value || '').split(';');
            
            return {
                type: this.normalizeType(addr.parameters?.TYPE || 'home'),
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

    /**
     * File validation with comprehensive checks
     */
    validateFile(file) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Check file existence
        if (!file) {
            result.errors.push('No file provided');
            result.isValid = false;
            return result;
        }

        // Check file size
        if (file.size > this.config.maxFileSize) {
            result.errors.push(`File too large: ${Math.round(file.size / 1024 / 1024)}MB (max: ${Math.round(this.config.maxFileSize / 1024 / 1024)}MB)`);
            result.isValid = false;
        }

        if (file.size === 0) {
            result.errors.push('File is empty');
            result.isValid = false;
        }

        // Check file extension
        const hasValidExtension = this.config.supportedExtensions.some(ext => 
            file.name.toLowerCase().endsWith(ext.toLowerCase())
        );

        // Check MIME type
        const hasValidMimeType = this.config.supportedMimeTypes.includes(file.type);

        if (!hasValidExtension && !hasValidMimeType) {
            result.warnings.push(`Unrecognized file type: ${file.type}. Supported: ${this.config.supportedExtensions.join(', ')}`);
        }

        // Warn about potential encoding issues
        if (file.name.includes(' ') || /[^\x00-\x7F]/.test(file.name)) {
            result.warnings.push('File name contains special characters, may cause encoding issues');
        }

        return result;
    }

    /**
     * Check for duplicate contacts
     */
    async checkForDuplicate(contactData) {
        // This would integrate with your contact manager's duplicate detection
        // For now, returning a simple check based on name and email
        
        const result = {
            isDuplicate: false,
            existingContact: null,
            matchType: null,
            confidence: 0
        };

        try {
            const existingContacts = await this.contactManager.getAllContacts();
            
            for (const existing of existingContacts) {
                const match = this.calculateContactSimilarity(contactData, existing);
                
                if (match.confidence > 0.8) {
                    result.isDuplicate = true;
                    result.existingContact = existing;
                    result.matchType = match.type;
                    result.confidence = match.confidence;
                    break;
                }
            }

            return result;

        } catch (error) {
            console.warn('Duplicate check failed:', error);
            return result;
        }
    }

    /**
     * Calculate similarity between contacts for duplicate detection
     */
    calculateContactSimilarity(contact1, contact2) {
        let score = 0;
        let matchType = 'none';

        // Name comparison
        if (contact1.fn && contact2.cardName) {
            const nameScore = this.calculateStringSimilarity(
                contact1.fn.toLowerCase(),
                contact2.cardName.toLowerCase()
            );
            score += nameScore * 0.4;
            if (nameScore > 0.8) matchType = 'name';
        }

        // Email comparison
        if (contact1.emails && contact1.emails.length > 0 && contact2.emails && contact2.emails.length > 0) {
            const emailMatch = contact1.emails.some(e1 => 
                contact2.emails.some(e2 => e1.value.toLowerCase() === e2.value.toLowerCase())
            );
            if (emailMatch) {
                score += 0.5;
                matchType = 'email';
            }
        }

        // Phone comparison
        if (contact1.phones && contact1.phones.length > 0 && contact2.phones && contact2.phones.length > 0) {
            const phoneMatch = contact1.phones.some(p1 => 
                contact2.phones.some(p2 => this.normalizePhoneNumber(p1.value) === this.normalizePhoneNumber(p2.value))
            );
            if (phoneMatch) {
                score += 0.3;
                if (matchType === 'none') matchType = 'phone';
            }
        }

        return { confidence: Math.min(score, 1.0), type: matchType };
    }

    // Utility methods
    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    isValidVCardStructure(vCardString) {
        return vCardString.includes('BEGIN:VCARD') && 
               vCardString.includes('END:VCARD') && 
               (vCardString.includes('FN:') || vCardString.includes('VERSION:'));
    }

    getPropertyValue(properties, propertyName) {
        const value = properties.get(propertyName);
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && value.length > 0) {
            return value[0].value || value[0];
        }
        return null;
    }

    extractNotesProperties(properties) {
        const notes = properties.get('NOTE');
        if (!notes) return [];
        
        if (Array.isArray(notes)) {
            return notes.map(note => note.value || note).filter(n => n.trim());
        }
        
        return typeof notes === 'string' ? [notes] : [notes.value || ''].filter(n => n.trim());
    }

    formatBirthdayProperty(birthday) {
        if (!birthday) return '';
        
        // Handle various birthday formats
        const dateMatch = birthday.match(/(\d{4})-(\d{2})-(\d{2})/);
        return dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
    }

    generateCardName(properties) {
        const fn = this.getPropertyValue(properties, 'FN');
        const org = this.getPropertyValue(properties, 'ORG');
        
        if (fn) {
            return org ? `${fn} - ${org}` : fn;
        }
        
        return org || 'Imported Contact';
    }

    normalizeType(type) {
        if (!type) return 'other';
        return type.toLowerCase().replace(/[^a-z]/g, '');
    }

    normalizePhoneNumber(phone) {
        return phone.replace(/\D/g, '');
    }

    calculateStringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    mergeContactData(existing, imported) {
        // Basic merge strategy - this could be made more sophisticated
        return {
            ...existing,
            ...imported,
            phones: [...(existing.phones || []), ...(imported.phones || [])],
            emails: [...(existing.emails || []), ...(imported.emails || [])],
            urls: [...(existing.urls || []), ...(imported.urls || [])],
            addresses: [...(existing.addresses || []), ...(imported.addresses || [])],
            notes: [...(existing.notes || []), ...(imported.notes || [])]
        };
    }

    resetProgress() {
        this.importProgress = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            started: null,
            currentBatch: 0
        };
    }

    getImportProgress() {
        return { ...this.importProgress };
    }

    // Configuration methods
    setConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    getConfig() {
        return { ...this.config };
    }
}