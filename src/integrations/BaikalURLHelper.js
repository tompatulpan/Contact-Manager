/**
 * Baikal URL Helper
 * Helps users configure correct server URLs and addressbook paths
 */
export class BaikalURLHelper {
    /**
     * Parse a full Baikal URL into server URL and addressbook path
     * @param {string} fullUrl - Full URL like https://dav.xroad.se/dav.php/addressbooks/test/default/
     * @returns {Object} Parsed URL components
     */
    static parseFullURL(fullUrl) {
        try {
            const url = new URL(fullUrl);
            
            // Extract base server URL (protocol + host + port)
            const serverBase = `${url.protocol}//${url.host}`;
            
            // Extract path components
            const pathParts = url.pathname.split('/').filter(part => part.length > 0);
            
            // Common patterns for Baikal URLs
            const patterns = [
                // Baikal: https://domain.com/dav.php/addressbooks/username/default/
                {
                    pattern: /^(.+\/dav\.php)\/addressbooks\/([^\/]+)\/([^\/]+)\/?$/,
                    description: 'Baikal with dav.php',
                    extract: (pathname) => {
                        const match = pathname.match(/^(.+\/dav\.php)\/addressbooks\/([^\/]+)\/([^\/]+)\/?$/);
                        if (match) {
                            return {
                                serverPath: match[1],
                                username: match[2],
                                addressbook: match[3],
                                addressbookPath: `addressbooks/${match[2]}/${match[3]}/`
                            };
                        }
                        return null;
                    }
                },
                
                // NextCloud: https://domain.com/remote.php/dav/addressbooks/users/username/default/
                {
                    pattern: /^(.+\/remote\.php\/dav)\/addressbooks\/users\/([^\/]+)\/([^\/]+)\/?$/,
                    description: 'NextCloud',
                    extract: (pathname) => {
                        const match = pathname.match(/^(.+\/remote\.php\/dav)\/addressbooks\/users\/([^\/]+)\/([^\/]+)\/?$/);
                        if (match) {
                            return {
                                serverPath: match[1],
                                username: match[2],
                                addressbook: match[3],
                                addressbookPath: `addressbooks/users/${match[2]}/${match[3]}/`
                            };
                        }
                        return null;
                    }
                },
                
                // Generic CardDAV: https://domain.com/carddav/addressbooks/username/default/
                {
                    pattern: /^(.+)\/addressbooks\/([^\/]+)\/([^\/]+)\/?$/,
                    description: 'Generic CardDAV',
                    extract: (pathname) => {
                        const match = pathname.match(/^(.+)\/addressbooks\/([^\/]+)\/([^\/]+)\/?$/);
                        if (match) {
                            return {
                                serverPath: match[1],
                                username: match[2],
                                addressbook: match[3],
                                addressbookPath: `addressbooks/${match[2]}/${match[3]}/`
                            };
                        }
                        return null;
                    }
                }
            ];
            
            // Try each pattern
            for (const { pattern, description, extract } of patterns) {
                const extracted = extract(url.pathname);
                if (extracted) {
                    return {
                        success: true,
                        type: description,
                        fullUrl,
                        serverUrl: `${serverBase}${extracted.serverPath}/`,
                        username: extracted.username,
                        addressbook: extracted.addressbook,
                        addressbookPath: extracted.addressbookPath,
                        recommendation: {
                            serverUrl: `${serverBase}${extracted.serverPath}/`,
                            addressbookPath: extracted.addressbookPath,
                            note: `Configure your connection with Server URL: "${serverBase}${extracted.serverPath}/" and let the bridge discover the addressbook path automatically.`
                        }
                    };
                }
            }
            
            // If no pattern matches, provide general guidance
            return {
                success: false,
                error: 'URL pattern not recognized',
                fullUrl,
                serverUrl: serverBase,
                guidance: {
                    possibleServerUrl: serverBase,
                    suggestions: [
                        'Try removing the addressbook-specific path from your URL',
                        'Use only the base server URL (e.g., https://domain.com/dav.php/)',
                        'Let the bridge auto-discover the addressbook path',
                        'Check your CardDAV server documentation for the correct base URL'
                    ]
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: `Invalid URL: ${error.message}`,
                fullUrl
            };
        }
    }
    
    /**
     * Validate a server URL for CardDAV compatibility
     * @param {string} serverUrl - Base server URL
     * @returns {Object} Validation result
     */
    static validateServerURL(serverUrl) {
        try {
            const url = new URL(serverUrl);
            
            const issues = [];
            const recommendations = [];
            
            // Check protocol
            if (url.protocol !== 'https:') {
                issues.push('URL should use HTTPS for security');
                recommendations.push('Change http:// to https://');
            }
            
            // Check for common CardDAV endpoints
            const commonEndpoints = [
                '/dav.php/',           // Baikal
                '/remote.php/dav/',    // NextCloud/ownCloud
                '/carddav/',           // Generic
                '/dav/',               // SabreDAV
                '/.well-known/carddav' // Well-known endpoint
            ];
            
            const hasKnownEndpoint = commonEndpoints.some(endpoint => 
                url.pathname.includes(endpoint.replace('/', ''))
            );
            
            if (!hasKnownEndpoint) {
                recommendations.push('URL should point to a CardDAV endpoint (e.g., /dav.php/, /remote.php/dav/)');
            }
            
            return {
                isValid: issues.length === 0,
                issues,
                recommendations,
                url: serverUrl,
                parsedUrl: {
                    protocol: url.protocol,
                    host: url.host,
                    pathname: url.pathname
                }
            };
            
        } catch (error) {
            return {
                isValid: false,
                issues: [`Invalid URL format: ${error.message}`],
                recommendations: ['Ensure URL includes protocol (https://) and valid domain']
            };
        }
    }
    
    /**
     * Generate suggested configurations based on common CardDAV servers
     * @param {string} domain - Domain name (e.g., 'example.com')
     * @param {string} username - Username
     * @returns {Array} Array of suggested configurations
     */
    static generateSuggestions(domain, username = 'username') {
        const suggestions = [
            {
                name: 'Baikal',
                serverUrl: `https://${domain}/dav.php/`,
                description: 'Baikal CardDAV server',
                addressbookPath: 'Let bridge auto-discover',
                example: `https://${domain}/dav.php/addressbooks/${username}/default/`
            },
            {
                name: 'NextCloud',
                serverUrl: `https://${domain}/remote.php/dav/`,
                description: 'NextCloud CardDAV',
                addressbookPath: 'Let bridge auto-discover',
                example: `https://${domain}/remote.php/dav/addressbooks/users/${username}/contacts/`
            },
            {
                name: 'ownCloud',
                serverUrl: `https://${domain}/remote.php/carddav/`,
                description: 'ownCloud CardDAV',
                addressbookPath: 'Let bridge auto-discover',
                example: `https://${domain}/remote.php/carddav/addressbooks/${username}/contacts/`
            },
            {
                name: 'SabreDAV',
                serverUrl: `https://${domain}/dav/`,
                description: 'SabreDAV CardDAV server',
                addressbookPath: 'Let bridge auto-discover',
                example: `https://${domain}/dav/addressbooks/${username}/default/`
            },
            {
                name: 'Generic CardDAV',
                serverUrl: `https://${domain}/carddav/`,
                description: 'Generic CardDAV endpoint',
                addressbookPath: 'Let bridge auto-discover',
                example: `https://${domain}/carddav/addressbooks/${username}/contacts/`
            }
        ];
        
        return suggestions;
    }
    
    /**
     * Fix common URL mistakes
     * @param {string} inputUrl - User's input URL
     * @returns {Object} Fixed URL and explanation
     */
    static fixCommonMistakes(inputUrl) {
        let fixedUrl = inputUrl.trim();
        const fixes = [];
        
        // Add protocol if missing
        if (!fixedUrl.match(/^https?:\/\//)) {
            fixedUrl = 'https://' + fixedUrl;
            fixes.push('Added HTTPS protocol');
        }
        
        // Remove trailing addressbook-specific paths
        const addressbookPatterns = [
            /\/addressbooks\/[^\/]+\/[^\/]+\/?$/,  // Remove /addressbooks/user/default/
            /\/contacts\/?$/,                       // Remove /contacts
            /\/default\/?$/                         // Remove /default
        ];
        
        for (const pattern of addressbookPatterns) {
            if (pattern.test(fixedUrl)) {
                fixedUrl = fixedUrl.replace(pattern, '/');
                fixes.push('Removed addressbook-specific path (will be auto-discovered)');
                break;
            }
        }
        
        // Ensure trailing slash for server URLs
        if (!fixedUrl.endsWith('/') && !fixedUrl.includes('?')) {
            fixedUrl += '/';
            fixes.push('Added trailing slash');
        }
        
        return {
            originalUrl: inputUrl,
            fixedUrl,
            fixes,
            wasFixed: fixes.length > 0
        };
    }
}