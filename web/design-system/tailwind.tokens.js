/**
 * Tailwind `theme.extend` fragment derived from https://www.athareg.com/ (extracted 2026-10-12).
 * NOT merged. To apply: `import { atharTheme } from './design-system/tailwind.tokens.js'` and spread it into
 * `theme.extend` of web/tailwind.config.js, and load design-system/tokens.css (or copy its :root block into
 * web/src/styles/index.css). Semantic colours keep the existing `hsl(var(--x))` indirection so components do not change.
 */
export const atharTheme = {
  colors: {
    // semantic (CSS variables from tokens.css)
    border: 'hsl(var(--border))',
    input: 'hsl(var(--input))',
    ring: 'hsl(var(--ring))',
    background: 'hsl(var(--background))',
    foreground: 'hsl(var(--foreground))',
    surface: { DEFAULT: 'hsl(var(--surface))', 2: 'hsl(var(--surface-2))' },
    primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
    secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
    accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
    muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
    destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
    success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
    warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
    info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
    card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
    popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
    // raw brand palette (literal hex from the site)
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
      grey: {
        25: '#fafafa',
        50: '#f8f8f8',
        100: '#f2f2f2',
        200: '#eaeaea',
        300: '#dadbdd',
        400: '#d1dae5',
        500: '#868e96',
        600: '#7a7a7a',
        700: '#606266',
      },
    },
  },
  fontFamily: {
    display: ['"Hepta Slab"', 'Georgia', 'serif'],
    sans: ['Manrope', 'Tajawal', 'system-ui', 'sans-serif'],
    manrope: ['Manrope', 'sans-serif'],
    questrial: ['Questrial', 'Manrope', 'sans-serif'],
    arabic: ['Tajawal', 'Manrope', 'system-ui', 'sans-serif'],
    'arabic-display': ['Tajawal', '"Noto Kufi Arabic"', 'sans-serif'],
  },
  fontSize: {
    // [size, { lineHeight, letterSpacing, fontWeight }] — values measured on the site
    xs: ['12px', { lineHeight: '1.4' }],
    sm: ['16px', { lineHeight: '1.5' }],
    base: ['17px', { lineHeight: '1.857' }],
    md: ['18px', { lineHeight: '22px' }],
    lg: ['20px', { lineHeight: '1.5' }],
    xl: ['22px', { lineHeight: '1.5', letterSpacing: '0.8px' }],
    '2xl': ['30px', { lineHeight: '1', letterSpacing: '0.8px' }],
    '3xl': ['35px', { lineHeight: '1', letterSpacing: '0.8px' }],
    '4xl': ['40px', { lineHeight: '1.5', letterSpacing: '0.8px' }],
    '5xl': ['45px', { lineHeight: '1.5', letterSpacing: '0.8px' }],
    '6xl': ['55px', { lineHeight: '1', letterSpacing: '0.8px' }],
    '7xl': ['65px', { lineHeight: '1', letterSpacing: '0.8px' }],
    '8xl': ['70px', { lineHeight: '1.5', letterSpacing: '0.8px' }],
    '9xl': ['80px', { lineHeight: '1.2', letterSpacing: '4px' }],
    // app-oriented aliases
    'hero': ['clamp(42px, 6vw, 70px)', { lineHeight: '1.3', letterSpacing: '0.8px', fontWeight: '800' }],
    'page-title': ['clamp(30px, 4vw, 55px)', { lineHeight: '1.1', letterSpacing: '0.8px', fontWeight: '800' }],
    'section-title': ['clamp(30px, 3vw, 35px)', { lineHeight: '1.1', letterSpacing: '0.8px', fontWeight: '800' }],
    'card-title': ['22px', { lineHeight: '1.5', letterSpacing: '0.8px', fontWeight: '700' }],
    'stat': ['42px', { lineHeight: '1', letterSpacing: '0.8px', fontWeight: '700' }],
  },
  letterSpacing: {
    heading: '0.8px',
    display: '4px',
  },
  lineHeight: {
    body: '1.857',
  },
  borderRadius: {
    xs: '5px',
    sm: '6px',
    input: '7px',
    DEFAULT: '8px',
    md: '8px',
    lg: '8px',
    card: '15px',
    xl: '15px',
  },
  boxShadow: {
    image: '0 0 10px 0 rgba(0,0,0,0.2)',
    dropdown: '0 4px 10px -2px rgba(0,0,0,0.1)',
    // keep the existing name so current components still resolve; same value as dropdown-ish depth
    premium: '0 4px 10px -2px rgba(0,0,0,0.1)',
  },
  spacing: {
    gutter: '10px',
    header: '80px',
    'logo-w': '150px',
    'logo-h': '50px',
    'card-pad': '10px',
    'panel-pad': '25px',
    'field-gap': '20px',
    'icon-gap': '15px',
    'section-xs': '25px',
    'section-sm': '50px',
    section: '100px',
    'card-min': '400px',
    container: '1140px',
    'container-wide': '1200px',
    'container-narrow': '750px',
  },
  maxWidth: {
    container: '1140px',
    'container-wide': '1200px',
    'container-narrow': '750px',
  },
  minHeight: {
    card: '400px',
    hero: '650px',
    'hero-page': '400px',
  },
  screens: {
    xs: '480px',
    // site breakpoints (Elementor mobile 767 / tablet 1024, Astra header 921, wide 1201)
    sm: '768px',
    header: '922px',
    lg: '1025px',
    xl: '1201px',
    '2xl': '1440px',
  },
  transitionDuration: {
    fast: '150ms',
    DEFAULT: '300ms',
    entrance: '1250ms',
  },
  scale: {
    hover: '1.03',
    'hover-site': '1.1',
  },
  backgroundImage: {
    'overlay-card': 'linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7))',
    'overlay-hero': 'linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8))',
    'hero-pattern': "url('/design-system/raw/images/Pattern-Gray-very-small.png')",
  },
  keyframes: {
    fadeInUp: {
      from: { opacity: '0', transform: 'translate3d(0, 40px, 0)' },
      to: { opacity: '1', transform: 'none' },
    },
  },
  animation: {
    'fade-in-up': 'fadeInUp 600ms ease both',
  },
}

export default atharTheme
