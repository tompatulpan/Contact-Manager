#!/usr/bin/env fish
# ============================================================================
# Production Packaging Script for Contact Management System
# ============================================================================
# Purpose: Creates optimized production.zip for Cloudflare Pages deployment
# 
# Features:
# - Automatic cache busting for browser refresh
# - File validation before packaging
# - Excludes test/dev files for security and size optimization
# - Creates 404.html for SPA routing support
# - Development environment restoration after packaging
#
# Usage: ./production_zip.sh
# Output: production.zip (ready for Cloudflare Pages upload)
# ============================================================================

set zipname production.zip

# ============================================================================
# STEP 1: Cleanup - Remove old production package
# ============================================================================
if test -f $zipname
    rm $zipname
    echo "Removed existing $zipname"
end

echo "🚀 Creating production package with cache busting..."
echo ""

# ============================================================================
# STEP 2: Cache Busting - Force browser refresh of updated files
# ============================================================================
# The cache-bust.sh script:
# - Generates unique version hashes for CSS/JS files
# - Updates import statements with version parameters (?v=hash)
# - Ensures users always get the latest version after deployment
if test -f ./cache-bust.sh
    echo "🔄 Running cache busting..."
    ./cache-bust.sh
    echo ""
else
    echo "⚠️  Cache busting script not found, skipping..."
    echo ""
end

echo "📦 Packaging files..."

# ============================================================================
# STEP 3: File Validation - Ensure all critical files exist
# ============================================================================
# Critical files required for basic application functionality.
# Note: Full src/ directory is packaged, but we validate core modules here.
#
# File Categories:
# - HTML/CSS: User interface and styling
# - lib/: Third-party dependencies (Userbase SDK)
# - src/app.js: Application entry point
# - src/core/: Business logic modules
# - src/ui/: User interface controllers
# - src/utils/: Utility modules and helpers
set critical_files \
    "index.html" \
    "style.css" \
    "mobile.css" \
    "favicon.ico" \
    "lib/userbase.js" \
    "src/app.js" \
    "src/config/app.config.js" \
    "src/core/ContactManager.js" \
    "src/core/ContactDatabase.js" \
    "src/core/VCardStandard.js" \
    "src/core/ContactValidator.js" \
    "src/core/IndividualSharingStrategy.js" \
    "src/core/VCardImporter.js" \
    "src/core/VCardExporter.js" \
    "src/core/VCardFormatManager.js" \
    "src/core/VCard3Processor.js" \
    "src/core/VCard4Processor.js" \
    "src/ui/ContactUIController.js" \
    "src/ui/ContactRenderer.js" \
    "src/ui/ContactUIHelpers.js" \
    "src/ui/MobileNavigation.js" \
    "src/ui/ImportExportIntegration.js" \
    "src/ui/components/qrcode.js" \
    "src/utils/EventBus.js" \
    "src/utils/UserbaseConnectionFix.js" \
    "src/utils/ProfileRouter.js" \
    "src/utils/AuthPerformanceTracker.js"

echo "🔍 Validating critical files..."
set missing_files 0
for file in $critical_files
    if not test -f $file
        echo "❌ MISSING: $file"
        set missing_files (math $missing_files + 1)
    end
end

if test $missing_files -gt 0
    echo ""
    echo "💥 ABORT: $missing_files critical files missing!"
    echo "🛠️  Please ensure all files exist before running production build."
    exit 1
end
echo "✅ All critical files present ($critical_files | count) files validated)"
echo ""

# ============================================================================
# STEP 4: Pre-Packaging Cleanup
# ============================================================================
# Remove temporary files that might have been left by development
find . -name "*.tmp" -delete 2>/dev/null || true

# ============================================================================
# STEP 5: Create Production ZIP Package
# ============================================================================
# Package Structure:
# - index.html, 404.html: Entry points (404.html enables SPA routing)
# - style.css, mobile.css: Application styling
# - favicon.ico: Browser icon
# - package.json: Project metadata
# - src/: Complete application source code (ALL modules included)
#   ├── app.js: Application initialization
#   ├── config/: Configuration files
#   ├── core/: Business logic (contact management, database, vCard processing)
#   ├── ui/: User interface components and controllers
#   └── utils/: Utility modules (EventBus, authentication, routing)
# - lib/userbase.js: Userbase SDK for encrypted storage
# - cache-versions.json: Cache busting version tracking
#
# Exclusions (for security and size optimization):
# - *.tmp: Temporary files
# - *_backup.js, *_new.js: Development backup files
# - test-*.html, debug-*.html: Testing/debugging files
# - tests/: Test suites (Jest/Puppeteer)
# - tools/: Development tools
# - _temp/: Temporary directories
# - *.md: Documentation files (README, implementation notes, etc.)
# ============================================================================
# Create core application files
zip -r $zipname \
    index.html \
    style.css \
    mobile.css \
    favicon.ico \
    package.json \
    src/ \
    lib/userbase.js \
    cache-versions.json \
    --exclude="src/**/*.tmp" \
    --exclude="*.tmp" \
    --exclude="src/**/*_backup.js" \
    --exclude="src/**/*_new.js" \
    --exclude="test-*.html" \
    --exclude="debug-*.html" \
    --exclude="tests/" \
    --exclude="tools/" \
    --exclude="_temp/" \
    --exclude="*.md"

