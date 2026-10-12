#!/usr/bin/env node
// ============================================================================
// Cache Busting Script (Node.js Implementation)
// ============================================================================
// Purpose: Generates checksum-based version parameters for CSS/JS files
//
// NOTE: This is the Node.js implementation. The primary cache busting script
//       is cache-bust.sh (Fish shell), which provides more comprehensive
//       coverage including ES6 module imports.
//
// Features:
// - Checksum-based versioning (content-based, not time-based)
// - Updates index.html with version parameters
// - Creates cache-versions.json report
// - Standalone execution or module usage
//
// Limitations:
// ⚠️  Does NOT update ES6 module imports (import statements)
// ⚠️  Only updates index.html <script> and <link> tags
// ⚠️  Limited to 5 files (cache-bust.sh handles 28 files)
//
// Recommendation: Use cache-bust.sh for production builds
//                 Use this script for simple HTML-only updates
//
// NOTE: This is an ES module (package.json declares "type": "module").
//
// Usage:
//   node cache-bust.js              # Run directly
//   import CacheBuster from './cache-bust.js'; new CacheBuster().run();  # Module usage (ESM)
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// ES module replacement for the CommonJS __dirname global
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Helper: contentChecksum
// ============================================================================
// Deterministic, non-cryptographic checksum used ONLY for cache-busting
// version strings (a change detector, not a security primitive). Combines
// two independent 32-bit hashes (FNV-1a and djb2) into 16 hex characters —
// more entropy than the previous 8-character truncated hash.
// ============================================================================
function contentChecksum(content) {
    let fnv = 0x811c9dc5;   // FNV-1a 32-bit offset basis
    let djb2 = 5381;        // djb2 initial value
    for (let i = 0; i < content.length; i++) {
        const c = content.charCodeAt(i);
        fnv = Math.imul(fnv ^ c, 0x01000193);   // FNV-1a: xor then multiply by prime
        djb2 = (Math.imul(djb2, 33) + c) >>> 0; // djb2: hash * 33 + c
    }
    fnv >>>= 0;
    return fnv.toString(16).padStart(8, '0') + djb2.toString(16).padStart(8, '0');
}

// ============================================================================
// Class: CacheBuster
// ============================================================================
// Handles cache busting operations for HTML-embedded files only.
// For full ES6 module support, use cache-bust.sh instead.
// ============================================================================
class CacheBuster {
    constructor() {
        this.indexPath = path.join(__dirname, 'index.html');
        this.versions = new Map();
        this.timestamp = Date.now();
    }

    /**
     * Generate version string for a file based on its content
     * Uses a non-cryptographic checksum for deterministic versioning
     * (same content = same version)
     * 
     * @param {string} filePath - Path to file to hash
     * @returns {string} 16-character checksum or timestamp fallback
     */
    generateFileVersion(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                console.warn(`⚠️  File not found: ${filePath}`);
                return this.timestamp.toString();
            }

            const content = fs.readFileSync(filePath, 'utf8');
            return contentChecksum(content); // Compact deterministic version
        } catch (error) {
            console.warn(`⚠️  Error reading ${filePath}:`, error.message);
            return this.timestamp.toString();
        }
    }

    /**
     * Get all files that need cache busting
     * 
     * ⚠️ LIMITED COVERAGE: Only 5 files
     * For complete coverage (28 files + ES6 imports), use cache-bust.sh
     * 
     * @returns {Array} List of files to process
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
     * Iterates through files and creates checksum-based versions
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
     * 
     * ⚠️ LIMITATION: Only updates <link> and <script> tags in index.html
     * Does NOT update ES6 import statements inside JavaScript files
     * 
     * For full import chain updates, use cache-bust.sh which handles:
     * - All HTML tags (this script)
     * - ES6 module imports in app.js
     * - Nested module imports in all components
     * - 28 total files vs 5 files here
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
        console.log('\n🎉 Cache busting complete (HTML tags only)!\n');
        console.log('⚠️  NOTE: ES6 module imports NOT updated by this script');
        console.log('💡 For full cache busting, use: ./cache-bust.sh\n');
    }

    /**
     * Generate versions report
     * Creates cache-versions.json with build metadata
     * 
     * @returns {Object} Report object with timestamp, build number, and versions
     */
    generateVersionsReport() {
        const reportPath = path.join(__dirname, 'cache-versions.json');
        const report = {
            timestamp: new Date().toISOString(),
            buildNumber: this.timestamp,
            versions: Object.fromEntries(this.versions),
            note: 'Generated by cache-bust.js - HTML tags only. For full coverage, use cache-bust.sh'
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`📊 Versions report saved to: cache-versions.json`);
        
        return report;
    }

    /**
     * Main execution method
     * Runs the complete cache busting workflow
     */
    run() {
        console.log('🚀 Contact Management System - Cache Buster (Node.js)\n');
        console.log('=' .repeat(50));
        
        this.generateVersions();
        this.updateIndexHtml();
        const report = this.generateVersionsReport();
        
        console.log('=' .repeat(50));
        console.log(`📈 Build: ${report.buildNumber}`);
        console.log(`🕒 Time: ${report.timestamp}`);
        console.log(`📁 Files: ${this.versions.size} updated (HTML tags only)`);
        console.log('⚠️  ES6 imports: NOT updated');
        console.log('💡 Use cache-bust.sh for full coverage (28 files)');
        console.log('✨ Ready for deployment!');
    }
}

// ============================================================================
// Execution
// ============================================================================
// Run if executed directly (not when imported as a module)
const isDirectRun = process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
    try {
        const cacheBuster = new CacheBuster();
        cacheBuster.run();
    } catch (error) {
        console.error('❌ Cache busting failed:', error.message);
        process.exit(1);
    }
}

// ============================================================================
// Module Export
// ============================================================================
// Allow usage as a module for programmatic cache busting
// Example: import CacheBuster from './cache-bust.js';
//          const cb = new CacheBuster();
//          cb.run();
export default CacheBuster;