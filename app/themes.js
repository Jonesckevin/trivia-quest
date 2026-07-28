// ==================== THEME SYSTEM ====================

const themes = {
    'dark-midnight-violet': {
        name: 'dark-midnight-violet',
        displayName: 'Dark Midnight Violet',
        colors: {
            background: 'oklch(0.15 0.04 280)',
            foreground: 'oklch(0.95 0.02 280)',
            card: 'oklch(0.20 0.05 280)',
            cardForeground: 'oklch(0.95 0.02 280)',
            popover: 'oklch(0.18 0.05 280)',
            popoverForeground: 'oklch(0.95 0.02 280)',
            primary: 'oklch(0.55 0.25 285)',
            primaryForeground: 'oklch(0.98 0.01 280)',
            secondary: 'oklch(0.25 0.05 280)',
            secondaryForeground: 'oklch(0.95 0.02 280)',
            muted: 'oklch(0.22 0.04 280)',
            mutedForeground: 'oklch(0.60 0.03 280)',
            accent: 'oklch(0.65 0.28 290)',
            accentForeground: 'oklch(0.98 0.01 280)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 280)',
            border: 'oklch(0.30 0.05 280)',
            input: 'oklch(0.30 0.05 280)',
            ring: 'oklch(0.55 0.25 285)',
        },
    },
    'electric-blue': {
        name: 'electric-blue',
        displayName: 'Electric Blue',
        colors: {
            background: 'oklch(0.14 0.03 250)',
            foreground: 'oklch(0.93 0.02 250)',
            card: 'oklch(0.19 0.04 250)',
            cardForeground: 'oklch(0.93 0.02 250)',
            popover: 'oklch(0.17 0.04 250)',
            popoverForeground: 'oklch(0.93 0.02 250)',
            primary: 'oklch(0.55 0.24 250)',
            primaryForeground: 'oklch(0.98 0.01 250)',
            secondary: 'oklch(0.24 0.04 250)',
            secondaryForeground: 'oklch(0.93 0.02 250)',
            muted: 'oklch(0.21 0.03 250)',
            mutedForeground: 'oklch(0.58 0.03 250)',
            accent: 'oklch(0.65 0.22 250)',
            accentForeground: 'oklch(0.98 0.01 250)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 250)',
            border: 'oklch(0.30 0.05 250)',
            input: 'oklch(0.30 0.05 250)',
            ring: 'oklch(0.55 0.24 250)',
        },
    },
    'sunset-orange': {
        name: 'sunset-orange',
        displayName: 'Sunset Orange',
        colors: {
            background: 'oklch(0.15 0.04 40)',
            foreground: 'oklch(0.94 0.02 40)',
            card: 'oklch(0.20 0.05 40)',
            cardForeground: 'oklch(0.94 0.02 40)',
            popover: 'oklch(0.18 0.05 40)',
            popoverForeground: 'oklch(0.94 0.02 40)',
            primary: 'oklch(0.58 0.22 35)',
            primaryForeground: 'oklch(0.98 0.01 40)',
            secondary: 'oklch(0.26 0.05 40)',
            secondaryForeground: 'oklch(0.94 0.02 40)',
            muted: 'oklch(0.23 0.04 40)',
            mutedForeground: 'oklch(0.58 0.03 40)',
            accent: 'oklch(0.68 0.25 55)',
            accentForeground: 'oklch(0.98 0.01 40)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 40)',
            border: 'oklch(0.32 0.05 40)',
            input: 'oklch(0.32 0.05 40)',
            ring: 'oklch(0.58 0.22 35)',
        },
    },
    'forest-green': {
        name: 'forest-green',
        displayName: 'Forest Green',
        colors: {
            background: 'oklch(0.14 0.03 150)',
            foreground: 'oklch(0.93 0.02 150)',
            card: 'oklch(0.19 0.04 150)',
            cardForeground: 'oklch(0.93 0.02 150)',
            popover: 'oklch(0.17 0.04 150)',
            popoverForeground: 'oklch(0.93 0.02 150)',
            primary: 'oklch(0.50 0.20 155)',
            primaryForeground: 'oklch(0.98 0.01 150)',
            secondary: 'oklch(0.24 0.04 150)',
            secondaryForeground: 'oklch(0.93 0.02 150)',
            muted: 'oklch(0.21 0.03 150)',
            mutedForeground: 'oklch(0.58 0.03 150)',
            accent: 'oklch(0.65 0.22 145)',
            accentForeground: 'oklch(0.98 0.01 150)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 150)',
            border: 'oklch(0.30 0.04 150)',
            input: 'oklch(0.30 0.04 150)',
            ring: 'oklch(0.50 0.20 155)',
        },
    },
    'crimson-red': {
        name: 'crimson-red',
        displayName: 'Crimson Red',
        colors: {
            background: 'oklch(0.16 0.04 20)',
            foreground: 'oklch(0.95 0.02 20)',
            card: 'oklch(0.22 0.05 20)',
            cardForeground: 'oklch(0.95 0.02 20)',
            popover: 'oklch(0.20 0.05 20)',
            popoverForeground: 'oklch(0.95 0.02 20)',
            primary: 'oklch(0.50 0.24 20)',
            primaryForeground: 'oklch(0.98 0.01 20)',
            secondary: 'oklch(0.28 0.05 20)',
            secondaryForeground: 'oklch(0.95 0.02 20)',
            muted: 'oklch(0.25 0.04 20)',
            mutedForeground: 'oklch(0.60 0.03 20)',
            accent: 'oklch(0.65 0.26 25)',
            accentForeground: 'oklch(0.98 0.01 20)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 20)',
            border: 'oklch(0.35 0.05 20)',
            input: 'oklch(0.35 0.05 20)',
            ring: 'oklch(0.50 0.24 20)',
        },
    },
    'ocean-teal': {
        name: 'ocean-teal',
        displayName: 'Ocean Teal',
        colors: {
            background: 'oklch(0.17 0.04 200)',
            foreground: 'oklch(0.95 0.02 200)',
            card: 'oklch(0.22 0.05 200)',
            cardForeground: 'oklch(0.95 0.02 200)',
            popover: 'oklch(0.20 0.05 200)',
            popoverForeground: 'oklch(0.95 0.02 200)',
            primary: 'oklch(0.52 0.20 195)',
            primaryForeground: 'oklch(0.98 0.01 200)',
            secondary: 'oklch(0.28 0.05 200)',
            secondaryForeground: 'oklch(0.95 0.02 200)',
            muted: 'oklch(0.25 0.04 200)',
            mutedForeground: 'oklch(0.60 0.03 200)',
            accent: 'oklch(0.68 0.24 190)',
            accentForeground: 'oklch(0.98 0.01 200)',
            destructive: 'oklch(0.55 0.22 25)',
            destructiveForeground: 'oklch(0.98 0.01 200)',
            border: 'oklch(0.32 0.05 200)',
            input: 'oklch(0.32 0.05 200)',
            ring: 'oklch(0.52 0.20 195)',
        },
    },
    'cyber-green': {
        name: 'cyber-green',
        displayName: 'Cyber',
        colors: {
            background: '#030603',
            foreground: '#c8f0c8',
            card: '#080f08',
            cardForeground: '#c8f0c8',
            popover: '#070e07',
            popoverForeground: '#c8f0c8',
            primary: '#00cc44',
            primaryForeground: '#000000',
            secondary: '#0d1a0d',
            secondaryForeground: '#88bb88',
            muted: '#0a140a',
            mutedForeground: '#557755',
            accent: '#00ff55',
            accentForeground: '#000000',
            destructive: '#cc2200',
            destructiveForeground: '#ffffff',
            border: '#003311',
            input: '#0d1a0d',
            ring: '#00cc44',
        },
    },
    'classic': {
        name: 'classic',
        displayName: 'Classic (Original)',
        colors: {
            background: '#0d0d1a',
            foreground: '#e2e8f0',
            card: 'rgba(26, 26, 46, 0.8)',
            cardForeground: '#e2e8f0',
            popover: '#1a1a2e',
            popoverForeground: '#e2e8f0',
            primary: '#8b5cf6',
            primaryForeground: '#e2e8f0',
            secondary: '#1a1a2e',
            secondaryForeground: '#e2e8f0',
            muted: '#16213e',
            mutedForeground: '#64748b',
            accent: '#a78bfa',
            accentForeground: '#e2e8f0',
            destructive: '#ef4444',
            destructiveForeground: '#e2e8f0',
            border: 'rgba(139, 92, 246, 0.2)',
            input: 'rgba(139, 92, 246, 0.2)',
            ring: '#8b5cf6',
        },
    },
};

