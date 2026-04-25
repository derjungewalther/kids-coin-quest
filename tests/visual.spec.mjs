/**
 * Visual capture spec — drives the app through every key UI state and
 * writes PNG screenshots to test-results/visual/. Used in two modes:
 *
 *   1) **Discovery loop** (initial pass): capture all screens, then a
 *      developer browses the PNGs to spot graphical bugs that no
 *      assertion yet covers (overlap, contrast, off-canvas text,
 *      misaligned grids, cut-off labels, broken icons, etc.).
 *
 *   2) **Regression mode** (later): the same screenshots are compared
 *      against committed baselines via `toHaveScreenshot()` so future
 *      style/layout regressions are caught automatically.
 *
 * Right now the suite is in mode (1): every test just calls
 * `captureFullPage(page, name)` to dump a PNG. Once the visual pass
 * stabilises, swap each `captureFullPage` for `expect(page).toHaveScreenshot(name)`.
 *
 * Why we wait on web fonts before each shot:
 * Cinzel / MedievalSharp / Lora load via @import. If we screenshot
 * before they finish, the page renders in a fallback sans-serif and
 * every spacing measurement is wrong. `document.fonts.ready` blocks
 * until they're parsed and the layout is stable.
 */
import { test, expect, seedHero, setPin } from './fixtures.mjs';

// Threshold knobs for cross-platform stability. Small font / antialias
// drift between macOS dev and Linux CI is normal — pinning at 0.2%
// pixel tolerance ignores that without being so loose it misses real
// regressions. fullPage=true so we catch issues below the fold too.
const SHOT_OPTS = {
  fullPage: true,
  maxDiffPixelRatio: 0.002,    // ≤0.2 % of pixels may differ
  threshold: 0.2,              // per-pixel colour delta tolerance
  animations: 'disabled'       // stop dice spins / pulses smearing
};

async function prepareForShot(page) {
  // Block until web fonts are parsed so layout measurements don't
  // shift between renders.
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // Belt-and-braces: even with `animations: 'disabled'` above, some
  // CSS keyframe gradients are paint-time and Playwright's freezer
  // doesn't normalise them. Force-stop everything. Also hide the
  // toast region — boot-time side effects (streak shield grant,
  // PWA install chip) raise toasts whose timing varies under load
  // and would otherwise show up in screenshots non-deterministically.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }
    #toast, .install-chip { display: none !important; }`
  });
  await page.waitForTimeout(120);
}

async function captureFullPage(page, name) {
  await prepareForShot(page);
  await expect(page).toHaveScreenshot(`${name}.png`, SHOT_OPTS);
}

// Determinism hook: several render paths (sceneArtVariant,
// pickOfferedLegendaryClasses, count-game positions, ritual hero
// portrait flourish) tap Math.random(). For visual snapshots that
// noise has to go — replace Math.random with a seeded LCG so each
// render produces identical pixels run-to-run.
test.beforeEach(async ({ page }) => {
  // Boot-time stub: replaces Math.random with a deterministic LCG so
  // first-paint code paths (id generation, narration variant pick,
  // sceneArtVariant) render identically across runs. Tests that need
  // a fresh seed RIGHT BEFORE a specific render call window.__reseed()
  // to reset the LCG state — the stub state advances every time
  // anything in the app calls Math.random, so the right seed for a
  // ritual render only exists if we re-seed at the moment of render.
  await page.addInitScript(() => {
    const SEED = 0x9e3779b1;
    let s = SEED;
    const lcg = () => {
      s = (Math.imul(s, 1597334677) + 0x6D2B79F5) >>> 0;
      return (s & 0xfffffff) / 0x10000000;
    };
    Math.random = lcg;
    window.__reseed = () => { s = SEED; };

    // Pin the wall clock to a fixed instant so:
    //   - logTx timestamps render the same date each run
    //   - todayKeyFamily / dayKeyOffset return stable keys
    //   - new Date().toISOString() in any code path is reproducible
    // 2026-04-25T12:00:00Z chosen to match the development date already
    // anchored in earlier specs.
    const FIXED_NOW = new Date('2026-04-25T12:00:00Z').getTime();
    const _Date = Date;
    function StubDate(...args) {
      if (args.length === 0) return new _Date(FIXED_NOW);
      return new _Date(...args);
    }
    StubDate.now = () => FIXED_NOW;
    StubDate.parse = _Date.parse;
    StubDate.UTC = _Date.UTC;
    StubDate.prototype = _Date.prototype;
    Object.setPrototypeOf(StubDate, _Date);
    window.Date = StubDate;
  });
});

