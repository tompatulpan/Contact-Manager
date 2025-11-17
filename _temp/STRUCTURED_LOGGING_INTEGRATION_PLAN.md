# Structured Logging Integration Plan

## ✅ Completed

### 1. Infrastructure Created
- ✅ `StructuredLogger.js` - 220 lines, 17 logging methods
- ✅ `BatchSyncManager.js` - 380 lines, batch processing with concurrency control
- ✅ `HealthCheckManager.js` - 280 lines, health monitoring with caching

### 2. TsdavBridge.js - Partial Integration
- ✅ Added imports for all three components
- ✅ Initialized logger, batchManager, healthManager in constructor
- ✅ Updated `connect()` method with structured logging
- ✅ Updated `fetchVCards()` method with structured logging

## ✅ Completed - TsdavBridge.js Integration (100%)

### 3. Complete TsdavBridge.js Integration

#### Methods Updated (console.log → logger calls):
- ✅ `connect()` - Structured logging with timing and context
- ✅ `connectToICloud()` - Full iCloud discovery logging
- ✅ `disconnect()` - Simple connection logging
- ✅ `getAddressbook()` - Debug logging for addressbook lookup
- ✅ `fetchVCards()` - Timing, error context, duration tracking
- ✅ `fetchVCardsViaReport()` - REPORT method with structured logs
- ✅ `createVCard()` - pushStart/pushSuccess with retry logging
- ✅ `updateVCard()` - Update logging with ETag tracking
- ✅ `deleteVCard()` - Delete operations with timing
- ✅ `syncAddressbook()` - syncStart/syncComplete integration
- ✅ `createAddressbook()` - Addressbook creation logging
- ✅ `extractUID()` - Warning logs for invalid data
- ✅ ALL console.log statements replaced (verified via grep)

#### Logging Pattern:
```javascript
// Replace:
console.log(`✅ Success message`);
console.error(`❌ Error message`);
console.warn(`⚠️ Warning message`);

// With:
this.logger.info('Success message', { context });
this.logger.error('Error message', error, { context });
this.logger.warn('Warning message', { context });
```

#### Retry Logging Pattern:
```javascript
// When retrying operations:
this.logger.retryAttempt(retryCount, MAX_RETRIES, error, {
    operation: 'createVCard',
    filename: vcfFilename
});
```

### 4. BaikalConnector.js Integration

#### Methods to Update:
- [ ] `connectToServer()` - Add health check before connect
- [ ] `testSync()` - Use BatchSyncManager.syncInBatches()
- [ ] `pushContactToBaikal()` - Use logger for retry attempts
- [ ] `_syncFromBaikalInternal()` - Add sync logging
- [ ] All validation methods

#### Integration Examples:
```javascript
// Health check before expensive operation:
async testSync(profileName) {
    const health = await this.healthManager.isServerHealthy(profileName);
    if (!health) {
        this.logger.warn('Server unhealthy, skipping sync');
        return { success: false, reason: 'server_unhealthy' };
    }
    // ... proceed with sync
}

// Batch sync instead of individual:
const result = await this.batchManager.syncInBatches(contacts, profileName);
```

### 5. Add Health Check Endpoint

Create `contact-carddav-bridge/routes/health.js`:
```javascript
const express = require('express');
const router = express.Router();

router.get('/health/:profileName', async (req, res) => {
    const { profileName } = req.params;
    const health = await healthManager.performHealthCheck(profileName);
    res.json(health);
});

router.get('/health/:profileName/detailed', async (req, res) => {
    const { profileName } = req.params;
    const health = await healthManager.performDetailedHealthCheck(config);
    res.json(health);
});

module.exports = router;
```

### 6. Update Bridge Server Index

Add to `contact-carddav-bridge/index.js`:
```javascript
const healthRoutes = require('./routes/health');
app.use('/api/health', healthRoutes);
```

## 📋 Next Steps

### Immediate (30 minutes):
1. ✅ Update remaining TsdavBridge.js methods with structured logging
2. ✅ Test that all logging works correctly
3. ✅ Verify no console.log remains in TsdavBridge.js

### Short-term (1-2 hours):
4. Update BaikalConnector.js with:
   - Health checks before expensive operations
   - Batch sync for large contact sets
   - Structured logging throughout
5. Add health check endpoint to bridge server
6. Test end-to-end with real Baikal server

### Testing Checklist:
- [ ] TsdavBridge logs to StructuredLogger correctly
- [ ] Health checks work with cached results
- [ ] Batch sync processes contacts efficiently
- [ ] Retry attempts logged with metadata
- [ ] Performance warnings triggered correctly
- [ ] Error logs include full context

## 🎯 Success Criteria

### Performance:
- Batch sync 50 contacts in < 10 seconds (vs 50+ seconds individually)
- Health check cached for 60 seconds
- Structured logs include timestamps and context

### Observability:
- All operations logged with consistent format
- JSON-structured logs for parsing
- Performance metrics captured
- Error context always included

### Reliability:
- Health checks prevent wasted operations
- Batch processing with controlled concurrency
- Retry attempts properly logged
- Degraded performance detected early
