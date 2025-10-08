/**
 * Enhanced Import/Export Integration
 * Connects the new vCard handling components with existing ContactUIController
 */

import { VCardImporter } from '../core/VCardImporter.js';
import { VCardExporter } from '../core/VCardExporter.js';

export class ImportExportIntegration {
    constructor(contactManager, eventBus) {
        this.contactManager = contactManager;
        this.eventBus = eventBus;
        
        // Initialize enhanced components
        this.importer = new VCardImporter(contactManager, eventBus);
        this.exporter = new VCardExporter(eventBus);
        
        // Bind event handlers
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Import progress events
        this.eventBus.on('vcard:import:batch-progress', (data) => {
            this.updateImportProgress(data);
        });

        // Import completion events
        this.eventBus.on('vcard:import:completed', (data) => {
            this.handleImportCompleted(data);
        });

        // Export progress events
        this.eventBus.on('vcard:export:batch-progress', (data) => {
            this.updateExportProgress(data);
        });

        // Export completion events
        this.eventBus.on('vcard:export:batch-completed', (data) => {
            this.handleExportCompleted(data);
        });
    }

    /**
     * Enhanced import with drag-and-drop support
     */
    async handleFileImport(files, options = {}) {
        const importOptions = {
            duplicateHandling: 'skip',
            markAsImported: true,
            validateFormat: true,
            strictMode: false,
            progressCallback: (progress) => {
                this.showImportProgress(progress);
            },
            ...options
        };

        try {
            // Show import modal with progress
            this.showImportModal(files.length);

            let result;
            if (files.length === 1) {
                result = await this.importer.importFromFile(files[0], importOptions);
            } else {
                result = await this.importer.importMultipleFiles(files, importOptions);
            }

            // Display results
            this.displayImportResults(result);
            
            return result;

        } catch (error) {
            this.showImportError(error.message);
            throw error;
        }
    }

    /**
     * Enhanced export with format selection
     */
    async handleContactExport(contacts, options = {}) {
        const exportOptions = {
            format: 'vcard-4.0',
            combinedFile: true,
            compress: contacts.length > 10,
            download: true,
            progressCallback: (progress) => {
                this.showExportProgress(progress);
            },
            ...options
        };

        try {
            // Show export modal with format selection
            if (!options.format) {
                const selectedFormat = await this.showFormatSelectionModal();
                if (!selectedFormat) return null; // User cancelled
                exportOptions.format = selectedFormat;
            }

            const result = await this.exporter.exportContacts(contacts, exportOptions);
            
            if (result.success) {
                this.showExportSuccess(result);
            } else {
                this.showExportError(result.errors);
            }

            return result;

        } catch (error) {
            this.showExportError([error.message]);
            throw error;
        }
    }

    /**
     * Generate QR code for contact
     */
    async generateContactQR(contact, options = {}) {
        const qrOptions = {
            format: 'vcard-3.0',  // Use vCard 3.0 for better mobile device compatibility
            maxSize: 2048,
            ...options
        };

        try {
            const result = this.exporter.generateQRCode(contact, qrOptions);
            
            if (result.success) {
                this.displayQRCode(result.qr.data, contact.cardName);
            } else {
                this.showError(`QR generation failed: ${result.errors.join(', ')}`);
            }

            return result;

        } catch (error) {
            this.showError(`QR generation error: ${error.message}`);
            throw error;
        }
    }

    // UI Methods (to be integrated with ContactUIController)

