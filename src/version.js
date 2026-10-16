/**
 * Application version and build information
 *
 * APP_VERSION: semantic version, bump manually on releases (keep in sync
 *              with "version" in package.json).
 * APP_BUILD:   replaced with "<git-sha>-<yyyymmdd>" by scripts/production_zip.sh
 *              when the production package is built. "dev" means the file is
 *              running straight from the working tree.
 */
export const APP_VERSION = '0.3.1';
export const APP_BUILD = 'dev';

/**
 * Human-readable version string for the footer badge
 */
export function versionLabel() {
    return `v${APP_VERSION} (${APP_BUILD})`;
}
