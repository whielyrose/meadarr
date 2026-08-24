/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep, moody surface palette
        surface: {
          950: '#0a0b10',   // page background (deeper)
          900: '#0f1117',
          800: '#171a24',   // card
          700: '#212533',   // elevated / border
          600: '#2c3145',   // hover
        },
        accent: {
          50:  '#f0eeff',
          100: '#e4e0ff',
          200: '#c4bfff',
          300: '#a89dff',
          400: '#8b7cff',
          500: '#6d63ff',   // primary
          600: '#5548e0',
          700: '#4038b8',
          800: '#2e2990',
          900: '#1f1c6b',
        },
        muted: {
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'wave':         'wave 1.2s ease-in-out infinite',
        'wave-delay-1': 'wave 1.2s ease-in-out 0.1s infinite',
        'wave-delay-2': 'wave 1.2s ease-in-out 0.2s infinite',
        'wave-delay-3': 'wave 1.2s ease-in-out 0.3s infinite',
        'wave-delay-4': 'wave 1.2s ease-in-out 0.4s infinite',
        'fade-in':      'fadeIn 0.15s ease-out',
        'slide-in':     'slideIn 0.2s ease-out',
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        wave: {
          '0%, 100%': { transform: 'scaleY(0.35)', opacity: '0.6' },
          '50%':      { transform: 'scaleY(1.0)',  opacity: '1.0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'glow': '0 0 24px -6px rgb(109 99 255 / 0.4)',
        'card': '0 1px 3px rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.2)',
      },
    },
  },
  plugins: [],
}
