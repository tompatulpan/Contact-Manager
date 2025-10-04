/**
 * HybridSharingManager - Hybrid sharing strategy management
 * Manages both group and individual sharing strategies with intelligent selection
 * Provides backward compatibility and performance optimization
 */
export class HybridSharingManager {
    constructor(database) {
        this.database = database;
        this.strategy = 'auto'; // 'auto', 'group', 'individual'
        this.autoThreshold = 5; // Use individual for <= 5 users, group for > 5 users
        this.performanceMetrics = {
            operations: new Map(),
            totalOperations: 0,
            averageResponseTime: 0
        };
    }

    /**
     * 🎯 SMART: Intelligently choose sharing strategy based on context
     * @param {Object} contact - Contact to share
     * @param {Array|string} users - Single user or array of users
     * @param {Object} options - Sharing options
     * @returns {Promise<Object>} Share result with strategy used
     */
    async smartShare(contact, users, options = {}) {
        const startTime = Date.now();
        
        try {
            const userList = Array.isArray(users) ? users : [users];
            const strategy = this.chooseStrategy(userList.length, options);
            
            console.log(`🎯 Using ${strategy} strategy for sharing with ${userList.length} users`);
            
            let result;
            
            switch (strategy) {
                case 'individual':
                    if (userList.length === 1) {
                        result = await this.database.shareContactIndividually(contact, userList[0], options.readOnly, options.resharingAllowed);
                    } else {
                        result = await this.database.shareContactWithMultipleUsers(contact, userList);
                    }
                    break;
                    
                case 'group':
                    // Use traditional group sharing for large lists
                    result = await this.shareWithGroupStrategy(contact, userList, options);
                    break;
                    
                default:
                    throw new Error(`Unknown sharing strategy: ${strategy}`);
            }
            
            // Record performance metrics
            const duration = Date.now() - startTime;
            this.recordPerformanceMetric('smartShare', duration, userList.length, strategy);
            
            return {
                ...result,
                strategyUsed: strategy,
                userCount: userList.length,
                duration
            };
            
        } catch (error) {
            console.error('❌ Smart share failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 🎯 STRATEGY: Choose optimal sharing strategy
     * @param {number} userCount - Number of users to share with
     * @param {Object} options - Options that might influence strategy choice
     * @returns {string} Strategy to use ('individual' or 'group')
     */
    chooseStrategy(userCount, options = {}) {
        if (this.strategy !== 'auto') {
            return this.strategy;
        }
        
        // Factors that influence strategy choice
        const factors = {
            userCount,
            requiresGranularRevocation: options.requiresGranularRevocation || false,
            performancePriority: options.performancePriority || 'balanced', // 'speed', 'memory', 'balanced'
            expectedUpdateFrequency: options.expectedUpdateFrequency || 'medium' // 'low', 'medium', 'high'
        };
        
        // Decision logic
        if (factors.requiresGranularRevocation) {
            console.log('🎯 Choosing individual strategy: granular revocation required');
            return 'individual';
        }
        
        if (userCount <= this.autoThreshold) {
            console.log(`🎯 Choosing individual strategy: user count (${userCount}) <= threshold (${this.autoThreshold})`);
            return 'individual';
        }
        
        if (factors.expectedUpdateFrequency === 'high' && userCount > 10) {
            console.log('🎯 Choosing group strategy: high update frequency with many users');
            return 'group';
        }
        
        if (factors.performancePriority === 'memory' && userCount > 3) {
            console.log('🎯 Choosing group strategy: memory optimization priority');
            return 'group';
        }
        
        console.log(`🎯 Choosing individual strategy: default for ${userCount} users`);
        return 'individual';
    }

    /**
     * 🔄 GROUP: Share using traditional group strategy
     * @param {Object} contact - Contact to share
     * @param {Array} userList - List of users
     * @param {Object} options - Sharing options
     * @returns {Promise<Object>} Share result
     */
    async shareWithGroupStrategy(contact, userList, options) {
        const results = [];
        
        // Share with first user to create the database
        const firstResult = await this.database.shareContact(contact, userList[0], options.readOnly, options.resharingAllowed);
        results.push({ username: userList[0], ...firstResult });
        
        if (!firstResult.success) {
            return {
                success: false,
                error: `Failed to create group share with first user: ${firstResult.error}`,
                results
            };
        }
        
        // Add remaining users using modifyDatabasePermissions
        for (let i = 1; i < userList.length; i++) {
            const username = userList[i];
            try {
                const result = await this.database.modifyContactPermissions(
                    contact.contactId, 
                    username, 
                    options.readOnly || true, 
                    options.resharingAllowed || false
                );
                results.push({ username, ...result });
            } catch (error) {
                results.push({ username, success: false, error: error.message });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        
        return {
            success: successCount > 0,
            results,
            successCount,
            errorCount: results.length - successCount,
            strategyUsed: 'group'
        };
    }

    /**
     * 🗑️ SMART: Intelligently revoke access based on sharing strategy used
     * @param {string} contactId - Contact ID
     * @param {string} username - Username to revoke access from
     * @returns {Promise<Object>} Revoke result
     */
    async smartRevoke(contactId, username) {
        const startTime = Date.now();
        
        try {
            // Check what type of sharing exists for this contact
            const sharingInfo = await this.getContactSharingInfo(contactId);
            
            if (sharingInfo.hasIndividualShares) {
                console.log('🗑️ Using individual revocation strategy');
                const result = await this.database.revokeIndividualContactAccess(contactId, username);
                
                const duration = Date.now() - startTime;
                this.recordPerformanceMetric('smartRevoke', duration, 1, 'individual');
                
                return { ...result, strategyUsed: 'individual', duration };
            }
            
            if (sharingInfo.hasGroupShare) {
                console.log('🗑️ Using group revocation strategy');
                const result = await this.database.modifyContactPermissions(contactId, username, true, false, true);
                
                const duration = Date.now() - startTime;
                this.recordPerformanceMetric('smartRevoke', duration, 1, 'group');
                
                return { ...result, strategyUsed: 'group', duration };
            }
            
            return {
                success: true,
                message: 'No sharing found for this contact',
                strategyUsed: 'none',
                duration: Date.now() - startTime
            };
            
        } catch (error) {
            console.error('❌ Smart revoke failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 📋 INFO: Get comprehensive sharing information for a contact
     * @param {string} contactId - Contact ID
     * @returns {Promise<Object>} Sharing information
     */
    async getContactSharingInfo(contactId) {
        try {
            const [individualShares, allDatabases] = await Promise.all([
                this.database.getIndividualContactShares(contactId),
                this.database.getAllSharedContactDatabases()
            ]);
            
            const groupDbName = `shared-contact-${contactId}`;
            const groupShare = allDatabases.ownedSharedDatabases.find(db => 
                db.databaseName === groupDbName
            );
            
            return {
                contactId,
                hasIndividualShares: individualShares.length > 0,
                hasGroupShare: !!groupShare,
                individualShares,
                groupShare,
                totalSharedWith: individualShares.length + (groupShare ? (groupShare.users?.length || 0) : 0),
                strategies: {
                    individual: individualShares.length,
                    group: groupShare ? 1 : 0
                }
            };
            
        } catch (error) {
            console.error('❌ Failed to get contact sharing info:', error);
            return {
                contactId,
                hasIndividualShares: false,
                hasGroupShare: false,
                individualShares: [],
                groupShare: null,
                totalSharedWith: 0,
                error: error.message
            };
        }
    }

    /**
     * 📊 METRICS: Record performance metric for optimization
     * @param {string} operation - Operation type
     * @param {number} duration - Duration in milliseconds
     * @param {number} userCount - Number of users involved
     * @param {string} strategy - Strategy used
     */
    recordPerformanceMetric(operation, duration, userCount, strategy) {
        const metric = {
            operation,
            duration,
            userCount,
            strategy,
            timestamp: new Date().toISOString(),
            efficiency: userCount > 0 ? duration / userCount : duration
        };
        
        if (!this.performanceMetrics.operations.has(operation)) {
            this.performanceMetrics.operations.set(operation, []);
        }
        
        const operationMetrics = this.performanceMetrics.operations.get(operation);
        operationMetrics.push(metric);
        
        // Keep only last 100 metrics per operation
        if (operationMetrics.length > 100) {
            operationMetrics.shift();
        }
        
        this.performanceMetrics.totalOperations++;
        
        // Update running average
        const allDurations = Array.from(this.performanceMetrics.operations.values())
            .flat()
            .map(m => m.duration);
        
        this.performanceMetrics.averageResponseTime = 
            allDurations.reduce((sum, d) => sum + d, 0) / allDurations.length;
        
        console.log(`📊 Recorded metric: ${operation} took ${duration}ms for ${userCount} users using ${strategy} strategy`);
    }

    /**
     * 📈 ANALYTICS: Get performance analytics
     * @returns {Object} Performance analytics
     */
    getPerformanceAnalytics() {
        const analytics = {
            totalOperations: this.performanceMetrics.totalOperations,
            averageResponseTime: this.performanceMetrics.averageResponseTime,
            operationBreakdown: {},
            strategyEfficiency: {},
            recommendations: []
        };
        
        // Analyze each operation type
        for (const [operation, metrics] of this.performanceMetrics.operations.entries()) {
            if (metrics.length === 0) continue;
            
            const durations = metrics.map(m => m.duration);
            const strategies = metrics.map(m => m.strategy);
            
            analytics.operationBreakdown[operation] = {
                count: metrics.length,
                averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
                minDuration: Math.min(...durations),
                maxDuration: Math.max(...durations),
                strategiesUsed: [...new Set(strategies)]
            };
            
            // Strategy efficiency analysis
            const strategyGroups = {};
            metrics.forEach(metric => {
                if (!strategyGroups[metric.strategy]) {
                    strategyGroups[metric.strategy] = [];
                }
                strategyGroups[metric.strategy].push(metric.efficiency);
            });
            
            for (const [strategy, efficiencies] of Object.entries(strategyGroups)) {
                const avgEfficiency = efficiencies.reduce((sum, e) => sum + e, 0) / efficiencies.length;
                analytics.strategyEfficiency[`${operation}_${strategy}`] = avgEfficiency;
            }
        }
        
        // Generate recommendations
        this.generatePerformanceRecommendations(analytics);
        
        return analytics;
    }

    /**
     * 💡 RECOMMENDATIONS: Generate performance recommendations
     * @param {Object} analytics - Performance analytics
     */
    generatePerformanceRecommendations(analytics) {
        const recommendations = [];
        
        // Check if individual strategy is consistently faster
        const shareIndividualEff = analytics.strategyEfficiency['smartShare_individual'];
        const shareGroupEff = analytics.strategyEfficiency['smartShare_group'];
        
        if (shareIndividualEff && shareGroupEff && shareIndividualEff < shareGroupEff * 0.8) {
            recommendations.push({
                type: 'strategy_preference',
                message: 'Individual sharing strategy shows 20%+ better efficiency',
                suggestion: 'Consider lowering autoThreshold or setting strategy to "individual"'
            });
        }
        
        // Check for high average response times
        if (analytics.averageResponseTime > 500) {
            recommendations.push({
                type: 'performance_warning',
                message: `High average response time: ${analytics.averageResponseTime.toFixed(0)}ms`,
                suggestion: 'Consider reducing batch sizes or optimizing network conditions'
            });
        }
        
        // Check operation distribution
        const shareOps = analytics.operationBreakdown['smartShare']?.count || 0;
        const revokeOps = analytics.operationBreakdown['smartRevoke']?.count || 0;
        
        if (revokeOps > shareOps * 0.3) {
            recommendations.push({
                type: 'usage_pattern',
                message: 'High revocation rate detected',
                suggestion: 'Individual sharing strategy may be more suitable for your use case'
            });
        }
        
        analytics.recommendations = recommendations;
    }

    /**
     * ⚙️ CONFIG: Configure hybrid manager settings
     * @param {Object} config - Configuration options
     */
    configure(config = {}) {
        if (config.strategy && ['auto', 'group', 'individual'].includes(config.strategy)) {
            this.strategy = config.strategy;
            console.log(`⚙️ Strategy set to: ${this.strategy}`);
        }
        
        if (config.autoThreshold && config.autoThreshold > 0) {
            this.autoThreshold = config.autoThreshold;
            console.log(`⚙️ Auto threshold set to: ${this.autoThreshold} users`);
        }
        
        if (config.clearMetrics) {
            this.performanceMetrics.operations.clear();
            this.performanceMetrics.totalOperations = 0;
            this.performanceMetrics.averageResponseTime = 0;
            console.log('⚙️ Performance metrics cleared');
        }
    }

    /**
     * 🧹 CLEANUP: Clear performance metrics and reset state
     */
    reset() {
        this.performanceMetrics.operations.clear();
        this.performanceMetrics.totalOperations = 0;
        this.performanceMetrics.averageResponseTime = 0;
        console.log('🧹 Hybrid sharing manager reset');
    }
}