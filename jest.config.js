/**
 * Jest configuration for ESM support.
 * Run with: node --experimental-vm-modules node_modules/.bin/jest
 */
export default {
    testEnvironment: 'node',
    // No transform needed — pure ESM (package.json "type":"module" handles .js)
    transform: {},
    // Only look in tests/icloud/ for iCloud sync tests
    testMatch: ['**/tests/icloud/**/*.test.js', '**/tests/dedup.test.js'],
    // Silence verbose console during tests (our tests assert on return values)
    silent: false,
    // Show each test name
    verbose: true,
};
