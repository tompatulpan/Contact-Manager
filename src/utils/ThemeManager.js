/**
 * Theme Manager - Dark Mode Toggle
 * Handles theme switching and persistence
 */

class ThemeManager {
    constructor() {
        this.themeKey = 'contact-manager-theme';
        this.init();
    }

    init() {
        // Load saved theme preference
        const savedTheme = localStorage.getItem(this.themeKey);
        
        if (savedTheme === 'dark') {
            this.enableDarkMode(false); // false = no transition on load
        } else {
            this.enableLightMode(false);
        }

        // Setup toggle button listener with retry for Firefox compatibility
        this.setupToggleListener();
    }

    setupToggleListener() {
        const toggleBtn = document.getElementById('theme-toggle');
        
        if (toggleBtn) {
            // Click event (primary - works in all browsers)
            toggleBtn.addEventListener('click', (e) => {
                console.log('🔄 Click event fired');
                e.preventDefault();
                e.stopPropagation();
                this.toggleTheme();
            }, false);
            
            // Touch event (mobile devices)
            toggleBtn.addEventListener('touchend', (e) => {
                console.log('🔄 Touch event fired');
                e.preventDefault();
                e.stopPropagation();
                this.toggleTheme();
            }, false);
            
            // Keyboard event (accessibility - Enter or Space)
            toggleBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    console.log('🔄 Keyboard event fired');
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTheme();
                }
            }, false);
            
            console.log('✅ Theme toggle listener attached successfully');
            console.log('Toggle element:', toggleBtn);
            console.log('Has role="button":', toggleBtn.getAttribute('role') === 'button');
        } else {
            console.warn('⚠️ Theme toggle button not found, retrying...');
            // Retry after a short delay (Firefox might need this)
            setTimeout(() => {
                this.setupToggleListener();
            }, 100);
        }
    }

    toggleTheme() {
        const isDarkMode = document.body.classList.contains('dark-mode');
        
        if (isDarkMode) {
            this.enableLightMode(true);
        } else {
            this.enableDarkMode(true);
        }
    }

    enableDarkMode(withTransition = true) {
        if (withTransition) {
            document.body.classList.add('theme-transitioning');
        }

        document.body.classList.add('dark-mode');
        localStorage.setItem(this.themeKey, 'dark');
        
        // Update toggle icon
        this.updateToggleIcon('dark');

        if (withTransition) {
            setTimeout(() => {
                document.body.classList.remove('theme-transitioning');
            }, 300);
        }
    }

    enableLightMode(withTransition = true) {
        if (withTransition) {
            document.body.classList.add('theme-transitioning');
        }

        document.body.classList.remove('dark-mode');
        localStorage.setItem(this.themeKey, 'light');
        
        // Update toggle icon
        this.updateToggleIcon('light');

        if (withTransition) {
            setTimeout(() => {
                document.body.classList.remove('theme-transitioning');
            }, 300);
        }
    }

    updateToggleIcon(theme) {
        const icon = document.querySelector('.theme-toggle-icon');
        
        if (icon) {
            if (theme === 'dark') {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            } else {
                icon.classList.remove('fa-sun');
                icon.classList.add('fa-moon');
            }
        }
    }

    getCurrentTheme() {
        return document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    }
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.themeManager = new ThemeManager();
    });
} else {
    window.themeManager = new ThemeManager();
}
