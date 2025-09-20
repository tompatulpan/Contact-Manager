/**
 * Basic integration test for the contact management system
 * Tests core functionality without external dependencies
 */

import { EventBus } from '../src/utils/EventBus.js';
import { VCardStandard } from '../src/core/VCardStandard.js';
import { ContactValidator } from '../src/core/ContactValidator.js';
import { ContactManager } from '../src/core/ContactManager.js';
import { MockDatabase, generateMockContactData } from '../src/utils/TestHelpers.js';

/**
 * Test suite runner
 */
class TestRunner {
    constructor() {
        this.tests = [];
        this.results = {
            passed: 0,
            failed: 0,
            total: 0
        };
    }

    /**
     * Add a test
     */
    test(name, testFn) {
        this.tests.push({ name, testFn });
    }

    /**
     * Run all tests
     */
    async run() {
        console.log('🧪 Running Contact Management System Tests\n');
        
        for (const test of this.tests) {
            this.results.total++;
            
            try {
                await test.testFn();
                this.results.passed++;
                console.log(`✅ ${test.name}`);
            } catch (error) {
                this.results.failed++;
                console.error(`❌ ${test.name}: ${error.message}`);
            }
        }
        
        this.printResults();
    }

    /**
     * Print test results
     */
    printResults() {
        console.log('\n📊 Test Results:');
        console.log(`Total: ${this.results.total}`);
        console.log(`Passed: ${this.results.passed}`);
        console.log(`Failed: ${this.results.failed}`);
        
        if (this.results.failed === 0) {
            console.log('🎉 All tests passed!');
        } else {
            console.log('⚠️  Some tests failed');
        }
    }

    /**
     * Assertion helper
     */
    assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }

    /**
     * Equality assertion helper
     */
    assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(`${message}: expected ${expected}, got ${actual}`);
        }
    }
}

// Create test runner
const runner = new TestRunner();

// EventBus Tests
runner.test('EventBus should emit and receive events', () => {
    const eventBus = new EventBus();
    let received = false;
    
    eventBus.on('test', () => {
        received = true;
    });
    
    eventBus.emit('test');
    runner.assert(received, 'Event should be received');
});

runner.test('EventBus should handle multiple listeners', () => {
    const eventBus = new EventBus();
    let count = 0;
    
    eventBus.on('test', () => count++);
    eventBus.on('test', () => count++);
    
    eventBus.emit('test');
    runner.assertEqual(count, 2, 'Both listeners should be called');
});

// VCardStandard Tests
runner.test('VCardStandard should generate valid vCard', () => {
    const vCardStandard = new VCardStandard();
    const contactData = generateMockContactData();
    
    const vCard = vCardStandard.generateVCard(contactData);
    
    runner.assert(vCard.includes('BEGIN:VCARD'), 'vCard should start with BEGIN:VCARD');
    runner.assert(vCard.includes('VERSION:4.0'), 'vCard should have VERSION:4.0');
    runner.assert(vCard.includes(`FN:${contactData.fn}`), 'vCard should have full name');
    runner.assert(vCard.includes('END:VCARD'), 'vCard should end with END:VCARD');
});

runner.test('VCardStandard should parse vCard correctly', () => {
    const vCardStandard = new VCardStandard();
    const vCardString = `BEGIN:VCARD
VERSION:4.0
FN:John Doe
TEL;TYPE=work:+1-555-123-4567
EMAIL;TYPE=work:john@company.com
END:VCARD`;
    
    const parsed = vCardStandard.parseVCard(vCardString);
    
    runner.assertEqual(parsed.properties.get('FN'), 'John Doe', 'Full name should be parsed correctly');
    runner.assert(parsed.properties.has('TEL'), 'Phone should be parsed');
    runner.assert(parsed.properties.has('EMAIL'), 'Email should be parsed');
});

runner.test('VCardStandard should validate RFC 9553 compliance', () => {
    const vCardStandard = new VCardStandard();
    const validVCard = `BEGIN:VCARD
VERSION:4.0
FN:John Doe
END:VCARD`;
    
    const validation = vCardStandard.validateVCard(validVCard);
    runner.assert(validation.isValid, 'Valid vCard should pass validation');
    runner.assertEqual(validation.version, '4.0', 'Version should be 4.0');
});

runner.test('VCardStandard should detect invalid vCard', () => {
    const vCardStandard = new VCardStandard();
    const invalidVCard = `BEGIN:VCARD
VERSION:4.0
END:VCARD`; // Missing required FN property
    
    const validation = vCardStandard.validateVCard(invalidVCard);
    runner.assert(!validation.isValid, 'Invalid vCard should fail validation');
    runner.assert(validation.errors.length > 0, 'Should have validation errors');
});

