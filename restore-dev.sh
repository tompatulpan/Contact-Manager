#!/usr/bin/env fish

# Restore Development Environment
# Removes cache busting parameters for development

echo "🔄 Restoring Development Environment"
echo "===================================="
echo ""

if test -f index.html.backup
    echo "✅ Restoring original index.html..."
    mv index.html.backup index.html
    echo "📄 Original index.html restored"
    
    # Also restore JS module imports even when restoring from backup
    echo "🔄 Restoring JS module imports..."
    sed -i.tmp 's|\(EventBus\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactDatabase\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(VCardStandard\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactValidator\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactManager\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactUIController\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(MobileNavigation\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    # Clean up remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    rm -f src/app.js.tmp src/ui/ContactUIController.js.tmp
    echo "📄 JavaScript module imports restored"
else
    echo "⚠️  No backup found, removing version parameters manually..."
    
    # Remove version parameters from CSS files
    sed -i.tmp 's|\(style\.css\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(mobile\.css\)\?v=[^"]*|\1|g' index.html
    
    # Remove version parameters from JS files  
    sed -i.tmp 's|\(userbase\.js\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(UserbaseConnectionFix\.js\)\?v=[^"]*|\1|g' index.html
    sed -i.tmp 's|\(app\.js\)\?v=[^"]*|\1|g' index.html
    
    # Clean up any remaining ? characters in HTML
    sed -i.tmp 's|\.js?"|.js"|g' index.html
    sed -i.tmp 's|\.css?"|.css"|g' index.html
    
    # Remove version parameters from ES6 module imports in src/app.js
    sed -i.tmp 's|\(EventBus\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactDatabase\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(VCardStandard\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactValidator\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactManager\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    sed -i.tmp 's|\(ContactUIController\.js\)\?v=[^'"'"']*|\1|g' src/app.js
    
    # Remove version parameters from imports in ContactUIController.js
    sed -i.tmp 's|\(MobileNavigation\.js\)\?v=[^'"'"']*|\1|g' src/ui/ContactUIController.js
    
    # Clean up remaining ? characters from failed regex matches
    sed -i.tmp 's|\.js?|.js|g' src/app.js
    sed -i.tmp 's|\.js?|.js|g' src/ui/ContactUIController.js
    
    # Clean up temp files
    rm -f index.html.tmp src/app.js.tmp src/ui/ContactUIController.js.tmp
    
    echo "📄 Version parameters removed from HTML and JS modules"
end

# Clean up cache files
if test -f cache-versions.json
    rm cache-versions.json
    echo "🗑️  Removed cache-versions.json"
end

echo ""
echo "🎉 Development environment restored!"
echo "🌐 Your files are now loading without cache busting"
echo ""
echo "💡 To apply cache busting again:"
echo "  • For development: ./dev-cache-bust.sh"
echo "  • For production: ./production_zip.sh"