import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any static host path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
} as never);
