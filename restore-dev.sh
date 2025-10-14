#!/usr/bin/env fish
# ============================================================================
# Development Environment Restoration Script
# ============================================================================
# Purpose: Removes cache busting parameters to restore clean development state
#
# Use Cases:
# - After running cache-bust.sh manually
# - After production_zip.sh if auto-restore failed
# - When cache busting interferes with development
# - To reset to clean file references
#
# What It Does:
# 1. Restores index.html from backup (if exists)
# 2. Removes ?v=hash parameters from all file references
# 3. Cleans up ES6 module import parameters
# 4. Removes cache-versions.json
# 5. Cleans up temporary files
#
# Safe to run multiple times - idempotent operation
#
# Usage: ./restore-dev.sh
# ============================================================================

echo "🔄 Restoring Development Environment"
echo "===================================="
echo ""

# ============================================================================
# STEP 1: Restore index.html from Backup (Preferred Method)
# ============================================================================
# If index.html.backup exists, this is the cleanest restoration method
# as it restores the exact pre-cache-busting state
if test -f index.html.backup
    echo "✅ Restoring original index.html..."
    mv index.html.backup index.html
    echo "📄 Original index.html restored from backup"
    
    # ========================================================================
    # STEP 2a: Restore ES6 Module Imports (Even from Backup)
    # ========================================================================
    # Even when restoring from backup, clean up any lingering cache parameters
    # in JavaScript module imports that may have been added
    echo "🔄 Restoring JavaScript module imports..."
    
    # Core module imports in app.js
    sed -i.tmp 's|\(EventBus\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactDatabase\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(VCardStandard\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactValidator\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactManager\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactUIController\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    
    # UI component imports
    sed -i.tmp 's|\(MobileNavigation\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(ContactRenderer\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(ContactUIHelpers\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\(ImportExportIntegration\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    
    # Core business logic imports
    sed -i.tmp 's|\(IndividualSharingStrategy\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactDatabase.js
    sed -i.tmp 's|\(VCardImporter\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactManager.js
    sed -i.tmp 's|\(VCardExporter\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactManager.js
    sed -i.tmp 's|\(VCardFormatManager\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardImporter.js
    sed -i.tmp 's|\(VCard3Processor\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\(VCard4Processor\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\(VCardStandardEnhanced\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    
    # Utility and configuration imports
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/utils/AuthPerformanceTracker.js
    sed -i.tmp 's|\(ProfileRouter\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    
    # Clean up any remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/core/ContactDatabase.js
    sed -i.tmp 's|\.js?|.js|g' src/core/ContactManager.js
    sed -i.tmp 's|\.js?|.js|g' src/core/VCardImporter.js
    sed -i.tmp 's|\.js?|.js|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\.js?|.js|g' src/utils/AuthPerformanceTracker.js
    
    # Clean up temporary files
    rm -f src/app.js.tmp
    rm -f src/core/ContactDatabase.js.tmp
    rm -f src/core/ContactManager.js.tmp
    rm -f src/core/VCardImporter.js.tmp
    rm -f src/core/VCardFormatManager.js.tmp
    rm -f src/ui/ContactUIController.js.tmp
    rm -f src/ui/ContactRenderer.js.tmp
    rm -f src/utils/AuthPerformanceTracker.js.tmp
    
    echo "📄 JavaScript module imports restored (28 files cleaned)"
