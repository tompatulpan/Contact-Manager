#!/usr/bin/env node

/**
 * Cache Busting Script
 * Generates version parameters for CSS and JS files to prevent browser caching issues
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CacheBuster {
    constructor() {
        this.indexPath = path.join(__dirname, 'index.html');
        this.versions = new Map();
        this.timestamp = Date.now();
    }

    /**
     * Generate version hash for a file based on its content
     */
    generateFileVersion(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                console.warn(`⚠️  File not found: ${filePath}`);
                return this.timestamp.toString();
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const hash = crypto.createHash('md5').update(content).digest('hex');
            return hash.substring(0, 8); // Use first 8 characters
        } catch (error) {
            console.warn(`⚠️  Error reading ${filePath}:`, error.message);
            return this.timestamp.toString();
        }
    }

    /**
     * Get all files that need cache busting
     */
    getFilesToBust() {
        return [
            { file: 'style.css', type: 'css' },
            { file: 'mobile.css', type: 'css' },
            { file: 'src/app.js', type: 'js' },
            { file: 'src/utils/UserbaseConnectionFix.js', type: 'js' },
            { file: 'lib/userbase.js', type: 'js' },
        ];
    }

    /**
     * Generate versions for all files
     */
    generateVersions() {
        const filesToBust = this.getFilesToBust();
        
        console.log('🔄 Generating cache bust versions...\n');
        
        filesToBust.forEach(({ file, type }) => {
            const filePath = path.join(__dirname, file);
            const version = this.generateFileVersion(filePath);
            this.versions.set(file, version);
            console.log(`  📄 ${file} → v${version}`);
        });
        
        console.log();
    }

    /**
     * Update index.html with version parameters
     */
    updateIndexHtml() {
        let content = fs.readFileSync(this.indexPath, 'utf8');
        
        console.log('📝 Updating index.html with cache bust parameters...\n');
        
        // Update CSS files
        const cssFiles = [
            { file: 'style.css', pattern: /<link rel="stylesheet" href="style\.css"[^>]*>/ },
            { file: 'mobile.css', pattern: /<link rel="stylesheet" href="mobile\.css"[^>]*>/ }
        ];
        
        cssFiles.forEach(({ file, pattern }) => {
            const version = this.versions.get(file);
            const newLink = `<link rel="stylesheet" href="${file}?v=${version}">`;
            
            if (pattern.test(content)) {
                content = content.replace(pattern, newLink);
                console.log(`  ✅ Updated ${file} → ?v=${version}`);
            }
        });

        // Update JavaScript files
        const jsFiles = [
            { 
                file: 'lib/userbase.js', 
                pattern: /<script src="lib\/userbase\.js"[^>]*><\/script>/ 
            },
            { 
                file: 'src/utils/UserbaseConnectionFix.js', 
                pattern: /<script src="src\/utils\/UserbaseConnectionFix\.js"[^>]*><\/script>/ 
            },
            { 
                file: 'src/app.js', 
                pattern: /<script type="module" src="src\/app\.js"[^>]*><\/script>/ 
            }
        ];
        
        jsFiles.forEach(({ file, pattern }) => {
            const version = this.versions.get(file);
            let newScript;
            
            if (file === 'src/app.js') {
                newScript = `<script type="module" src="${file}?v=${version}"></script>`;
            } else {
                newScript = `<script src="${file}?v=${version}"></script>`;
            }
            
            if (pattern.test(content)) {
                content = content.replace(pattern, newScript);
                console.log(`  ✅ Updated ${file} → ?v=${version}`);
            }
        });

        // Write updated content
        fs.writeFileSync(this.indexPath, content, 'utf8');
        console.log('\n🎉 Cache busting complete!\n');
    }

    /**
     * Generate versions report
     */
    generateVersionsReport() {
        const reportPath = path.join(__dirname, 'cache-versions.json');
        const report = {
            timestamp: new Date().toISOString(),
            buildNumber: this.timestamp,
            versions: Object.fromEntries(this.versions)
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`📊 Versions report saved to: cache-versions.json`);
        
        return report;
    }

    /**
     * Main execution method
     */
    run() {
        console.log('🚀 Contact Management System - Cache Buster\n');
        console.log('=' .repeat(50));
        
        this.generateVersions();
        this.updateIndexHtml();
        const report = this.generateVersionsReport();
        
        console.log('=' .repeat(50));
        console.log(`📈 Build: ${report.buildNumber}`);
        console.log(`🕒 Time: ${report.timestamp}`);
        console.log(`📁 Files: ${this.versions.size} updated`);
        console.log('✨ Ready for deployment!');
    }
}

// Run if called directly
if (require.main === module) {
    try {
        const cacheBuster = new CacheBuster();
        cacheBuster.run();
    } catch (error) {
        console.error('❌ Cache busting failed:', error.message);
        process.exit(1);
    }
}

module.exports = CacheBuster;