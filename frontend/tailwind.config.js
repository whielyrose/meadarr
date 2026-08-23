/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy honey (kept for any remaining references)
        honey: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        // New Meadarr design system
        surface: {
          50:  '#f8f8ff',
          900: '#0f1117',   // page background
          800: '#1a1d27',   // card background
          700: '#242838',   // elevated surface / border
          600: '#2e3347',   // hover states
        },
        accent: {
          50:  '#f0eeff',
          100: '#e4e0ff',
          200: '#c4bfff',   // light text on dark
          300: '#a89dff',
          400: '#8b7cff',
          500: '#6d63ff',   // primary accent
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
        'wave': 'wave 1.2s ease-in-out infinite',
        'wave-delay-1': 'wave 1.2s ease-in-out 0.1s infinite',
        'wave-delay-2': 'wave 1.2s ease-in-out 0.2s infinite',
        'wave-delay-3': 'wave 1.2s ease-in-out 0.3s infinite',
        'wave-delay-4': 'wave 1.2s ease-in-out 0.4s infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        wave: {
          '0%, 100%': { transform: 'scaleY(0.4)', opacity: '0.5' },
          '50%':       { transform: 'scaleY(1.0)', opacity: '1.0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