// ContactValidator Tests
runner.test('ContactValidator should validate correct contact data', () => {
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const validData = generateMockContactData();
    
    const validation = validator.validateContactData(validData);
    runner.assert(validation.isValid, 'Valid contact data should pass validation');
});

runner.test('ContactValidator should reject invalid contact data', () => {
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const invalidData = {
        fn: '', // Empty required field
        cardName: 'Test',
        phones: [{ value: 'invalid-phone', type: 'work' }],
        emails: [{ value: 'invalid-email', type: 'work' }]
    };
    
    const validation = validator.validateContactData(invalidData);
    runner.assert(!validation.isValid, 'Invalid contact data should fail validation');
    runner.assert(validation.errors.length > 0, 'Should have validation errors');
});

runner.test('ContactValidator should validate phone numbers', () => {
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    
    runner.assert(validator.isValidPhone('+1-555-123-4567'), 'Valid phone should pass');
    runner.assert(validator.isValidPhone('555-123-4567'), 'Local phone should pass');
    runner.assert(!validator.isValidPhone('invalid'), 'Invalid phone should fail');
    runner.assert(!validator.isValidPhone('123'), 'Too short phone should fail');
});

runner.test('ContactValidator should validate email addresses', () => {
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    
    runner.assert(validator.isValidEmail('test@example.com'), 'Valid email should pass');
    runner.assert(!validator.isValidEmail('invalid-email'), 'Invalid email should fail');
    runner.assert(!validator.isValidEmail('test@'), 'Incomplete email should fail');
});

runner.test('ContactValidator should validate URLs', () => {
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    
    runner.assert(validator.isValidURL('https://example.com'), 'Valid HTTPS URL should pass');
    runner.assert(validator.isValidURL('http://example.com'), 'Valid HTTP URL should pass');
    runner.assert(!validator.isValidURL('invalid-url'), 'Invalid URL should fail');
    runner.assert(!validator.isValidURL('ftp://example.com'), 'FTP URL should fail');
});

// ContactManager Tests
runner.test('ContactManager should create contact successfully', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize database
    await database.initialize();
    await database.signIn('testuser', 'password');
    await contactManager.initialize();
    
    const contactData = generateMockContactData();
    const result = await contactManager.createContact(contactData);
    
    runner.assert(result.success, 'Contact creation should succeed');
    runner.assert(result.contact, 'Should return contact object');
    runner.assert(result.contact.vcard, 'Contact should have vCard');
});

runner.test('ContactManager should handle validation errors', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize database
    await database.initialize();
    await database.signIn('testuser', 'password');
    
    const invalidData = {
        fn: '', // Invalid: empty required field
        cardName: 'Test'
    };
    
    const result = await contactManager.createContact(invalidData);
    
    runner.assert(!result.success, 'Contact creation should fail');
    runner.assert(result.validationErrors, 'Should return validation errors');
});

runner.test('ContactManager should search contacts', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize and create test contacts
    await database.initialize();
    await database.signIn('testuser', 'password');
    await contactManager.initialize();
    
    const contactData1 = generateMockContactData({ fn: 'John Doe', cardName: 'John' });
    const contactData2 = generateMockContactData({ fn: 'Jane Smith', cardName: 'Jane' });
    
    await contactManager.createContact(contactData1);
    await contactManager.createContact(contactData2);
    
    // Small delay to ensure async events are processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Search for John
    const results = contactManager.searchContacts('John');
    
    runner.assert(results.length === 1, 'Should find one contact');
    runner.assert(results[0].cardName === 'John', 'Should find the correct contact');
});

runner.test('ContactManager should update contact', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize and create test contact
    await database.initialize();
    await database.signIn('testuser', 'password');
    await contactManager.initialize();
    
    const originalData = generateMockContactData({ fn: 'John Doe' });
    const createResult = await contactManager.createContact(originalData);
    
    runner.assert(createResult.success, 'Contact creation should succeed');
    
    // Small delay to ensure contact is in cache
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Update the contact
    const updatedData = generateMockContactData({ fn: 'John Smith' });
    const updateResult = await contactManager.updateContact(createResult.contactId, updatedData);
    
    runner.assert(updateResult.success, 'Contact update should succeed');
    
    // Small delay to ensure update is processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify the update
    const contact = contactManager.getContact(createResult.contactId);
    const displayData = vCardStandard.extractDisplayData(contact);
    runner.assertEqual(displayData.fullName, 'John Smith', 'Contact should be updated');
});

