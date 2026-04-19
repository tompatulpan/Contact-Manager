/**
 * MultiFieldManager - Handles dynamic multi-value form fields
 * (phone, email, URL, address, notes)
 * Extracted from ContactUIController for modularity.
 */
export class MultiFieldManager {
    setupListeners() {
        const addPhoneBtn = document.getElementById('add-phone-btn');
        const addEmailBtn = document.getElementById('add-email-btn');
        const addUrlBtn = document.getElementById('add-url-btn');
        const addAddressBtn = document.getElementById('add-address-btn');
        const addNoteBtn = document.getElementById('add-note-btn');

        if (addPhoneBtn) addPhoneBtn.addEventListener('click', () => this.addField('phone'));
        if (addEmailBtn) addEmailBtn.addEventListener('click', () => this.addField('email'));
        if (addUrlBtn) addUrlBtn.addEventListener('click', () => this.addField('url'));
        if (addAddressBtn) addAddressBtn.addEventListener('click', () => this.addField('address'));
        if (addNoteBtn) addNoteBtn.addEventListener('click', () => this.addField('note'));

        this.setupFieldEvents('phone');
        this.setupFieldEvents('email');
        this.setupFieldEvents('url');
        this.setupFieldEvents('address');
        this.setupFieldEvents('note');
    }

    addField(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        const newItem = this.createFieldItem(fieldType);
        container.appendChild(newItem);
        this.setupFieldEvents(fieldType);

        let newInput;
        if (fieldType === 'address') {
            newInput = newItem.querySelector('input[name="addressStreet[]"]');
        } else if (fieldType === 'note') {
            newInput = newItem.querySelector(`textarea[name="${fieldType}[]"]`);
        } else {
            newInput = newItem.querySelector(`input[name="${fieldType}[]"]`);
        }
        if (newInput) newInput.focus();
    }

