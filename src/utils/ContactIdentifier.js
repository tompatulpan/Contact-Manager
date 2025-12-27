/**
 * ContactIdentifier - Utility for contact identification and UID operations
 * 
 * Pure utility functions for extracting and matching contact UIDs from vCard content.
 * Used by ContactManager, ICloudSyncService, and BaikalConnector for consistent
 * UID-based contact matching during sync operations.
 * 
 * @module ContactIdentifier
 */

export class ContactIdentifier {
    /**
     * Extract UID from vCard content
     * 
     * @param {string} vcard - vCard 3.0/4.0 content
     * @returns {string|null} - UID value or null if not found
     * 
     * @example
     * const vcard = "BEGIN:VCARD\nUID:contact-123\nFN:John Doe\nEND:VCARD";
     * const uid = ContactIdentifier.extractUIDFromVCard(vcard);
     * // Returns: "contact-123"
     */
    static extractUIDFromVCard(vcard) {
        if (!vcard) return null;
        
        // Use regex for single-pass extraction (faster than line iteration)
        const match = vcard.match(/^UID:(.+)$/m);
        return match ? match[1].trim() : null;
    }

    /**
     * Find contact by vCard UID in a collection
     * 
     * @param {Map|Array} contacts - Collection of contact objects (Map.values() or Array)
     * @param {string} uid - UID to search for
     * @returns {Object|null} - Contact object or null if not found
     * 
     * @example
     * const contact = ContactIdentifier.findContactByUID(contactsMap.values(), "contact-123");
     */
    static findContactByUID(contacts, uid) {
        if (!uid) return null;
        
        // Support both Map.values() iterator and Array
        const contactArray = Array.isArray(contacts) ? contacts : Array.from(contacts);
        
        for (const contact of contactArray) {
            if (!contact?.vcard) continue;
            
            const contactUID = this.extractUIDFromVCard(contact.vcard);
            if (contactUID === uid) {
                return contact;
            }
        }
        return null;
    }

    /**
     * Build Set of UIDs from contact collection
     * 
     * @param {Map|Array} contacts - Collection of contact objects
     * @returns {Set<string>} - Set of UIDs (empty Set if no valid UIDs)
     * 
     * @example
     * const uidSet = ContactIdentifier.buildUIDSet(contactsMap.values());
     * if (uidSet.has("contact-123")) { ... }
     */
    static buildUIDSet(contacts) {
        const uids = new Set();
        
        // Support both Map.values() iterator and Array
        const contactArray = Array.isArray(contacts) ? contacts : Array.from(contacts);
        
        for (const contact of contactArray) {
            if (!contact?.vcard) continue;
            
            const uid = this.extractUIDFromVCard(contact.vcard);
            if (uid) {
                uids.add(uid);
            }
        }
        
        return uids;
    }

    /**
     * Validate that a contact has a valid UID
     * 
     * @param {Object} contact - Contact object with vcard property
     * @returns {boolean} - true if contact has valid UID
     */
    static hasValidUID(contact) {
        if (!contact?.vcard) return false;
        const uid = this.extractUIDFromVCard(contact.vcard);
        return uid !== null && uid.length > 0;
    }

    /**
     * Extract UIDs from multiple contacts
     * 
     * @param {Map|Array} contacts - Collection of contact objects
     * @returns {Array<string>} - Array of UIDs (may contain nulls for invalid contacts)
     */
    static extractUIDs(contacts) {
        const contactArray = Array.isArray(contacts) ? contacts : Array.from(contacts);
        return contactArray.map(contact => this.extractUIDFromVCard(contact?.vcard));
    }
}
