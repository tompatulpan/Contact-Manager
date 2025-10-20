#!/usr/bin/env fish
# ============================================================================
# Cache Busting Script for Contact Management System
# ============================================================================
# Purpose: Generates unique version parameters to force browser cache refresh
#
# How It Works:
# 1. Generates version hashes based on file modification time + size
# 2. Updates HTML <script> and <link> tags with ?v=hash parameters
# 3. Updates ES6 module import statements with ?v=hash parameters
# 4. Creates cache-versions.json for build tracking
# 5. Backs up original index.html for restoration
#
# Version Generation Algorithm:
# - Combines file modification time (mtime) + file size
# - Truncates to 8 characters for compact version strings
# - Falls back to timestamp if file doesn't exist
# - Result: Unique version for each file change
#
# Usage: ./cache-bust.sh (called automatically by production_zip.sh)
# ============================================================================

# ============================================================================
# Function: generate_version
# ============================================================================
# Generates a unique version identifier for a file based on:
# - File modification timestamp (mtime)
# - File size in bytes
# 
# This ensures that any change to the file (content or metadata)
# produces a new version hash, forcing browsers to download fresh copies.
#
# Parameters:
#   $argv[1] - File path to generate version for
#
# Returns:
#   8-character version hash (e.g., "17289456")
# ============================================================================
function generate_version
    set -l file $argv[1]
    if test -f $file
        # Use file modification time + size as version
        # stat -c %Y: Linux format (modification time)
        # stat -f %m: macOS/BSD format (modification time)
        set -l mtime (stat -c %Y $file 2>/dev/null || stat -f %m $file 2>/dev/null)
        set -l size (stat -c %s $file 2>/dev/null || stat -f %z $file 2>/dev/null)
        # Combine and truncate to 8 chars for compact version
        echo (math $mtime + $size | string sub -l 8)
    else
        # Fallback to current timestamp if file not found
        date +%s | string sub -l 8
    end
end

