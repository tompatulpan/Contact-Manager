# Address and Notes Support Implementation

## Overview
This document describes the implementation of postal address and notes support in the Contact Management System, following RFC 9553 (vCard 4.0) standards.

## Features Added

### 1. Postal Address Support
- **Multiple addresses per contact** (work, home, etc.)
- **Complete address structure**: Street, City, State/Province, Postal Code, Country
- **Type classification**: work, home, other
- **Primary address designation**
- **RFC 9553 ADR format compliance**

### 2. Notes Support
- **Multiple notes per contact**
- **Free-form text content**
- **RFC 9553 NOTE property compliance**

## Implementation Details

### Database Schema Changes

#### Contact Data Structure
```javascript
const contactData = {
    fn: 'John Doe',
    // ... existing fields
    addresses: [
        {
            street: '123 Main Street',
            city: 'San Francisco',
            state: 'CA',
            postalCode: '94102',
            country: 'USA',
            type: 'work',
            primary: true
        }
    ],
    notes: [
        'Important client contact',
        'Prefers email communication'
    ]
};
```

#### vCard 4.0 Format
```
BEGIN:VCARD
VERSION:4.0
FN:John Doe
ADR;TYPE=work;PREF=1:;;123 Main Street;San Francisco;CA;94102;USA
ADR;TYPE=home:;;456 Oak Avenue;Berkeley;CA;94704;USA
NOTE:Important client contact
NOTE:Prefers email communication
END:VCARD
```

### Code Changes

#### 1. VCardStandard.js Enhancements

**Address Handling Methods:**
```javascript
// Format address object to RFC 9553 ADR format
formatAddressValue(address) {
    // Format: PO Box;Extended Address;Street;City;State;Postal Code;Country
    return `;;${address.street || ''};${address.city || ''};${address.state || ''};${address.postalCode || ''};${address.country || ''}`;
}

// Parse RFC 9553 ADR format to address object
parseAddressValue(addressString) {
    const parts = addressString.split(';');
    return {
        street: parts[2] || '',
        city: parts[3] || '',
        state: parts[4] || '',
        postalCode: parts[5] || '',
        country: parts[6] || ''
    };
}
```

**Notes Handling:**
```javascript
// Notes are handled as simple NOTE properties
// Multiple notes create multiple NOTE entries in vCard
```

#### 2. HTML Form Updates (index.html)

**Address Fields:**
```html
<div class="form-group">
    <label for="address-fields">Addresses</label>
    <div id="address-fields" class="multi-field-container">
        <!-- Dynamic address fields -->
    </div>
    <button type="button" class="add-field-btn" data-field="address">
        <i class="fas fa-plus"></i> Add Address
    </button>
</div>
```

**Notes Fields:**
```html
<div class="form-group">
    <label for="note-fields">Notes</label>
    <div id="note-fields" class="multi-field-container">
        <!-- Dynamic note fields -->
    </div>
    <button type="button" class="add-field-btn" data-field="note">
        <i class="fas fa-plus"></i> Add Note
    </button>
</div>
```

#### 3. ContactUIController.js Updates

**Multi-field Creation for Addresses:**
```javascript
createAddressField() {
    return `
        <div class="multi-field-item" data-field-id="${fieldId}">
            <div class="field-row">
                <select name="addressType[]" class="field-type">
                    <option value="home">Home</option>
                    <option value="work">Work</option>
                    <option value="other">Other</option>
                </select>
                <label class="primary-checkbox">
                    <input type="checkbox" name="addressPrimary[]" value="${fieldId}">
                    Primary
                </label>
            </div>
            <div class="address-inputs">
                <input type="text" name="addressStreet[]" placeholder="Street Address" class="address-field">
                <div class="address-row">
                    <input type="text" name="addressCity[]" placeholder="City" class="address-field">
                    <input type="text" name="addressState[]" placeholder="State/Province" class="address-field">
                    <input type="text" name="addressPostalCode[]" placeholder="Postal Code" class="address-field">
                    <input type="text" name="addressCountry[]" placeholder="Country" class="address-field">
                </div>
            </div>
            <button type="button" class="remove-field-btn">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
}
```

**Form Data Extraction:**
```javascript
// Extract address data with compound structure
extractAddressData(formData) {
    const streets = formData.getAll('addressStreet[]');
    const cities = formData.getAll('addressCity[]');
    // ... collect all address components
    
    return streets.map((street, index) => ({
        street: street.trim(),
        city: (cities[index] || '').trim(),
        state: (states[index] || '').trim(),
        postalCode: (postalCodes[index] || '').trim(),
        country: (countries[index] || '').trim(),
        type: types[index] || 'home',
        primary: isPrimary
    }));
}
```

#### 4. CSS Styling Enhancements

**Address Field Styling:**
```css
.address-inputs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
}

.address-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 8px;
}

.address-field {
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
}
```

**Notes Field Styling:**
```css
.note-field {
    width: 100%;
    min-height: 80px;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-family: inherit;
    resize: vertical;
}
```

## RFC 9553 Compliance

### Address Format (ADR Property)
- **Format**: `ADR;TYPE=work;PREF=1:PO Box;Extended;Street;City;State;Postal;Country`
- **Components**: 7 semicolon-separated parts
- **Implementation**: Uses empty values for unused components (PO Box, Extended Address)

### Notes Format (NOTE Property)
- **Format**: `NOTE:Note content here`
- **Multiple Notes**: Multiple NOTE properties for multiple notes
- **Content**: Free-form text, properly escaped

## Apple vCard Compatibility

### Address Conversion
```javascript
convertStandardToApple(vCard) {
    // Convert RFC 9553 ADR to Apple format
    return vCard.replace(/ADR;TYPE=([^;]+);PREF=1:/g, 'item1.ADR;TYPE=$1:')
               .replace(/ADR;TYPE=([^;]+):/g, 'item2.ADR;TYPE=$1:');
}
```

### Notes Compatibility
- Apple vCard 3.0 supports NOTE properties
- No special conversion needed for notes

## Testing

### Test Cases Covered
1. **Address Creation**: Multiple addresses with different types
2. **Address Parsing**: RFC 9553 ADR format parsing
3. **Notes Creation**: Multiple notes per contact
4. **Form Integration**: Address and notes in contact form
5. **vCard Export**: Proper RFC 9553 formatting
6. **Apple Compatibility**: Address format conversion

### Test File
- `test-address-notes.html`: Comprehensive testing interface
- Tests vCard generation, parsing, and formatting
- Validates RFC 9553 compliance

## Usage Examples

### Creating Contact with Address
```javascript
const contactData = {
    fn: 'John Smith',
    addresses: [{
        street: '123 Business St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
        type: 'work',
        primary: true
    }],
    notes: ['VIP Client', 'Technical decision maker']
};

const vCard = vCardStandard.generateVCard(contactData);
```

### Parsing vCard with Addresses
```javascript
const parsed = vCardStandard.parseVCard(vCardString);
console.log('Addresses:', parsed.addresses);
console.log('Notes:', parsed.notes);
```

## Benefits

1. **Standards Compliance**: Full RFC 9553 support
2. **User Friendly**: Intuitive address form layout
3. **Flexible**: Multiple addresses and notes per contact
4. **Portable**: Standard vCard export/import
5. **Apple Compatible**: Works with iCloud contacts

## Future Enhancements

1. **Address Validation**: Postal code format validation
2. **Geocoding**: Address to coordinates conversion
3. **Map Integration**: Display addresses on maps
4. **Rich Notes**: Markdown or HTML formatted notes
5. **Address Types**: Custom address type definitions