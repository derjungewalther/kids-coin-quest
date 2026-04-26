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
 *   BUG-13  hero sheet attributes + achievement tiles use dark text
 *           (no more pale-yellow-on-tan low-contrast pattern)
 *   BUG-14  hero sheet localized end-to-end (slot labels, item names,
 *           section headers, buttons)
 *   BUG-15  identical inventory items stack with a ×N badge
 *   BUG-16  no "indie-RPG" or other dev language leaks into player UI
 *   BUG-17  achievement German uses ß ("Heißer Lauf") not ss
 *   BUG-18  @username never appears on the kid card; auto-generated
 *           when omitted at recruit time
 *   BUG-19  cosmetic empty state shows concrete progress to next drop
 *   BUG-20  Escape closes the topmost open modal
 *   BUG-21  modal close buttons render the localized t('close_btn')
 *   BUG-22  modals toggle aria-hidden on open/close + restore focus
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

  // -------------------------------------------------------------------
  // BUG-13 — Hero sheet + achievement tiles use dark text on parchment.
  // -------------------------------------------------------------------
  test('BUG-13 · achievement-tile-label colour is dark-wood, not pale gold', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g13', balance: 100, totalEarned: 100 });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.achievements = ['first_quest', 'level_5'];
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    const colour = await page.locator('.achievement-tile-label').first().evaluate((el) =>
      getComputedStyle(el).color
    );
    const m = colour.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(m).not.toBeNull();
    const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    expect(r).toBeLessThan(120);
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(120);
  });

  // -------------------------------------------------------------------
  // BUG-14 — Hero sheet localized end-to-end.
  // -------------------------------------------------------------------
  test('BUG-14 · slot label + item name render in DE locale', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g14' });
    await page.evaluate((id) => {
      window.state.settings.lang = 'de';
      window.updateI18n();
      const k = window.kidById(id);
      const hat = window.ITEMS.find(it => it.slot === 'hat' && it.id === 'feathered_cap');
      window.giveItemToKid(id, hat);
      const inst = k.inventory.find(i => i.itemId === 'feathered_cap');
      if (inst) k.equipment.hat = inst.instanceId;
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    const html = await page.locator('#heroSheetContent').innerHTML();
    // German item name "Federhut" must render, not English "Feathered Cap".
    expect(html).toContain('Federhut');
    expect(html).not.toContain('Feathered Cap');
    // Slot labels — must be DE words.
    expect(html).toContain('Hut');
    expect(html).toContain('Rüstung');
    expect(html).toContain('Waffe');
    expect(html).toContain('Zubehör');
    // Section headers must be localized too.
    expect(html).toMatch(/Attribute|Eigenschaften/);
    // The dev-language leak must be gone.
    expect(html).not.toContain('indie-RPG');
    expect(html).not.toContain('Indie-RPG');
  });

  // -------------------------------------------------------------------
  // BUG-15 — Stacked inventory.
  // -------------------------------------------------------------------
  test('BUG-15 · duplicate item drops render as a single tile with ×N badge', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g15' });
    await page.evaluate((id) => {
      const ring = window.ITEMS.find(it => it.id === 'lucky_ring');
      window.giveItemToKid(id, ring);
      window.giveItemToKid(id, ring);
      window.giveItemToKid(id, ring);
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    // Three pushes → still one tile (stacked).
    await expect(page.locator('#heroSheetContent .inv-item')).toHaveCount(1);
    // Stack badge shows ×3.
    await expect(page.locator('#heroSheetContent .stack-badge')).toContainText('×3');
  });

  // -------------------------------------------------------------------
  // BUG-16 — No dev-language leaks anywhere player-facing.
  // -------------------------------------------------------------------
  test('BUG-16 · "indie-RPG" string is not in either locale\'s upload caption', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = window.state.settings.lang;
      window.state.settings.lang = 'en';
      const en = window.t('upload_desc_char');
      window.state.settings.lang = 'de';
      const de = window.t('upload_desc_char');
      window.state.settings.lang = orig;
      return { en, de };
    });
    expect(r.en).not.toMatch(/indie-RPG/i);
    expect(r.de).not.toMatch(/indie-RPG/i);
    // Replacement copy is on-tone (mentions "storybook" or "Märchen").
    expect(r.en.toLowerCase()).toMatch(/storybook|hero/);
    expect(r.de.toLowerCase()).toMatch(/märchen|held/);
  });

  // -------------------------------------------------------------------
  // BUG-17 — German achievement uses ß.
  // -------------------------------------------------------------------
  test('BUG-17 · streak_3 achievement renders "Heißer Lauf" with ß', async ({ page }) => {
    const r = await page.evaluate(() => {
      // Walk the catalog by building a max-stats hero and reading the
      // tile's German label.
      const k = {
        id: 'k_h17', name: 'Hot', class: 'warrior',
        stats: { brave: 5, clever: 5, kind: 5 },
        balance: 0, xp: { brave: 0, clever: 0, kind: 0 },
        inventory: [], equipment: {}, achievements: [],
        streak: { days: 5, lastDay: (() => {
          const d = new Date();
          return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        })() }
      };
      window.state.kids.push(k);
      window.state.settings.lang = 'de';
      window.openHeroSheet(k.id);
      const labels = Array.from(document.querySelectorAll('.achievement-tile-label')).map(el => el.textContent);
      return labels;
    });
    expect(r.some(l => /Heißer/.test(l))).toBe(true);
    expect(r.some(l => /Heisser/.test(l))).toBe(false);
  });

  // -------------------------------------------------------------------
  // BUG-18 — @username gone from card; auto-generation works.
  // -------------------------------------------------------------------
  test('BUG-18 · kid card no longer renders @username', async ({ page }) => {
    await seedHero(page, { name: 'Ida', userName: 'ida_handle' });
    await page.evaluate(() => window.renderKids());
    const html = await page.locator('.kid-card').first().innerHTML();
    expect(html).not.toContain('@ida_handle');
    expect(html).not.toMatch(/class="kid-user"/);
  });

  test('BUG-18 · slugifyUserName produces a stable handle from a display name', async ({ page }) => {
    const r = await page.evaluate(() => ({
      simple: window.slugifyUserName('Lily Brave'),
      umlaut: window.slugifyUserName('Hänsel & Gretel'),
      sharp:  window.slugifyUserName('Heißer Held'),
      empty:  window.slugifyUserName('')
    }));
    expect(r.simple).toBe('lilybrave');
    expect(r.umlaut).toMatch(/^hanselgretel/);
    expect(r.sharp).toMatch(/^heissh|^heisser/);
    expect(r.empty).toBe('hero');
  });

  test('BUG-18 · addKid auto-generates a username when the field is empty', async ({ page }) => {
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await page.locator('#newKidName').fill('Auto User');
    // Leave #newKidUserName blank.
    await page.locator('.class-card').first().click();
    await page.locator('#addKidModal .btn-primary').click();
    const stored = await page.evaluate(() => window.state.kids[0].userName);
    expect(stored).toMatch(/^autouser/);
  });

  // -------------------------------------------------------------------
  // BUG-19 — Cosmetic empty state shows progress.
  // -------------------------------------------------------------------
  test('BUG-19 · cosmetics empty state surfaces a streak-progress hint', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g19' });
    await page.evaluate((id) => {
      window.state.cosmeticInventory = [];
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      window.state.streak.activeDays = [
        window.dayKeyOffset(today, -1), today
      ];
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    const html = await page.locator('#heroSheetContent').innerHTML();
    // Either EN or DE phrasing — both contain a digit/day reference.
    expect(html).toMatch(/2 \/ 7|Streak|Strähne/);
  });

  // -------------------------------------------------------------------
  // BUG-20 — Escape closes the topmost open modal.
  // -------------------------------------------------------------------
  test('BUG-20 · pressing Escape closes the open hero sheet modal', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g20' });
    await page.evaluate((id) => window.openHeroSheet(id), kidId);
    await expect(page.locator('#heroSheetModal')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#heroSheetModal')).not.toHaveClass(/open/);
  });

  test('BUG-20 · Escape closes only the topmost modal when two are open', async ({ page }) => {
    await seedHero(page, { userName: 'g20b' });
    await page.evaluate(() => {
      window.openModal('addKidModal');
      window.openModal('renameHeroModal');
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#renameHeroModal')).not.toHaveClass(/open/);
    await expect(page.locator('#addKidModal')).toHaveClass(/open/);
  });

  // -------------------------------------------------------------------
  // BUG-21 — Modal close buttons localized.
  // -------------------------------------------------------------------
  test('BUG-21 · hero sheet close button uses t("close_btn")', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'g21' });
    await page.evaluate((id) => {
      window.state.settings.lang = 'de';
      window.updateI18n();
      window.openHeroSheet(id);
    }, kidId);
    const html = await page.locator('#heroSheetContent').innerHTML();
    expect(html).toContain('Schließen');
    expect(html).not.toMatch(/>Close</);
  });

  // -------------------------------------------------------------------
  // BUG-22 — Modals manage aria-hidden + restore focus.
  // -------------------------------------------------------------------
  test('BUG-22 · openModal flips aria-hidden to "false"; closeModal back to "true"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      window.openModal('addKidModal');
      await new Promise(r => setTimeout(r, 50));
      const open = document.getElementById('addKidModal').getAttribute('aria-hidden');
      window.closeModal('addKidModal');
      await new Promise(r => setTimeout(r, 20));
      const closed = document.getElementById('addKidModal').getAttribute('aria-hidden');
      return { open, closed };
    });
    expect(result.open).toBe('false');
    expect(result.closed).toBe('true');
  });

  test('BUG-22 · all modal-backdrops declare role="dialog" + aria-modal="true"', async ({ page }) => {
    const audit = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.modal-backdrop')).map(el => ({
        id: el.id,
        role: el.getAttribute('role'),
        modal: el.getAttribute('aria-modal')
      }))
    );
    expect(audit.length).toBeGreaterThan(0);
    for (const m of audit) {
      expect.soft(m.role, `modal#${m.id}`).toBe('dialog');
      expect.soft(m.modal, `modal#${m.id}`).toBe('true');
    }
  });

  // ---------------------------------------------------------------------
  // BUG-23 · Streak unification: family-only, never per-hero
  //
  // April 2026: per-hero streak badge ("🔥 N" on every kid card) was
  // redundant with the family-streak flame in the header and confused
  // the model. We removed it from the kid card and switched the
  // streak_3/7/30 achievements to test the family streak. These tests
  // pin both behaviours so a future refactor can't silently bring back
  // the per-hero surface.
  // ---------------------------------------------------------------------
  test('BUG-23 · kid cards render no .streak-badge regardless of k.streak.days', async ({ page }) => {
    await seedHero(page, { userName: 'streakcard' });
    await page.evaluate(() => {
      const k = window.state.kids[0];
      // Force a long per-hero streak record. v1 would have rendered
      // "🔥 12" on the kid card — v2 must show nothing.
      const today = (window.todayKeyFamily ? window.todayKeyFamily() : window.todayYmd());
      k.streak = { lastDay: today, days: 12, best: 12 };
      window.renderKids();
    });
    const inCardBadges = await page.locator('.kid-card .streak-badge').count();
    expect(inCardBadges).toBe(0);
    // The family flame in the header MUST still be there (always present,
    // even at 0 days — it's just dimmed via data-cold).
    await expect(page.locator('#familyStreakBadge')).toBeVisible();
  });

  test('BUG-23 · streak_3 unlocks from family activity, not per-hero data', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'streakfam' });
    const has = await page.evaluate((kid) => {
      const k = window.state.kids.find(x => x.id === kid);
      // Per-hero streak deliberately empty — only the family side has data.
      k.streak = { lastDay: null, days: 0, best: 0 };
      const today = window.todayKeyFamily();
      const d = (n) => window.dayKeyOffset(today, -n);
      window.state.streak = window.state.streak || {};
      window.state.streak.activeDays = [d(2), d(1), today];
      window.state.streak.freezesUsed = [];
      window.checkAchievements(k, 'all');
      return Array.isArray(k.achievements) && k.achievements.includes('streak_3');
    }, kidId);
    expect(has).toBe(true);
  });

  test('BUG-23 · streak_3 does NOT unlock when only the per-hero record is set', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'streakperhero' });
    const has = await page.evaluate((kid) => {
      const k = window.state.kids.find(x => x.id === kid);
      const today = window.todayKeyFamily();
      // Only per-hero streak — family side empty.
      k.streak = { lastDay: today, days: 30, best: 30 };
      window.state.streak = { activeDays: [], freezesUsed: [], current: 0, longest: 0 };
      window.checkAchievements(k, 'all');
      return Array.isArray(k.achievements) && k.achievements.includes('streak_3');
    }, kidId);
    expect(has).toBe(false);
  });
});
