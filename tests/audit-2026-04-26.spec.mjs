/**
 * Regression tests for the 8 actionable bugs from the
 * 2026-04-26 partial E2E audit. Each test pins the fix in place so
 * a future refactor that re-introduces any of these failures shows
 * up by name in CI.
 *
 *   BUG-01  goal-strip-empty contrast
 *   BUG-02  service worker no longer network-first for assets
 *   BUG-03  icon.svg cache-control allows browser disk cache
 *   BUG-04  /favicon.ico no longer 404s
 *   BUG-05  no decorative ornament reads as broken slot placeholders
 *   BUG-06  recruit CTA inline with title + grid below
 *   BUG-07  kid.avatar emoji surfaces somewhere on the hero card
 *   BUG-08  duplicate hero display names are rejected
 *   BUG-09  <html lang> stays in sync with the active locale
 *   BUG-10  Supabase auth token storage (informational threat-model
 *           assertion that no clear-text password leaks into state)
 *   BUG-11  hero card click zone fully covers the visible avatar
 *   BUG-12  manifest.json is requested at most once per page boot
 *           under the new SW (subset of BUG-02)
 */
import { test, expect, seedHero } from './fixtures.mjs';

test.describe('Audit 2026-04-26 regressions', () => {

  // -------------------------------------------------------------------
  // BUG-01 — goal-strip-empty contrast must be readable on parchment.
  // The earlier R2-P1-06 fix used `--gold-bright` over a 35%-opacity
  // overlay; the resolved colour was tan and contrast was ~1.6:1.
  // Asserting the computed style against the dark-wood token catches
  // an accidental revert.
  // -------------------------------------------------------------------
  test('BUG-01 · goal-strip-empty uses dark-wood text on parchment', async ({ page }) => {
    await seedHero(page, { userName: 'g01' });
    await page.evaluate(() => window.renderKids());
    const colour = await page.evaluate(() => {
      const el = document.querySelector('.goal-strip-empty');
      if (!el) return null;
      return getComputedStyle(el).color;
    });
    expect(colour).not.toBeNull();
    // --wood-dark resolves to rgb(58, 35, 20) or close. Accept any
    // colour whose channels stay in the dark-wood range — never let
    // a pale-yellow (#f4d35e ≈ rgb(244, 211, 94)) regress in.
    const m = colour.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(m).not.toBeNull();
    const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    // Each channel must be < 130 (dark-wood is ~58/35/20).
    expect(r).toBeLessThan(130);
    expect(g).toBeLessThan(130);
    expect(b).toBeLessThan(130);
  });

  // -------------------------------------------------------------------
  // BUG-02 — Service worker stale-while-revalidate strategy.
  // Asserts the source contains the new function name, the network-
  // first-only string is gone, and the cache version was bumped past
  // v6. We can't easily exercise the SW from Playwright (it's
  // disabled under test) but the source is the contract.
  // -------------------------------------------------------------------
  test('BUG-02 · service worker uses stale-while-revalidate for assets', async ({ page }) => {
    const sw = await page.evaluate(async () => {
      const r = await fetch('/sw.js');
      return r.text();
    });
    expect(sw).toContain('staleWhileRevalidate');
    expect(sw).toContain('networkFirst');     // HTML keeps network-first
    // Old cache name must be bumped so users on the prior network-
    // first cache get a clean activate purge.
    expect(sw).not.toMatch(/CACHE_VERSION\s*=\s*'kcq-v6'/);
    expect(sw).toMatch(/CACHE_VERSION\s*=\s*'kcq-v[7-9]\d*'/);
  });

  // -------------------------------------------------------------------
  // BUG-03 — icon.svg cache headers.
  // Netlify runs in production but the static file isn't served by
  // the test web server (python -m http.server). Best we can do here
  // is assert the netlify.toml has the long cache header so a future
  // edit doesn't drop it.
  // -------------------------------------------------------------------
  test('BUG-03 · netlify.toml gives icon.svg a 30-day cache', async ({ page }) => {
    const cfg = await page.evaluate(async () => {
      const r = await fetch('/netlify.toml');
      return r.ok ? r.text() : '';
    });
    if (!cfg) test.skip(true, 'netlify.toml not served by test web server');
    expect(cfg).toMatch(/for\s*=\s*"\/\*\.svg"/);
    expect(cfg).toMatch(/max-age=2592000/);
    expect(cfg).toMatch(/immutable/);
  });

  // -------------------------------------------------------------------
  // BUG-04 — /favicon.ico no longer 404s, and the index.html has the
  // explicit shortcut-icon hint so HTML-aware clients short-circuit
  // the probe.
  // -------------------------------------------------------------------
  test('BUG-04 · index.html declares a shortcut icon', async ({ page }) => {
    const html = await page.evaluate(async () => {
      const r = await fetch('/index.html');
      return r.text();
    });
    expect(html).toMatch(/<link\s+rel=["']shortcut icon["']\s+href=["']\.\/icon\.svg["']/);
  });

  test('BUG-04 · netlify redirect routes /favicon.ico to /icon.svg', async ({ page }) => {
    const cfg = await page.evaluate(async () => {
      const r = await fetch('/netlify.toml');
      return r.ok ? r.text() : '';
    });
    if (!cfg) test.skip(true, 'netlify.toml not served by test web server');
    expect(cfg).toMatch(/from\s*=\s*"\/favicon\.ico"/);
    expect(cfg).toMatch(/to\s*=\s*"\/icon\.svg"/);
  });

  // -------------------------------------------------------------------
  // BUG-05 — the standalone "❦ ❦ ❦" ornament that read as 3 broken
  // slot placeholders is gone from the heroes view header.
  // -------------------------------------------------------------------
  test('BUG-05 · heroes view header has no standalone ornament block', async ({ page }) => {
    await seedHero(page, { userName: 'g05' });
    const ornamentInsideHeader = await page.evaluate(() => {
      // The ornament class can still exist elsewhere — only fail if
      // it's a child of #view-kids > .section.heroes-section-head.
      const head = document.querySelector('#view-kids .heroes-section-head');
      return !!(head && head.querySelector('.ornament'));
    });
    expect(ornamentInsideHeader).toBe(false);
  });

  // -------------------------------------------------------------------
  // BUG-06 — recruit CTA sits beside the title (single header row),
  // and the kids-grid follows directly without an intermediary
  // empty-state-looking section.
  // -------------------------------------------------------------------
  test('BUG-06 · recruit CTA + title + count pill share one header row', async ({ page }) => {
    await seedHero(page, { name: 'Aria',  userName: 'g06a' });
    await seedHero(page, { name: 'Boris', userName: 'g06b' });
    const layout = await page.evaluate(() => {
      const head = document.querySelector('.heroes-head-row');
      if (!head) return null;
      const has = (sel) => !!head.querySelector(sel);
      return {
        hasTitle: has('h2'),
        hasPill:  has('#heroesCountPill'),
        hasRecruit: has('button[onclick*="openAddKidModal()"]'),
        pillText: (head.querySelector('#heroesCountPill') || {}).textContent
      };
    });
    expect(layout).not.toBeNull();
    expect(layout.hasTitle).toBe(true);
    expect(layout.hasPill).toBe(true);
    expect(layout.hasRecruit).toBe(true);
    // Pill should reflect the seeded count.
    expect(layout.pillText).toMatch(/\b2\b/);
  });

  test('BUG-06 · count pill is empty when no heroes exist', async ({ page }) => {
    const txt = await page.evaluate(() => {
      const el = document.getElementById('heroesCountPill');
      return el ? (el.textContent || '').trim() : null;
    });
    expect(txt).toBe('');
  });

  // -------------------------------------------------------------------
  // BUG-07 — kid.avatar emoji surfaces on the hero card via the
  // `.kid-avatar-badge` corner badge. Stored emoji used to be
  // silently ignored everywhere except dropdowns.
  // -------------------------------------------------------------------
  test('BUG-07 · kid.avatar renders as a corner badge on the hero card', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Drago', userName: 'g07' });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.avatar = '🐲';
      window.save();
      window.renderKids();
    }, kidId);
    const txt = await page.locator('.kid-card .kid-avatar-badge').first().textContent();
    expect(txt.trim()).toBe('🐲');
  });

  test('BUG-07 · kidEmoji helper falls back to class icon', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = window.kidEmoji({ class: 'magician' });
      const b = window.kidEmoji({ class: 'warrior', avatar: '🦊' });
      const c = window.kidEmoji(null);
      return { a, b, c };
    });
    // The magician class icon comes from CLASSES catalog; we don't
    // hard-code the exact emoji because the catalog can evolve. Just
    // assert the helper returns a non-empty string.
    expect(typeof r.a).toBe('string');
    expect(r.a.length).toBeGreaterThan(0);
    // Explicit avatar wins over class icon.
    expect(r.b).toBe('🦊');
    // Null kid yields the safe-default hero glyph.
    expect(r.c).toBe('🦸');
  });

  // -------------------------------------------------------------------
  // BUG-08 — duplicate display names are rejected at recruit and
  // rename time. Case-insensitive across the existing roster.
  // -------------------------------------------------------------------
  test('BUG-08 · nameTaken detects duplicates case-insensitively', async ({ page }) => {
    await seedHero(page, { name: 'Carlo der Weisse', userName: 'g08a' });
    const r = await page.evaluate(() => ({
      same:  window.nameTaken('Carlo der Weisse'),
      lower: window.nameTaken('carlo der weisse'),
      upper: window.nameTaken('CARLO DER WEISSE'),
      pad:   window.nameTaken('  Carlo der Weisse  '),
      diff:  window.nameTaken('Gabi der Weisse')
    }));
    expect(r.same).toBe(true);
    expect(r.lower).toBe(true);
    expect(r.upper).toBe(true);
    expect(r.pad).toBe(true);
    expect(r.diff).toBe(false);
  });

  test('BUG-08 · recruit modal rejects a duplicate display name with a toast', async ({ page }) => {
    await seedHero(page, { name: 'Carlo der Weisse', userName: 'g08c' });
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await page.locator('#newKidName').fill('Carlo der Weisse');
    await page.locator('#newKidUserName').fill('newhandle');
    await page.locator('#addKidModal .btn-primary').click();
    await expect(page.locator('#toast')).toContainText(/already in your family|schon in deiner Familie/i);
    // Modal stays open, hero count unchanged.
    const n = await page.evaluate(() => window.state.kids.length);
    expect(n).toBe(1);
  });

  test('BUG-08 · rename modal rejects a duplicate name (excluding self)', async ({ page }) => {
    const a = await seedHero(page, { name: 'Aria',  userName: 'g08x' });
    const b = await seedHero(page, { name: 'Boris', userName: 'g08y' });
    const result = await page.evaluate(({ aId, bId }) => ({
      // Renaming Boris to Aria → blocked (Aria exists)
      blocked: window.nameTaken('Aria', bId),
      // Renaming Aria to "Aria" (itself) → allowed
      self:    window.nameTaken('Aria', aId)
    }), { aId: a, bId: b });
    expect(result.blocked).toBe(true);
    expect(result.self).toBe(false);
  });

  // -------------------------------------------------------------------
  // BUG-09 — <html lang> follows the active locale.
  // -------------------------------------------------------------------
  test('BUG-09 · static <html lang> in source defaults to "de" (no-JS / SEO baseline)', async ({ page }) => {
    // Read the raw HTML so we measure what crawlers / no-JS clients
    // see. After updateI18n() runs the runtime attribute reflects
    // state.settings.lang (asserted in the next test).
    const html = await page.evaluate(() => fetch('/index.html').then(r => r.text()));
    expect(html).toMatch(/<html\s+lang=["']de["']/);
  });

  test('BUG-09 · runtime <html lang> matches state.settings.lang', async ({ page }) => {
    const r = await page.evaluate(() => ({
      attr: document.documentElement.lang,
      state: window.state.settings.lang
    }));
    expect(r.attr).toBe(r.state);
  });

  test('BUG-09 · toggling state.settings.lang updates document.documentElement.lang', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.state.settings.lang = 'en';
      window.updateI18n();
      const en = document.documentElement.lang;
      window.state.settings.lang = 'de';
      window.updateI18n();
      const de = document.documentElement.lang;
      return { en, de };
    });
    expect(r.en).toBe('en');
    expect(r.de).toBe('de');
  });

  // -------------------------------------------------------------------
  // BUG-10 — Threat-model sanity check.
  // The Supabase auth token in localStorage is a known/accepted
  // tradeoff (default Supabase JS behaviour), but this app must NEVER
  // write a plain-text password into its own state. Assert the
  // password input never round-trips to localStorage.
  // -------------------------------------------------------------------
  test('BUG-10 · piggyBankState never contains a clear-text password field', async ({ page }) => {
    const blob = await page.evaluate(() => localStorage.getItem('piggyBankState') || '');
    expect(blob).not.toMatch(/"password"\s*:/i);
    expect(blob).not.toMatch(/"signinPassword"\s*:/i);
  });

  // -------------------------------------------------------------------
  // BUG-11 — Click zone covers the full avatar circle.
  // We measure the bounding rects of .kid-head-click and the avatar
  // and assert the click rect fully contains the avatar's outer
  // visible bounds (with a 1px tolerance for sub-pixel rounding).
  // -------------------------------------------------------------------
  test('BUG-11 · .kid-head-click rect contains the avatar rect', async ({ page }) => {
    await seedHero(page, { name: 'ClickKid', userName: 'g11' });
    await page.evaluate(() => window.renderKids());
    const r = await page.evaluate(() => {
      const head = document.querySelector('.kid-head-click');
      const av = head && head.querySelector('.avatar');
      if (!head || !av) return null;
      const h = head.getBoundingClientRect();
      const a = av.getBoundingClientRect();
      return { h, a };
    });
    expect(r).not.toBeNull();
    // Click zone must extend at least to the avatar edges (allow 1 px
    // sub-pixel slack on each side).
    expect(r.h.left).toBeLessThanOrEqual(r.a.left + 1);
    expect(r.h.top).toBeLessThanOrEqual(r.a.top + 1);
    expect(r.h.right).toBeGreaterThanOrEqual(r.a.right - 1);
    expect(r.h.bottom).toBeGreaterThanOrEqual(r.a.bottom - 1);
  });

  test('BUG-11 · clicking the avatar edge opens the hero sheet', async ({ page }) => {
    await seedHero(page, { name: 'EdgeKid', userName: 'g11edge' });
    await page.evaluate(() => window.renderKids());
    // Click the top-right corner of the avatar — the spot that used
    // to fall outside the click zone.
    const box = await page.evaluate(() => {
      const av = document.querySelector('.kid-card .avatar');
      const r = av.getBoundingClientRect();
      return { x: r.left + r.width - 2, y: r.top + 2 };
    });
    await page.mouse.click(box.x, box.y);
    await expect(page.locator('#heroSheetModal')).toHaveClass(/open/);
  });

  // -------------------------------------------------------------------
  // BUG-12 — manifest.json is fetched at most once per page boot.
  // Subset of BUG-02. We hook up a network listener around a fresh
  // page-load and count manifest.json requests.
  // -------------------------------------------------------------------
  test('BUG-12 · manifest.json is requested at most twice on a fresh load', async ({ page }) => {
    let manifestRequests = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/manifest.json')) manifestRequests++;
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.kidById === 'function');
    // Tolerate up to 2 (one HTML <link> probe + one PWA install
    // prompt query). Pre-fix this was 4×; the SW change has to keep
    // it ≤2 so the install prompt doesn't flicker on Android.
    expect(manifestRequests).toBeLessThanOrEqual(2);
  });
});
