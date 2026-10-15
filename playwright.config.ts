import { defineConfig, devices } from '@playwright/test';

// Runs against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173/',
    launchOptions: process.env.CI ? {} : { executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run preview', url: 'http://localhost:4173/', reuseExistingServer: true },
});