test.describe('Visual capture · desktop 1280×900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('01 heroes empty state', async ({ page }) => {
    await captureFullPage(page, '01-heroes-empty');
  });

  test('02 heroes with one kid', async ({ page }) => {
    await seedHero(page, { name: 'Lily Brave', userName: 'lilybrave', class: 'magician', balance: 7.5, totalEarned: 12 });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, '02-heroes-one-kid');
  });

  test('03 heroes with three kids + goal + streak', async ({ page }) => {
    await seedHero(page, { name: 'Aria',  userName: 'aria',  class: 'warrior',  balance: 15, totalEarned: 22 });
    await seedHero(page, { name: 'Boris', userName: 'boris', class: 'magician', balance: 4,  totalEarned: 9 });
    await seedHero(page, { name: 'Cleo',  userName: 'cleo',  class: 'healer',   balance: 2,  totalEarned: 3 });
    await page.evaluate(() => {
      const k = window.state.kids[0];
      k.goal = { name: 'Fahrrad', target: 50, emoji: '🚲' };
      k.streak = { days: 5, lastEarn: new Date().toISOString() };
      window.state.kids[1].xp = { brave: 12, clever: 8, kind: 4 };
      window.save(); window.renderKids();
    });
    await captureFullPage(page, '03-heroes-three-kids');
  });

  test('04 quest board with default activities', async ({ page }) => {
    await page.locator('.tab[data-view="activities"]').click();
    await captureFullPage(page, '04-quest-board');
  });

  test('05 chronicle (history) with mixed entries', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Quester', userName: 'quester', balance: 5, totalEarned: 5 });
    await page.evaluate((id) => {
      window.logTx(id, 'earn',   3, '📜 Brush teeth · +1 brave-XP', { event: 'quest', payload: { questIcon:'📜', questName: 'Brush teeth', xp: 1, stat:'brave' } });
      window.logTx(id, 'payout', -2, 'Ice cream',                    { event: 'withdrawal', payload: { reason:'Ice cream' } });
      window.logTx(id, 'donate', -1, '❤ Alms to Library',            { event: 'donation', payload: { to:'Library' } });
      window.logTx(id, 'earn',   5, '🏛 Weekly allowance',            { event: 'allowance', payload: {} });
      window.save();
    }, kidId);
    await page.locator('.tab[data-view="history"]').click();
    await captureFullPage(page, '05-chronicle');
  });

  test('06 adventure picker with party + locks', async ({ page }) => {
    await seedHero(page, { name: 'Pip', userName: 'pip' });
    await page.locator('.tab[data-view="adventure"]').click();
    await page.locator('.adventure-hero-card').first().click();
    await captureFullPage(page, '06-adventure-picker');
  });

  test('07 recruit modal', async ({ page }) => {
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await captureFullPage(page, '07-modal-recruit');
  });

  test('08 hero sheet modal', async ({ page }) => {
    await seedHero(page, { name: 'Sage', userName: 'sage', class: 'magician', balance: 7, totalEarned: 11 });
    await page.evaluate(() => {
      const k = window.state.kids[0];
      k.xp = { brave: 5, clever: 12, kind: 3 };
      k.achievements = ['first_quest', 'level_5'];
      k.goal = { name: 'Mikroskop', target: 30, emoji: '🔬' };
      window.save();
    });
    await page.locator('.kid-head-click').first().click();
    await captureFullPage(page, '08-modal-hero-sheet');
  });

  test('09 goal modal', async ({ page }) => {
    await seedHero(page, { userName: 'goalkid' });
    await page.locator('.goal-strip-empty').click();
    await captureFullPage(page, '09-modal-goal');
  });

  test('10 withdraw modal', async ({ page }) => {
    await seedHero(page, { userName: 'wdkid', balance: 8 });
    await page.locator('.kid-card').first().getByRole('button', { name: /Withdraw|Auszahlen/ }).click();
    await captureFullPage(page, '10-modal-withdraw');
  });

  test('11 donate modal', async ({ page }) => {
    await seedHero(page, { userName: 'dokid', balance: 5 });
    await page.locator('.kid-card').first().getByRole('button', { name: /Alms|Spende/ }).click();
    await captureFullPage(page, '11-modal-donate');
  });

  test('12 reward modal (tier 3)', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.pendingRewards.push({
        tier: 'tier3', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'lucky_charm', qty: 1 }
      });
      window.maybeShowNextReward();
    });
    await captureFullPage(page, '12-modal-reward-tier3');
  });

  test('13 streak detail modal (60-day grid)', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      const days = [];
      for (let i = 6; i >= 0; i--) days.push(window.dayKeyOffset(today, -i));
      window.state.streak.activeDays = days;
      window.state.streak.freezesUsed = [window.dayKeyOffset(today, -3)];
      window.openStreakDetailModal();
    });
    await captureFullPage(page, '13-modal-streak-detail');
  });

  test('14 ritual step 1 (invocation)', async ({ page }) => {
    await page.evaluate(() => {
      window.__reseed && window.__reseed();
      window.ensureLegendaryState();
      // Pin pickOfferedLegendaryClasses so the visual is deterministic.
      // The function is replaced in-place; restore is unnecessary
      // because each test runs in its own page context.
      window.pickOfferedLegendaryClasses = () => ['licht', 'erde', 'mond'];
      window.openRecruitmentRitual();
    });
    await captureFullPage(page, '14-ritual-step1-invocation');
  });

  test('15 ritual step 2 (class offering)', async ({ page }) => {
    await page.evaluate(() => {
      window.__reseed && window.__reseed();
      window.ensureLegendaryState();
      // Pin pickOfferedLegendaryClasses so the visual is deterministic.
      // The function is replaced in-place; restore is unnecessary
      // because each test runs in its own page context.
      window.pickOfferedLegendaryClasses = () => ['licht', 'erde', 'mond'];
      window.openRecruitmentRitual();
    });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await captureFullPage(page, '15-ritual-step2-classes');
  });

  test('16 ritual step 5 (welcome)', async ({ page }) => {
    await page.evaluate(() => {
      window.__reseed && window.__reseed();
      window.ensureLegendaryState();
      // Pin pickOfferedLegendaryClasses so the visual is deterministic.
      // The function is replaced in-place; restore is unnecessary
      // because each test runs in its own page context.
      window.pickOfferedLegendaryClasses = () => ['licht', 'erde', 'mond'];
      window.openRecruitmentRitual();
    });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await page.locator('.ritual-class-card').first().click();
    await page.locator('#ritualClassNextBtn').click();
    await page.locator('.ritual-name-chip').first().click();
    await page.locator('#ritualNameNextBtn').click();
    await page.locator('.ritual-cosmetic-card').first().click();
    await page.locator('#ritualCosmeticNextBtn').click();
    await captureFullPage(page, '16-ritual-step5-welcome');
  });

  test('17 legendary mentor card on heroes view', async ({ page }) => {
    await seedHero(page, { name: 'Aria', userName: 'aria', class: 'warrior' });
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-vis', userName: 'lhvis', name: 'Mira',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        cosmetics: { hat: 'halo_gold' },
        legendary: { class: 'licht', recruitedAt: new Date().toISOString(),
          recruitedAfterStreak: 30, abilityCharges: { perAdventure: 1, currentAdventure: 1 },
          timesUsed: 0, bondLevel: 7 }
      });
      window.state.cosmeticInventory = [{ id: 'halo_gold', slot: 'hat', icon: '😇', legendary: true }];
      window.save(); window.renderKids();
    });
    await captureFullPage(page, '17-heroes-with-legendary');
  });

  test('18 minigame · memory mounted', async ({ page }) => {
    await seedHero(page, { userName: 'mg18' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      // Switch to the adventure tab so the renderer's container is on screen.
      const adv = document.querySelector('.tab[data-view="adventure"]');
      if (adv) adv.click();
      window.renderAdventure();
    });
    await captureFullPage(page, '18-minigame-memory');
  });

  test('19 minigame · sort mounted', async ({ page }) => {
    await seedHero(page, { userName: 'mg19' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 1; // Köderkiste = sort
      window.renderAdventure();
    });
    await captureFullPage(page, '19-minigame-sort');
  });

  test('20 minigame · rhythm mounted', async ({ page }) => {
    await seedHero(page, { userName: 'mg20' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 2; // Erster Wurf = rhythm
      window.renderAdventure();
    });
    await captureFullPage(page, '20-minigame-rhythm');
  });

  test('21 minigame · count guess phase', async ({ page }) => {
    // Capture the guess-phase number pad — visually deterministic
    // (no randomly placed icons). The flash phase has irreducible
    // position randomness because Math.random consumption between
    // the test's reseed and createCountGame.startRound depends on
    // every render-side draw in between.
    await seedHero(page, { userName: 'mg21' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 3;
      // Make the flash effectively instant so we land in 'guess'.
      const adv = window.ADVENTURES.find(a => a.id === 'fischer-sebastian');
      adv.scenes[3].minigameConfig = adv.scenes[3].minigameConfig || {};
      adv.scenes[3].minigameConfig.flashDurationMs = 1;
      window.renderAdventure();
    });
    await page.waitForTimeout(150);
    await captureFullPage(page, '21-minigame-count');
  });

  test('22 minigame · maze mounted', async ({ page }) => {
    await seedHero(page, { userName: 'mg22' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 4; // Schilfgürtel = maze
      window.renderAdventure();
    });
    await captureFullPage(page, '22-minigame-maze');
  });

  test('23 minigame · spot mounted', async ({ page }) => {
    await seedHero(page, { userName: 'mg23' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 6; // Hungriger Wanderer = spot
      window.renderAdventure();
    });
    await captureFullPage(page, '23-minigame-spot');
  });

  test('24 adventure intro (Fischer Sebastian)', async ({ page }) => {
    await seedHero(page, { userName: 'mg24' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.renderAdventure();
    });
    await captureFullPage(page, '24-adventure-intro');
  });

  test('25 adventure picker — many adventures', async ({ page }) => {
    await seedHero(page, { name: 'PartyHero', userName: 'party', xp: { brave: 100, clever: 100, kind: 100 } });
    await page.locator('.tab[data-view="adventure"]').click();
    await page.locator('.adventure-hero-card').first().click();
    await captureFullPage(page, '25-adventure-picker-full');
  });

  test('26 settings (PIN setup modal)', async ({ page }) => {
    await page.locator('.tab[data-view="settings"]').click();
    await captureFullPage(page, '26-settings-pin-setup');
  });

  test('27 chronicle filter dropdown', async ({ page }) => {
    await seedHero(page, { name: 'Hist', userName: 'hist' });
    await seedHero(page, { name: 'Hist2', userName: 'hist2' });
    await page.locator('.tab[data-view="history"]').click();
    await captureFullPage(page, '27-chronicle-filter');
  });

  test('28 DE locale heroes view', async ({ page }) => {
    await seedHero(page, { name: 'Tester', userName: 'tester' });
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); window.renderKids(); });
    await captureFullPage(page, '28-de-heroes');
  });
});

