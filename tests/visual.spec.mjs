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
      const todayYmd = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      })();
      const k = window.state.kids[0];
      k.goal = { name: 'Fahrrad', target: 50, emoji: '🚲' };
      // effectiveStreak gates the badge on lastDay matching today.
      k.streak = { days: 5, best: 5, lastDay: todayYmd };
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

  // =====================================================================
  // TIER 1 — modals + states with zero coverage
  // =====================================================================

  test('29 modal · allowance', async ({ page }) => {
    await seedHero(page, { name: 'AllowKid', userName: 'allow' });
    await page.evaluate(() => window.openAllowanceModal(window.state.kids[0].id));
    await captureFullPage(page, '29-modal-allowance');
  });

  test('30 modal · sign-in', async ({ page }) => {
    await page.evaluate(() => window.openSignInModal && window.openSignInModal());
    await captureFullPage(page, '30-modal-signin');
  });

  test('31 modal · custom adventure (template loaded)', async ({ page }) => {
    await page.evaluate(() => {
      window.pinVerified = true;
      window.openCustomAdventureModal();
      if (typeof window.loadCustomAdventureTemplate === 'function') {
        window.loadCustomAdventureTemplate();
      }
    });
    await captureFullPage(page, '31-modal-custom-adv-template');
  });

  test('32 modal · custom adventure (parse error)', async ({ page }) => {
    await page.evaluate(() => {
      window.pinVerified = true;
      window.openCustomAdventureModal();
      const ta = document.getElementById('customAdvJson');
      if (ta) ta.value = '{ this is not valid json';
      window.saveCustomAdventureFromModal && window.saveCustomAdventureFromModal();
    });
    await captureFullPage(page, '32-modal-custom-adv-error');
  });

  test('33 modal · Erdheld pre-adventure prompt', async ({ page }) => {
    await seedHero(page, { name: 'ErdeKid', userName: 'erdekid' });
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-erde-vis', userName: 'lhev', name: 'Toras',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        legendary: { class: 'erde', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
      });
      window.adventureState.party = [window.state.kids[0].id];
      window.adventureState.legendaryId = 'lh-erde-vis';
      window.chooseAdventure('fischer-sebastian');
    });
    await captureFullPage(page, '33-modal-erde-prompt');
  });

  test('34 modal · delete hero (BANISH)', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Banished', userName: 'banishtest' });
    await page.evaluate((id) => {
      window.pinVerified = true;
      window.deleteKid(id);
    }, kidId);
    await captureFullPage(page, '34-modal-delete-hero');
  });

  test('35 modal · rename hero', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'OldName', userName: 'oldname' });
    await page.evaluate((id) => {
      window.pinVerified = true;
      if (typeof window.openRenameHero === 'function') window.openRenameHero(id);
    }, kidId);
    await captureFullPage(page, '35-modal-rename-hero');
  });

  test('36 modal · PIN entry', async ({ page }) => {
    await setPin(page, '4242');
    await page.evaluate(() => {
      window.pinVerified = false;
      // requirePin opens the entry modal when a PIN is set.
      window.requirePin && window.requirePin(() => {}, 'pin_required');
    });
    await captureFullPage(page, '36-modal-pin-entry');
  });

  test('37 reward · tier 7 cosmetic', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.pendingRewards.push({
        tier: 'tier7', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'cosmetic', cosmeticId: 'crown_gold' }
      });
      window.maybeShowNextReward();
    });
    await captureFullPage(page, '37-reward-tier7');
  });

  test('38 reward · tier 30 ritual entry', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.ensureLegendaryState();
      window.state.streak.pendingRewards.push({
        tier: 'tier30', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'legendary_recruitment_ritual' }
      });
      window.maybeShowNextReward();
    });
    await captureFullPage(page, '38-reward-tier30-ritual');
  });

  test('39 reward · tier 30 cosmetic fallback', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.pendingRewards.push({
        tier: 'tier30', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'legendary_cosmetic', cosmeticId: 'halo_gold' }
      });
      window.maybeShowNextReward();
    });
    await captureFullPage(page, '39-reward-tier30-cosmetic');
  });

  // ---- Adventure end screens ------------------------------------------------

  async function setupAdventureEnd(page, hp) {
    const kidId = await seedHero(page, { name: 'Endkid', userName: 'endkid', balance: 5, totalEarned: 5 });
    await page.evaluate(({ id, hp }) => {
      window.adventureState.party = [id];
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.sceneIdx = 7;
      window.adventureState.maxHp = 6;
      window.adventureState.hp = hp;
      window.adventureState.log = Array.from({ length: 8 }, (_, i) => ({
        sceneTitle: 'Scene ' + (i+1), heroId: id, success: i < hp,
        type: 'minigame', score: i < hp ? 1 : 0, errors: 0, durationMs: 1000
      }));
      window.adventureState.treasureRewards = null;
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.endAdventure(hp >= 4);
    }, { id: kidId, hp });
  }

  test('40 adventure end · triumph 5⭐', async ({ page }) => {
    await setupAdventureEnd(page, 5);
    await captureFullPage(page, '40-end-triumph');
  });

  test('41 adventure end · brave 3⭐', async ({ page }) => {
    await setupAdventureEnd(page, 3);
    await captureFullPage(page, '41-end-brave');
  });

  test('42 adventure end · close call 1⭐', async ({ page }) => {
    await setupAdventureEnd(page, 1);
    await captureFullPage(page, '42-end-close');
  });

  test('43 adventure end · defeat 0⭐', async ({ page }) => {
    await setupAdventureEnd(page, 0);
    await captureFullPage(page, '43-end-defeat');
  });

  // ---- Settings (post-PIN) -------------------------------------------------

  test('44 settings · post-unlock panel', async ({ page }) => {
    await seedHero(page, { name: 'SetK', userName: 'setk' });
    await setPin(page, '1234');
    await page.evaluate(() => {
      window.pinVerified = true;
      const tab = document.querySelector('.tab[data-view="settings"]');
      if (tab) tab.click();
    });
    await captureFullPage(page, '44-settings-unlocked');
  });

  test('45 settings · interest + allowance config visible', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'IntK', userName: 'intk', balance: 50 });
    await page.evaluate((id) => {
      window.pinVerified = true;
      window.state.settings.interestRate = 5;
      window.state.settings.interestFreq = 'monthly';
      const k = window.kidById(id);
      k.allowance = { amount: 3, dayOfWeek: 0, lastPaidAt: null };
      window.save();
      const tab = document.querySelector('.tab[data-view="settings"]');
      if (tab) tab.click();
    }, kidId);
    await captureFullPage(page, '45-settings-interest-allowance');
  });

  test('46 eltern dashboard · streak heatmap', async ({ page }) => {
    await seedHero(page, { name: 'EltK1', userName: 'elt1', balance: 12, totalEarned: 30 });
    await seedHero(page, { name: 'EltK2', userName: 'elt2', balance: 7,  totalEarned: 20 });
    await setPin(page, '1234');
    await page.evaluate(() => {
      window.pinVerified = true;
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      const active = [];
      for (let i = 0; i < 14; i++) active.push(window.dayKeyOffset(today, -i));
      window.state.streak.activeDays = active;
      window.state.streak.freezesUsed = [window.dayKeyOffset(today, -7)];
      window.state.streak.longest = 14;
      window.save();
      // The heatmap lives on the Parents tab (renderParentDashboard),
      // not Settings. switchTab routes through requirePin which is
      // already satisfied because we set pinVerified above.
      window.switchTab('parents');
    });
    await captureFullPage(page, '46-eltern-heatmap');
  });

  // =====================================================================
  // TIER 2 — each non-Fischer adventure + minigame outcome banners
  // =====================================================================

  for (const advId of ['bakery', 'grove', 'crypt', 'dragon', 'tower']) {
    test(`50 adventure · ${advId} first scene`, async ({ page }) => {
      await seedHero(page, { name: 'A', userName: 'a' + advId, xp: { brave: 9999, clever: 9999, kind: 9999 } });
      await page.evaluate((id) => {
        window.adventureState.party = [window.state.kids[0].id];
        window.chooseAdventure(id);
        const advTab = document.querySelector('.tab[data-view="adventure"]');
        if (advTab) advTab.click();
        window.beginScenes();
        window.renderAdventure();
      }, advId);
      await captureFullPage(page, `50-adv-${advId}-scene1`);
    });
  }

  test('55 minigame outcome · memory success banner', async ({ page }) => {
    await seedHero(page, { userName: 'mout1' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      const adv = window.ADVENTURES.find(a => a.id === 'fischer-sebastian');
      window.finishMinigameOutcome({ success: true, score: 1, errors: 0, durationMs: 100 }, adv.scenes[0]);
    });
    // finishMinigameOutcome shows the success banner for ~800ms.
    await page.waitForTimeout(300);
    await captureFullPage(page, '55-minigame-memory-success');
  });

  test('56 minigame outcome · memory failure banner', async ({ page }) => {
    await seedHero(page, { userName: 'mout2' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      const adv = window.ADVENTURES.find(a => a.id === 'fischer-sebastian');
      window.finishMinigameOutcome({ success: false, score: 0.2, errors: 3, durationMs: 100 }, adv.scenes[0]);
    });
    await page.waitForTimeout(300);
    await captureFullPage(page, '56-minigame-memory-failure');
  });

  test('57 sort game · one item picked', async ({ page }) => {
    await seedHero(page, { userName: 'mout3' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 1;
      window.renderAdventure();
      window.__sortPickItem && window.__sortPickItem(0);
    });
    await captureFullPage(page, '57-minigame-sort-picked');
  });

  test('58 spot game · one diff found', async ({ page }) => {
    await seedHero(page, { userName: 'mout5' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 6;
      window.renderAdventure();
      // Synthetically tap one of the right-panel diffs.
      const right = document.querySelector('.spot-panel.right');
      if (right) {
        const r = right.getBoundingClientRect();
        const ev = new MouseEvent('click', { bubbles: true,
          clientX: r.left + 0.25 * r.width, clientY: r.top + 0.50 * r.height });
        window.__mgSpotTap && window.__mgSpotTap(ev, right);
      }
    });
    await page.waitForTimeout(300);
    await captureFullPage(page, '58-minigame-spot-found');
  });

  // =====================================================================
  // TIER 3 — hero sheet variations
  // =====================================================================

  test('60 hero sheet · with inventory', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Inv', userName: 'inv', class: 'warrior' });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      // Drop a few items into the inventory.
      const items = (window.ITEMS || []).slice(0, 4);
      items.forEach(it => window.giveItemToKid(id, it));
      // Equip the first item if its slot exists.
      const first = items[0];
      if (first && first.slot) {
        const inst = (k.inventory || []).find(i => i.itemId === first.id);
        if (inst) k.equipment[first.slot] = inst.id;
      }
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    await captureFullPage(page, '60-hero-sheet-inventory');
  });

  test('61 hero sheet · achievements unlocked grid', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Ach', userName: 'achkid', balance: 200, totalEarned: 250 });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.xp = { brave: 30, clever: 30, kind: 30 };
      k.achievements = ['first_quest','level_5','coins_50','goal_reached'];
      k.goal = { name: 'Bike', target: 100, achievedAt: new Date().toISOString() };
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    await captureFullPage(page, '61-hero-sheet-achievements');
  });

  test('62 hero sheet · legendary mentor variant', async ({ page }) => {
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-sheet', userName: 'lhsheet', name: 'Selene',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        balance: null, totalEarned: null, totalPaidOut: null,
        cosmetics: { hat: 'mask_silver' }, inventory: [], equipment: {},
        legendary: { class: 'mond', recruitedAt: new Date().toISOString(),
          recruitedAfterStreak: 30, abilityCharges: { perAdventure: 1, currentAdventure: 1 },
          timesUsed: 2, bondLevel: 9 }
      });
      window.state.cosmeticInventory = [{ id: 'mask_silver', slot: 'hat', icon: '🎭', legendary: true }];
      window.save();
      window.openHeroSheet('lh-sheet');
    });
    await captureFullPage(page, '62-hero-sheet-legendary');
  });

  for (const cls of ['warrior', 'healer', 'elf', 'bard']) {
    test(`63 hero sheet · ${cls} class`, async ({ page }) => {
      const kidId = await seedHero(page, { name: cls + 'Kid', userName: cls + 'kid', class: cls, balance: 12, totalEarned: 18 });
      await page.evaluate((id) => {
        const k = window.kidById(id);
        k.xp = { brave: 8, clever: 8, kind: 8 };
        window.save();
        window.openHeroSheet(id);
      }, kidId);
      await captureFullPage(page, `63-hero-sheet-${cls}`);
    });
  }

  // =====================================================================
  // TIER 4 — i18n DE breadth
  // =====================================================================

  async function switchToDE(page) {
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); });
  }

  test('70 DE · quest board', async ({ page }) => {
    await switchToDE(page);
    await page.locator('.tab[data-view="activities"]').click();
    await captureFullPage(page, '70-de-quest-board');
  });

  test('71 DE · chronicle', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Tester', userName: 'tester' });
    await page.evaluate((id) => {
      window.logTx(id, 'earn', 3, '📜 Bett machen', { event: 'quest', payload: { questIcon: '📜', questName: 'Bett machen', xp: 1, stat: 'brave' } });
      window.logTx(id, 'payout', -2, 'Eis', { event: 'withdrawal', payload: { reason: 'Eis' } });
      window.logTx(id, 'earn', 5, '🏛 Wöchentliches Taschengeld', { event: 'allowance', payload: {} });
    }, kidId);
    await switchToDE(page);
    await page.locator('.tab[data-view="history"]').click();
    await captureFullPage(page, '71-de-chronicle');
  });

  test('72 DE · adventure picker', async ({ page }) => {
    await seedHero(page, { name: 'Pip', userName: 'pip' });
    await switchToDE(page);
    await page.locator('.tab[data-view="adventure"]').click();
    await page.locator('.adventure-hero-card').first().click();
    await captureFullPage(page, '72-de-adventure-picker');
  });

  test('73 DE · recruit modal', async ({ page }) => {
    await switchToDE(page);
    await page.getByRole('button', { name: /Held|Anwerben|Recruit/ }).first().click();
    await captureFullPage(page, '73-de-modal-recruit');
  });

  test('74 DE · goal modal', async ({ page }) => {
    await seedHero(page, { name: 'GZK', userName: 'gzk' });
    await switchToDE(page);
    await page.locator('.goal-strip-empty').click();
    await captureFullPage(page, '74-de-modal-goal');
  });

  test('75 DE · ritual classes', async ({ page }) => {
    await switchToDE(page);
    await page.evaluate(() => {
      window.__reseed && window.__reseed();
      window.ensureLegendaryState();
      window.pickOfferedLegendaryClasses = () => ['licht', 'erde', 'mond'];
      window.openRecruitmentRitual();
    });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await captureFullPage(page, '75-de-ritual-classes');
  });

  // =====================================================================
  // TIER 5 — edge cases
  // =====================================================================

  test('80 edge · long hero name truncation', async ({ page }) => {
    await seedHero(page, { name: 'Aurelius Ferdinand the Brave Magnificent Third', userName: 'longname' });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, '80-edge-long-name');
  });

  test('81 edge · 5+ heroes in grid', async ({ page }) => {
    for (let i = 0; i < 6; i++) {
      await seedHero(page, { name: 'H' + (i+1), userName: 'h' + (i+1), balance: i + 1 });
    }
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, '81-edge-many-heroes');
  });

  test('82 edge · 4-slot adventure party (3 kids + legendary)', async ({ page }) => {
    await seedHero(page, { name: 'Aria', userName: 'aria4' });
    await seedHero(page, { name: 'Boris', userName: 'boris4' });
    await seedHero(page, { name: 'Cleo', userName: 'cleo4' });
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-4slot', userName: 'lh4', name: 'Mira',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
      });
      window.adventureState.party = window.state.kids.filter(k => !window.isLegendaryHero(k)).map(k => k.id);
      window.adventureState.legendaryId = 'lh-4slot';
      window.save();
      const tab = document.querySelector('.tab[data-view="adventure"]');
      if (tab) tab.click();
    });
    await captureFullPage(page, '82-edge-4slot-party');
  });

  test('83 edge · unicode emoji name', async ({ page }) => {
    await seedHero(page, { name: '🦄 Sparkle 🌈', userName: 'unicornkid' });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, '83-edge-unicode-name');
  });

  test('84 edge · streak badge 99 days', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'StreakK', userName: 'streakk' });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      // effectiveStreak requires lastDay matching today (or yesterday)
      // and reads .days for the count. lastEarn alone does nothing.
      const todayYmd = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      })();
      k.streak = { days: 99, best: 99, lastDay: todayYmd };
      window.save();
      window.renderKids();
    }, kidId);
    await captureFullPage(page, '84-edge-streak-99');
  });

  test('85 edge · large balance with thousand separator', async ({ page }) => {
    await seedHero(page, { name: 'Rich', userName: 'rich', balance: 12345.67, totalEarned: 99999.99 });
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); window.renderKids(); });
    await captureFullPage(page, '85-edge-big-balance-de');
  });

  test('86 edge · empty chronicle (no transactions)', async ({ page }) => {
    await seedHero(page, { name: 'Empty', userName: 'emptyk' });
    await page.locator('.tab[data-view="history"]').click();
    await captureFullPage(page, '86-edge-empty-chronicle');
  });

  test('87 edge · 4-mentor cap state on heroes view', async ({ page }) => {
    await seedHero(page, { name: 'Aria', userName: 'aria-cap' });
    await page.evaluate(() => {
      const classes = ['licht', 'sturm', 'mond', 'erde'];
      const names = ['Mira', 'Boras', 'Selene', 'Toras'];
      classes.forEach((cls, i) => {
        window.state.kids.push({
          id: 'lh-cap-' + cls, userName: 'lhcap' + cls, name: names[i],
          class: 'legendary', stats: {brave:0,clever:0,kind:0},
          cosmetics: {},
          legendary: { class: cls, recruitedAt: new Date().toISOString(),
            recruitedAfterStreak: 30, abilityCharges: { perAdventure: 1, currentAdventure: 1 },
            timesUsed: 0, bondLevel: i + 1 }
        });
      });
      window.ensureLegendaryState();
      window.state.legendary.heroesRecruited = 4;
      window.save();
      window.renderKids();
    });
    await captureFullPage(page, '87-edge-4-mentors');
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

  test('M06 mobile · chronicle', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'MH', userName: 'mh' });
    await page.evaluate((id) => {
      window.logTx(id, 'earn', 3, '📜 Brush teeth', { event: 'quest', payload: { questIcon: '📜', questName: 'Brush teeth', xp: 1, stat: 'brave' } });
      window.logTx(id, 'payout', -2, 'Treat', { event: 'withdrawal', payload: { reason: 'Treat' } });
      window.logTx(id, 'earn', 5, '🏛 Allowance', { event: 'allowance', payload: {} });
      // Tabs are hidden inside the hamburger on mobile — call switchTab
      // directly to land on the Chronicle view without animating.
      window.switchTab('history');
    }, kidId);
    await captureFullPage(page, 'M06-mobile-chronicle');
  });

  test('M07 mobile · reward modal', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.pendingRewards.push({
        tier: 'tier3', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'lucky_charm', qty: 1 }
      });
      window.maybeShowNextReward();
    });
    await captureFullPage(page, 'M07-mobile-reward');
  });

  test('M08 mobile · hero sheet', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'Sage', userName: 'sage', class: 'magician', balance: 7, totalEarned: 11 });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.xp = { brave: 5, clever: 12, kind: 3 };
      k.achievements = ['first_quest'];
      window.save();
      window.openHeroSheet(id);
    }, kidId);
    await captureFullPage(page, 'M08-mobile-hero-sheet');
  });

  test('M09 mobile · settings PIN setup', async ({ page }) => {
    // Settings is PIN-gated and requirePin opens the setup modal when
    // no PIN is set. Trigger that path directly.
    await page.evaluate(() => window.requirePin && window.requirePin(() => {}, 'pin_council_reason'));
    await captureFullPage(page, 'M09-mobile-settings-pin');
  });

  test('M10 mobile · adventure picker', async ({ page }) => {
    await seedHero(page, { name: 'Mob', userName: 'mob10' });
    await page.evaluate(() => {
      window.switchTab('adventure');
      window.adventureState.party = [window.state.kids[0].id];
      window.renderAdventure();
    });
    await captureFullPage(page, 'M10-mobile-adventure-picker');
  });
});

