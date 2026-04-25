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
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('test-results/visual');
try { mkdirSync(OUT_DIR, { recursive: true }); } catch (e) {}

async function captureFullPage(page, name) {
  // Wait for fonts + any in-flight CSS animation to settle.
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // Disable animations so dice / hero pulses don't smear the shot.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function captureViewport(page, name) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

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
    await page.evaluate(() => { window.ensureLegendaryState(); window.openRecruitmentRitual(); });
    await captureFullPage(page, '14-ritual-step1-invocation');
  });

  test('15 ritual step 2 (class offering)', async ({ page }) => {
    await page.evaluate(() => { window.ensureLegendaryState(); window.openRecruitmentRitual(); });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await captureFullPage(page, '15-ritual-step2-classes');
  });

  test('16 ritual step 5 (welcome)', async ({ page }) => {
    await page.evaluate(() => { window.ensureLegendaryState(); window.openRecruitmentRitual(); });
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

  test('21 minigame · count flash phase', async ({ page }) => {
    await seedHero(page, { userName: 'mg21' });
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure("fischer-sebastian");
      const advTab = document.querySelector('.tab[data-view="adventure"]');
      if (advTab) advTab.click();
      window.beginScenes();
      window.adventureState.sceneIdx = 3; // Schwarmzählung = count
      window.renderAdventure();
    });
    // Capture during the flash phase (before transition to guess).
    await page.waitForTimeout(800);
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
    await page.evaluate(() => { window.ensureLegendaryState(); window.openRecruitmentRitual(); });
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await captureFullPage(page, 'M05-mobile-ritual-classes');
  });
});
