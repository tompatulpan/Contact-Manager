/**
 * UserbaseSDKWrapper - SDK-compliant wrapper layer for the Userbase SDK
 *
 * Wraps the item, sharing and permission SDK calls with:
 * - parameter validation before each SDK call
 * - SDK-specified error handling (surfaces events on the event bus)
 * - transient-error retries with exponential backoff
 *
 * Not every userbase.* call goes through this layer yet: session/auth calls
 * (init, signIn, signUp, signOut), openDatabase and getDatabases are still
 * called directly from ContactDatabase. ContactDatabase keeps thin
 * delegating methods for everything here so callers and tests keep their
 * existing API.
 */

export class UserbaseSDKWrapper {
    /**
     * @param {Object} eventBus - Event bus for SDK error events
     * @param {Function} [getCurrentUser] - Returns the current user (or null);
     *        used for the share/modify self-check
     */
    constructor(eventBus, getCurrentUser) {
        this.eventBus = eventBus;
        this.getCurrentUser = getCurrentUser || (() => null);
    }

    /**
     * Sleep utility for retry delays
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check whether an SDK error is transient (connection lost, service
     * briefly unavailable, rate limiting). Userbase throws these while it
     * is reconnecting; the call usually succeeds once the connection is
     * re-established.
     * @param {Error} error - The error object
     * @returns {boolean} True if the error is transient and retryable
     */
    isTransientError(error) {
        if (!error) {
            return false;
        }
        if (error.name === 'ServiceUnavailable' || error.name === 'TooManyRequests') {
            return true;
        }
        return /reconnect|service unavailable/i.test(error.message || '');
    }

