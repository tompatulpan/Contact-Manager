/**
 * BulkOperations - Handles bulk select/delete operations on contacts
 * Extracted from ContactUIController for modularity.
 */
export class BulkOperations {
    constructor(contactManager, eventBus) {
        this.contactManager = contactManager;
        this.eventBus = eventBus;
        this.bulkSelectMode = false;
        this.selectedContacts = new Set();
    }

    toggle() {
        this.bulkSelectMode = !this.bulkSelectMode;
        if (this.bulkSelectMode) {
            this.enter();
        } else {
            this.exit();
        }
    }

    enter() {
        this.bulkSelectMode = true;
        this.selectedContacts.clear();

        const toolbar = document.getElementById('bulk-actions-toolbar');
        if (toolbar) toolbar.classList.remove('hidden');

        const contactCards = document.querySelectorAll('.contact-card');
        contactCards.forEach(card => this.addCheckboxToCard(card));

        const bulkSelectBtn = document.getElementById('bulk-select-btn');
        if (bulkSelectBtn) bulkSelectBtn.classList.add('active');

        this.updateSelectionCount();
    }

    exit() {
        this.bulkSelectMode = false;
        this.selectedContacts.clear();

        const toolbar = document.getElementById('bulk-actions-toolbar');
        if (toolbar) toolbar.classList.add('hidden');

        const contactCards = document.querySelectorAll('.contact-card');
        contactCards.forEach(card => this.removeCheckboxFromCard(card));

        const bulkSelectBtn = document.getElementById('bulk-select-btn');
        if (bulkSelectBtn) bulkSelectBtn.classList.remove('active');

        const selectAllCheckbox = document.getElementById('select-all-contacts');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
    }