const defaultTheme = 'classic';

/**
 * Apply a theme by setting CSS custom properties
 * @param {string} themeName - The name of the theme to apply
 */
function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) {
        console.warn(`Theme "${themeName}" not found, using default`);
        themeName = defaultTheme;
    }
    
    const actualTheme = themes[themeName];
    const root = document.documentElement;
    
    // Map theme colors to existing CSS variables
    const colorMap = {
        background: '--bg-primary',
        card: '--bg-card',
        secondary: '--bg-secondary',
        muted: '--bg-tertiary',
        primary: '--accent-primary',
        accent: '--accent-hover',
        ring: '--accent-active',
        foreground: '--text-primary',
        mutedForeground: '--text-secondary',
        border: '--border-color',
        destructive: '--error',
    };
    
    Object.entries(colorMap).forEach(([themeKey, cssVar]) => {
        if (actualTheme.colors[themeKey]) {
            root.style.setProperty(cssVar, actualTheme.colors[themeKey]);
        }
    });

    // Also set dark-theme alias variables used by quiz-mode / admin CSS
    const aliasMap = {
        background: '--background',
        foreground: '--foreground',
        card: '--card',
        primary: '--primary',
        primaryForeground: '--primary-foreground',
        secondary: '--secondary',
        secondaryForeground: '--secondary-foreground',
        muted: '--muted',
        mutedForeground: '--muted-foreground',
        accent: '--accent',
        accentForeground: '--accent-foreground',
        destructive: '--destructive',
        border: '--border',
        input: '--input',
    };
    Object.entries(aliasMap).forEach(([themeKey, cssVar]) => {
        if (actualTheme.colors[themeKey]) {
            root.style.setProperty(cssVar, actualTheme.colors[themeKey]);
        }
    });
    
    // Set accent glow based on primary color
    root.style.setProperty('--accent-glow', actualTheme.colors.primary.replace(')', ', 0.4)').replace('oklch(', 'oklch(').replace('#', 'rgba('));
    
    // For hex colors, create proper rgba glow
    if (actualTheme.colors.primary.startsWith('#')) {
        const hex = actualTheme.colors.primary;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.4)`);
        root.style.setProperty('--accent-subtle', `rgba(${r}, ${g}, ${b}, 0.1)`);
    }
    
    // Store in localStorage
    localStorage.setItem('trivia-quest-theme', themeName);

    // Apply body class for special themes (e.g., cyber scanline effect)
    document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
    document.body.classList.add(`theme-${themeName}`);
    
    // Update selector if exists
    updateThemeSelector(themeName);
}

/**
 * Get the current theme name from localStorage or return default
 * @returns {string} The current theme name
 */
function getCurrentTheme() {
    return localStorage.getItem('trivia-quest-theme') || defaultTheme;
}

/**
 * Update the theme selector UI to reflect current selection
 * @param {string} themeName - The currently active theme
 */
function updateThemeSelector(themeName) {
    const buttons = document.querySelectorAll('.theme-option');
    buttons.forEach(btn => {
        const isSelected = btn.dataset.theme === themeName;
        btn.classList.toggle('selected', isSelected);
        
        // Update checkmark visibility
        const checkmark = btn.querySelector('.theme-checkmark');
        if (checkmark) {
            checkmark.style.display = isSelected ? 'flex' : 'none';
        }
    });
}

/**
 * Render the theme selector UI
 */
function renderThemeSelector() {
    const container = document.getElementById('themeOptions');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.values(themes).forEach(theme => {
        const btn = document.createElement('button');
        btn.className = 'theme-option';
        btn.dataset.theme = theme.name;
        
        // Create color preview
        const preview = document.createElement('div');
        preview.className = 'theme-preview';
        preview.style.background = `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.accent} 100%)`;
        
        // Create label
        const label = document.createElement('span');
        label.className = 'theme-label';
        label.textContent = theme.displayName;
        
        // Create checkmark
        const checkmark = document.createElement('span');
        checkmark.className = 'theme-checkmark';
        checkmark.innerHTML = '✓';
        checkmark.style.display = 'none';
        
        btn.appendChild(preview);
        btn.appendChild(label);
        btn.appendChild(checkmark);
        
        btn.addEventListener('click', () => applyTheme(theme.name));
        
        container.appendChild(btn);
    });
    
    // Set initial selection
    updateThemeSelector(getCurrentTheme());
}

/**
 * Initialize the theme system
 */
function initThemes() {
    // Apply saved theme immediately
    applyTheme(getCurrentTheme());
    
    // Render theme selector
    renderThemeSelector();
}
