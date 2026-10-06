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
                    DEFAULT: '#08090a',
                    card: '#0f1011',
                    border: '#191a1b',
                    hover: '#191a1b',
                },
                'dark-bg': {
                    DEFAULT: '#08090a',      // canvas
                    card: '#0f1011',         // superfície de painel
                    border: '#23252a',       // borda sólida de separação
                    hover: '#191a1b',        // hover
                    elevated: '#191a1b',     // camada elevada (dropdown, modal)
                },
                sidebar: {
                    DEFAULT: '#0b0c0d',      // sidebar um degrau acima do canvas
                    border: '#1c1d20',
                    active: '#e8b33a',       // acento único da marca
                    'active-bg': 'rgba(232, 179, 58, 0.10)',
                    text: '#8a8f98',
                    'text-active': '#f7f8f8',
                },
                accent: {
                    green: '#3fb950',        // alta, dessaturado
                    'green-soft': '#2ea043',
                    'green-glow': 'rgba(63, 185, 80, 0.2)',
                    red: '#f85149',          // baixa, dessaturado
                    'red-soft': '#da3633',
                    'red-glow': 'rgba(248, 81, 73, 0.2)',
                    yellow: '#e8b33a',
                    'yellow-soft': '#ca8a04',
                    blue: '#e8b33a',         // acento único (nome legado)
                    'blue-glow': 'rgba(232, 179, 58, 0.2)',
                    orange: '#d29922',
                    neon: '#3fb950',
                },
                text: {
                    primary: '#f7f8f8',
                    muted: '#8a8f98',
                    dim: '#62666d',
                },
                'dark-text': {
                    primary: '#f7f8f8',
                    secondary: '#d0d6e0',
                    muted: '#8a8f98',
                    dim: '#62666d',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            borderRadius: {
                DEFAULT: '6px',
                md: '6px',
                lg: '8px',
                xl: '10px',
            },
            boxShadow: {
                // Elevação em dark não é sombra: é degrau de luminância.
                // Reservado para o que realmente flutua (dropdown, modal).
                'card': '0 1px 2px rgba(0, 0, 0, 0.4)',
                'card-hover': '0 2px 6px rgba(0, 0, 0, 0.5)',
                'pop': '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)',
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.18s ease-out',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(4px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
        },
    },
    plugins: [],
}
