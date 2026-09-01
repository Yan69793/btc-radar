/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                bg: {
                    DEFAULT: '#f8fafc',
                    card: '#ffffff',
                    border: '#e2e8f0',
                    hover: '#f1f5f9',
                },
                'dark-bg': {
                    DEFAULT: '#0b1120', // fundo principal — mais escuro e azulado
                    card: '#131b2e', // cards — sutilmente mais claro que o fundo
                    border: '#1e2d4a', // bordas — azul escuro
                    hover: '#182032', // hover sutil
                    elevated: '#162032', // camada elevada (modais, dropdowns)
                },
                sidebar: {
                    DEFAULT: '#0d1525', // sidebar — ainda mais escura
                    border: '#16233e',
                    active: '#3b82f6',
                    'active-bg': 'rgba(59, 130, 246, 0.12)',
                    text: '#7c8aa5',
                    'text-active': '#e2e8f0',
                },
                accent: {
                    green: '#22c55e',
                    'green-soft': '#16a34a',
                    'green-glow': 'rgba(34, 197, 94, 0.25)',
                    red: '#ef4444',
                    'red-soft': '#dc2626',
                    'red-glow': 'rgba(239, 68, 68, 0.25)',
                    yellow: '#eab308',
                    'yellow-soft': '#ca8a04',
                    blue: '#3b82f6',
                    'blue-glow': 'rgba(59, 130, 246, 0.25)',
                    orange: '#f97316',
                    neon: '#00ff88',
                },
                text: {
                    primary: '#0f172a',
                    muted: '#475569',
                    dim: '#94a3b8',
                },
                'dark-text': {
                    primary: '#e8edf5',
                    secondary: '#b0bec5',
                    muted: '#7c8aa5',
                    dim: '#4a5568',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            boxShadow: {
                'glow-green': '0 0 20px rgba(34, 197, 94, 0.15), 0 0 40px rgba(34, 197, 94, 0.05)',
                'glow-red': '0 0 20px rgba(239, 68, 68, 0.15), 0 0 40px rgba(239, 68, 68, 0.05)',
                'glow-blue': '0 0 20px rgba(59, 130, 246, 0.15), 0 0 40px rgba(59, 130, 246, 0.05)',
                'card': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
                'card-hover': '0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3)',
            },
            backgroundImage: {
                'card-gradient': 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)',
                'header-gradient': 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(11, 17, 32, 0.98) 100%)',
            },
            animation: {
                'fade-in': 'fadeIn 0.4s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'pulse-slow': 'pulse 3s ease-in-out infinite',
                'shimmer': 'shimmer 2s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
            },
        },
    },
    plugins: [],
};