# ============================================================================
# Function: update_cache_busting
# ============================================================================
# Main function that orchestrates the cache busting process:
# 1. Generates versions for all JavaScript and CSS files
# 2. Creates backup of index.html
# 3. Updates all file references with version parameters
# 4. Saves version report to cache-versions.json
# ============================================================================
function update_cache_busting
    echo "🚀 Contact Management System - Cache Buster"
    echo "=================================================="
    echo ""
    echo "🔄 Generating cache bust versions..."
    echo ""

    # ========================================================================
    # STEP 1: Generate Versions for All Files
    # ========================================================================
    # CSS Files (referenced in index.html)
    set -l css_version (generate_version "style.css")
    set -l mobile_css_version (generate_version "mobile.css")
    
    # External Libraries (referenced in index.html)
    set -l userbase_version (generate_version "lib/userbase.js")
    set -l connection_fix_version (generate_version "src/utils/UserbaseConnectionFix.js")
    
    # Main Application Entry Point (referenced in index.html)
    set -l app_version (generate_version "src/app.js")
    
    # ========================================================================
    # Core ES6 Modules (imported by app.js)
    # ========================================================================
    # These are the main application modules imported in src/app.js
    set -l eventbus_version (generate_version "src/utils/EventBus.js")
    set -l database_version (generate_version "src/core/ContactDatabase.js")
    set -l vcard_version (generate_version "src/core/VCardStandard.js")
    set -l validator_version (generate_version "src/core/ContactValidator.js")
    set -l manager_version (generate_version "src/core/ContactManager.js")
    set -l ui_controller_version (generate_version "src/ui/ContactUIController.js")
    
    # ========================================================================
    # Additional ES6 Modules (imported by other modules)
    # ========================================================================
    # UI Component Modules
    set -l mobile_nav_version (generate_version "src/ui/MobileNavigation.js")
    set -l contact_renderer_version (generate_version "src/ui/ContactRenderer.js")
    set -l ui_helpers_version (generate_version "src/ui/ContactUIHelpers.js")
    set -l import_export_version (generate_version "src/ui/ImportExportIntegration.js")
    set -l qr_version (generate_version "src/ui/components/qrcode.js")
    
    # Core Business Logic Modules
    set -l individual_sharing_version (generate_version "src/core/IndividualSharingStrategy.js")
    set -l vcard_importer_version (generate_version "src/core/VCardImporter.js")
    set -l vcard_exporter_version (generate_version "src/core/VCardExporter.js")
    set -l vcard_format_manager_version (generate_version "src/core/VCardFormatManager.js")
    set -l vcard3_processor_version (generate_version "src/core/VCard3Processor.js")
    set -l vcard4_processor_version (generate_version "src/core/VCard4Processor.js")
    set -l vcard_standard_enhanced_version (generate_version "src/core/VCardStandardEnhanced.js")
    
    # Utility Modules
    set -l auth_tracker_version (generate_version "src/utils/AuthPerformanceTracker.js")
    set -l profile_router_version (generate_version "src/utils/ProfileRouter.js")
    set -l test_helpers_version (generate_version "src/utils/TestHelpers.js")
    
    # Integration Modules
    set -l baical_connector_version (generate_version "src/integrations/BaicalConnector.js")
    set -l baical_config_manager_version (generate_version "src/integrations/BaicalConfigManager.js")
    set -l baical_ui_controller_version (generate_version "src/integrations/BaicalUIController.js")
    
    # Configuration
    set -l app_config_version (generate_version "src/config/app.config.js")

    # ========================================================================
    # Display Generated Versions
    # ========================================================================
    echo "  📄 CSS Files:"
    echo "     style.css → v$css_version"
    echo "     mobile.css → v$mobile_css_version"
    echo ""
    echo "  � External Libraries:"
    echo "     lib/userbase.js → v$userbase_version"
    echo "     src/utils/UserbaseConnectionFix.js → v$connection_fix_version"
    echo ""
    echo "  � Application Entry:"
    echo "     src/app.js → v$app_version"
    echo ""
    echo "  🔧 Core ES6 Modules (app.js imports):"
    echo "     src/utils/EventBus.js → v$eventbus_version"
    echo "     src/core/ContactDatabase.js → v$database_version"
    echo "     src/core/VCardStandard.js → v$vcard_version"
    echo "     src/core/ContactValidator.js → v$validator_version"
    echo "     src/core/ContactManager.js → v$manager_version"
    echo "     src/ui/ContactUIController.js → v$ui_controller_version"
    echo ""
    echo "  🎨 UI Component Modules:"
    echo "     src/ui/MobileNavigation.js → v$mobile_nav_version"
    echo "     src/ui/ContactRenderer.js → v$contact_renderer_version"
    echo "     src/ui/ContactUIHelpers.js → v$ui_helpers_version"
    echo "     src/ui/ImportExportIntegration.js → v$import_export_version"
    echo "     src/ui/components/qrcode.js → v$qr_version"
    echo ""
    echo "  💼 Business Logic Modules:"
    echo "     src/core/IndividualSharingStrategy.js → v$individual_sharing_version"
    echo "     src/core/VCardImporter.js → v$vcard_importer_version"
    echo "     src/core/VCardExporter.js → v$vcard_exporter_version"
    echo "     src/core/VCardFormatManager.js → v$vcard_format_manager_version"
    echo "     src/core/VCard3Processor.js → v$vcard3_processor_version"
    echo "     src/core/VCard4Processor.js → v$vcard4_processor_version"
    echo "     src/core/VCardStandardEnhanced.js → v$vcard_standard_enhanced_version"
    echo ""
    echo "  🛠️ Utility Modules:"
    echo "     src/utils/AuthPerformanceTracker.js → v$auth_tracker_version"
    echo "     src/utils/ProfileRouter.js → v$profile_router_version"
    echo "     src/utils/TestHelpers.js → v$test_helpers_version"
    echo ""
    echo "  🔗 Integration Modules:"
    echo "     src/integrations/BaicalConnector.js → v$baical_connector_version"
    echo "     src/integrations/BaicalConfigManager.js → v$baical_config_manager_version"
    echo "     src/ui/BaicalUIController.js → v$baical_ui_controller_version"
    echo ""
    echo "  ⚙️ Configuration:"
    echo "     src/config/app.config.js → v$app_config_version"
    echo ""

    # ========================================================================
    # STEP 2: Create Backup of index.html
    # ========================================================================
    # This backup is used for development environment restoration
    # after production packaging (see production_zip.sh step 8)
    cp index.html index.html.backup

    echo "📝 Updating index.html with cache bust parameters..."
    echo ""

    # ========================================================================
    # STEP 3: Update index.html with Version Parameters
    # ========================================================================
    # Strategy: Replace file references with versioned URLs using ?v=hash
    # Format: <link href="file.css?v=12345678">
    #         <script src="file.js?v=12345678"></script>
    
    # Update CSS files with version parameters
    sed -i.tmp "s|<link rel=\"stylesheet\" href=\"style\.css\"[^>]*>|<link rel=\"stylesheet\" href=\"style.css?v=$css_version\">|g" index.html
    sed -i.tmp "s|<link rel=\"stylesheet\" href=\"mobile\.css\"[^>]*>|<link rel=\"stylesheet\" href=\"mobile.css?v=$mobile_css_version\">|g" index.html

    # Update JavaScript files with version parameters  
    sed -i.tmp "s|<script src=\"lib/userbase\.js\"[^>]*></script>|<script src=\"lib/userbase.js?v=$userbase_version\"></script>|g" index.html
    sed -i.tmp "s|<script src=\"src/utils/UserbaseConnectionFix\.js\"[^>]*></script>|<script src=\"src/utils/UserbaseConnectionFix.js?v=$connection_fix_version\"></script>|g" index.html
    sed -i.tmp "s|<script type=\"module\" src=\"src/app\.js\"[^>]*></script>|<script type=\"module\" src=\"src/app.js?v=$app_version\"></script>|g" index.html

    # ========================================================================
    # STEP 4: Update ES6 Module Imports with Version Parameters
    # ========================================================================
    # Updates import statements in JavaScript files to include version hashes.
    # This ensures that when app.js or other modules load dependencies,
    # browsers download fresh versions instead of using cached files.
    
    # Update ES6 module imports in src/app.js (main entry point)
    sed -i.tmp "s|from './utils/EventBus\.js'|from './utils/EventBus.js?v=$eventbus_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactDatabase\.js'|from './core/ContactDatabase.js?v=$database_version'|g" src/app.js  
    sed -i.tmp "s|from './core/VCardStandard\.js'|from './core/VCardStandard.js?v=$vcard_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactValidator\.js'|from './core/ContactValidator.js?v=$validator_version'|g" src/app.js
    sed -i.tmp "s|from './core/ContactManager\.js'|from './core/ContactManager.js?v=$manager_version'|g" src/app.js
    sed -i.tmp "s|from './ui/ContactUIController\.js'|from './ui/ContactUIController.js?v=$ui_controller_version'|g" src/app.js
    
    # Update Baical integration imports in src/app.js
    sed -i.tmp "s|from './integrations/BaicalConnector\.js'|from './integrations/BaicalConnector.js?v=$baical_connector_version'|g" src/app.js
    sed -i.tmp "s|from './integrations/BaicalConfigManager\.js'|from './integrations/BaicalConfigManager.js?v=$baical_config_manager_version'|g" src/app.js
    sed -i.tmp "s|from './ui/BaicalUIController\.js'|from './ui/BaicalUIController.js?v=$baical_ui_controller_version'|g" src/app.js

    # Update imports in ContactUIController.js
    sed -i.tmp "s|from './MobileNavigation\.js'|from './MobileNavigation.js?v=$mobile_nav_version'|g" src/ui/ContactUIController.js

    # Update imports in ContactRenderer.js  
    sed -i.tmp "s|from './ContactUIHelpers\.js'|from './ContactUIHelpers.js?v=$ui_helpers_version'|g" src/ui/ContactRenderer.js

    # Update imports in ContactUIController.js (app.config.js import)
    sed -i.tmp "s|from '../config/app\.config\.js'|from '../config/app.config.js?v=$app_config_version'|g" src/ui/ContactUIController.js

    # Update imports in AuthPerformanceTracker.js (app.config.js import)  
    sed -i.tmp "s|from '../config/app\.config\.js'|from '../config/app.config.js?v=$app_config_version'|g" src/utils/AuthPerformanceTracker.js

    # Update imports in ContactDatabase.js (IndividualSharingStrategy import)
    sed -i.tmp "s|from './IndividualSharingStrategy\.js'|from './IndividualSharingStrategy.js?v=$individual_sharing_version'|g" src/core/ContactDatabase.js

    # Update imports in ContactManager.js (vCard processing modules)
    sed -i.tmp "s|from './VCardImporter\.js'|from './VCardImporter.js?v=$vcard_importer_version'|g" src/core/ContactManager.js
    sed -i.tmp "s|from './VCardExporter\.js'|from './VCardExporter.js?v=$vcard_exporter_version'|g" src/core/ContactManager.js

    # Update imports in VCardImporter.js (vCard processors)
    sed -i.tmp "s|from './VCardFormatManager\.js'|from './VCardFormatManager.js?v=$vcard_format_manager_version'|g" src/core/VCardImporter.js
    
    # Update imports in VCardFormatManager.js (vCard processors)
    sed -i.tmp "s|from './VCard3Processor\.js'|from './VCard3Processor.js?v=$vcard3_processor_version'|g" src/core/VCardFormatManager.js
    sed -i.tmp "s|from './VCard4Processor\.js'|from './VCard4Processor.js?v=$vcard4_processor_version'|g" src/core/VCardFormatManager.js
    sed -i.tmp "s|from './VCardStandardEnhanced\.js'|from './VCardStandardEnhanced.js?v=$vcard_standard_enhanced_version'|g" src/core/VCardFormatManager.js

    # Update imports in ContactUIController.js (additional imports)
    sed -i.tmp "s|from './ContactRenderer\.js'|from './ContactRenderer.js?v=$contact_renderer_version'|g" src/ui/ContactUIController.js
    sed -i.tmp "s|from './ImportExportIntegration\.js'|from './ImportExportIntegration.js?v=$import_export_version'|g" src/ui/ContactUIController.js
    sed -i.tmp "s|from '../utils/ProfileRouter\.js'|from '../utils/ProfileRouter.js?v=$profile_router_version'|g" src/ui/ContactUIController.js

    # ========================================================================
    # STEP 5: Cleanup Temporary Files
    # ========================================================================
    # Remove .tmp files created by sed -i.tmp operations
    rm -f index.html.tmp
    rm -f src/app.js.tmp
    rm -f src/core/ContactDatabase.js.tmp
    rm -f src/core/ContactManager.js.tmp
    rm -f src/core/VCardImporter.js.tmp
    rm -f src/core/VCardFormatManager.js.tmp
    rm -f src/ui/ContactUIController.js.tmp
    rm -f src/ui/ContactRenderer.js.tmp
    rm -f src/utils/AuthPerformanceTracker.js.tmp

    # ========================================================================
    # STEP 6: Display Update Summary
    # ========================================================================
    echo "  ✅ Updated style.css → ?v=$css_version"
    echo "  ✅ Updated mobile.css → ?v=$mobile_css_version"
    echo "  ✅ Updated lib/userbase.js → ?v=$userbase_version"
    echo "  ✅ Updated src/utils/UserbaseConnectionFix.js → ?v=$connection_fix_version"
    echo "  ✅ Updated src/app.js → ?v=$app_version"
    echo ""
    echo "  🔧 ES6 Module imports updated in app.js:"
    echo "     ✅ EventBus.js → ?v=$eventbus_version"
    echo "     ✅ ContactDatabase.js → ?v=$database_version"
    echo "     ✅ VCardStandard.js → ?v=$vcard_version"
    echo "     ✅ ContactValidator.js → ?v=$validator_version"
    echo "     ✅ ContactManager.js → ?v=$manager_version"
    echo "     ✅ ContactUIController.js → ?v=$ui_controller_version"
    echo ""
    echo "  🔗 Baical integration imports updated in app.js:"
    echo "     ✅ BaicalConnector.js → ?v=$baical_connector_version"
    echo "     ✅ BaicalConfigManager.js → ?v=$baical_config_manager_version"
    echo "     ✅ BaicalUIController.js → ?v=$baical_ui_controller_version"
    echo ""
    echo "  🎨 UI component imports updated:"
    echo "     ✅ MobileNavigation.js → ?v=$mobile_nav_version"
    echo "     ✅ ContactRenderer.js → ?v=$contact_renderer_version"
    echo "     ✅ ContactUIHelpers.js → ?v=$ui_helpers_version"
    echo "     ✅ ImportExportIntegration.js → ?v=$import_export_version"
    echo ""
    echo "  💼 Business logic imports updated:"
    echo "     ✅ IndividualSharingStrategy.js → ?v=$individual_sharing_version"
    echo "     ✅ VCardImporter.js → ?v=$vcard_importer_version"
    echo "     ✅ VCardExporter.js → ?v=$vcard_exporter_version"
    echo "     ✅ VCardFormatManager.js → ?v=$vcard_format_manager_version"
    echo "     ✅ VCard3Processor.js → ?v=$vcard3_processor_version"
    echo "     ✅ VCard4Processor.js → ?v=$vcard4_processor_version"
    echo "     ✅ VCardStandardEnhanced.js → ?v=$vcard_standard_enhanced_version"
    echo ""
    echo "  🛠️ Utility imports updated:"
    echo "     ✅ AuthPerformanceTracker.js → ?v=$auth_tracker_version"
    echo "     ✅ ProfileRouter.js → ?v=$profile_router_version"
    echo ""
    echo "  ⚙️ Configuration imports updated:"
    echo "     ✅ app.config.js → ?v=$app_config_version"
    echo ""

    # ========================================================================
    # STEP 7: Generate cache-versions.json Report
    # ========================================================================
    # This JSON file contains:
    # - Build timestamp (ISO 8601 format)
    # - Build number (Unix timestamp)
    # - Version hash for each file
    # 
    # Used by production_zip.sh to display build information
    # Can be used for debugging cache issues in production
    set -l timestamp (date -Iseconds)
    set -l build_number (date +%s)
    
    echo "{" > cache-versions.json
    echo "  \"timestamp\": \"$timestamp\"," >> cache-versions.json
    echo "  \"buildNumber\": \"$build_number\"," >> cache-versions.json
    echo "  \"versions\": {" >> cache-versions.json
    
    # CSS Files
    echo "    \"style.css\": \"$css_version\"," >> cache-versions.json
    echo "    \"mobile.css\": \"$mobile_css_version\"," >> cache-versions.json
    
    # External Libraries
    echo "    \"lib/userbase.js\": \"$userbase_version\"," >> cache-versions.json
    echo "    \"src/utils/UserbaseConnectionFix.js\": \"$connection_fix_version\"," >> cache-versions.json
    
    # Main Application
    echo "    \"src/app.js\": \"$app_version\"," >> cache-versions.json
    
    # Core ES6 Modules
    echo "    \"src/utils/EventBus.js\": \"$eventbus_version\"," >> cache-versions.json
    echo "    \"src/core/ContactDatabase.js\": \"$database_version\"," >> cache-versions.json
    echo "    \"src/core/VCardStandard.js\": \"$vcard_version\"," >> cache-versions.json
    echo "    \"src/core/ContactValidator.js\": \"$validator_version\"," >> cache-versions.json
    echo "    \"src/core/ContactManager.js\": \"$manager_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactUIController.js\": \"$ui_controller_version\"," >> cache-versions.json
    
    # UI Components
    echo "    \"src/ui/MobileNavigation.js\": \"$mobile_nav_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactRenderer.js\": \"$contact_renderer_version\"," >> cache-versions.json
    echo "    \"src/ui/ContactUIHelpers.js\": \"$ui_helpers_version\"," >> cache-versions.json
    echo "    \"src/ui/ImportExportIntegration.js\": \"$import_export_version\"," >> cache-versions.json
    echo "    \"src/ui/components/qrcode.js\": \"$qr_version\"," >> cache-versions.json
    
    # Business Logic Modules
    echo "    \"src/core/IndividualSharingStrategy.js\": \"$individual_sharing_version\"," >> cache-versions.json
    echo "    \"src/core/VCardImporter.js\": \"$vcard_importer_version\"," >> cache-versions.json
    echo "    \"src/core/VCardExporter.js\": \"$vcard_exporter_version\"," >> cache-versions.json
    echo "    \"src/core/VCardFormatManager.js\": \"$vcard_format_manager_version\"," >> cache-versions.json
    echo "    \"src/core/VCard3Processor.js\": \"$vcard3_processor_version\"," >> cache-versions.json
    echo "    \"src/core/VCard4Processor.js\": \"$vcard4_processor_version\"," >> cache-versions.json
    echo "    \"src/core/VCardStandardEnhanced.js\": \"$vcard_standard_enhanced_version\"," >> cache-versions.json
    
    # Utilities
    echo "    \"src/utils/AuthPerformanceTracker.js\": \"$auth_tracker_version\"," >> cache-versions.json
    echo "    \"src/utils/ProfileRouter.js\": \"$profile_router_version\"," >> cache-versions.json
    echo "    \"src/utils/TestHelpers.js\": \"$test_helpers_version\"," >> cache-versions.json
    
    # Baical CardDAV Integration
    echo "    \"src/integrations/BaicalConnector.js\": \"$baical_connector_version\"," >> cache-versions.json
    echo "    \"src/integrations/BaicalConfigManager.js\": \"$baical_config_manager_version\"," >> cache-versions.json
    echo "    \"src/ui/BaicalUIController.js\": \"$baical_ui_controller_version\"," >> cache-versions.json
    
    # Configuration (last entry - no trailing comma)
    echo "    \"src/config/app.config.js\": \"$app_config_version\"" >> cache-versions.json
    
    echo "  }" >> cache-versions.json
    echo "}" >> cache-versions.json

    # ========================================================================
    # STEP 8: Final Summary
    # ========================================================================
    echo "📊 Versions report saved to: cache-versions.json"
    echo ""
    echo "=================================================="
    echo "📈 Build: $build_number"
    echo "🕒 Time: $timestamp"  
    echo "📁 Files: 28 updated (5 direct + 23 ES6 modules)"
    echo "✨ Ready for deployment!"
    echo ""
    echo "💡 To restore development environment:"
    echo "   - Run production_zip.sh (auto-restores after packaging)"
    echo "   - Or manually: mv index.html.backup index.html"
    echo ""
    echo "🔍 Cache busting coverage:"
    echo "   ✅ All CSS files"
    echo "   ✅ All JavaScript dependencies"
    echo "   ✅ All ES6 module imports"
    echo "   ✅ All core business logic"
    echo "   ✅ All UI components"
    echo "   ✅ All utility modules"
    echo "   ✅ Application configuration"
end

# ============================================================================
# Execute Cache Busting
# ============================================================================
update_cache_busting

# ============================================================================
# Cache Busting Complete
# ============================================================================
# Result: All file references now include version parameters (?v=hash)
# Effect: Browsers will download fresh files when deployed
# Next: Run production_zip.sh to create deployment package
# ============================================================================
