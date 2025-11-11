/**
 * Authentication Performance Tracker
 * Tracks and categorizes authentication performance for optimization
 */

import { AUTH_CONFIG } from '../config/app.config.js';

export class AuthPerformanceTracker {
    constructor() {
        this.startTime = null;
        this.method = null;
        this.metrics = [];
    }

    /**
     * Start tracking authentication performance
     * @param {string} method - Authentication method being attempted
     */
    start(method = 'unknown') {
        this.startTime = performance.now();
        this.method = method;
    }

    /**
     * End tracking and log performance
     * @param {boolean} success - Whether authentication was successful
     * @param {Object} additional - Additional metadata
     * @returns {Object} Performance result
     */
    end(success = false, additional = {}) {
        if (!this.startTime) {
            console.warn('⚠️ AuthPerformanceTracker: end() called without start()');
            return null;
        }

        const duration = performance.now() - this.startTime;
        const category = this.categorizeSpeed(duration);
        
        const result = {
            method: this.method,
            duration: Math.round(duration * 100) / 100, // Round to 2 decimals
            category,
            success,
            timestamp: new Date().toISOString(),
            ...additional
        };

        this.logPerformance(result);
        this.metrics.push(result);
        
        // Reset for next measurement
        this.reset();
        
        return result;
    }

    /**
     * Reset tracker state
     */
    reset() {
        this.startTime = null;
        this.method = null;
    }

    /**
     * Categorize authentication speed based on duration
     * @param {number} duration - Duration in milliseconds
     * @returns {string} Speed category
     */
    categorizeSpeed(duration) {
        const thresholds = AUTH_CONFIG.PERFORMANCE_THRESHOLDS;
        
        if (duration <= thresholds.ULTRA_FAST) return 'ultra-fast';
        if (duration <= thresholds.FAST) return 'fast';
        if (duration <= thresholds.NORMAL) return 'normal';
        return 'slow';
    }

    /**
     * Get emoji for performance category
     * @param {string} category - Performance category
     * @returns {string} Emoji representation
     */
    getCategoryEmoji(category) {
        const emojis = {
            'ultra-fast': '🚀',
            'fast': '⚡',
            'normal': '🔄',
            'slow': '🐌'
        };
        return emojis[category] || '⏱️';
    }

    /**
     * Log performance with appropriate styling
     * @param {Object} result - Performance result object
     */
    logPerformance(result) {
        const emoji = this.getCategoryEmoji(result.category);
        const status = result.success ? '✅' : '❌';
        
        const message = `${emoji} ${status} Authentication ${result.method}: ${result.duration}ms (${result.category})`;
        
        // Use appropriate console method based on performance
        if (result.category === 'ultra-fast' || result.category === 'fast') {
        } else if (result.category === 'normal') {
            console.info(message);
        } else {
            console.warn(message);
        }

        // Log additional details if available
        if (Object.keys(result).length > 6) { // More than base properties
            const details = { ...result };
            delete details.method;
            delete details.duration;
            delete details.category;
            delete details.success;
            delete details.timestamp;
            
            if (Object.keys(details).length > 0) {
            }
        }
    }

    /**
     * Get performance statistics
     * @returns {Object} Performance statistics
     */
    getStats() {
        if (this.metrics.length === 0) {
            return { message: 'No performance data available' };
        }

        const successful = this.metrics.filter(m => m.success);
        const byMethod = this.groupBy(successful, 'method');
        const byCategory = this.groupBy(successful, 'category');

        return {
            totalAttempts: this.metrics.length,
            successfulAttempts: successful.length,
            successRate: (successful.length / this.metrics.length * 100).toFixed(1) + '%',
            averageDuration: (successful.reduce((sum, m) => sum + m.duration, 0) / successful.length).toFixed(1) + 'ms',
            byMethod: this.getMethodStats(byMethod),
            byCategory: this.getCategoryStats(byCategory),
            fastestAuth: this.getFastest(successful),
            slowestAuth: this.getSlowest(successful)
        };
    }

    /**
     * Group array by property
     * @param {Array} array - Array to group
     * @param {string} property - Property to group by
     * @returns {Object} Grouped object
     */
    groupBy(array, property) {
        return array.reduce((groups, item) => {
            const key = item[property];
            groups[key] = groups[key] || [];
            groups[key].push(item);
            return groups;
        }, {});
    }

    /**
     * Get statistics by method
     * @param {Object} byMethod - Grouped by method
     * @returns {Object} Method statistics
     */
    getMethodStats(byMethod) {
        const stats = {};
        for (const [method, attempts] of Object.entries(byMethod)) {
            stats[method] = {
                count: attempts.length,
                averageDuration: (attempts.reduce((sum, a) => sum + a.duration, 0) / attempts.length).toFixed(1) + 'ms',
                fastest: Math.min(...attempts.map(a => a.duration)).toFixed(1) + 'ms'
            };
        }
        return stats;
    }

    /**
     * Get statistics by category
     * @param {Object} byCategory - Grouped by category
     * @returns {Object} Category statistics
     */
    getCategoryStats(byCategory) {
        const stats = {};
        for (const [category, attempts] of Object.entries(byCategory)) {
            stats[category] = {
                count: attempts.length,
                percentage: ((attempts.length / this.metrics.filter(m => m.success).length) * 100).toFixed(1) + '%'
            };
        }
        return stats;
    }

    /**
     * Get fastest authentication
     * @param {Array} successful - Successful authentications
     * @returns {Object} Fastest authentication
     */
    getFastest(successful) {
        if (successful.length === 0) return null;
        return successful.reduce((fastest, current) => 
            current.duration < fastest.duration ? current : fastest
        );
    }

    /**
     * Get slowest authentication
     * @param {Array} successful - Successful authentications
     * @returns {Object} Slowest authentication
     */
    getSlowest(successful) {
        if (successful.length === 0) return null;
        return successful.reduce((slowest, current) => 
            current.duration > slowest.duration ? current : slowest
        );
    }

    /**
     * Clear all metrics
     */
    clearMetrics() {
        this.metrics = [];
    }
}

// Create a singleton instance for global use
export const authPerformanceTracker = new AuthPerformanceTracker();