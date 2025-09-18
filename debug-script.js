// Simple test script to run in browser console
console.log('=== Contact Management System Debug ===');

// Check if app is available
if (window.contactApp) {
    const app = window.contactApp;
    console.log('✅ App found:', app.getStatus());
    
    const contactManager = app.modules?.contactManager;
    if (contactManager) {
        console.log('✅ ContactManager found');
        console.log('Contacts in memory:', contactManager.contacts.size);
        console.log('Is loaded:', contactManager.isLoaded);
        
        // Test search
        const searchResults = contactManager.searchContacts('', {});
        console.log('Empty search results:', searchResults.length);
        
        if (searchResults.length > 0) {
            console.log('First contact:', searchResults[0]);
        }
    } else {
        console.log('❌ ContactManager not found');
    }
    
    const uiController = app.modules?.uiController;
    if (uiController) {
        console.log('✅ UIController found');
        console.log('Contact cards element:', uiController.elements.contactCards);
        console.log('Contact list element:', uiController.elements.contactList);
    } else {
        console.log('❌ UIController not found');
    }
} else {
    console.log('❌ App not found in window.contactApp');
}

console.log('=== End Debug ===');