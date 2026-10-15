/**
 * Theme Manager
 * Handles colour theme selection (themes.css) and light/dark mode,
 * persists both to localStorage and keeps all toggles/pickers in sync.
 *
 *   <body data-theme="soft-slate" class="dark-mode">
 *
 * Themes are defined as CSS custom property sets in themes.css.
 */

const THEME_DEFINITIONS = [
    {
        id: 'classic-refined',
        name: 'Classic',
        description: 'The familiar blue, polished',
        swatch: { light: ['#f4f6fa', '#ffffff', '#2f6fed'], dark: ['#0e1119', '#161b26', '#5b8def'] }
    },
    {
        id: 'soft-slate',
        name: 'Soft Slate',
        description: 'Indigo accent, rounded and layered',
        swatch: { light: ['#eef0f6', '#ffffff', '#5b5bd6'], dark: ['#151722', '#232738', '#8b8bf0'] }
    },
    {
        id: 'warm-paper',
        name: 'Warm Paper',
        description: 'Warm neutrals with a teal accent',
        swatch: { light: ['#f3eee6', '#fffdfa', '#0f766e'], dark: ['#171412', '#262220', '#2dd4bf'] }
    },
    {
        id: 'nordic-frost',
        name: 'Nordic',
        description: 'Calm, desaturated Nord palette',
        swatch: { light: ['#e5e9f0', '#ffffff', '#5e81ac'], dark: ['#272c38', '#3b4252', '#88c0d0'] }
    },
    {
        id: 'high-contrast',
        name: 'Contrast',
        description: 'Accessibility-first black & white',
        swatch: { light: ['#ffffff', '#f3f4f6', '#047857'], dark: ['#000000', '#0a0a0a', '#34d399'] }
    },
    {
        id: 'aurora-glass',
        name: 'Aurora',
        description: 'Gradient backdrop, translucent panels',
        swatch: { light: ['#e6e4ff', '#ffffff', '#7c3aed'], dark: ['#2a2557', '#1c1830', '#a78bfa'] }
    }
];

class ThemeManager {
    constructor() {
        this.modeKey = 'contact-manager-theme';        // 'light' | 'dark' (legacy key kept)
        this.themeKey = 'contact-manager-color-theme'; // theme id
        this.defaultTheme = 'classic-refined';
        this.themes = THEME_DEFINITIONS;
        this.init();
    }

    init() {
        const savedMode = localStorage.getItem(this.modeKey);
        const savedTheme = localStorage.getItem(this.themeKey);

        this.applyTheme(this.isValidTheme(savedTheme) ? savedTheme : this.defaultTheme, false);

        if (savedMode === 'dark') {
            this.enableDarkMode(false);
        } else {
            this.enableLightMode(false);
        }

        this.setupToggleListeners();
        this.renderThemePicker();
    }

    /* ---------------- Light / dark mode ---------------- */

    setupToggleListeners() {
        const toggles = this.getToggleElements();

        if (toggles.length === 0) {
            // Retry after a short delay (Firefox might need this)
            setTimeout(() => this.setupToggleListeners(), 100);
            return;
        }

        toggles.forEach(toggleBtn => {
            if (toggleBtn.dataset.themeBound) return;
            toggleBtn.dataset.themeBound = 'true';

            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleTheme();
            }, false);

            toggleBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleTheme();
            }, false);

            toggleBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTheme();
                }
            }, false);
        });
    }

    getToggleElements() {
        const set = new Set(document.querySelectorAll('[data-theme-toggle]'));
        const headerToggle = document.getElementById('theme-toggle');
        if (headerToggle) set.add(headerToggle);
        return Array.from(set);
    }

    toggleTheme() {
        if (document.body.classList.contains('dark-mode')) {
            this.enableLightMode(true);
        } else {
            this.enableDarkMode(true);
        }
    }

    enableDarkMode(withTransition = true) {
        this.withTransition(withTransition, () => {
            document.body.classList.add('dark-mode');
            localStorage.setItem(this.modeKey, 'dark');
            this.updateToggleIcon('dark');
            this.updateMetaThemeColor();
            this.updatePickerSwatches();
        });
    }

    enableLightMode(withTransition = true) {
        this.withTransition(withTransition, () => {
            document.body.classList.remove('dark-mode');
            localStorage.setItem(this.modeKey, 'light');
            this.updateToggleIcon('light');
            this.updateMetaThemeColor();
            this.updatePickerSwatches();
        });
    }

    withTransition(enabled, apply) {
        if (enabled) document.body.classList.add('theme-transitioning');
        apply();
        if (enabled) {
            setTimeout(() => document.body.classList.remove('theme-transitioning'), 300);
        }
    }

    updateToggleIcon(mode) {
        document.querySelectorAll('.theme-toggle-icon').forEach(icon => {
            icon.classList.toggle('fa-sun', mode === 'dark');
            icon.classList.toggle('fa-moon', mode !== 'dark');
        });
    }

    getCurrentTheme() {
        return document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    }

    /* ---------------- Colour theme ---------------- */

    isValidTheme(id) {
        return !!id && this.themes.some(t => t.id === id);
    }

    getCurrentColorTheme() {
        return document.body.getAttribute('data-theme') || this.defaultTheme;
    }

    applyTheme(themeId, withTransition = true) {
        if (!this.isValidTheme(themeId)) return;

        this.withTransition(withTransition, () => {
            document.body.setAttribute('data-theme', themeId);
            localStorage.setItem(this.themeKey, themeId);
            this.updateMetaThemeColor();
            this.updatePickerSelection();
        });

        document.dispatchEvent(new CustomEvent('theme:changed', {
            detail: { theme: themeId, mode: this.getCurrentTheme() }
        }));
    }

    renderThemePicker() {
        const container = document.getElementById('theme-picker');
        if (!container) return;

        container.innerHTML = '';
        this.themes.forEach(theme => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theme-option';
            btn.dataset.themeId = theme.id;
            btn.title = theme.description;
            btn.setAttribute('role', 'radio');
            btn.innerHTML =
                '<span class="theme-swatch" aria-hidden="true"></span>' +
                '<span class="theme-option-label">' + theme.name + '</span>';
            btn.addEventListener('click', () => this.applyTheme(theme.id, true));
            container.appendChild(btn);
        });

        this.updatePickerSwatches();
        this.updatePickerSelection();
    }

    updatePickerSelection() {
        const current = this.getCurrentColorTheme();
        document.querySelectorAll('.theme-option').forEach(btn => {
            const active = btn.dataset.themeId === current;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    }

    // Swatches preview each theme in the *current* mode (light or dark)
    updatePickerSwatches() {
        const mode = this.getCurrentTheme();
        document.querySelectorAll('.theme-option').forEach(btn => {
            const theme = this.themes.find(t => t.id === btn.dataset.themeId);
            if (!theme) return;
            const [bg, surface, accent] = theme.swatch[mode];
            const swatch = btn.querySelector('.theme-swatch');
            swatch.style.setProperty('--swatch-bg', bg);
            swatch.style.setProperty('--swatch-surface', surface);
            swatch.style.setProperty('--swatch-accent', accent);
        });
    }

    // Keep the browser UI (mobile address bar) in step with the active surface colour
    updateMetaThemeColor() {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        const theme = this.themes.find(t => t.id === this.getCurrentColorTheme());
        if (!theme) return;
        meta.setAttribute('content', theme.swatch[this.getCurrentTheme()][1]);
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
