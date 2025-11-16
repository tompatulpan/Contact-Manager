/**
 * HistoryManager - Centralized history management utilities
 * Provides memory-efficient history tracking with configurable limits
 * 
 * Purpose: Prevent 10KB Userbase item limit issues while maintaining useful history
 * 
 * @module HistoryManager
 */

/**
 * History configuration constants
 */
export const HISTORY_LIMITS = {
    // Interaction history (per-contact usage tracking)
    INTERACTION_HISTORY_LIMIT: 5,      // Down from 50 - saves ~2KB per contact
    INTERACTION_HISTORY_SAFE: 3,       // Safe limit when optimizing
    
    // Share history (audit trail)
    SHARE_HISTORY_LIMIT: 5,            // Audit trail entries
    SHARE_HISTORY_SAFE: 3,             // Safe limit when optimizing
    
    // CardDAV push history (sync tracking)
    PUSH_HISTORY_LIMIT: 10,            // ETag tracking needs more entries
    PUSH_HISTORY_SAFE: 5,              // Safe limit when optimizing
    
    // Activity log (system-wide)
    ACTIVITY_LOG_ENABLED: true,        // Can be disabled for performance
    ACTIVITY_LOG_MAX_BATCH: 100        // Max activities per query
};

/**
 * Create a minimal interaction history entry
 * @param {string} action - Action type (viewed, edited, etc.)
 * @param {Object} options - Optional fields (userId, duration, etc.)
 * @returns {Object} Minimal interaction entry
 */
export function createInteractionEntry(action, options = {}) {
    // Validate action
    if (!action || typeof action !== 'string') {
        throw new Error('Action is required and must be a string');
    }

    const entry = {
        action,
        timestamp: new Date().toISOString()
    };

    // Add optional fields only if meaningful (memory optimization)
    if (options.userId) {
        entry.userId = options.userId;
    }
    
    if (options.duration !== null && options.duration !== undefined && options.duration > 0) {
        entry.duration = options.duration;
    }
    
    if (options.fieldsChanged && Array.isArray(options.fieldsChanged) && options.fieldsChanged.length > 0) {
        entry.fieldsChanged = options.fieldsChanged;
    }

    return entry;
}

/**
 * Create a minimal share history entry
 * @param {string} action - Share action (shared, revoked, etc.)
 * @param {string} targetUser - Username being shared with/revoked from
 * @param {Object} options - Optional fields (sharedBy, permission, etc.)
 * @returns {Object} Minimal share entry
 */
export function createShareEntry(action, targetUser, options = {}) {
    // Validate required fields
    if (!action || typeof action !== 'string') {
        throw new Error('Action is required and must be a string');
    }
    if (!targetUser || typeof targetUser !== 'string') {
        throw new Error('Target user is required and must be a string');
    }

    const entry = {
        action,
        targetUser,
        timestamp: new Date().toISOString()
    };

    // Add optional fields only if present
    if (options.sharedBy) {
        entry.sharedBy = options.sharedBy;
    }
    
    if (options.permission) {
        entry.permission = options.permission;
    }

    return entry;
}

/**
 * Create a minimal push history entry (CardDAV sync)
 * @param {string} etag - Server ETag
 * @param {Object} options - Optional fields (href, serverUID, etc.)
 * @returns {Object} Minimal push entry
 */
export function createPushEntry(etag, options = {}) {
    // Validate ETag
    if (!etag || typeof etag !== 'string') {
        throw new Error('ETag is required and must be a string');
    }

    const entry = {
        etag,
        timestamp: new Date().toISOString()
    };

    // Add optional fields
    if (options.href) {
        entry.href = options.href;
    }
    
    if (options.serverUID) {
        entry.serverUID = options.serverUID;
    }

    return entry;
}

/**
 * Trim history array to specified limit (FIFO - oldest entries removed first)
 * @param {Array} history - History array to trim
 * @param {number} limit - Maximum number of entries to keep
 * @returns {Array} Trimmed history array
 */
export function trimHistory(history, limit) {
    // Input validation
    if (!Array.isArray(history)) {
        console.warn('⚠️ Invalid history array for trimming');
        return [];
    }
    
    if (typeof limit !== 'number' || limit < 0) {
        console.warn('⚠️ Invalid limit for history trimming');
        return history;
    }

    // Return trimmed array (keep last N entries)
    if (history.length <= limit) {
        return history;
    }
    
    return history.slice(-limit);
}

