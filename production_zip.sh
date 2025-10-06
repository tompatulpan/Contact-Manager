#!/usr/bin/env fish

set zipname production.zip

# Remove old zip if exists
if test -f $zipname
    rm $zipname
    echo "Removed existing $zipname"
end

echo "🚀 Creating production package with cache busting..."
echo ""

# Run cache busting first
if test -f ./cache-bust.sh
    echo "🔄 Running cache busting..."
    ./cache-bust.sh
    echo ""
else
    echo "⚠️  Cache busting script not found, skipping..."
    echo ""
end

echo "📦 Packaging files..."

# Validate critical files exist before packaging
set critical_files \
    "index.html" \
    "style.css" \
    "mobile.css" \
    "favicon.ico" \
    "lib/userbase.js" \
    "src/app.js" \
    "src/core/ContactManager.js" \
    "src/core/ContactDatabase.js" \
    "src/core/VCardStandard.js" \
    "src/ui/ContactUIController.js" \
    "src/utils/EventBus.js"

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
echo "✅ All critical files present"
echo ""

# Clean up any existing temp files before packaging
find . -name "*.tmp" -delete 2>/dev/null || true

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

# Restore original index.html for development
if test -f index.html.backup
    echo ""
    echo "🔄 Restoring complete development environment..."
    mv index.html.backup index.html
    echo "  ✅ index.html restored"
    
    # Restore JavaScript module imports
    echo "  🔄 Restoring ES6 module imports..."
    sed -i.tmp 's|\(EventBus\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactDatabase\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(VCardStandard\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactValidator\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactManager\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactUIController\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(MobileNavigation\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(ContactUIHelpers\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\(app\.config\.js\)\?v=[^'"'"']*|\1|g' src/utils/AuthPerformanceTracker.js
    
    # Clean up any remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactRenderer.js
    sed -i.tmp 's|\.js?|.js|g' src/utils/AuthPerformanceTracker.js
    sed -i.tmp 's|\.js?"|.js"|g' index.html
    sed -i.tmp 's|\.css?"|.css"|g' index.html
    
    # Clean up temp files (including any that might have been accidentally zipped)
    rm -f src/app.js.tmp src/ui/ContactUIController.js.tmp src/ui/ContactRenderer.js.tmp src/utils/AuthPerformanceTracker.js.tmp
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
