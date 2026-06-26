import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pure client-side SPA (Option A in the PRD): banking files never leave the browser.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