    addCheckboxToCard(card) {
        if (card.querySelector('.contact-card-checkbox')) return;

        const contactId = card.dataset.contactId;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'contact-card-checkbox';
        checkbox.dataset.contactId = contactId;
        checkbox.checked = this.selectedContacts.has(contactId);

        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            this.handleCheckboxChange(contactId, e.target.checked);
        });

        card.classList.add('bulk-select-mode');
        card.insertBefore(checkbox, card.firstChild);
    }

    removeCheckboxFromCard(card) {
        const checkbox = card.querySelector('.contact-card-checkbox');
        if (checkbox) checkbox.remove();
        card.classList.remove('bulk-select-mode', 'selected');
    }

    handleCheckboxChange(contactId, checked) {
        if (checked) {
            this.selectedContacts.add(contactId);
        } else {
            this.selectedContacts.delete(contactId);
        }

        const card = document.querySelector(`.contact-card[data-contact-id="${contactId}"]`);
        if (card) {
            card.classList.toggle('selected', checked);
        }

        this.updateSelectionCount();
        this.updateSelectAllCheckbox();
    }

    handleSelectAll(event) {
        const checked = event.target.checked;

        const contactCards = document.querySelectorAll('.contact-card');
        contactCards.forEach(card => {
            const contactId = card.dataset.contactId;
            if (contactId) {
                if (checked) {
                    this.selectedContacts.add(contactId);
                } else {
                    this.selectedContacts.delete(contactId);
                }
                const checkbox = card.querySelector('.contact-card-checkbox');
                if (checkbox) checkbox.checked = checked;
                card.classList.toggle('selected', checked);
            }
        });
        if (!checked) this.selectedContacts.clear();

        this.updateSelectionCount();
    }

    updateSelectionCount() {
        const countElement = document.getElementById('bulk-selection-count');
        if (countElement) {
            const count = this.selectedContacts.size;
            countElement.textContent = count === 0 ? '0 selected' :
                                       count === 1 ? '1 selected' :
                                       `${count} selected`;
        }
    }

    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('select-all-contacts');
        if (!selectAllCheckbox) return;

        const totalVisible = document.querySelectorAll('.contact-card').length;
        const selectedCount = this.selectedContacts.size;

        if (selectedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (selectedCount === totalVisible) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    }

    async handleBulkDelete() {
        const count = this.selectedContacts.size;

        if (count === 0) {
            this.eventBus.emit('ui:showToast', { message: 'No contacts selected', type: 'warning' });
            return;
        }

        const deletableContacts = [];
        const sharedContacts = [];

        for (const contactId of this.selectedContacts) {
            const contact = this.contactManager.getContact(contactId);
            if (contact && contact.metadata.isOwned) {
                deletableContacts.push(contactId);
            } else if (contact && !contact.metadata.isOwned) {
                sharedContacts.push(contactId);
            }
        }

        if (deletableContacts.length === 0) {
            this.eventBus.emit('ui:showToast', {
                message: 'Cannot delete shared contacts. You can only delete contacts you own.',
                type: 'warning'
            });
            return;
        }

        let confirmMessage = `Are you sure you want to delete ${deletableContacts.length} contact${deletableContacts.length > 1 ? 's' : ''}?\n\nThis action cannot be undone.`;
        if (sharedContacts.length > 0) {
            confirmMessage += `\n\nNote: ${sharedContacts.length} shared contact${sharedContacts.length > 1 ? 's' : ''} will be skipped (cannot delete).`;
        }

        if (!confirm(confirmMessage)) return;

        let pauseResult;
        try {
            let successCount = 0;
            let errorCount = 0;
            const skippedCount = sharedContacts.length;

            console.log(`🗑️ Bulk delete: ${deletableContacts.length} contacts to delete (skipping ${skippedCount} shared)`);

            // Pause sync services during bulk delete
            console.log('⏸️ Pausing all sync services during bulk delete...');
            pauseResult = this.contactManager.pauseAllSync();
            if (pauseResult.success) {
                console.log('✅ Sync services paused:', pauseResult.pausedServices);
            }

            for (let i = 0; i < deletableContacts.length; i++) {
                const contactId = deletableContacts[i];
                try {
                    const contact = this.contactManager.getContact(contactId);
                    const contactName = contact ? (contact.cardName || contactId) : contactId;
                    console.log(`🗑️ Deleting ${i + 1}/${deletableContacts.length}: ${contactName}`);

                    const result = await this.contactManager.deleteContact(contactId);
                    if (result.success) {
                        successCount++;
                    } else {
                        errorCount++;
                        console.error(`❌ Failed to delete ${contactName}:`, result.error);
                    }

                    // Rate limiting: 600ms between deletions
                    if (i < deletableContacts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 600));
                    }
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error deleting contact ${contactId}:`, error);
                    if (i < deletableContacts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 600));
                    }
                }
            }

            // Resume sync services
            console.log('▶️ Resuming sync services after bulk delete...');
            await this.contactManager.resumeAllSync(pauseResult.pausedServices);

            this.exit();

            if (errorCount === 0 && skippedCount === 0) {
                this.eventBus.emit('ui:showToast', {
                    message: `Successfully deleted ${successCount} contact${successCount > 1 ? 's' : ''}`,
                    type: 'success'
                });
            } else if (errorCount === 0) {
                this.eventBus.emit('ui:showToast', {
                    message: `Deleted ${successCount} contact${successCount > 1 ? 's' : ''} (${skippedCount} shared skipped)`,
                    type: 'success'
                });
            } else {
                this.eventBus.emit('ui:showToast', {
                    message: `Deleted ${successCount}, ${errorCount} failed, ${skippedCount} skipped`,
                    type: 'warning'
                });
            }
        } catch (error) {
            console.error('❌ Bulk delete error:', error);
            if (pauseResult?.pausedServices) {
                await this.contactManager.resumeAllSync(pauseResult.pausedServices);
            }
            this.eventBus.emit('ui:showToast', {
                message: 'Failed to delete contacts. Please try again.',
                type: 'error'
            });
        }
    }
}