# Tests are excluded from production build for security and size optimization

# ============================================================================
# STEP 6: SPA Routing Support - Create/Update 404.html
# ============================================================================
# Cloudflare Pages serves 404.html when a route is not found.
# By copying index.html to 404.html, client-side routing works correctly
# (e.g., /profile/username routes to the SPA, not a 404 error page)
# Create 404.html if it doesn't exist (required for Cloudflare Pages SPA routing)
if not test -f 404.html
    echo "Creating 404.html for SPA routing..."
    cp index.html 404.html
    zip -u $zipname 404.html
    echo "Added 404.html (copy of index.html for SPA routing)"
else
    zip -u $zipname 404.html
    echo "Added existing 404.html"
end

# ============================================================================
# STEP 7: Package Summary and Verification
# ============================================================================
echo ""
echo "✅ Production zip created: $zipname"

# Show cache versions report
if test -f cache-versions.json
    echo ""
    echo "🔍 Cache Versions Applied:"
    cat cache-versions.json | grep -E "timestamp|buildNumber|versions" | head -10
end

echo ""
echo "📦 Contents:"
unzip -l $zipname | head -30
if test (unzip -l $zipname | wc -l) -gt 35
    echo "... (showing first 25 files, total: "(unzip -l $zipname | grep -c "\.") " files)"
end
echo ""
echo "🚀 Ready for Cloudflare Pages deployment!"
echo "💡 Cache busting applied - browsers will get fresh files!"
echo "📊 Enhanced: Covers all JavaScript modules + CSS files"
echo "🔍 Validation: All critical files verified before packaging"

# Show file size summary
set zipsize (du -h $zipname | cut -f1)
echo "📏 Package size: $zipsize"

# ============================================================================
# STEP 8: Development Environment Restoration
# ============================================================================
# After packaging, restore the development environment to working state.
# This reverses the cache busting changes that were applied for production:
# - Removes version parameters from imports (?v=hash)
# - Restores original file references
# - Cleans up temporary files created during packaging
# Restore original index.html for development
if test -f index.html.backup
    echo ""
    echo "🔄 Restoring complete development environment..."
    mv index.html.backup index.html
    echo "  ✅ index.html restored"
    
    # Restore JavaScript module imports (remove cache busting version parameters)
    echo "  🔄 Restoring ES6 module imports..."
    
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
    sed -i.tmp 's|\.js?"|.js"|g' index.html
    sed -i.tmp 's|\.css?"|.css"|g' index.html
    
    # Clean up temp files (including any that might have been accidentally zipped)
    rm -f src/app.js.tmp
    rm -f src/core/ContactDatabase.js.tmp
    rm -f src/core/ContactManager.js.tmp
    rm -f src/core/VCardImporter.js.tmp
    rm -f src/core/VCardFormatManager.js.tmp
    rm -f src/ui/ContactUIController.js.tmp
    rm -f src/ui/ContactRenderer.js.tmp
    rm -f src/utils/AuthPerformanceTracker.js.tmp
    find src -name "*.tmp" -delete 2>/dev/null || true
    rm -f *.tmp 2>/dev/null || true
    
    echo "  ✅ JavaScript module imports restored"
    echo "  🧹 Cleanup completed"
    echo "✅ Complete development environment restored"
else
    echo ""
    echo "⚠️  No backup found - development environment may still have cache busting"
    echo "💡 Run './restore-dev.sh' to clean up development files"
end

# ============================================================================
# Production Package Complete
# ============================================================================
# Next Steps:
# 1. Upload production.zip to Cloudflare Pages
# 2. Cloudflare will automatically extract and deploy
# 3. SPA routing will work via 404.html fallback
# 4. Users will get fresh files via cache busting
# ============================================================================
