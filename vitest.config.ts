import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Renderer unit tests only (jsdom). Kept separate from the forge/vite
// build configs so `vitest run` never touches Electron entry points.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
