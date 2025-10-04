#!/usr/bin/env fish

# Cache Busting Script for Contact Management System
# Generates version parameters to prevent browser caching

function generate_version
    # Generate version based on file modification time and size
    set -l file $argv[1]
    if test -f $file
        # Use file modification time + size as version
        set -l mtime (stat -c %Y $file 2>/dev/null || stat -f %m $file 2>/dev/null)
        set -l size (stat -c %s $file 2>/dev/null || stat -f %z $file 2>/dev/null)
        echo (math $mtime + $size | string sub -l 8)
    else
        # Fallback to timestamp
        date +%s | string sub -l 8
    end
end

function update_cache_busting
    echo "🚀 Contact Management System - Cache Buster"
    echo "=================================================="
    echo ""
    echo "🔄 Generating cache bust versions..."
    echo ""

    # Generate versions for all files
    set -l css_version (generate_version "style.css")
    set -l mobile_css_version (generate_version "mobile.css")  
    set -l userbase_version (generate_version "lib/userbase.js")
    set -l connection_fix_version (generate_version "src/utils/UserbaseConnectionFix.js")
    set -l app_version (generate_version "src/app.js")
    
    # ES6 Module versions (imported by app.js)
    set -l eventbus_version (generate_version "src/utils/EventBus.js")
    set -l database_version (generate_version "src/core/ContactDatabase.js")
    set -l vcard_version (generate_version "src/core/VCardStandard.js")
    set -l validator_version (generate_version "src/core/ContactValidator.js")
    set -l manager_version (generate_version "src/core/ContactManager.js")
    set -l ui_controller_version (generate_version "src/ui/ContactUIController.js")
    set -l mobile_nav_version (generate_version "src/ui/MobileNavigation.js")
    set -l qr_version (generate_version "src/ui/components/qrcode.js")
    
    # New module versions (added in recent updates)
    set -l individual_sharing_version (generate_version "src/core/IndividualSharingStrategy.js")
    set -l contact_renderer_version (generate_version "src/ui/ContactRenderer.js")
    set -l ui_helpers_version (generate_version "src/ui/ContactUIHelpers.js")
    set -l auth_tracker_version (generate_version "src/utils/AuthPerformanceTracker.js")
    set -l app_config_version (generate_version "src/config/app.config.js")

    echo "  📄 style.css → v$css_version"
    echo "  📄 mobile.css → v$mobile_css_version"
    echo "  📄 lib/userbase.js → v$userbase_version"
    echo "  📄 src/utils/UserbaseConnectionFix.js → v$connection_fix_version"
    echo "  📄 src/app.js → v$app_version"
    echo ""
    echo "  🔧 ES6 Modules:"
    echo "     src/utils/EventBus.js → v$eventbus_version"
    echo "     src/core/ContactDatabase.js → v$database_version"
    echo "     src/core/VCardStandard.js → v$vcard_version"
    echo "     src/core/ContactValidator.js → v$validator_version"
    echo "     src/core/ContactManager.js → v$manager_version"
    echo "     src/ui/ContactUIController.js → v$ui_controller_version"
    echo "     src/ui/MobileNavigation.js → v$mobile_nav_version"
    echo "     src/ui/components/qrcode.js → v$qr_version"
    echo ""
    echo "  🆕 New Modules:"
    echo "     src/core/IndividualSharingStrategy.js → v$individual_sharing_version"
    echo "     src/ui/ContactRenderer.js → v$contact_renderer_version"
    echo "     src/ui/ContactUIHelpers.js → v$ui_helpers_version"
    echo "     src/utils/AuthPerformanceTracker.js → v$auth_tracker_version"
    echo "     src/config/app.config.js → v$app_config_version"
    echo ""

    # Create backup
    cp index.html index.html.backup

    echo "📝 Updating index.html with cache bust parameters..."
    echo ""

    # Update CSS files with version parameters
    sed -i.tmp "s|<link rel=\"stylesheet\" href=\"style\.css\"[^>]*>|<link rel=\"stylesheet\" href=\"style.css?v=$css_version\">|g" index.html
    sed -i.tmp "s|<link rel=\"stylesheet\" href=\"mobile\.css\"[^>]*>|<link rel=\"stylesheet\" href=\"mobile.css?v=$mobile_css_version\">|g" index.html

    # Update JavaScript files with version parameters  
    sed -i.tmp "s|<script src=\"lib/userbase\.js\"[^>]*></script>|<script src=\"lib/userbase.js?v=$userbase_version\"></script>|g" index.html
    sed -i.tmp "s|<script src=\"src/utils/UserbaseConnectionFix\.js\"[^>]*></script>|<script src=\"src/utils/UserbaseConnectionFix.js?v=$connection_fix_version\"></script>|g" index.html
    sed -i.tmp "s|<script type=\"module\" src=\"src/app\.js\"[^>]*></script>|<script type=\"module\" src=\"src/app.js?v=$app_version\"></script>|g" index.html

    # Update ES6 module imports in src/app.js
    sed -i.tmp "s|from './utils/EventBus\.js'|from './utils/EventBus.js?v=$eventbus_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactDatabase\.js'|from './core/ContactDatabase.js?v=$database_version'|g" src/app.js  
    sed -i.tmp "s|from './core/VCardStandard\.js'|from './core/VCardStandard.js?v=$vcard_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactValidator\.js'|from './core/ContactValidator.js?v=$validator_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactManager\.js'|from './core/ContactManager.js?v=$manager_version'|g" src/app.js
    sed -i.tmp "s|from './ui/ContactUIController\.js'|from './ui/ContactUIController.js?v=$ui_controller_version'|g" src/app.js

    # Update imports in ContactUIController.js
    sed -i.tmp "s|from './MobileNavigation\.js'|from './MobileNavigation.js?v=$mobile_nav_version'|g" src/ui/ContactUIController.js

    # Update imports in ContactRenderer.js  
    sed -i.tmp "s|from './ContactUIHelpers\.js'|from './ContactUIHelpers.js?v=$ui_helpers_version'|g" src/ui/ContactRenderer.js

    # Update imports in ContactUIController.js (app.config.js import)
    sed -i.tmp "s|from '../config/app\.config\.js'|from '../config/app.config.js?v=$app_config_version'|g" src/ui/ContactUIController.js

    # Update imports in AuthPerformanceTracker.js (app.config.js import)  
    sed -i.tmp "s|from '../config/app\.config\.js'|from '../config/app.config.js?v=$app_config_version'|g" src/utils/AuthPerformanceTracker.js

    # Clean up temp files
    rm -f index.html.tmp

    echo "  ✅ Updated style.css → ?v=$css_version"
    echo "  ✅ Updated mobile.css → ?v=$mobile_css_version"
    echo "  ✅ Updated lib/userbase.js → ?v=$userbase_version"
    echo "  ✅ Updated src/utils/UserbaseConnectionFix.js → ?v=$connection_fix_version"
    echo "  ✅ Updated src/app.js → ?v=$app_version"
    echo ""
    echo "  🔧 ES6 Module imports updated:"
    echo "     ✅ EventBus.js → ?v=$eventbus_version"
    echo "     ✅ ContactDatabase.js → ?v=$database_version"
    echo "     ✅ VCardStandard.js → ?v=$vcard_version"
    echo "     ✅ ContactValidator.js → ?v=$validator_version"
    echo "     ✅ ContactManager.js → ?v=$manager_version"
    echo "     ✅ ContactUIController.js → ?v=$ui_controller_version"
    echo "     ✅ MobileNavigation.js → ?v=$mobile_nav_version"
    echo ""

    # Generate versions report
    set -l timestamp (date -Iseconds)
    set -l build_number (date +%s)
    
    echo "{" > cache-versions.json
    echo "  \"timestamp\": \"$timestamp\"," >> cache-versions.json
    echo "  \"buildNumber\": \"$build_number\"," >> cache-versions.json
    echo "  \"versions\": {" >> cache-versions.json
    echo "    \"style.css\": \"$css_version\"," >> cache-versions.json
    echo "    \"mobile.css\": \"$mobile_css_version\"," >> cache-versions.json
    echo "    \"lib/userbase.js\": \"$userbase_version\"," >> cache-versions.json
    echo "    \"src/utils/UserbaseConnectionFix.js\": \"$connection_fix_version\"," >> cache-versions.json
    echo "    \"src/app.js\": \"$app_version\"," >> cache-versions.json
    echo "    \"src/utils/EventBus.js\": \"$eventbus_version\"," >> cache-versions.json
    echo "    \"src/core/ContactDatabase.js\": \"$database_version\"," >> cache-versions.json
    echo "    \"src/core/VCardStandard.js\": \"$vcard_version\"," >> cache-versions.json
    echo "    \"src/core/ContactValidator.js\": \"$validator_version\"," >> cache-versions.json
    echo "    \"src/core/ContactManager.js\": \"$manager_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactUIController.js\": \"$ui_controller_version\"," >> cache-versions.json
    echo "    \"src/ui/MobileNavigation.js\": \"$mobile_nav_version\"," >> cache-versions.json
    echo "    \"src/ui/components/qrcode.js\": \"$qr_version\"," >> cache-versions.json
    echo "    \"src/core/IndividualSharingStrategy.js\": \"$individual_sharing_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactRenderer.js\": \"$contact_renderer_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactUIHelpers.js\": \"$ui_helpers_version\"," >> cache-versions.json
    echo "    \"src/utils/AuthPerformanceTracker.js\": \"$auth_tracker_version\"," >> cache-versions.json
    echo "    \"src/config/app.config.js\": \"$app_config_version\"" >> cache-versions.json
    echo "  }" >> cache-versions.json
    echo "}" >> cache-versions.json

    echo "📊 Versions report saved to: cache-versions.json"
    echo ""
    echo "=================================================="
    echo "📈 Build: $build_number"
    echo "🕒 Time: $timestamp"  
    echo "📁 Files: 18 updated (5 direct + 13 ES6 modules)"
    echo "✨ Ready for deployment!"
    echo ""
    echo "💡 To restore original: mv index.html.backup index.html"
end

# Run the cache busting
update_cache_busting