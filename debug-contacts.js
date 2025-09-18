// Debug contact data - run this in browser console
console.log('=== Contact Debug Information ===');

if (window.contactApp && window.contactApp.modules) {
    const contactManager = window.contactApp.modules.contactManager;
    
    if (contactManager && contactManager.contacts) {
        console.log('Total contacts in memory:', contactManager.contacts.size);
        
        // Log all contacts with their metadata
        const allContacts = Array.from(contactManager.contacts.values());
        allContacts.forEach((contact, index) => {
            console.log(`Contact ${index + 1}:`, {
                contactId: contact.contactId,
                cardName: contact.cardName,
                isDeleted: contact.metadata?.isDeleted,
                isArchived: contact.metadata?.isArchived,
                createdAt: contact.metadata?.createdAt,
                lastUpdated: contact.metadata?.lastUpdated
            });
        });
        
        // Test search with empty query
        const searchResults = contactManager.searchContacts('', {
            includeArchived: false,
            includeDeleted: false
        });
        
        console.log('Search results (empty query):', searchResults.length);
        searchResults.forEach((contact, index) => {
            console.log(`Result ${index + 1}:`, contact.cardName);
        });
        
        // Test search including archived and deleted
        const allResults = contactManager.searchContacts('', {
            includeArchived: true,
            includeDeleted: true
        });
        
        console.log('Search results (include all):', allResults.length);
        
    } else {
        console.log('ContactManager not found or contacts not loaded');
    }
} else {
    console.log('Contact app not found in window.contactApp');
}

console.log('=== End Debug ===');