/** @type {import('tailwindcss').Config} */
declare const _default: {
    darkMode: string;
    content: string[];
    theme: {
        extend: {
            colors: {
                bg: {
                    DEFAULT: string;
                    card: string;
                    border: string;
                    hover: string;
                };
                'dark-bg': {
                    DEFAULT: string;
                    card: string;
                    border: string;
                    hover: string;
                    elevated: string;
                };
                sidebar: {
                    DEFAULT: string;
                    border: string;
                    active: string;
                    'active-bg': string;
                    text: string;
                    'text-active': string;
                };
                accent: {
                    green: string;
                    'green-soft': string;
                    'green-glow': string;
                    red: string;
                    'red-soft': string;
                    'red-glow': string;
                    yellow: string;
                    'yellow-soft': string;
                    blue: string;
                    'blue-glow': string;
                    orange: string;
                    neon: string;
                };
                text: {
                    primary: string;
                    muted: string;
                    dim: string;
                };
                'dark-text': {
                    primary: string;
                    secondary: string;
                    muted: string;
                    dim: string;
                };
            };
            fontFamily: {
                sans: string[];
                mono: string[];
            };
            boxShadow: {
                'glow-green': string;
                'glow-red': string;
                'glow-blue': string;
                card: string;
                'card-hover': string;
            };
            backgroundImage: {
                'card-gradient': string;
                'header-gradient': string;
            };
            animation: {
                'fade-in': string;
                'slide-up': string;
                'pulse-slow': string;
                shimmer: string;
            };
            keyframes: {
                fadeIn: {
                    '0%': {
                        opacity: string;
                    };
                    '100%': {
                        opacity: string;
                    };
                };
                slideUp: {
                    '0%': {
                        opacity: string;
                        transform: string;
                    };
                    '100%': {
                        opacity: string;
                        transform: string;
                    };
                };
                shimmer: {
                    '0%': {
                        backgroundPosition: string;
                    };
                    '100%': {
                        backgroundPosition: string;
                    };
                };
            };
        };
    };
    plugins: never[];
};
export default _default;