runner.test('ContactManager should get contact statistics', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize
    await database.initialize();
    await database.signIn('testuser', 'password');
    await contactManager.initialize();
    
    // Create multiple contacts
    for (let i = 0; i < 3; i++) {
        const contactData = generateMockContactData({ fn: `Contact ${i + 1}` });
        await contactManager.createContact(contactData);
    }
    
    // Small delay to ensure all contacts are in cache
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const stats = contactManager.getContactStatistics();
    
    runner.assertEqual(stats.total, 3, 'Should have 3 total contacts');
    runner.assertEqual(stats.active, 3, 'Should have 3 active contacts');
    runner.assertEqual(stats.archived, 0, 'Should have 0 archived contacts');
});

// Database Mock Tests
runner.test('MockDatabase should handle basic operations', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    
    await database.initialize();
    runner.assert(database.isInitialized, 'Database should be initialized');
    
    const signUpResult = await database.signUp('testuser', 'password');
    runner.assert(signUpResult.success, 'Sign up should succeed');
    runner.assert(database.currentUser.username === 'testuser', 'User should be set');
    
    const contact = { contactId: 'test', cardName: 'Test Contact' };
    const saveResult = await database.saveContact(contact);
    runner.assert(saveResult.success, 'Save should succeed');
    
    const contacts = database.getContacts();
    runner.assert(contacts.length === 1, 'Should have one contact');
});

runner.test('MockDatabase should handle failure modes', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    
    await database.initialize();
    
    // Enable failure mode
    database.setFailureMode(true, 'Test failure');
    
    const signUpResult = await database.signUp('testuser', 'password');
    runner.assert(!signUpResult.success, 'Sign up should fail');
    runner.assertEqual(signUpResult.error, 'Test failure', 'Should return test error');
});

// Integration Tests
runner.test('Complete workflow: create, search, update, delete', async () => {
    const eventBus = new EventBus();
    const database = new MockDatabase(eventBus);
    const vCardStandard = new VCardStandard();
    const validator = new ContactValidator(vCardStandard);
    const contactManager = new ContactManager(eventBus, database, vCardStandard, validator);
    
    // Initialize system
    await database.initialize();
    await database.signIn('testuser', 'password');
    await contactManager.initialize();
    
    // Create contact
    const contactData = generateMockContactData({ fn: 'Integration Test' });
    const createResult = await contactManager.createContact(contactData);
    runner.assert(createResult.success, 'Create should succeed');
    
    const contactId = createResult.contactId;
    
    // Small delay to ensure contact is in cache
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Search for contact
    const searchResults = contactManager.searchContacts('Integration');
    runner.assert(searchResults.length === 1, 'Should find created contact');
    
    // Update contact
    const updatedData = generateMockContactData({ fn: 'Updated Integration Test' });
    const updateResult = await contactManager.updateContact(contactId, updatedData);
    runner.assert(updateResult.success, 'Update should succeed');
    
    // Small delay to ensure update is processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify update
    const updatedContact = contactManager.getContact(contactId);
    const displayData = vCardStandard.extractDisplayData(updatedContact);
    runner.assert(displayData.fullName.includes('Updated'), 'Should be updated');
    
    // Archive contact
    const archiveResult = await contactManager.archiveContact(contactId);
    runner.assert(archiveResult.success, 'Archive should succeed');
    
    // Delete contact
    const deleteResult = await contactManager.deleteContact(contactId);
    runner.assert(deleteResult.success, 'Delete should succeed');
    
    // Verify deletion (should be marked as deleted)
    const deletedContact = contactManager.getContact(contactId);
    runner.assert(deletedContact.metadata.isDeleted, 'Should be marked as deleted');
});

// Export validation test
runner.test('Export/Import vCard round-trip', async () => {
    const vCardStandard = new VCardStandard();
    
    // Create original contact data
    const originalData = generateMockContactData();
    
    // Generate vCard
    const vCardString = vCardStandard.generateVCard(originalData);
    
    // Import vCard
    const importedContact = vCardStandard.importFromVCard(vCardString, 'Imported Contact');
    
    // Extract display data
    const displayData = vCardStandard.extractDisplayData(importedContact);
    
    // Verify data integrity
    runner.assertEqual(displayData.fullName, originalData.fn, 'Full name should match');
    runner.assertEqual(displayData.organization, originalData.organization, 'Organization should match');
    runner.assert(displayData.phones.length > 0, 'Should have phone numbers');
    runner.assert(displayData.emails.length > 0, 'Should have email addresses');
});

// Run the tests
runner.run().then(() => {
    console.log('\n🎯 Test execution completed');
}).catch(error => {
    console.error('Test execution failed:', error);
});