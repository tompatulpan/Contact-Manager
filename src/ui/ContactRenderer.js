/**
 * Contact Rendering Helper
 * Extracted from ContactUIController.js for better organization
 */
import { ContactUIHelpers } from './ContactUIHelpers.js';

export class ContactRenderer {
    /**
     * Render contact preview (for lists)
     */
    static renderContactPreview(contact) {
        const escapedName = ContactUIHelpers.escapeHtml(contact.cardName || 'Unnamed Contact');
        const initials = ContactUIHelpers.getInitials(contact.cardName || 'Unnamed Contact');
        const contactType = this.getContactType(contact);
        
        return `
            <div class="contact-item" data-contact-id="${ContactUIHelpers.escapeHtml(contact.itemId)}">
                <div class="contact-avatar avatar-${contactType}">
                    <div class="avatar-circle">${initials}</div>
                </div>
                <div class="contact-info">
                    <div class="contact-name">${escapedName}</div>
                    <div class="contact-preview-details">
                        ${this.renderContactPreviewDetails(contact)}
                    </div>
                </div>
                <div class="contact-actions">
                    <button class="btn-small" onclick="window.contactController?.viewContact('${ContactUIHelpers.escapeHtml(contact.itemId)}')">
                        View
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render contact preview details (phone, email)
     */
    static renderContactPreviewDetails(contact) {
        if (!contact.vcard) return '';
        
        // Extract first phone and email from vCard
        const phoneMatch = contact.vcard.match(/TEL[^:]*:([^\n\r]+)/);
        const emailMatch = contact.vcard.match(/EMAIL[^:]*:([^\n\r]+)/);
        
        const details = [];
        if (phoneMatch) {
            details.push(`📞 ${ContactUIHelpers.escapeHtml(phoneMatch[1])}`);
        }
        if (emailMatch) {
            details.push(`✉️ ${ContactUIHelpers.escapeHtml(emailMatch[1])}`);
        }
        
        return details.slice(0, 2).join(' • ');
    }

    /**
     * Render contact fields (phone, email, url)
     */
    static renderContactFields(fieldType, fields) {
        if (!fields || fields.length === 0) return '';
        
        const fieldConfig = {
            phone: { icon: 'fas fa-phone', label: 'Phone' },
            email: { icon: 'fas fa-envelope', label: 'Email' },
            url: { icon: 'fas fa-globe', label: 'Website' }
        };
        
        const config = fieldConfig[fieldType] || { icon: 'fas fa-file', label: 'Field' };
        
        return `
            <div class="field-group">
                <h4><i class="${config.icon}"></i> ${config.label}</h4>
                ${fields.map(field => this.renderSingleField(fieldType, field)).join('')}
            </div>
        `;
    }

    /**
     * Render a single field
     */
    static renderSingleField(fieldType, field) {
        const escapedValue = ContactUIHelpers.escapeHtml(field.value || '');
        const escapedType = ContactUIHelpers.escapeHtml(field.type || '');
        const primaryBadge = field.primary ? '<span class="field-primary">Primary</span>' : '';
        
        let content = '';
        
        switch (fieldType) {
            case 'phone':
                const formattedPhone = ContactUIHelpers.formatPhoneNumber(field.value);
                content = `
                    <a href="tel:${escapedValue}" class="field-value">${ContactUIHelpers.escapeHtml(formattedPhone)}</a>
                `;
                break;
                
            case 'email':
                content = `
                    <a href="mailto:${escapedValue}" class="field-value">${escapedValue}</a>
                `;
                break;
                
            case 'url':
                content = `
                    <a href="${escapedValue}" target="_blank" class="field-value">${escapedValue}</a>
                `;
                break;
                
            default:
                content = `<span class="field-value">${escapedValue}</span>`;
        }
        
        return `
            <div class="field-item">
                ${content}
                <div class="field-meta">
                    <span class="field-type">${escapedType}</span>
                    ${primaryBadge}
                </div>
            </div>
        `;
    }

    /**
     * Render contact metadata (timestamps, ownership)
     */
    static renderContactMetadata(metadata) {
        if (!metadata) return '';
        
        const createdDate = ContactUIHelpers.formatDate(metadata.createdAt);
        const updatedDate = ContactUIHelpers.formatDate(metadata.lastUpdated);
        const ownershipBadge = metadata.isOwned ? 
            '<span class="badge badge-primary">Owned</span>' : 
            '<span class="badge badge-secondary">Shared</span>';
        
        return `
            <div class="contact-metadata">
                <div class="metadata-row">
                    <span class="metadata-label">Created:</span>
                    <span class="metadata-value">${ContactUIHelpers.escapeHtml(createdDate)}</span>
                </div>
                <div class="metadata-row">
                    <span class="metadata-label">Updated:</span>
                    <span class="metadata-value">${ContactUIHelpers.escapeHtml(updatedDate)}</span>
                </div>
                <div class="metadata-row">
                    <span class="metadata-label">Status:</span>
                    <span class="metadata-value">${ownershipBadge}</span>
                </div>
            </div>
        `;
    }

    /**
     * Render contact avatar with type-specific styling
     * @param {string} name - Contact name for initials
     * @param {string} size - Size: 'small', 'medium', 'large'
     * @param {string} type - Type: 'owned', 'shared', 'imported'
     */
    static renderContactAvatar(name, size = 'medium', type = 'owned') {
        const initials = ContactUIHelpers.getInitials(name);
        const sizeClass = `avatar-${size}`;
        const typeClass = `avatar-${type}`;
        
        return `
            <div class="contact-avatar ${sizeClass} ${typeClass}">
                <div class="avatar-circle">${ContactUIHelpers.escapeHtml(initials)}</div>
            </div>
        `;
    }

    /**
     * Render contact actions (edit, share, delete)
     */
    static renderContactActions(contact, permissions = {}) {
        const contactId = ContactUIHelpers.escapeHtml(contact.itemId);
        const canEdit = permissions.canEdit !== false;
        const canShare = permissions.canShare !== false;
        const canDelete = permissions.canDelete !== false;
        
        return `
            <div class="contact-actions">
                ${canEdit ? `
                    <button class="btn btn-primary" onclick="window.contactController?.editContact('${contactId}')">
                        Edit
                    </button>
                ` : ''}
                ${canShare ? `
                    <button class="btn btn-secondary" onclick="window.contactController?.shareContact('${contactId}')">
                        Share
                    </button>
                ` : ''}
                ${canDelete ? `
                    <button class="btn btn-danger" onclick="window.contactController?.deleteContact('${contactId}')">
                        Delete
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render empty state message
     */
    static renderEmptyState(message = 'No contacts found', actionText = '', actionHandler = '') {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-message">${ContactUIHelpers.escapeHtml(message)}</div>
                ${actionText && actionHandler ? `
                    <button class="btn btn-primary" onclick="${ContactUIHelpers.escapeHtml(actionHandler)}">
                        ${ContactUIHelpers.escapeHtml(actionText)}
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render loading state
     */
    static renderLoadingState(message = 'Loading contacts...') {
        return `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-message">${ContactUIHelpers.escapeHtml(message)}</div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    static renderErrorState(error, retryHandler = '') {
        return `
            <div class="error-state">
                <div class="error-icon">⚠️</div>
                <div class="error-message">${ContactUIHelpers.escapeHtml(error)}</div>
                ${retryHandler ? `
                    <button class="btn btn-primary" onclick="${ContactUIHelpers.escapeHtml(retryHandler)}">
                        Retry
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render contact search results
     */
    static renderSearchResults(contacts, query) {
        if (contacts.length === 0) {
            return this.renderEmptyState(`No contacts found for "${query}"`, 'Clear Search', 'window.contactController?.clearSearch()');
        }
        
        return `
            <div class="search-results">
                <div class="search-results-header">
                    Found ${contacts.length} contact${contacts.length === 1 ? '' : 's'} for "${ContactUIHelpers.escapeHtml(query)}"
                </div>
                <div class="contact-list">
                    ${contacts.map(contact => this.renderContactPreview(contact)).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Determine contact type for avatar styling
     * @param {Object} contact - Contact object
     * @returns {string} - 'owned', 'shared', or 'imported'
     */
    static getContactType(contact) {
        const isOwned = contact.metadata?.isOwned;
        const isImported = contact.metadata?.isImported;
        
        // Check shared first (not owned by current user)
        if (isOwned === false) {
            return 'shared';  // Green - contacts shared with you
        }
        // Then check if imported (owned but from external source)
        else if (isImported === true) {
            return 'imported';  // Orange - imported from files/CardDAV
        }
        // Default to owned (created locally)
        else {
            return 'owned';  // Blue - contacts you created
        }
    }
}

// ES6 module export (see export at class declaration)