    createFieldItem(fieldType) {
        const item = document.createElement('div');
        item.className = 'multi-field-item';

        if (fieldType === 'address') item.classList.add('address-field');
        else if (fieldType === 'note') item.classList.add('note-field');

        const typeOptions = this.getTypeOptions(fieldType);
        const fieldId = Date.now() + Math.random();

        if (fieldType === 'address') {
            item.innerHTML = `
                <select class="field-type-select" name="${fieldType}Type[]">
                    ${typeOptions}
                </select>
                <div class="address-inputs">
                    <input type="text" name="addressStreet[]" placeholder="Street address">
                    <div class="address-row">
                        <input type="text" name="addressCity[]" placeholder="City">
                        <input type="text" name="addressState[]" placeholder="State/Province">
                        <input type="text" name="addressPostalCode[]" placeholder="Postal code">
                    </div>
                    <input type="text" name="addressCountry[]" placeholder="Country">
                </div>
                <label class="primary-checkbox">
                    <input type="checkbox" name="${fieldType}Primary[]" value="${fieldId}">
                    <span class="checkmark"></span>
                    Primary
                </label>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        } else if (fieldType === 'note') {
            item.innerHTML = `
                <textarea name="${fieldType}[]" placeholder="Add a note..." rows="3"></textarea>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        } else {
            const inputType = this.getInputType(fieldType);
            const placeholder = this.getPlaceholder(fieldType);
            item.innerHTML = `
                <select class="field-type-select" name="${fieldType}Type[]">
                    ${typeOptions}
                </select>
                <input type="${inputType}" name="${fieldType}[]" placeholder="${placeholder}">
                <label class="primary-checkbox">
                    <input type="checkbox" name="${fieldType}Primary[]" value="${fieldId}">
                    <span class="checkmark"></span>
                    Primary
                </label>
                <button type="button" class="remove-field-btn" title="Remove ${fieldType}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }

        item.dataset.fieldId = fieldId;
        return item;
    }

    getTypeOptions(fieldType) {
        const options = {
            phone: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'cell', label: 'Mobile' },
                { value: 'fax', label: 'Fax' }
            ],
            email: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'internet', label: 'Internet' },
                { value: 'other', label: 'Other' }
            ],
            url: [
                { value: 'work', label: 'Work' },
                { value: 'home', label: 'Home' },
                { value: 'other', label: 'Other' }
            ],
            address: [
                { value: 'home', label: 'Home' },
                { value: 'work', label: 'Work' },
                { value: 'other', label: 'Other' }
            ],
            note: []
        };
        return options[fieldType]?.map(o => `<option value="${o.value}">${o.label}</option>`).join('') || '';
    }

    getInputType(fieldType) {
        return { phone: 'tel', email: 'email', url: 'url' }[fieldType] || 'text';
    }

    getPlaceholder(fieldType) {
        return { phone: 'Phone number', email: 'Email address', url: 'Website URL' }[fieldType] || '';
    }

    setupFieldEvents(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;

        const removeButtons = container.querySelectorAll('.remove-field-btn');
        removeButtons.forEach(button => { button.replaceWith(button.cloneNode(true)); });

        const newRemoveButtons = container.querySelectorAll('.remove-field-btn');
        newRemoveButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.removeField(e.target.closest('.multi-field-item'), fieldType);
            });
        });

        const primaryCheckboxes = container.querySelectorAll(`input[name="${fieldType}Primary[]"]`);
        primaryCheckboxes.forEach(cb => { cb.replaceWith(cb.cloneNode(true)); });

        const newPrimaryCheckboxes = container.querySelectorAll(`input[name="${fieldType}Primary[]"]`);
        newPrimaryCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    newPrimaryCheckboxes.forEach(cb => {
                        if (cb !== e.target) cb.checked = false;
                    });
                }
            });
        });

        this.updateRemoveButtonStates(fieldType);
    }

    removeField(item, fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;
        item.remove();
        this.updateRemoveButtonStates(fieldType);
    }

    updateRemoveButtonStates(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;
        const removeButtons = container.querySelectorAll('.remove-field-btn');
        removeButtons.forEach(button => { button.disabled = false; });
    }

    extractData(formData, fieldType) {
        if (fieldType === 'address') return this.extractAddressData(formData);

        const values = formData.getAll(`${fieldType}[]`);
        const types = formData.getAll(`${fieldType}Type[]`);
        const checkedPrimaries = formData.getAll(`${fieldType}Primary[]`);

        const container = document.getElementById(`${fieldType}-fields`);
        const fieldItems = container ? Array.from(container.querySelectorAll('.multi-field-item')) : [];

        const fieldData = [];
        values.forEach((value, index) => {
            if (value.trim()) {
                const fieldItem = fieldItems[index];
                const fieldId = fieldItem ? fieldItem.dataset.fieldId : null;
                const isPrimary = fieldId && checkedPrimaries.includes(fieldId);
                fieldData.push({
                    value: value.trim(),
                    type: types[index] || 'other',
                    primary: isPrimary
                });
            }
        });
        return fieldData;
    }

    extractAddressData(formData) {
        const streets = formData.getAll('addressStreet[]');
        const cities = formData.getAll('addressCity[]');
        const states = formData.getAll('addressState[]');
        const postalCodes = formData.getAll('addressPostalCode[]');
        const countries = formData.getAll('addressCountry[]');
        const types = formData.getAll('addressType[]');
        const checkedPrimaries = formData.getAll('addressPrimary[]');

        const container = document.getElementById('address-fields');
        const fieldItems = container ? Array.from(container.querySelectorAll('.multi-field-item')) : [];

        const addressData = [];
        streets.forEach((street, index) => {
            if (street.trim() || cities[index]?.trim()) {
                const fieldItem = fieldItems[index];
                const fieldId = fieldItem ? fieldItem.dataset.fieldId : null;
                const isPrimary = fieldId && checkedPrimaries.includes(fieldId);
                addressData.push({
                    street: street.trim(),
                    city: (cities[index] || '').trim(),
                    state: (states[index] || '').trim(),
                    postalCode: (postalCodes[index] || '').trim(),
                    country: (countries[index] || '').trim(),
                    type: types[index] || 'home',
                    primary: isPrimary
                });
            }
        });
        return addressData;
    }

    extractNotesData(formData) {
        const notes = formData.getAll('note[]');
        return notes.filter(note => note.trim()).map(note => note.trim());
    }

    populateData(fieldType, data) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container || !data || data.length === 0) return;

        container.innerHTML = '';

        if (fieldType === 'address') { this.populateAddressData(data); return; }

        data.forEach((item) => {
            const fieldItem = this.createFieldItem(fieldType);
            const typeSelect = fieldItem.querySelector(`select[name="${fieldType}Type[]"]`);
            const valueInput = fieldItem.querySelector(`input[name="${fieldType}[]"]`);
            const primaryCheckbox = fieldItem.querySelector(`input[name="${fieldType}Primary[]"]`);

            if (typeSelect) {
                const normalizedType = this.normalizeFieldType(fieldType, item.type);
                typeSelect.value = normalizedType;
            }
            if (valueInput) valueInput.value = item.value || '';
            if (primaryCheckbox) primaryCheckbox.checked = item.primary || false;
            container.appendChild(fieldItem);
        });

        if (data.length === 0) {
            container.appendChild(this.createFieldItem(fieldType));
        }
        this.setupFieldEvents(fieldType);
    }

    populateAddressData(data) {
        const container = document.getElementById('address-fields');
        if (!container) return;
        container.innerHTML = '';

        if (!data || !Array.isArray(data) || data.length === 0) {
            container.appendChild(this.createFieldItem('address'));
            this.setupFieldEvents('address');
            return;
        }

        data.forEach((address) => {
            const fieldItem = this.createFieldItem('address');
            const typeSelect = fieldItem.querySelector('select[name="addressType[]"]');
            const streetInput = fieldItem.querySelector('input[name="addressStreet[]"]');
            const cityInput = fieldItem.querySelector('input[name="addressCity[]"]');
            const stateInput = fieldItem.querySelector('input[name="addressState[]"]');
            const postalCodeInput = fieldItem.querySelector('input[name="addressPostalCode[]"]');
            const countryInput = fieldItem.querySelector('input[name="addressCountry[]"]');
            const primaryCheckbox = fieldItem.querySelector('input[name="addressPrimary[]"]');

            if (typeSelect) typeSelect.value = address.type || 'home';
            if (streetInput) streetInput.value = address.street || '';
            if (cityInput) cityInput.value = address.city || '';
            if (stateInput) stateInput.value = address.state || '';
            if (postalCodeInput) postalCodeInput.value = address.postalCode || '';
            if (countryInput) countryInput.value = address.country || '';
            if (primaryCheckbox) primaryCheckbox.checked = address.primary || false;
            container.appendChild(fieldItem);
        });
        this.setupFieldEvents('address');
    }

    populateNotesData(data) {
        const container = document.getElementById('note-fields');
        if (!container) return;
        container.innerHTML = '';

        if (!data || !Array.isArray(data) || data.length === 0) {
            container.appendChild(this.createFieldItem('note'));
            this.setupFieldEvents('note');
            return;
        }

        data.forEach((note) => {
            const fieldItem = this.createFieldItem('note');
            const textarea = fieldItem.querySelector('textarea[name="note[]"]');
            if (textarea) textarea.value = note || '';
            container.appendChild(fieldItem);
        });
        this.setupFieldEvents('note');
    }

    normalizeFieldType(fieldType, type) {
        if (!type) return 'other';
        const normalizedType = type.toLowerCase();
        const typeMappings = {
            phone: { 'work': 'work', 'home': 'home', 'mobile': 'cell', 'cell': 'cell', 'fax': 'fax', 'voice': 'other', 'text': 'other', 'pager': 'other' },
            email: { 'work': 'work', 'home': 'home', 'personal': 'personal', 'other': 'other', 'internet': 'other' },
            url: { 'work': 'work', 'home': 'home', 'personal': 'personal', 'blog': 'blog' }
        };
        const mapping = typeMappings[fieldType];
        if (mapping && mapping[normalizedType]) return mapping[normalizedType];
        return 'other';
    }

    resetComponent(fieldType) {
        const container = document.getElementById(`${fieldType}-fields`);
        if (!container) return;
        container.innerHTML = '';
        container.appendChild(this.createFieldItem(fieldType));
        this.setupFieldEvents(fieldType);
    }
}
