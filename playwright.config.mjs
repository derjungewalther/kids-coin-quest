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
    video: 'retain-on-failure',
    // Skip motion-based delays (dice spin, hero transitions) so tests
    // resolve instantly. The app honours prefers-reduced-motion.
    reducedMotion: 'reduce'
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
    // Chromium runs the full suite — logic + visual + smoke + R3 specs.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox + WebKit only run the visual.spec — they exist to catch
    // browser-specific layout regressions (font metrics, gradient
    // rendering, flex/grid quirks). Running every logic test in 3
    // browsers triples runtime without catching new issues; visual
    // diffs are where cross-browser drift actually shows up.
    {
      name: 'firefox',
      testMatch: /visual\.spec\.mjs/,
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testMatch: /visual\.spec\.mjs/,
      use: { ...devices['Desktop Safari'] }
    }
  ]
});