    /**
     * Retry an SDK operation on retryable errors with exponential backoff.
     * @param {Function} operation - Async operation to attempt
     * @param {string} context - Context for error reporting
     * @param {Function} classifyRetry - Returns a retry kind string (e.g.
     *        'transient', 'conflict') for retryable errors, falsy otherwise
     * @param {number} maxRetries - Maximum retry attempts
     * @param {Function|number} baseDelayMs - Base delay (ms), or a function
     *        of the retry kind (different kinds can back off at different rates)
     * @returns {Promise<Object>} Operation result
     */
    async retryOn(operation, context, classifyRetry, maxRetries = 3, baseDelayMs = 1000) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const kind = classifyRetry(error);
                if (!kind || attempt >= maxRetries) {
                    throw error;
                }
                const base = typeof baseDelayMs === 'function' ? baseDelayMs(kind) : baseDelayMs;
                const delay = Math.pow(2, attempt) * base; // 1x, 2x, 4x
                console.warn(`🚫 ${error.name || 'retryable error'} (${kind}) in ${context}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await this.sleep(delay);
            }
        }
    }

    /**
     * Retry an SDK operation on transient errors (connection lost, service
     * briefly unavailable, rate limiting) with exponential backoff.
     * @param {Function} operation - Async operation to attempt
     * @param {string} context - Context for error reporting
     * @param {number} maxRetries - Maximum retry attempts (default: 3)
     * @param {number} baseDelayMs - Base delay for backoff (default: 1000ms)
     * @returns {Promise<Object>} Operation result
     */
    async retryTransientError(operation, context, maxRetries = 3, baseDelayMs = 1000) {
        return await this.retryOn(
            operation,
            context,
            (error) => this.isTransientError(error) ? 'transient' : false,
            maxRetries,
            () => baseDelayMs
        );
    }

    /**
     * ✅ SDK COMPLIANT: Validate insertItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateInsertItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: item
        if (params.item === undefined) {
            errors.push('ItemMissing: item parameter is required');
        } else {
            // Check item size (10KB limit)
            const itemSize = this.calculateItemSize(params.item);
            if (itemSize > 10240) { // 10KB in bytes
                errors.push(`ItemTooLarge: item size (${itemSize} bytes) exceeds 10KB limit`);
            }
            
            // Check item type validity
            if (!this.isValidItemType(params.item)) {
                errors.push('ItemInvalid: item must be object, string, number, boolean, or null');
            }
        }
        
        // Optional: itemId validation
        if (params.itemId !== undefined) {
            if (typeof params.itemId !== 'string') {
                errors.push('ItemIdMustBeString: itemId must be a string');
            } else if (params.itemId.trim() === '') {
                errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
            } else if (params.itemId.length > 100) {
                errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
            }
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate updateItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateUpdateItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: item
        if (params.item === undefined) {
            errors.push('ItemMissing: item parameter is required');
        } else {
            // Check item size (10KB limit)
            const itemSize = this.calculateItemSize(params.item);
            if (itemSize > 10240) { // 10KB in bytes
                errors.push(`ItemTooLarge: item size (${itemSize} bytes) exceeds 10KB limit`);
            }
            
            // Check item type validity
            if (!this.isValidItemType(params.item)) {
                errors.push('ItemInvalid: item must be object, string, number, boolean, or null');
            }
        }
        
        // Required: itemId (unlike insertItem, updateItem requires itemId)
        if (params.itemId === undefined || params.itemId === null) {
            errors.push('ItemIdMissing: itemId is required for updateItem');
        } else if (typeof params.itemId !== 'string') {
            errors.push('ItemIdMustBeString: itemId must be a string');
        } else if (params.itemId.trim() === '') {
            errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
        } else if (params.itemId.length > 100) {
            errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        // Optional: writeAccess validation
        if (params.writeAccess !== undefined) {
            if (params.writeAccess !== null && params.writeAccess !== false && typeof params.writeAccess !== 'object') {
                errors.push('WriteAccessInvalid: writeAccess must be object, null, undefined, or false');
            } else if (typeof params.writeAccess === 'object' && params.writeAccess !== null) {
                // Validate writeAccess object structure
                if (params.writeAccess.onlyCreator !== undefined && typeof params.writeAccess.onlyCreator !== 'boolean') {
                    errors.push('WriteAccessOnlyCreatorMustBeBoolean: writeAccess.onlyCreator must be boolean');
                }
                
                if (params.writeAccess.users !== undefined) {
                    if (!Array.isArray(params.writeAccess.users)) {
                        errors.push('WriteAccessUsersMustBeArray: writeAccess.users must be an array');
                    } else if (params.writeAccess.users.length > 10) {
                        errors.push('WriteAccessUsersTooMany: writeAccess.users cannot exceed 10 users');
                    } else {
                        // Validate each user object
                        params.writeAccess.users.forEach((user, index) => {
                            if (!user || typeof user !== 'object') {
                                errors.push(`WriteAccessUserInvalid: writeAccess.users[${index}] must be an object`);
                            } else if (!user.username || typeof user.username !== 'string') {
                                errors.push(`WriteAccessUsernameInvalid: writeAccess.users[${index}].username must be a string`);
                            }
                        });
                    }
                }
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate deleteItem parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateDeleteItemParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Required: databaseName
        if (params.databaseName === undefined || params.databaseName === null) {
            errors.push('DatabaseNameMissing: databaseName is required');
        } else if (typeof params.databaseName !== 'string') {
            errors.push('DatabaseNameMustBeString: databaseName must be a string');
        } else if (params.databaseName.trim() === '') {
            errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
        } else if (params.databaseName.length > 100) {
            errors.push('DatabaseNameTooLong: databaseName cannot exceed 100 characters');
        }
        
        // Required: itemId (deleteItem always requires itemId)
        if (params.itemId === undefined || params.itemId === null) {
            errors.push('ItemIdMissing: itemId is required for deleteItem');
        } else if (typeof params.itemId !== 'string') {
            errors.push('ItemIdMustBeString: itemId must be a string');
        } else if (params.itemId.trim() === '') {
            errors.push('ItemIdCannotBeBlank: itemId cannot be blank');
        } else if (params.itemId.length > 100) {
            errors.push('ItemIdTooLong: itemId cannot exceed 100 characters');
        }
        
        // Optional: databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            }
        }
        
        // Optional: shareToken validation
        if (params.shareToken !== undefined && typeof params.shareToken !== 'string') {
            errors.push('ShareTokenMustBeString: shareToken must be a string');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate shareDatabase parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateShareDatabaseParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Either databaseName or databaseId is required
        if (params.databaseName === undefined && params.databaseId === undefined) {
            errors.push('Either databaseName or databaseId is required');
        }
        
        // databaseName validation
        if (params.databaseName !== undefined) {
            if (typeof params.databaseName !== 'string') {
                errors.push('databaseName must be a string');
            } else if (params.databaseName.trim() === '') {
                errors.push('databaseName cannot be blank');
            } else if (params.databaseName.length > 100) {
                errors.push('databaseName too long (max 100 characters)');
            }
        }
        
        // databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('databaseId cannot be blank');
            } else if (params.databaseId.length !== 36) {
                errors.push('databaseId invalid length (must be 36 characters)');
            }
        }
        
        // username validation (optional)
        if (params.username !== undefined) {
            if (typeof params.username !== 'string') {
                errors.push('username must be a string');
            } else if (params.username.trim() === '') {
                errors.push('username cannot be blank');
            }
        }
        
        // readOnly validation (optional)
        if (params.readOnly !== undefined && typeof params.readOnly !== 'boolean') {
            errors.push('readOnly must be a boolean');
        }
        
        // requireVerified validation (optional)
        if (params.requireVerified !== undefined && typeof params.requireVerified !== 'boolean') {
            errors.push('requireVerified must be a boolean');
        }
        
        // resharingAllowed validation (optional)
        if (params.resharingAllowed !== undefined && typeof params.resharingAllowed !== 'boolean') {
            errors.push('resharingAllowed must be a boolean');
        }
        
        // Check for invalid combinations
        if (params.resharingAllowed === true && params.readOnly === false && params.username) {
            errors.push('resharingWithWriteAccessNotAllowed');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Validate modifyDatabasePermissions parameters before SDK call
     * @param {Object} params - Parameters to validate
     * @returns {Object} Validation result
     */
    validateModifyDatabasePermissionsParams(params) {
        const errors = [];
        
        // Check if params is object
        if (!params || typeof params !== 'object') {
            errors.push('ParamsMustBeObject: Parameters must be an object');
            return { isValid: false, errors };
        }
        
        // Either databaseName or databaseId is required
        if (params.databaseName === undefined && params.databaseId === undefined) {
            errors.push('DatabaseNameOrDatabaseIdMissing: Either databaseName or databaseId is required');
        }
        
        // databaseName validation
        if (params.databaseName !== undefined) {
            if (typeof params.databaseName !== 'string') {
                errors.push('DatabaseNameMustBeString: databaseName must be a string');
            } else if (params.databaseName.trim() === '') {
                errors.push('DatabaseNameCannotBeBlank: databaseName cannot be blank');
            } else if (params.databaseName.length > 100) {
                errors.push('DatabaseNameTooLong: databaseName too long (max 100 characters)');
            }
        }
        
        // databaseId validation
        if (params.databaseId !== undefined) {
            if (typeof params.databaseId !== 'string') {
                errors.push('DatabaseIdMustBeString: databaseId must be a string');
            } else if (params.databaseId.trim() === '') {
                errors.push('DatabaseIdCannotBeBlank: databaseId cannot be blank');
            } else if (params.databaseId.length !== 36) {
                errors.push('DatabaseIdInvalidLength: databaseId invalid length (must be 36 characters)');
            }
        }
        
        // username validation (required)
        if (params.username === undefined || params.username === null) {
            errors.push('UsernameMissing: username is required');
        } else if (typeof params.username !== 'string') {
            errors.push('UsernameMustBeString: username must be a string');
        } else if (params.username.trim() === '') {
            errors.push('UsernameCannotBeBlank: username cannot be blank');
        }
        
        // Userbase forbids readOnly when revoking access; otherwise it is required.
        if (params.revoke === true) {
            if (params.readOnly !== undefined) {
                errors.push('ReadOnlyParamNotAllowed: readOnly must be omitted when revoking access');
            }
        } else if (params.readOnly === undefined || params.readOnly === null) {
            errors.push('ReadOnlyMissing: readOnly is required');
        } else if (typeof params.readOnly !== 'boolean') {
            errors.push('ReadOnlyMustBeBoolean: readOnly must be a boolean');
        }
        
        // resharingAllowed validation (optional)
        if (params.resharingAllowed !== undefined && typeof params.resharingAllowed !== 'boolean') {
            errors.push('ResharingAllowedMustBeBoolean: resharingAllowed must be a boolean');
        }
        
        // revoke validation (optional)
        if (params.revoke !== undefined && typeof params.revoke !== 'boolean') {
            errors.push('RevokeMustBeBoolean: revoke must be a boolean');
        }
        
        // Check for invalid combinations per SDK spec
        if (params.resharingAllowed === true && params.readOnly === false) {
            errors.push('ResharingWithWriteAccessNotAllowed: resharingAllowed cannot be true when readOnly is false');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * ✅ SDK COMPLIANT: Calculate item size in bytes
     * @param {*} item - Item to calculate size for
     * @returns {number} Size in bytes
     */
    calculateItemSize(item) {
        try {
            return new Blob([JSON.stringify(item)]).size;
        } catch (error) {
            // Fallback calculation
            return JSON.stringify(item).length * 2; // Rough estimate (UTF-16)
        }
    }

    /**
     * ✅ SDK COMPLIANT: Check if item type is valid per SDK spec
     * @param {*} item - Item to validate
     * @returns {boolean} True if valid type
     */
    isValidItemType(item) {
        const type = typeof item;
        return type === 'object' || type === 'string' || type === 'number' || type === 'boolean' || item === null;
    }

    /**
     * ✅ SDK COMPLIANT: Handle insertItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleInsertItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot insert items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemMissing':
                console.error(`❌ Item missing in ${context}: item parameter is required`);
                break;
            case 'ItemInvalid':
                console.error(`❌ Invalid item in ${context}: item must be object, string, number, boolean, or null`);
                break;
            case 'ItemTooLarge':
                console.error(`❌ Item too large in ${context}: item exceeds 10KB limit`);
                break;
            case 'ItemAlreadyExists':
                console.warn(`⚠️ Item already exists in ${context}: Use updateItem instead`);
                this.eventBus.emit('database:itemExists', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check write permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle updateItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleUpdateItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot update items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMissing':
                console.error(`❌ Item ID missing in ${context}: itemId is required for updateItem`);
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemMissing':
                console.error(`❌ Item missing in ${context}: item parameter is required`);
                break;
            case 'ItemInvalid':
                console.error(`❌ Invalid item in ${context}: item must be object, string, number, boolean, or null`);
                break;
            case 'ItemTooLarge':
                console.error(`❌ Item too large in ${context}: item exceeds 10KB limit`);
                break;
            case 'ItemDoesNotExist':
                // Only log as error if NOT from a context that handles this
                // case deliberately: updateSharedContactMetadata auto-creates,
                // and updateContactAcrossSharedDatabases treats it as a skip
                // (e.g. the recipient copy was already removed by a revoke).
                if (!context.includes('updateSharedContactMetadata') &&
                    !context.includes('updateContactAcrossSharedDatabases')) {
                    console.error(`❌ Item does not exist in ${context}: Use insertItem to create new items`);
                }
                this.eventBus.emit('database:itemNotFound', { context });
                break;
            case 'ItemUpdateConflict':
                console.warn(`⚠️ Update conflict in ${context}: Item was modified by another operation`);
                this.eventBus.emit('database:updateConflict', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check write permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle deleteItem-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleDeleteItemError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error(`❌ Invalid parameters in ${context}: Must be an object`);
                break;
            case 'DatabaseNotOpen':
                console.error(`❌ Database not open in ${context}: Database must be opened first`);
                this.eventBus.emit('database:notOpen', { context });
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
            case 'DatabaseNameRestricted':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'DatabaseIdMustBeString':
            case 'DatabaseIdCannotBeBlank':
            case 'DatabaseIdInvalidLength':
            case 'DatabaseIdNotAllowed':
                console.error(`❌ Invalid database ID in ${context}:`, error.message);
                break;
            case 'DatabaseIsReadOnly':
                console.error(`❌ Database is read-only in ${context}: Cannot delete items`);
                this.eventBus.emit('database:readOnly', { context });
                break;
            case 'ItemIdMissing':
                console.error(`❌ Item ID missing in ${context}: itemId is required for deleteItem`);
                break;
            case 'ItemIdMustBeString':
            case 'ItemIdCannotBeBlank':
            case 'ItemIdTooLong':
                console.error(`❌ Invalid item ID in ${context}:`, error.message);
                break;
            case 'ItemDoesNotExist':
                console.error(`❌ Item does not exist in ${context}: Cannot delete non-existent item`);
                this.eventBus.emit('database:itemNotFound', { context });
                break;
            case 'ItemUpdateConflict':
                console.warn(`⚠️ Update conflict in ${context}: Item was modified by another operation during deletion`);
                this.eventBus.emit('database:updateConflict', { context });
                break;
            case 'TransactionUnauthorized':
                console.error(`❌ Unauthorized transaction in ${context}: Check delete permissions`);
                this.eventBus.emit('database:unauthorized', { context });
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotFound':
                console.error(`❌ User not found in ${context}`);
                this.eventBus.emit('auth:userNotFound', { context });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle shareDatabase-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleShareDatabaseError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                break;
            case 'DatabaseNameMissing':
                break;
            case 'DatabaseNameMustBeString':
                break;
            case 'DatabaseNameCannotBeBlank':
                break;
            case 'DatabaseNameTooLong':
                break;
            case 'DatabaseNameRestricted':
                break;
            case 'DatabaseIdMustBeString':
                break;
            case 'DatabaseIdCannotBeBlank':
                break;
            case 'DatabaseIdInvalidLength':
                break;
            case 'DatabaseIdNotAllowed':
                break;
            case 'ShareTokenNotAllowed':
                break;
            case 'DatabaseNotFound':
                break;
            case 'UsernameCannotBeBlank':
                break;
            case 'UsernameMustBeString':
                break;
            case 'ReadOnlyMustBeBoolean':
                break;
            case 'ResharingAllowedMustBeBoolean':
                break;
            case 'ResharingNotAllowed':
                break;
            case 'ResharingWithWriteAccessNotAllowed':
                break;
            case 'RequireVerifiedMustBeBoolean':
                break;
            case 'SharingWithSelfNotAllowed':
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'UserNotVerified':
                // requireVerified defaults to true — the recipient must have
                // verified their account before anything can be shared with
                // them. IndividualSharingStrategy rewrites the user-facing
                // message with the recipient's name before we get here.
                console.error(`❌ Recipient not verified (${context})`);
                break;
            case 'UserNotFound':
                break;
            case 'SubscriptionPlanNotSet':
                break;
            case 'SubscriptionNotFound':
                break;
            case 'SubscribedToIncorrectPlan':
                break;
            case 'SubscriptionInactive':
                break;
            case 'TrialExpired':
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle modifyDatabasePermissions-specific errors per SDK specification
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleModifyDatabasePermissionsError(error, context) {
        
        switch (error.name) {
            case 'ParamsMustBeObject':
                console.error('❌ Parameters must be provided as an object');
                break;
            case 'DatabaseNameOrDatabaseIdMissing':
                console.error('❌ Either databaseName or databaseId is required');
                break;
            case 'DatabaseNameMustBeString':
                console.error('❌ databaseName must be a string');
                break;
            case 'DatabaseNameCannotBeBlank':
                console.error('❌ databaseName cannot be empty');
                break;
            case 'DatabaseNameTooLong':
                console.error('❌ databaseName exceeds maximum length');
                break;
            case 'DatabaseNameRestricted':
                console.error('❌ databaseName uses restricted characters or words');
                break;
            case 'DatabaseIdMustBeString':
                console.error('❌ databaseId must be a string');
                break;
            case 'DatabaseIdCannotBeBlank':
                console.error('❌ databaseId cannot be empty');
                break;
            case 'DatabaseIdInvalidLength':
                console.error('❌ databaseId must be exactly 36 characters');
                break;
            case 'DatabaseIdNotAllowed':
                console.error('❌ databaseId format is not allowed');
                break;
            case 'DatabaseNotFound':
                console.error('❌ Database does not exist or user does not have access');
                break;
            case 'UsernameMissing':
                console.error('❌ username is required');
                break;
            case 'UsernameCannotBeBlank':
                console.error('❌ username cannot be empty');
                break;
            case 'UsernameMustBeString':
                console.error('❌ username must be a string');
                break;
            case 'ReadOnlyMissing':
                console.error('❌ readOnly parameter is required');
                break;
            case 'ReadOnlyMustBeBoolean':
                console.error('❌ readOnly must be a boolean value');
                break;
            case 'ResharingAllowedMustBeBoolean':
                console.error('❌ resharingAllowed must be a boolean value');
                break;
            case 'ResharingWithWriteAccessNotAllowed':
                console.error('❌ Cannot allow resharing when granting write access');
                break;
            case 'RevokeMustBeBoolean':
                console.error('❌ revoke must be a boolean value');
                break;
            case 'UserAlreadyExists':
                console.warn('⚠️ User already has access to this database');
                break;
            case 'UserNotFound':
                console.error('❌ Target user does not exist');
                break;
            case 'SharingWithSelfNotAllowed':
                console.error('❌ Cannot modify permissions for yourself');
                break;
            case 'UserNotSignedIn':
                console.error('❌ User must be signed in to modify database permissions');
                this.eventBus.emit('auth:required', { context });
                break;
            case 'SubscriptionPlanNotSet':
                console.error('❌ Subscription plan required for sharing');
                break;
            case 'SubscriptionNotFound':
                console.error('❌ Valid subscription required for sharing');
                break;
            case 'SubscribedToIncorrectPlan':
                console.error('❌ Current subscription plan does not support sharing');
                break;
            case 'SubscriptionInactive':
                console.error('❌ Subscription is not active');
                break;
            case 'TrialExpired':
                console.error('❌ Trial period has expired');
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                // Fall back to general SDK error handling
                this.handleSDKError(error, context);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe insertItem wrapper with full validation
     * @param {Object} params - insertItem parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Insert result
     */
    async safeInsertItem(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateInsertItemParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Call SDK insertItem
            return await userbase.insertItem(params);
            
        } catch (error) {
            this.handleInsertItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe updateItem wrapper with full validation
     * @param {Object} params - updateItem parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Update result
     */
    async safeUpdateItem(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateUpdateItemParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Call SDK updateItem
            return await userbase.updateItem(params);
            
        } catch (error) {
            this.handleUpdateItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe deleteItem wrapper with full validation and retry logic
     * @param {Object} params - deleteItem parameters
     * @param {string} context - Context for error reporting
     * @param {number} maxRetries - Maximum retry attempts for conflicts (default: 3)
     * @returns {Promise<Object>} Delete result
     */
    async safeDeleteItem(params, context, maxRetries = 3) {
        // Pre-validate parameters once — params do not change between attempts
        const validation = this.validateDeleteItemParams(params);
        if (!validation.isValid) {
            const error = new Error(validation.errors[0]);
            error.name = validation.errors[0].split(':')[0];
            this.handleDeleteItemError(error, context);
            throw error;
        }

        try {
            // Retry conflicts with a fast backoff (100ms base) and
            // connection-level transient errors with a slower one (1000ms
            // base, long enough to survive a reconnect)
            return await this.retryOn(
                () => userbase.deleteItem(params),
                context,
                (error) => {
                    if (this.isTransientError(error)) return 'transient';
                    if (error.name === 'ItemUpdateConflict') return 'conflict';
                    return false;
                },
                maxRetries,
                (kind) => kind === 'transient' ? 1000 : 100
            );
        } catch (error) {
            this.handleDeleteItemError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe shareDatabase wrapper with full validation
     * @param {Object} params - shareDatabase parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Share result
     */
    async safeShareDatabase(params, context) {
        try {
            // Validate parameters
            const validation = this.validateShareDatabaseParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Check if sharing with self
            if (params.username && this.getCurrentUser() && params.username === this.getCurrentUser().username) {
                const error = new Error('Cannot share database with yourself');
                error.name = 'SharingWithSelfNotAllowed';
                throw error;
            }
            
            // Call SDK shareDatabase
            return await userbase.shareDatabase(params);
            
        } catch (error) {
            this.handleShareDatabaseError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Safe modifyDatabasePermissions wrapper with full validation
     * @param {Object} params - modifyDatabasePermissions parameters
     * @param {string} context - Context for error reporting
     * @returns {Promise<Object>} Modify permissions result
     */
    async safeModifyDatabasePermissions(params, context) {
        try {
            // Pre-validate parameters
            const validation = this.validateModifyDatabasePermissionsParams(params);
            if (!validation.isValid) {
                const error = new Error(validation.errors[0]);
                error.name = validation.errors[0].split(':')[0];
                throw error;
            }
            
            // Check if modifying permissions for self
            if (params.username && this.getCurrentUser() && params.username === this.getCurrentUser().username) {
                const error = new Error('Cannot modify permissions for yourself');
                error.name = 'SharingWithSelfNotAllowed';
                throw error;
            }
            
            // Call SDK modifyDatabasePermissions (retries transient errors
            // so a revoke is not lost to a brief reconnect)
            return await this.retryTransientError(
                () => userbase.modifyDatabasePermissions(params),
                context
            );
            
        } catch (error) {
            this.handleModifyDatabasePermissionsError(error, context);
            throw error;
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle specific Userbase SDK error types
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleSDKError(error, context) {
        
        switch (error.name) {
            case 'DatabaseAlreadyOpening':
                break;
            case 'DatabaseNameMissing':
            case 'DatabaseNameMustBeString':
            case 'DatabaseNameCannotBeBlank':
            case 'DatabaseNameTooLong':
                console.error(`❌ Invalid database name in ${context}:`, error.message);
                break;
            case 'ChangeHandlerMissing':
            case 'ChangeHandlerMustBeFunction':
                console.error(`❌ Invalid change handler in ${context}:`, error.message);
                break;
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context });
                break;
            case 'DatabaseNotFound':
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in ${context}, backing off`);
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in ${context} (persistent after retries)`);
                this.eventBus.emit('database:serviceUnavailable', { context });
                break;
            default:
                console.error(`❌ Unknown SDK error in ${context}:`, error.name, error.message);
        }
    }

    /**
     * ✅ SDK COMPLIANT: Handle getDatabases() specific errors per specification
     * According to SDK docs, getDatabases() can throw: UserNotSignedIn, TooManyRequests, ServiceUnavailable
     * @param {Error} error - The error object
     * @param {string} context - Context where error occurred
     */
    handleGetDatabasesError(error, context) {
        
        switch (error.name) {
            case 'UserNotSignedIn':
                this.eventBus.emit('auth:required', { context, method: 'getDatabases' });
                break;
            case 'TooManyRequests':
                console.warn(`⚠️ Rate limited in getDatabases() ${context}, backing off`);
                this.eventBus.emit('database:rateLimited', { context, method: 'getDatabases' });
                break;
            case 'ServiceUnavailable':
                console.error(`🚫 Service unavailable in getDatabases() ${context}, retrying later`);
                this.eventBus.emit('database:serviceUnavailable', { context, method: 'getDatabases' });
                break;
            default:
                // For unexpected errors, fall back to general SDK error handling
                console.error(`❌ Unexpected getDatabases() error in ${context}:`, error.name, error.message);
                this.handleSDKError(error, context);
        }
    }
}

export default UserbaseSDKWrapper;