// =====================================================================
// TIER 4 — tablet (iPad portrait + landscape)
// =====================================================================

test.describe('Visual capture · iPad portrait 768×1024', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('T01 tablet portrait · heroes', async ({ page }) => {
    await seedHero(page, { name: 'Aria',  userName: 'tara',  class: 'warrior',  balance: 15 });
    await seedHero(page, { name: 'Boris', userName: 'tbor',  class: 'magician', balance: 4  });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, 'T01-tablet-p-heroes');
  });

  test('T02 tablet portrait · adventure picker', async ({ page }) => {
    await seedHero(page, { name: 'PartyT', userName: 'tpt' });
    await page.evaluate(() => {
      window.switchTab('adventure');
      window.adventureState.party = [window.state.kids[0].id];
      window.renderAdventure();
    });
    await captureFullPage(page, 'T02-tablet-p-adventure-picker');
  });

  test('T03 tablet portrait · minigame · sort', async ({ page }) => {
    await seedHero(page, { userName: 'tsort' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 1;
      window.renderAdventure();
    });
    await captureFullPage(page, 'T03-tablet-p-sort');
  });
});

test.describe('Visual capture · iPad landscape 1024×768', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('T04 tablet landscape · heroes', async ({ page }) => {
    await seedHero(page, { name: 'A', userName: 'tla', class: 'warrior',  balance: 15 });
    await seedHero(page, { name: 'B', userName: 'tlb', class: 'magician', balance: 4  });
    await seedHero(page, { name: 'C', userName: 'tlc', class: 'healer',   balance: 9  });
    await page.evaluate(() => window.renderKids());
    await captureFullPage(page, 'T04-tablet-l-heroes');
  });

  test('T05 tablet landscape · minigame · maze', async ({ page }) => {
    await seedHero(page, { userName: 'tlmaze' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('fischer-sebastian');
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 4;
      window.renderAdventure();
    });
    await captureFullPage(page, 'T05-tablet-l-maze');
  });
});
