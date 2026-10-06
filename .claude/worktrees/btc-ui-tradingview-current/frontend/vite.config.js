import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    base: '/painel/',
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules'))
                        return;
                    const parts = id.split('node_modules')[1].split(/[\\/]/);
                    const pkg = parts[1].startsWith('@') ? parts[1] + '/' + parts[2] : parts[1];
                    if (!pkg)
                        return;
                    if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router' || pkg === 'react-router-dom') {
                        return 'vendor';
                    }
                    if (pkg === 'recharts' || pkg === 'victory-vendor' || /^d3-/.test(pkg)) {
                        return 'charts';
                    }
                },
            },
        },
    },
    server: {
        proxy: {
            "/api": { target: "http://localhost:8787", changeOrigin: true },
        }
    }
});