/**
 * Clean interaction history entry (remove non-essential fields)
 * @param {Object} entry - Interaction history entry
 * @returns {Object} Cleaned entry with only essential fields
 */
export function cleanInteractionEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }

    const cleaned = {
        action: entry.action,
        timestamp: entry.timestamp
    };

    // Include duration only if meaningful
    if (entry.duration && entry.duration > 0) {
        cleaned.duration = entry.duration;
    }

    return cleaned;
}

/**
 * Clean share history entry (remove non-essential fields)
 * @param {Object} entry - Share history entry
 * @returns {Object} Cleaned entry with only essential fields
 */
export function cleanShareEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }

    return {
        action: entry.action,
        targetUser: entry.targetUser,
        timestamp: entry.timestamp
        // Remove sharedBy, permission (recoverable from other metadata)
    };
}

/**
 * Optimize complete contact history metadata
 * Applies all history optimizations in one pass
 * @param {Object} metadata - Contact metadata object
 * @returns {Object} Optimized metadata
 */
export function optimizeContactHistory(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return metadata;
    }

    const optimized = { ...metadata };

    // Optimize interaction history
    if (optimized.usage?.interactionHistory) {
        optimized.usage.interactionHistory = trimHistory(
            optimized.usage.interactionHistory.map(cleanInteractionEntry),
            HISTORY_LIMITS.INTERACTION_HISTORY_SAFE
        );
    }

    // Optimize share history
    if (optimized.sharing?.shareHistory) {
        optimized.sharing.shareHistory = trimHistory(
            optimized.sharing.shareHistory.map(cleanShareEntry),
            HISTORY_LIMITS.SHARE_HISTORY_SAFE
        );
    }

    // Optimize push history
    if (optimized.carddav?.pushHistory) {
        optimized.carddav.pushHistory = trimHistory(
            optimized.carddav.pushHistory,
            HISTORY_LIMITS.PUSH_HISTORY_SAFE
        );
    }

    return optimized;
}

/**
 * Calculate approximate memory size of history data
 * @param {Object} metadata - Contact metadata
 * @returns {number} Approximate size in bytes
 */
export function calculateHistorySize(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return 0;
    }

    let size = 0;

    // Interaction history
    if (metadata.usage?.interactionHistory) {
        size += JSON.stringify(metadata.usage.interactionHistory).length * 2; // UTF-16
    }

    // Share history
    if (metadata.sharing?.shareHistory) {
        size += JSON.stringify(metadata.sharing.shareHistory).length * 2;
    }

    // Push history
    if (metadata.carddav?.pushHistory) {
        size += JSON.stringify(metadata.carddav.pushHistory).length * 2;
    }

    return size;
}

/**
 * Validate history entry structure
 * @param {Object} entry - History entry to validate
 * @param {string} type - Entry type ('interaction', 'share', 'push')
 * @returns {boolean} True if valid
 */
export function validateHistoryEntry(entry, type) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    // All entries must have timestamp
    if (!entry.timestamp || typeof entry.timestamp !== 'string') {
        return false;
    }

    // Type-specific validation
    switch (type) {
        case 'interaction':
            return typeof entry.action === 'string';
        
        case 'share':
            return typeof entry.action === 'string' && 
                   typeof entry.targetUser === 'string';
        
        case 'push':
            return typeof entry.etag === 'string';
        
        default:
            return false;
    }
}

/**
 * Get history statistics
 * @param {Object} metadata - Contact metadata
 * @returns {Object} History statistics
 */
export function getHistoryStats(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return {
            interactionCount: 0,
            shareCount: 0,
            pushCount: 0,
            totalSize: 0
        };
    }

    return {
        interactionCount: metadata.usage?.interactionHistory?.length || 0,
        shareCount: metadata.sharing?.shareHistory?.length || 0,
        pushCount: metadata.carddav?.pushHistory?.length || 0,
        totalSize: calculateHistorySize(metadata)
    };
}

/**
 * Export for testing
 */
export default {
    HISTORY_LIMITS,
    createInteractionEntry,
    createShareEntry,
    createPushEntry,
    trimHistory,
    cleanInteractionEntry,
    cleanShareEntry,
    optimizeContactHistory,
    calculateHistorySize,
    validateHistoryEntry,
    getHistoryStats
};
