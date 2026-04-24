# Tests

Two test suites for **Kids Coin Quest**, both run via Playwright:

- `functional.spec.mjs` — unit-style tests that reach into `window` via
  `page.evaluate()` to call internal functions (XP math, stat breakdowns,
  class bonuses, treasure cap, voice ranking, PIN hashing, data migrations,
  and adventure gating).
- `e2e.spec.mjs` — real user-flow tests that click through the UI
  (recruit hero, complete quest, level-up toast, payout, donate, language
  toggle, hero sheet + rename, PIN setup/entry/lockout, Chronicle revoke,
  adventure intro → scene → dice → result, treasure cap on victory,
  Parent dashboard behind PIN, activity management).

## First-time setup

```bash
npm install
npx playwright install chromium
```

Playwright downloads a Chromium binary (~170MB) the first time.

## Running

```bash
# All tests (spins up python3 -m http.server 8765 automatically)
npm test

# Just the functional suite
npm run test:functional

# Just the E2E suite
npm run test:e2e

# Watch a run in a visible Chromium window
npm run test:headed

# Open the last HTML report
npm run test:report
```

## Fixtures

`fixtures.mjs` exports a `test` fixture that:

1. Clears `localStorage` before each test via `addInitScript`
2. Navigates to `/index.html`
3. Waits for the app to finish wiring (checks `window.effectiveStats`)

It also provides two helpers:

- `seedHero(page, { class, userName, balance, xp, ... })` — injects a hero
  directly into state (fast; skips the recruit modal)
- `setPin(page, '1234')` — hashes and stores a parent PIN directly

## Notes

- Tests start every run with fresh state. No cross-test contamination.
- Playwright runs its own Python http server via `webServer` in
  `playwright.config.mjs`. If port 8765 is already in use it reuses that.
- `webServer.reuseExistingServer: true` lets you keep the dev server running
  between test runs for faster iteration (`npm run serve` in another terminal).
- All tests target Chromium for speed. Add Firefox / WebKit in
  `playwright.config.mjs` under `projects` if you want cross-browser coverage.
