import tailwindcssAnimate from 'tailwindcss-animate'

/**
 * Athar design tokens (web/design-system/tailwind.tokens.js merged here; values from DESIGN-SYSTEM.md) with the owner's
 * palette decision (08 section 16): blue primary, yellow accent/CTA, black secondary. Semantic colours are CSS variables
 * (src/styles/index.css) so components never carry hex values. Dark mode stays off (no dark mode on the site).
 *
 * Deviations from tailwind.tokens.js, on purpose:
 *  - the breakpoints keep Tailwind's defaults (sm 640 / md 768 / lg 1024): every layout in src/ was built on them;
 *  - the base type scale keeps Tailwind's (14/16/18...) for the dense staff UI; the site sizes are the named aliases
 *    (`text-hero`, `text-page-title`, `text-section-title`, `text-card-title`, `text-stat`, `text-nav`, `text-md`).
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: { DEFAULT: 'hsl(var(--input))', bg: 'hsl(var(--input-background))' },
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        body: 'hsl(var(--body-foreground))',
        surface: { DEFAULT: 'hsl(var(--surface))', 2: 'hsl(var(--surface-2))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        cta: { DEFAULT: 'hsl(var(--cta))', foreground: 'hsl(var(--cta-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))', text: 'hsl(var(--destructive-text))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        // raw site palette (literal hex, for the rare place a token does not fit)
        athar: {
          black: '#000000',
          yellow: '#ffe91e',
          'yellow-kit': '#ffe92c',
          slate: '#0f172a',
          ink: '#364151',
          blue: '#1a27c9',
          'blue-link': '#0b75d9',
          error: '#f56c6c',
          white: '#ffffff',
          grey: { 25: '#fafafa', 50: '#f8f8f8', 100: '#f2f2f2', 200: '#eaeaea', 300: '#dadbdd', 400: '#d1dae5', 500: '#868e96', 600: '#7a7a7a', 700: '#606266' },
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-sans)'],
        manrope: ['Manrope', 'Tajawal', 'sans-serif'],
        questrial: ['var(--font-sans-2)'],
        arabic: ['Tajawal', 'Manrope', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        md: ['17px', { lineHeight: '1.6' }],
        nav: ['17px', { lineHeight: '1' }],
        hero: ['clamp(42px, 6vw, 70px)', { lineHeight: '1.3', fontWeight: '800' }],
        'page-title': ['clamp(30px, 4vw, 45px)', { lineHeight: '1.1', fontWeight: '800' }],
        'section-title': ['clamp(26px, 3vw, 35px)', { lineHeight: '1.1', fontWeight: '800' }],
        'card-title': ['22px', { lineHeight: '1.4', fontWeight: '700' }],
        stat: ['42px', { lineHeight: '1', fontWeight: '700' }],
      },
      letterSpacing: { heading: '0.8px', display: '4px' },
      lineHeight: { body: '1.857', heading: '1.1' },
      borderRadius: {
        xs: '5px',
        sm: 'var(--radius-sm)',
        input: 'var(--radius-input)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        card: 'var(--radius-card)',
        xl: 'var(--radius-card)',
        '2xl': '20px',
      },
      boxShadow: {
        image: 'var(--shadow-image)',
        dropdown: 'var(--shadow-dropdown)',
        // legacy name used by earlier components: now the site's only elevation (dropdown depth)
        premium: 'var(--shadow-dropdown)',
      },
      spacing: {
        header: 'var(--header-height)',
        'logo-w': '150px',
        'logo-h': '50px',
        'panel-pad': '25px',
        'field-gap': '20px',
        'icon-gap': '15px',
        'section-xs': '25px',
        'section-sm': '50px',
        section: '100px',
      },
      maxWidth: { container: '1140px', 'container-wide': '1200px', 'container-narrow': '750px' },
      minHeight: { card: '400px', hero: '650px', 'hero-page': '400px', 'hero-band': '300px' },
      screens: { xs: '480px', header: '922px' },
      transitionDuration: { fast: '150ms', DEFAULT: '300ms', entrance: '1250ms' },
      scale: { hover: '1.05', 'hover-site': '1.1' },
      backgroundImage: {
        'overlay-card': 'linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7))',
        'overlay-hero': 'linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8))',
        'hero-pattern': "url('/brand/pattern.webp')",
      },
      keyframes: {
        fadeInUp: { from: { opacity: '0', transform: 'translate3d(0, 40px, 0)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in-up': 'fadeInUp 600ms ease both' },
    },
  },
  plugins: [tailwindcssAnimate],
}
