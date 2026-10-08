import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `pnpm --filter @tailwatch/web dev` (port 5173) talks to the API on 8788 through this proxy, so the
// session cookie stays same-origin. In production the API serves the built files itself (pnpm app).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: false } } },
});
