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

# Clean up any existing temp files before packaging
find . -name "*.tmp" -delete 2>/dev/null || true

# Create core application files
zip -r $zipname \
    index.html \
    style.css \
    mobile.css \
    favicon.ico \
    src/ \
    lib/userbase.js \
    cache-versions.json \
    --exclude="src/**/*.tmp" \
    --exclude="*.tmp"

# Include tests for debugging if present
if test -d tests
    zip -r $zipname tests/
    echo "Added tests directory for production debugging"
end

# Create 404.html if it doesn't exist (required for Cloudflare Pages SPA routing)
if not test -f 404.html
    echo "Creating 404.html for SPA routing..."
    cp index.html 404.htmltml
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
unzip -l $zipname
echo ""
echo "🚀 Ready for Cloudflare Pages deployment!"
echo "💡 Cache busting applied - browsers will get fresh files!"
echo "📊 Enhanced: Now covers all 13 JavaScript modules + CSS files"

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
    
    # Clean up any remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    sed -i.tmp 's|\.js?"|.js"|g' index.html
    sed -i.tmp 's|\.css?"|.css"|g' index.html
    
    # Clean up temp files (including any that might have been accidentally zipped)
    rm -f src/app.js.tmp src/ui/ContactUIController.js.tmp
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
