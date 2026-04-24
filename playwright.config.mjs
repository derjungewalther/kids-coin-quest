import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8765',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  // Spin up the static file server for tests. Reuses an already-running
  // instance on port 8765 if present (so `npm run serve` works too).
  webServer: {
    command: 'python3 -m http.server 8765',
    url: 'http://localhost:8765/index.html',
    reuseExistingServer: true,
    timeout: 10_000
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