test.describe('Visual capture · mobile 390×844 (iPhone 14)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('M01 heroes view mobile', async ({ page }) => {
    await seedHero(page, { name: 'Mob', userName: 'mob' });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, 'M01-mobile-heroes');
  });

  test('M02 hamburger open', async ({ page }) => {
    await seedHero(page, { userName: 'mob2' });
    const tog = page.locator('.nav-toggle');
    if (await tog.isVisible().catch(() => false)) {
      await tog.click();
    }
    await captureFullPage(page, 'M02-mobile-hamburger');
  });

  test('M03 minigame · memory on mobile', async ({ page }) => {
    await seedHero(page, { userName: 'mob3' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      // Switch to the adventure tab so the renderer's container is on screen.
      const adv = document.querySelector('.tab[data-view="adventure"]');
      if (adv) adv.click();
      window.renderAdventure();
    });
    await captureFullPage(page, 'M03-mobile-memory');
  });

  test('M04 minigame · sort on mobile', async ({ page }) => {
    await seedHero(page, { userName: 'mob4' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 1;
      window.renderAdventure();
    });
    await captureFullPage(page, 'M04-mobile-sort');
  });

  test('M05 ritual on mobile', async ({ page }) => {
    await page.evaluate(() => {
      window.__reseed && window.__reseed();
      window.ensureLegendaryState();
      // Pin pickOfferedLegendaryClasses so the visual is deterministic.
      // The function is replaced in-place; restore is unnecessary
      // because each test runs in its own page context.
      window.pickOfferedLegendaryClasses = () => ['licht', 'erde', 'mond'];
      window.openRecruitmentRitual();
    });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await captureFullPage(page, 'M05-mobile-ritual-classes');
  });
});