    showImportModal(fileCount) {
        const modal = document.createElement('div');
        modal.className = 'import-modal-overlay';
        modal.innerHTML = `
            <div class="import-modal">
                <div class="modal-header">
                    <h3>Importing ${fileCount} file${fileCount > 1 ? 's' : ''}</h3>
                    <button class="close-btn" onclick="this.closest('.import-modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="import-progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" id="import-progress-fill"></div>
                        </div>
                        <div class="progress-text" id="import-progress-text">Preparing import...</div>
                        <div class="progress-details" id="import-progress-details"></div>
                    </div>
                    <div class="import-results" id="import-results" style="display: none;"></div>
                </div>
                <div class="modal-footer">
                    <button id="import-cancel-btn" class="btn btn-secondary">Cancel</button>
                    <button id="import-close-btn" class="btn btn-primary" style="display: none;">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    showImportProgress(progress) {
        const progressFill = document.getElementById('import-progress-fill');
        const progressText = document.getElementById('import-progress-text');
        const progressDetails = document.getElementById('import-progress-details');

        if (progressFill) {
            progressFill.style.width = `${progress.percentage || 0}%`;
        }

        if (progressText) {
            progressText.textContent = `Processing ${progress.processed}/${progress.total} contacts...`;
        }

        if (progressDetails) {
            progressDetails.innerHTML = `
                <div class="progress-stats">
                    <span class="stat-success">✅ ${progress.successful || 0} imported</span>
                    <span class="stat-failed">❌ ${progress.failed || 0} failed</span>
                    <span class="stat-skipped">⏭️ ${progress.skipped || 0} skipped</span>
                </div>
            `;
        }
    }

    displayImportResults(result) {
        const resultsContainer = document.getElementById('import-results');
        const progressContainer = document.querySelector('.import-progress-container');
        const cancelBtn = document.getElementById('import-cancel-btn');
        const closeBtn = document.getElementById('import-close-btn');

        if (progressContainer) {
            progressContainer.style.display = 'none';
        }

        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }

        if (closeBtn) {
            closeBtn.style.display = 'inline-block';
        }

        if (resultsContainer) {
            resultsContainer.style.display = 'block';
            
            const statistics = result.statistics || result;
            const isMultiFile = result.totalFiles !== undefined;
            
            resultsContainer.innerHTML = `
                <div class="import-summary">
                    <h4>Import Complete</h4>
                    ${isMultiFile ? `
                        <div class="summary-stats">
                            <div class="stat-item">
                                <strong>${result.successfulFiles}</strong> files processed successfully
                            </div>
                            <div class="stat-item">
                                <strong>${result.importedContacts}</strong> contacts imported
                            </div>
                            <div class="stat-item">
                                <strong>${result.totalContacts}</strong> total contacts found
                            </div>
                        </div>
                    ` : `
                        <div class="summary-stats">
                            <div class="stat-item">
                                <strong>${statistics.imported || 0}</strong> contacts imported
                            </div>
                            <div class="stat-item">
                                <strong>${statistics.failed || 0}</strong> failed
                            </div>
                            <div class="stat-item">
                                <strong>${statistics.skipped || 0}</strong> skipped (duplicates)
                            </div>
                        </div>
                    `}
                    
                    ${result.errors && result.errors.length > 0 ? `
                        <div class="import-errors">
                            <h5>Errors:</h5>
                            <ul>
                                ${result.errors.slice(0, 5).map(error => `<li>${error}</li>`).join('')}
                                ${result.errors.length > 5 ? `<li>... and ${result.errors.length - 5} more</li>` : ''}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${result.warnings && result.warnings.length > 0 ? `
                        <div class="import-warnings">
                            <h5>Warnings:</h5>
                            <ul>
                                ${result.warnings.slice(0, 3).map(warning => `<li>${warning}</li>`).join('')}
                                ${result.warnings.length > 3 ? `<li>... and ${result.warnings.length - 3} more</li>` : ''}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        // Refresh contact list after successful import
        if (result.success || (result.successfulFiles && result.successfulFiles > 0)) {
            this.eventBus.emit('contacts:refresh');
        }
    }

    async showFormatSelectionModal() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'format-modal-overlay';
            
            const formats = this.exporter.getSupportedFormats();
            
            modal.innerHTML = `
                <div class="format-modal">
                    <div class="modal-header">
                        <h3>Select Export Format</h3>
                        <button class="close-btn" onclick="this.closest('.format-modal-overlay').remove(); resolve(null);">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="format-options">
                            ${formats.map(format => `
                                <div class="format-option" data-format="${format.id}">
                                    <input type="radio" name="export-format" value="${format.id}" id="format-${format.id}" ${format.id === 'vcard-4.0' ? 'checked' : ''}>
                                    <label for="format-${format.id}">
                                        <strong>${format.name}</strong>
                                        <p>${format.description}</p>
                                        <div class="format-features">
                                            ${format.features.map(feature => `<span class="feature-tag">${feature}</span>`).join('')}
                                        </div>
                                    </label>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.format-modal-overlay').remove(); resolve(null);">Cancel</button>
                        <button class="btn btn-primary" onclick="
                            const selected = document.querySelector('input[name=export-format]:checked');
                            this.closest('.format-modal-overlay').remove();
                            resolve(selected ? selected.value : null);
                        ">Export</button>
                    </div>
                </div>
            `;

            // Bind resolve function to modal for access from onclick handlers
            modal.resolve = resolve;

            document.body.appendChild(modal);
        });
    }

    displayQRCode(qrData, contactName) {
        const modal = document.createElement('div');
        modal.className = 'qr-modal-overlay';
        modal.innerHTML = `
            <div class="qr-modal">
                <div class="modal-header">
                    <h3>QR Code - ${contactName}</h3>
                    <button class="close-btn" onclick="this.closest('.qr-modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="qr-code-container" id="qr-code-container">
                        <div class="qr-placeholder">Generating QR code...</div>
                    </div>
                    <div class="qr-info">
                        <p>Scan this QR code to add the contact to your phone.</p>
                        <p class="qr-size">Data size: ${qrData.length} bytes</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.qr-modal-overlay').remove()">Close</button>
                    <button class="btn btn-primary" onclick="this.downloadQRData('${contactName}')">Download vCard</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Generate QR code using external library (would need to be included)
        this.generateQRCodeImage(qrData, 'qr-code-container');
    }

