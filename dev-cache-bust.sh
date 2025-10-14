#!/usr/bin/env fish
# ============================================================================
# Development Cache Busting Script
# ============================================================================
# Purpose: Apply cache busting during development for browser testing
#
# Use Cases:
# - Testing CSS/JavaScript changes during development
# - Forcing browser to download fresh files without hard refresh
# - Verifying cache busting works before production deployment
# - Development workflow when browser caching is problematic
#
# What It Does:
# 1. Restores original files (if backup exists)
# 2. Runs cache-bust.sh to apply fresh version hashes
# 3. Updates ALL 28 files with cache parameters
# 4. Creates index.html.backup for later restoration
#
# Important:
# - Uses cache-bust.sh (Fish shell) for FULL coverage (28 files)
# - NOT the Node.js cache-bust.js (only 5 files)
# - Remember to run restore-dev.sh when done testing
#
# Usage: ./dev-cache-bust.sh
# ============================================================================

echo "🔧 Development Cache Busting"
echo "============================"
echo ""

# ============================================================================
# STEP 1: Restore Previous State (if backup exists)
# ============================================================================
# If there's an existing backup, restore it first to ensure clean state
# before applying new cache busting parameters
# Check if we have a backup to restore from
if test -f index.html.backup
    echo "🔄 Restoring original index.html from previous run..."
    mv index.html.backup index.html
    echo "✅ Previous state restored"
    echo ""
end

# ============================================================================
# STEP 2: Apply Fresh Cache Busting
# ============================================================================
# Run cache-bust.sh to apply new version hashes to all files
# This includes:
# - HTML <link> and <script> tags (5 files)
# - ES6 module imports in JavaScript (23+ files)
# - Total: 28 files with complete import chain coverage
# Run cache busting
echo "🚀 Applying new cache bust versions..."
./cache-bust.sh

# ============================================================================
# STEP 3: Display Usage Instructions
# ============================================================================
echo ""
echo "🎉 Development cache busting complete!"
echo "🌐 Refresh your browser to see changes"
echo ""
echo "📊 Coverage Applied:"
echo "  ✅ 2 CSS files (style.css, mobile.css)"
echo "  ✅ 2 External libraries (userbase.js, UserbaseConnectionFix.js)"
echo "  ✅ 1 Application entry (app.js)"
echo "  ✅ 6 Core ES6 modules"
echo "  ✅ 5 UI components"
echo "  ✅ 7 Business logic modules"
echo "  ✅ 3 Utility modules"
echo "  ✅ 1 Configuration file"
echo "  � Total: 28 files with cache parameters"
echo ""
echo "�💡 Tips:"
echo "  • Run this script after making CSS/JS changes"
echo "  • Use './restore-dev.sh' when done testing"
echo "  • For production: Use './production_zip.sh' instead"
echo "  • Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)"
echo ""
echo "⚠️  Remember: Run restore-dev.sh before committing to git!"
echo "   (Cache-busted files should NOT be committed)"

# ============================================================================
# Development Cache Busting Complete
# ============================================================================
# Browser will now download fresh versions of all files
# Version parameters are based on file modification time + size
# Remember to restore dev environment before git commits
# ============================================================================