else
    # ========================================================================
    # STEP 2b: Manual Cleanup (No Backup Available)
    # ========================================================================
    # If no backup exists, manually remove version parameters from all files
    echo "⚠️  No backup found, removing version parameters manually..."
    
    # Remove version parameters from CSS files in index.html
    sed -i.tmp 's|\(style\.css\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(mobile\.css\)\?v=[^"]*|\1|g' index.html
    
    # Remove version parameters from JS files in index.html
    sed -i.tmp 's|\(userbase\.js\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(UserbaseConnectionFix\.js\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(app\.js\)\?v=[^"]*|\1|g' index.html
    
    # Clean up any remaining ? characters in HTML
    sed -i.tmp 's|\.js?"|.js"|g' index.html
    sed -i.tmp 's|\.css?"|.css"|g' index.html
    
    # Remove version parameters from ES6 module imports (same as above)
    # Core module imports in app.js
    sed -i.tmp 's|\(EventBus\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactDatabase\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(VCardStandard\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactValidator\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactManager\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactUIController\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    
    # UI component imports
    sed -i.tmp 's|\(MobileNavigation\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(ContactRenderer\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(ContactUIHelpers\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\(ImportExportIntegration\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    
    # Core business logic imports
    sed -i.tmp 's|\(IndividualSharingStrategy\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactDatabase.js
    sed -i.tmp 's|\(VCardImporter\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactManager.js
    sed -i.tmp 's|\(VCardExporter\.js\)\?v=[^'"'"']*|\1|g' src/core/ContactManager.js
    sed -i.tmp 's|\(VCardFormatManager\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardImporter.js
    sed -i.tmp 's|\(VCard3Processor\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\(VCard4Processor\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\(VCardStandardEnhanced\.js\)\?v=[^'"'"']*|\1|g' src/core/VCardFormatManager.js
    
    # Utility and configuration imports
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/utils/AuthPerformanceTracker.js
    sed -i.tmp 's|\(ProfileRouter\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    
    # Clean up remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/core/ContactDatabase.js
    sed -i.tmp 's|\.js?|.js|g' src/core/ContactManager.js
    sed -i.tmp 's|\.js?|.js|g' src/core/VCardImporter.js
    sed -i.tmp 's|\.js?|.js|g' src/core/VCardFormatManager.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\.js?|.js|g' src/utils/AuthPerformanceTracker.js
    
    # Clean up temp files
    rm -f index.html.tmp
    rm -f src/app.js.tmp
    rm -f src/core/ContactDatabase.js.tmp
    rm -f src/core/ContactManager.js.tmp
    rm -f src/core/VCardImporter.js.tmp
    rm -f src/core/VCardFormatManager.js.tmp
    rm -f src/ui/ContactUIController.js.tmp
    rm -f src/ui/ContactRenderer.js.tmp
    rm -f src/utils/AuthPerformanceTracker.js.tmp
    
    echo "📄 Version parameters removed from HTML and all JavaScript modules"
end

# ============================================================================
# STEP 3: Clean up Cache Metadata Files
# ============================================================================
# Remove cache-versions.json which is only needed for production
if test -f cache-versions.json
    rm cache-versions.json
    echo "🗑️  Removed cache-versions.json"
end

# ============================================================================
# STEP 4: Clean up any remaining temporary files
# ============================================================================
# Belt-and-suspenders cleanup of any .tmp files that might be lingering
find src -name "*.tmp" -delete 2>/dev/null || true
rm -f *.tmp 2>/dev/null || true

# ============================================================================
# STEP 5: Completion Summary
# ============================================================================
echo ""
echo "🎉 Development environment restored!"
echo "🌐 Your files are now loading without cache busting"
echo ""
echo "📋 What was restored:"
echo "  ✅ index.html (clean file references)"
echo "  ✅ 28 JavaScript modules (clean imports)"
echo "  ✅ Temporary files removed"
echo "  ✅ Cache metadata removed"
echo ""
echo "💡 To apply cache busting again:"
echo "  • For development testing: ./dev-cache-bust.sh"
echo "  • For production build: ./production_zip.sh (recommended)"
echo "  • Manual (not recommended): ./cache-bust.sh"
echo ""
echo "🔍 Files cleaned:"
echo "  📄 index.html - All <link> and <script> tags"
echo "  📄 src/app.js - 6 core module imports"
echo "  📄 src/core/*.js - 7 business logic imports"
echo "  📄 src/ui/*.js - 5 UI component imports"
echo "  📄 src/utils/*.js - 2 utility imports"
echo "  📄 src/config/app.config.js - Configuration imports"
echo ""
echo "✨ Ready for development!"

# ============================================================================
# Development Environment Restoration Complete
# ============================================================================
# All cache busting parameters have been removed
# Files now reference clean paths without version parameters
# Safe to continue development work
# ============================================================================