    generateQRCodeImage(data, containerId) {
        // Placeholder for QR code generation
        // In real implementation, would use a library like qrcode.js
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="qr-code-placeholder">
                    <p>QR Code would be displayed here</p>
                    <p>Data: ${data.substring(0, 50)}...</p>
                    <p><small>Include qrcode.js library for actual QR generation</small></p>
                </div>
            `;
        }
    }

    // Event handlers for progress updates
    updateImportProgress(data) {
        this.showImportProgress({
            processed: data.processed,
            total: data.total,
            percentage: Math.round((data.processed / data.total) * 100)
        });
    }

    updateExportProgress(data) {
        this.showExportProgress({
            processed: data.processed,
            total: data.total,
            percentage: Math.round((data.processed / data.total) * 100)
        });
    }

    handleImportCompleted(data) {
        console.log('Import completed:', data);
        this.showNotification(`Import completed: ${data.result.statistics.imported} contacts imported`, 'success');
    }

    handleExportCompleted(data) {
        console.log('Export completed:', data);
        this.showNotification(`Export completed: ${data.successful} contacts exported`, 'success');
    }

    // Utility methods
    showNotification(message, type = 'info') {
        // Integration with existing notification system
        this.eventBus.emit('notification:show', { message, type });
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showImportError(message) {
        this.showError(`Import failed: ${message}`);
    }

    showExportError(errors) {
        const message = Array.isArray(errors) ? errors.join(', ') : errors;
        this.showError(`Export failed: ${message}`);
    }

    showExportSuccess(result) {
        const message = `Exported ${result.successfulContacts} contact${result.successfulContacts !== 1 ? 's' : ''} successfully`;
        this.showNotification(message, 'success');
    }

    showExportProgress(progress) {
        // Similar to import progress but for export
        console.log('Export progress:', progress);
    }

    // Configuration methods
    configureImporter(config) {
        this.importer.setConfig(config);
    }

    configureExporter(config) {
        this.exporter.setConfig(config);
    }

    getImporterConfig() {
        return this.importer.getConfig();
    }

    getExporterConfig() {
        return this.exporter.getConfig();
    }
}