/**
 * EventBus - Simple event system for loose coupling between components
 * Enables components to communicate without direct references
 */
export class EventBus {
    constructor() {
        this.events = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} context - Context to bind the callback to
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback, context = null) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }

        const listener = {
            callback,
            context,
            id: this.generateListenerId()
        };

        this.events.get(eventName).push(listener);

        // Return unsubscribe function
        return () => this.off(eventName, listener.id);
    }

    /**
     * Subscribe to an event only once
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Function to call when event is emitted
     * @param {Object} context - Context to bind the callback to
     * @returns {Function} Unsubscribe function
     */
    once(eventName, callback, context = null) {
        const unsubscribe = this.on(eventName, (...args) => {
            unsubscribe();
            callback.apply(context, args);
        }, context);

        return unsubscribe;
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Name of the event
     * @param {string|Function} callbackOrId - Callback function or listener ID
     */
    off(eventName, callbackOrId) {
        if (!this.events.has(eventName)) {
            return;
        }

        const listeners = this.events.get(eventName);
        
        if (typeof callbackOrId === 'string') {
            // Remove by listener ID
            const index = listeners.findIndex(listener => listener.id === callbackOrId);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        } else {
            // Remove by callback function
            const index = listeners.findIndex(listener => listener.callback === callbackOrId);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }

        // Clean up empty event arrays
        if (listeners.length === 0) {
            this.events.delete(eventName);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} eventName - Name of the event
     * @param {*} data - Data to pass to event handlers
     */
    emit(eventName, data = null) {
        if (!this.events.has(eventName)) {
            return;
        }

        const listeners = [...this.events.get(eventName)]; // Copy to prevent modification during iteration

        listeners.forEach(listener => {
            try {
                if (listener.context) {
                    listener.callback.call(listener.context, data);
                } else {
                    listener.callback(data);
                }
            } catch (error) {
                console.error(`Error in event handler for "${eventName}":`, error);
            }
        });
    }

    /**
     * Remove all listeners for an event, or all events if no event name provided
     * @param {string} eventName - Optional event name to clear
     */
    clear(eventName = null) {
        if (eventName) {
            this.events.delete(eventName);
        } else {
            this.events.clear();
        }
    }

    /**
     * Get the number of listeners for an event
     * @param {string} eventName - Name of the event
     * @returns {number} Number of listeners
     */
    listenerCount(eventName) {
        return this.events.has(eventName) ? this.events.get(eventName).length : 0;
    }

    /**
     * Get all event names that have listeners
     * @returns {Array<string>} Array of event names
     */
    eventNames() {
        return Array.from(this.events.keys());
    }

    /**
     * Generate a unique listener ID
     * @returns {string} Unique ID
     */
    generateListenerId() {
        return `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Debug method to log current event subscriptions
     */
    debug() {
        for (const [eventName, listeners] of this.events.entries()) {
        }
    }
}

// Create a default global event bus instance
export const eventBus = new EventBus();