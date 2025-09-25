#!/usr/bin/env fish

# Development Cache Busting Script
# Use this during development to force fresh files in the browser

echo "🔧 Development Cache Busting"
echo "============================"
echo ""

# Check if we have a backup to restore from
if test -f index.html.backup
    echo "🔄 Restoring original index.html..."
    mv index.html.backup index.html
    echo "✅ Original restored"
    echo ""
end

# Run cache busting
echo "🚀 Applying new cache bust versions..."
./cache-bust.sh

echo ""
echo "🎉 Development cache busting complete!"
echo "🌐 Refresh your browser to see changes"
echo ""
echo "💡 Tips:"
echo "  • Run this script after making CSS/JS changes"
echo "  • Now covers ALL JavaScript modules (13 files total)"
echo "  • Use './restore-dev.sh' to restore original files"
echo "  • Production deployment automatically includes cache busting"