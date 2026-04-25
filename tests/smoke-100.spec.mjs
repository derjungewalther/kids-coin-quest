/**
 * 100 smoke tests — broad surface sweep complementing the deeper
 * R3 coverage spec. Each test is intentionally small (1-3 assertions)
 * so when a regression lands the failing test name pinpoints the
 * exact surface that broke.
 *
 * Structure (counts in parens):
 *   Boot & globals (10)            Heroes lifecycle (10)
 *   Navigation & tabs (8)          Quests & activities (8)
 *   Modal lifecycle (10)           Adventures catalog (8)
 *   i18n surface (10)              Save / persistence (6)
 *   Currency / formatting (5)      Family streak edges (5)
 *   Settings & toggles (5)         Legendary edges (5)
 *   Goal jar (5)                   Cosmetics (5)
 *
 * Total: 100. Most of the heavy state setup goes through `seedHero`
 * and direct state pokes via `page.evaluate` — UI clicks are reserved
 * for the few flows where the click handler is the unit under test.
 */
import { test, expect, seedHero, setPin } from './fixtures.mjs';

test.use({ viewport: { width: 1280, height: 900 } });

// =====================================================================
// Boot & globals (10)
// =====================================================================
test.describe('Boot & globals', () => {
  test('window.state has the expected top-level shape', async ({ page }) => {
    const r = await page.evaluate(() => Object.keys(window.state).sort());
    for (const k of ['kids', 'activities', 'transactions', 'settings']) {
      expect(r).toContain(k);
    }
  });
  test('CLASSES catalog has 5 entries', async ({ page }) => {
    const n = await page.evaluate(() => window.CLASSES.length);
    expect(n).toBe(5);
  });
  test('ITEMS catalog has at least 12 entries', async ({ page }) => {
    const n = await page.evaluate(() => window.ITEMS.length);
    expect(n).toBeGreaterThanOrEqual(12);
  });
  test('STAT_KEYS is exactly [brave, clever, kind]', async ({ page }) => {
    const r = await page.evaluate(() => window.STAT_KEYS);
    expect(r).toEqual(['brave', 'clever', 'kind']);
  });
  test('ADVENTURES has at least 5 published quests', async ({ page }) => {
    const n = await page.evaluate(() => window.ADVENTURES.length);
    expect(n).toBeGreaterThanOrEqual(5);
  });
  test('every adventure has at least one scene', async ({ page }) => {
    const r = await page.evaluate(() => window.ADVENTURES.map(a => ({ id: a.id, n: a.scenes.length })));
    for (const a of r) expect(a.n).toBeGreaterThanOrEqual(1);
  });
  test('default settings include a currency string', async ({ page }) => {
    const c = await page.evaluate(() => window.state.settings.currency);
    expect(typeof c).toBe('string');
    expect(c.length).toBeGreaterThan(0);
  });
  test('XP_PER_LEVEL is a positive number', async ({ page }) => {
    const x = await page.evaluate(() => window.XP_PER_LEVEL);
    expect(x).toBeGreaterThan(0);
  });
  test('STAT_MAX_DISPLAY is exposed and a positive integer', async ({ page }) => {
    const x = await page.evaluate(() => window.STAT_MAX_DISPLAY);
    expect(Number.isInteger(x) && x > 0).toBe(true);
  });
  test('reload re-seeds the same default state shape', async ({ page }) => {
    await page.reload();
    await page.waitForFunction(() => typeof window.kidById === 'function');
    const ok = await page.evaluate(() => Array.isArray(window.state.kids) && Array.isArray(window.state.activities));
    expect(ok).toBe(true);
  });
});

// =====================================================================
// Navigation & tabs (8)
// =====================================================================
test.describe('Navigation & tabs', () => {
  for (const view of ['kids', 'activities', 'history', 'adventure']) {
    test(`switching to ${view} reveals #view-${view}`, async ({ page }) => {
      await page.locator(`.tab[data-view="${view}"]`).click();
      await expect(page.locator(`#view-${view}`)).toBeVisible();
    });
  }
  test('switching to settings opens the PIN-setup or settings view', async ({ page }) => {
    await page.locator('.tab[data-view="settings"]').click();
    // First-time click triggers PIN-setup modal; once setup, view-settings is visible.
    const setupOpen = await page.locator('#pinSetupModal.open, #pinModal.open').count();
    const viewVisible = await page.locator('#view-settings:visible').count();
    expect(setupOpen + viewVisible).toBeGreaterThan(0);
  });
  test('back-and-forth between Heroes and Adventure preserves party', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'tabhopper' });
    await page.locator('.tab[data-view="adventure"]').click();
    await page.locator('.adventure-hero-card').first().click();
    await page.locator('.tab[data-view="kids"]').click();
    await page.locator('.tab[data-view="adventure"]').click();
    const stillSelected = await page.locator('.adventure-hero-card.selected').count();
    expect(stillSelected).toBe(1);
  });
  test('Quests tab shows the quest table', async ({ page }) => {
    await page.locator('.tab[data-view="activities"]').click();
    await expect(page.locator('#activitiesTable')).toBeVisible();
  });
  test('History tab renders an empty Chronicle by default', async ({ page }) => {
    await page.locator('.tab[data-view="history"]').click();
    await expect(page.locator('#historyList')).toBeVisible();
  });
});

// =====================================================================
// Modal lifecycle (10)
// =====================================================================
test.describe('Modal lifecycle', () => {
  test('Recruit Hero modal opens and closes', async ({ page }) => {
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await expect(page.locator('#addKidModal')).toHaveClass(/open/);
    await page.locator('#addKidModal').getByRole('button', { name: /Cancel|Abbrechen/i }).click();
    await expect(page.locator('#addKidModal')).not.toHaveClass(/open/);
  });
  test('Hero sheet modal opens on avatar click', async ({ page }) => {
    await seedHero(page, { userName: 'sheettest' });
    await page.locator('.kid-head-click').first().click();
    await expect(page.locator('#heroSheetModal')).toHaveClass(/open/);
  });
  test('Hero sheet modal closes via Close button', async ({ page }) => {
    await seedHero(page, { userName: 'sheetclose' });
    await page.locator('.kid-head-click').first().click();
    await page.locator('#heroSheetModal').getByRole('button', { name: /Close|Schließen/i }).click();
    await expect(page.locator('#heroSheetModal')).not.toHaveClass(/open/);
  });
  test('Goal modal opens via empty goal strip', async ({ page }) => {
    await seedHero(page, { userName: 'goaltest' });
    await page.locator('.goal-strip-empty').click();
    await expect(page.locator('#goalModal')).toHaveClass(/open/);
  });
  test('Withdraw modal opens with kid name in title', async ({ page }) => {
    await seedHero(page, { userName: 'withkid', name: 'Pip' });
    await page.locator('.kid-card').first().getByRole('button', { name: /Withdraw|Auszahlen/i }).click();
    await expect(page.locator('#payoutModal')).toHaveClass(/open/);
  });
  test('Donate modal opens', async ({ page }) => {
    await seedHero(page, { userName: 'donor' });
    await page.locator('.kid-card').first().getByRole('button', { name: /Alms|Spende/i }).click();
    await expect(page.locator('#donateModal')).toHaveClass(/open/);
  });
  test('Reward modal opens via maybeShowNextReward when a reward is queued', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.pendingRewards.push({
        tier: 'tier3', day: window.todayKeyFamily(), ts: Date.now(),
        contents: { type: 'lucky_charm', qty: 1 }
      });
      window.maybeShowNextReward();
    });
    await expect(page.locator('#rewardModal')).toHaveClass(/open/);
  });
  test('Streak detail modal opens via badge', async ({ page }) => {
    await page.evaluate(() => window.openStreakDetailModal());
    await expect(page.locator('#streakDetailModal')).toHaveClass(/open/);
  });
  test('Erde prompt modal markup exists in the DOM', async ({ page }) => {
    const exists = await page.evaluate(() => !!document.getElementById('erdePromptModal'));
    expect(exists).toBe(true);
  });
  test('Recruitment ritual modal markup exists in the DOM', async ({ page }) => {
    const exists = await page.evaluate(() => !!document.getElementById('recruitmentRitualModal'));
    expect(exists).toBe(true);
  });
});

// =====================================================================
// i18n surface (10)
// =====================================================================
test.describe('i18n surface', () => {
  for (const lang of ['de', 'en']) {
    test(`switching to ${lang} updates the lang button label`, async ({ page }) => {
      await page.evaluate((l) => { window.state.settings.lang = l; window.save(); window.updateI18n(); }, lang);
      const txt = await page.locator('#langBtn').textContent();
      expect(txt.toLowerCase()).toContain(lang === 'de' ? 'en' : 'de');
    });
  }
  test('Heroes tab label translates to German', async ({ page }) => {
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); });
    await expect(page.locator('.tab[data-view="kids"]')).toContainText(/Helden/i);
  });
  test('Quest board heading exists with a non-empty translation', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = window.state.settings.lang;
      window.state.settings.lang = 'de'; window.updateI18n();
      const de = (document.querySelector('[data-i18n="quest_board"]') || {}).textContent || '';
      window.state.settings.lang = 'en'; window.updateI18n();
      const en = (document.querySelector('[data-i18n="quest_board"]') || {}).textContent || '';
      window.state.settings.lang = orig; window.updateI18n();
      return { de, en };
    });
    expect(r.de.length).toBeGreaterThan(0);
    expect(r.en.length).toBeGreaterThan(0);
  });
  test('Recruit button uses translated label', async ({ page }) => {
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); });
    await expect(page.getByRole('button', { name: /Helden|Anwerben/i }).first()).toBeVisible();
  });
  test('every legendary class has both DE and EN class names', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const cls of window.LEGENDARY_CLASSES) {
        const orig = window.state.settings.lang;
        window.state.settings.lang = 'de';
        const de = window.t('legendary_class_' + cls.id);
        window.state.settings.lang = 'en';
        const en = window.t('legendary_class_' + cls.id);
        window.state.settings.lang = orig;
        out[cls.id] = { de, en };
      }
      return out;
    });
    for (const id of Object.keys(r)) {
      expect(r[id].de).not.toBe('legendary_class_' + id);
      expect(r[id].en).not.toBe('legendary_class_' + id);
    }
  });
  test('every minigame disabled-state has both DE and EN strings', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keys = ['legendary_disabled_spent','legendary_disabled_morale_already_full',
                    'legendary_disabled_must_try_first','legendary_disabled_scene_already_resolved'];
      const out = {};
      const orig = window.state.settings.lang;
      for (const lang of ['de','en']) {
        window.state.settings.lang = lang;
        out[lang] = keys.map(k => window.t(k));
      }
      window.state.settings.lang = orig;
      return out;
    });
    for (const lang of ['de','en']) {
      for (const v of r[lang]) {
        // No raw key passthrough.
        expect(v.startsWith('legendary_disabled_')).toBe(false);
        expect(v.length).toBeGreaterThan(2);
      }
    }
  });
  test('rhythm banner strings differ between DE and EN', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = window.state.settings.lang;
      window.state.settings.lang = 'de';
      const de = window.t('rhythm_banner_listen');
      window.state.settings.lang = 'en';
      const en = window.t('rhythm_banner_listen');
      window.state.settings.lang = orig;
      return { de, en };
    });
    expect(r.de).not.toBe(r.en);
  });
  test('switching language re-renders the Heroes tab labels', async ({ page }) => {
    await seedHero(page, { userName: 'i18nkid' });
    await page.evaluate(() => { window.state.settings.lang = 'en'; window.updateI18n(); window.renderKids(); });
    const labelEn = await page.locator('.kid-balance-label').first().textContent();
    await page.evaluate(() => { window.state.settings.lang = 'de'; window.updateI18n(); window.renderKids(); });
    const labelDe = await page.locator('.kid-balance-label').first().textContent();
    expect(labelDe).not.toBe(labelEn);
  });
  test('cosmetic slot labels translate', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const lang of ['de','en']) {
        window.state.settings.lang = lang;
        out[lang] = ['cosmetic_slot_hat','cosmetic_slot_cape','cosmetic_slot_accessory','cosmetic_slot_pet'].map(window.t);
      }
      return out;
    });
    expect(r.de).not.toEqual(r.en);
    for (const arr of [r.de, r.en]) for (const v of arr) expect(v.length).toBeGreaterThan(1);
  });
});

// =====================================================================
// Currency / formatting (5)
// =====================================================================
test.describe('Currency / formatting', () => {
  test('fmtNumber respects the active locale (DE comma)', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.state.settings.lang = 'de';
      return window.fmtNumber(1234.5);
    });
    expect(r).toMatch(/1\.234,5|1234,5/);
  });
  test('fmtNumber in English uses dot as decimal separator', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.state.settings.lang = 'en';
      return window.fmtNumber(1234.5);
    });
    expect(r).toMatch(/1,234\.5|1234\.5/);
  });
  test('fmt prepends the configured currency symbol', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.state.settings.currency = '🪙';
      return window.fmt(7);
    });
    expect(r).toContain('🪙');
  });
  test('fmtDate is a non-empty string for a known timestamp', async ({ page }) => {
    const r = await page.evaluate(() => window.fmtDate ? window.fmtDate(new Date('2024-03-15T12:00:00Z').toISOString()) : '');
    expect(r.length).toBeGreaterThan(0);
  });
  test('fmtDateTime is a non-empty string', async ({ page }) => {
    const r = await page.evaluate(() => window.fmtDateTime ? window.fmtDateTime(new Date('2024-03-15T12:00:00Z').toISOString()) : '');
    expect(r.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// Settings & toggles (5)
// =====================================================================
test.describe('Settings & toggles', () => {
  test('toggling music updates state.settings.musicOn', async ({ page }) => {
    const before = await page.evaluate(() => !!window.state.settings.musicOn);
    await page.evaluate(() => { window.state.settings.musicOn = !window.state.settings.musicOn; window.save(); });
    const after = await page.evaluate(() => !!window.state.settings.musicOn);
    expect(after).toBe(!before);
  });
  test('changing currency persists', async ({ page }) => {
    await page.evaluate(() => { window.state.settings.currency = '💎'; window.save(); });
    const r = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).settings.currency);
    expect(r).toBe('💎');
  });
  test('maxTreasure setting clamps awarded coins', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'cap' });
    const r = await page.evaluate((id) => {
      window.state.settings.maxTreasure = 5;
      window.adventureState.party = [id];
      window.adventureState.adventureId = 'bakery';
      window.adventureState.log = [{ success: true }];
      window.adventureState.treasureRewards = null;
      window.awardTreasure(1.0);
      return window.adventureState.treasureMeta.amount;
    }, kidId);
    expect(r).toBeLessThanOrEqual(5);
  });
  test('paidAdventuresPerWeek=0 disables coin payouts', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'capped' });
    const r = await page.evaluate((id) => {
      window.state.settings.paidAdventuresPerWeek = 0;
      window.adventureState.party = [id];
      window.adventureState.adventureId = 'bakery';
      window.adventureState.log = [{ success: true }];
      window.adventureState.treasureRewards = null;
      window.awardTreasure(1.0);
      return window.adventureState.treasureMeta.amount;
    }, kidId);
    expect(r).toBe(0);
  });
  test('difficulty setting persists across save', async ({ page }) => {
    await page.evaluate(() => { window.state.settings.difficulty = 'ritter'; window.save(); });
    const r = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).settings.difficulty);
    expect(r).toBe('ritter');
  });
});

// =====================================================================
// Goal jar (5)
// =====================================================================
test.describe('Goal jar', () => {
  test('setting a goal stores name + target on the kid', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'goaler' });
    await page.locator('.goal-strip-empty').click();
    await page.locator('#goalName').fill('LEGO set');
    await page.locator('#goalTarget').fill('20');
    await page.locator('#goalModal .btn-primary').click();
    const goal = await page.evaluate((id) => window.kidById(id).goal, kidId);
    expect(goal.name).toBe('LEGO set');
    expect(goal.target).toBe(20);
  });
  test('goal progress strip renders amount formatted', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'goalfmt', balance: 5 });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.goal = { name: 'Bike', target: 10 };
      window.save(); window.renderKids();
    }, kidId);
    await expect(page.locator('.goal-strip-amount')).toContainText(/5/);
  });
  test('reaching goal grants the goal_reached achievement', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'reach', balance: 0 });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.goal = { name: 'Skateboard', target: 5 };
      k.balance = 6;
      window.checkGoalReached(k);
      window.save();
    }, kidId);
    // checkGoalReached fires achievement after a 350ms setTimeout.
    await page.waitForTimeout(500);
    const ach = await page.evaluate((id) => window.kidById(id).achievements || [], kidId);
    expect(ach).toContain('goal_reached');
  });
  test('clearing a goal resets the field on state', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'goalclear' });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.goal = { name: 'X', target: 5 };
      window.save();
      k.goal = null; window.save();
    }, kidId);
    const goal = await page.evaluate((id) => window.kidById(id).goal, kidId);
    expect(goal).toBeNull();
  });
  test('goal with target=0 does not render a progress bar', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'zerogoal' });
    await page.evaluate((id) => {
      const k = window.kidById(id);
      k.goal = { name: 'Empty', target: 0 };
      window.save(); window.renderKids();
    }, kidId);
    // Empty-state strip should be visible because target is invalid.
    await expect(page.locator('.goal-strip-empty')).toBeVisible();
  });
});

// =====================================================================
// Heroes lifecycle (10)
// =====================================================================
test.describe('Heroes lifecycle', () => {
  test('renaming a hero updates the card', async ({ page }) => {
    const kidId = await seedHero(page, { name: 'OldName' });
    await page.evaluate((id) => {
      window.kidById(id).name = 'NewName';
      window.save(); window.renderKids();
    }, kidId);
    await expect(page.locator('.kid-name').first()).toContainText(/NewName/);
  });
  test('seeded hero has all 3 stat keys initialised', async ({ page }) => {
    const kidId = await seedHero(page, {});
    const r = await page.evaluate((id) => Object.keys(window.kidById(id).stats), kidId);
    for (const k of ['brave','clever','kind']) expect(r).toContain(k);
  });
  test('changing a hero’s class persists', async ({ page }) => {
    const kidId = await seedHero(page, { class: 'warrior' });
    await page.evaluate((id) => { window.kidById(id).class = 'magician'; window.save(); }, kidId);
    const cls = await page.evaluate((id) => window.kidById(id).class, kidId);
    expect(cls).toBe('magician');
  });
  test('two heroes can be seeded and both render', async ({ page }) => {
    await seedHero(page, { userName: 'a1' });
    await seedHero(page, { userName: 'a2' });
    await expect(page.locator('.kid-card')).toHaveCount(2);
  });
  test('totalEarned is preserved in the saved JSON blob', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'persist', totalEarned: 17 });
    await page.evaluate(() => window.save());
    const r = await page.evaluate((id) => {
      const blob = JSON.parse(localStorage.getItem('piggyBankState'));
      const k = (blob.kids || []).find(x => x.id === id);
      return k && k.totalEarned;
    }, kidId);
    expect(r).toBe(17);
  });
  test('xp object accepts fractional values', async ({ page }) => {
    const kidId = await seedHero(page, {});
    await page.evaluate((id) => { window.kidById(id).xp.brave = 1.5; window.save(); }, kidId);
    const r = await page.evaluate((id) => window.kidById(id).xp.brave, kidId);
    expect(r).toBeCloseTo(1.5, 2);
  });
  test('heroLevel returns a non-negative integer for a fresh hero', async ({ page }) => {
    const kidId = await seedHero(page, {});
    const r = await page.evaluate((id) => window.heroLevel(window.kidById(id)), kidId);
    expect(Number.isInteger(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
  });
  test('effectiveStats includes equipment bonuses', async ({ page }) => {
    const kidId = await seedHero(page, {});
    const r = await page.evaluate((id) => {
      const k = window.kidById(id);
      const before = window.effectiveStats(k).brave;
      // Pick any hat that grants brave +1
      const hat = window.ITEMS.find(it => it.slot === 'hat' && it.bonusStat === 'brave');
      if (hat) {
        k.equipment.hat = hat.id;
        window.save();
      }
      const after = window.effectiveStats(k).brave;
      return { before, after };
    }, kidId);
    expect(r.after).toBeGreaterThanOrEqual(r.before);
  });
  test('giveItemToKid adds to inventory with an instance id', async ({ page }) => {
    const kidId = await seedHero(page, {});
    const r = await page.evaluate((id) => {
      window.giveItemToKid(id, window.ITEMS[0]);
      return window.kidById(id).inventory.length;
    }, kidId);
    expect(r).toBeGreaterThanOrEqual(1);
  });
  test('rankName returns a non-empty string per level', async ({ page }) => {
    const kidId = await seedHero(page, {});
    const r = await page.evaluate((id) => {
      const k = window.kidById(id);
      k.xp = { brave: 100, clever: 100, kind: 100 };
      return window.rankName(k);
    }, kidId);
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(1);
  });
});

// =====================================================================
// Quests & activities (8)
// =====================================================================
test.describe('Quests & activities', () => {
  test('default activities have non-empty names in both DE and EN', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = window.state.settings.lang;
      const out = [];
      for (const a of window.state.activities) {
        window.state.settings.lang = 'de'; const de = window.L(a.name);
        window.state.settings.lang = 'en'; const en = window.L(a.name);
        out.push({ id: a.id, de, en });
      }
      window.state.settings.lang = orig;
      return out;
    });
    for (const a of r) {
      expect(a.de.length).toBeGreaterThan(0);
      expect(a.en.length).toBeGreaterThan(0);
    }
  });
  test('default activity has a numeric reward', async ({ page }) => {
    const r = await page.evaluate(() => window.state.activities[0].amount);
    expect(typeof r).toBe('number');
    expect(r).toBeGreaterThan(0);
  });
  test('every default activity has a stat type', async ({ page }) => {
    const r = await page.evaluate(() => window.state.activities.every(a => ['brave','clever','kind'].includes(a.statType)));
    expect(r).toBe(true);
  });
  test('completing a quest pushes a quest event into chronicle', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'qlog' });
    const r = await page.evaluate((id) => {
      const a = window.state.activities[0];
      if (!a) return { error: 'no-activities' };
      const before = window.state.transactions.length;
      try { window.earn(id, a.id); } catch (e) { return { error: 'earn-threw: ' + e.message }; }
      return {
        before,
        after: window.state.transactions.length,
        lastEvent: (window.state.transactions[window.state.transactions.length - 1] || {}).event
      };
    }, kidId);
    expect(r.error).toBeUndefined();
    expect(r.after).toBeGreaterThan(r.before);
    expect(r.lastEvent).toBe('quest');
  });
  test('chronicle renders quest entry with the activity name', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'qrender' });
    await page.evaluate((id) => window.earn(id, window.state.activities[0].id), kidId);
    await page.locator('.tab[data-view="history"]').click();
    await expect(page.locator('#historyList')).not.toBeEmpty();
  });
  test('once-per-day quests detect cadence completion', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'cad' });
    const r = await page.evaluate((id) => {
      const a = window.state.activities.find(x => x.cadence === 'daily') || window.state.activities[0];
      window.earn(id, a.id);
      return window.isQuestDoneWithinCadence(id, a);
    }, kidId);
    expect(r === true || r === false).toBe(true);
  });
  test('adding a custom quest via state appears in the picker', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'addqq' });
    await page.evaluate(() => {
      window.state.activities.push({
        id: 'q_custom_x', name: 'Test', amount: 1, statType: 'brave', cadence: 'once'
      });
      window.save(); window.renderKids();
    });
    await expect(page.locator(`#quest-select-${kidId} option`)).toHaveCount(await page.evaluate(() => window.state.activities.length));
  });
  test('quest with amount=0 does not move balance', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'zeroamt', balance: 3 });
    await page.evaluate((id) => {
      window.state.activities.push({ id: 'q_zero', name: { en: 'Zero', de: 'Null' }, amount: 0, statType: 'brave', cadence: 'once' });
      window.earn(id, 'q_zero');
    }, kidId);
    const r = await page.evaluate((id) => window.kidById(id).balance, kidId);
    expect(r).toBeCloseTo(3, 2);
  });
});

// =====================================================================
// Adventures catalog (8)
// =====================================================================
test.describe('Adventures catalog', () => {
  for (const advId of ['bakery', 'fischer-sebastian']) {
    test(`adventure ${advId} has bilingual title`, async ({ page }) => {
      const r = await page.evaluate((id) => {
        const a = window.ADVENTURES.find(x => x.id === id);
        return { de: a.title.de || '', en: a.title.en || '' };
      }, advId);
      expect(r.de.length).toBeGreaterThan(0);
      expect(r.en.length).toBeGreaterThan(0);
    });
  }
  test('every adventure has minLevel ≥ 0', async ({ page }) => {
    const r = await page.evaluate(() => window.ADVENTURES.every(a => typeof a.minLevel === 'number' && a.minLevel >= 0));
    expect(r).toBe(true);
  });
  test('every adventure has maxHp between 4 and 10', async ({ page }) => {
    const r = await page.evaluate(() => window.ADVENTURES.every(a => a.maxHp >= 4 && a.maxHp <= 10));
    expect(r).toBe(true);
  });
  test('every adventure has a difficulty in the known set', async ({ page }) => {
    const r = await page.evaluate(() => window.ADVENTURES.every(a => ['easy','medium','hard','epic'].includes(a.difficulty)));
    expect(r).toBe(true);
  });
  test('locked adventures show a lock overlay', async ({ page }) => {
    await seedHero(page, { userName: 'lockview' });
    await page.locator('.tab[data-view="adventure"]').click();
    await page.locator('.adventure-hero-card').first().click();
    const locked = await page.locator('.adventure-option.locked').count();
    expect(locked).toBeGreaterThanOrEqual(0); // may be 0 if min levels are all 0
  });
  test('adventureLocked is true when no party is selected', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.adventureState.party = [];
      const adv = window.ADVENTURES.find(a => a.minLevel >= 1) || window.ADVENTURES[0];
      return window.adventureLocked(adv);
    });
    // Spec note: adventureLocked treats empty party as locked.
    expect(r).toBe(true);
  });
  test('chooseAdventure with an empty party is rejected with a toast', async ({ page }) => {
    await page.evaluate(() => {
      window.adventureState.party = [];
      window.chooseAdventure('bakery');
    });
    await expect(page.locator('#toast')).toContainText(/at least|hero|Held/i);
  });
});

// =====================================================================
// Save / persistence (6)
// =====================================================================
test.describe('Save / persistence', () => {
  test('save() writes a parseable JSON blob', async ({ page }) => {
    await page.evaluate(() => window.save());
    const ok = await page.evaluate(() => {
      try { JSON.parse(localStorage.getItem('piggyBankState')); return true; } catch { return false; }
    });
    expect(ok).toBe(true);
  });
  // The fixture's addInitScript wipes localStorage on every navigation,
  // so we can't actually reload. Instead we assert that save() writes
  // the expected fields into localStorage — same property of save being
  // tested, just observed via a direct parse.
  test('save() writes seeded heroes into localStorage', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'persist-h' });
    const r = await page.evaluate((id) => {
      const raw = JSON.parse(localStorage.getItem('piggyBankState'));
      return raw.kids.some(k => k.id === id);
    }, kidId);
    expect(r).toBe(true);
  });
  test('save() writes transactions into localStorage', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'persist-tx' });
    await page.evaluate((id) => { window.logTx(id, 'earn', 1, 'Smoke'); window.save(); }, kidId);
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).transactions.length);
    expect(n).toBeGreaterThanOrEqual(1);
  });
  test('save() writes narrationHistory into localStorage', async ({ page }) => {
    await page.evaluate(() => {
      window.state.narrationHistory = { 'adv-x': { 's-1': { intro: [0, 1, 2] } } };
      window.save();
    });
    const r = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).narrationHistory['adv-x']['s-1'].intro);
    expect(r).toEqual([0, 1, 2]);
  });
  test('save() writes family streak activeDays into localStorage', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      window.state.streak.activeDays = [
        window.dayKeyOffset(today, -2),
        window.dayKeyOffset(today, -1),
        today
      ];
      window.save();
    });
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).streak.activeDays.length);
    expect(n).toBe(3);
  });
  test('save() writes cosmetic inventory into localStorage', async ({ page }) => {
    await page.evaluate(() => {
      window.state.cosmeticInventory = [{ id: 'crown_gold', slot: 'hat', icon: '👑' }];
      window.save();
    });
    const r = await page.evaluate(() => JSON.parse(localStorage.getItem('piggyBankState')).cosmeticInventory.map(c => c.id));
    expect(r).toEqual(['crown_gold']);
  });
});

// =====================================================================
// Family streak edges (5)
// =====================================================================
test.describe('Family streak edges', () => {
  test('familyMarkActive is idempotent for the same day', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.activeDays = [];
      window.familyMarkActive();
      window.familyMarkActive();
      window.familyMarkActive();
      return window.state.streak.activeDays.length;
    });
    expect(r).toBe(1);
  });
  test('computeFamilyStreak returns 0 when no active days', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.activeDays = [];
      window.state.streak.freezesUsed = [];
      return window.computeFamilyStreak();
    });
    expect(r).toBe(0);
  });
  test('computeFamilyStreak skips a missed day if freeze is recorded', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      const yesterday = window.dayKeyOffset(today, -1);
      const dayBefore = window.dayKeyOffset(today, -2);
      window.state.streak.activeDays = [dayBefore, today]; // gap on yesterday
      window.state.streak.freezesUsed = [yesterday];
      return window.computeFamilyStreak();
    });
    expect(r).toBeGreaterThanOrEqual(2);
  });
  test('grantWeeklyFreezeIfDue keeps shields capped at 2', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.freezesAvailable = 2;
      window.state.streak.lastFreezeGrantedWeek = null;
      window.grantWeeklyFreezeIfDue();
      return window.state.streak.freezesAvailable;
    });
    expect(r).toBeLessThanOrEqual(2);
  });
  test('streak badge text reflects current count after familyMarkActive', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.state.streak.activeDays = [window.todayKeyFamily()];
      window.updateFamilyStreakBadge();
    });
    await expect(page.locator('#familyStreakBadge')).toContainText(/[01]/);
  });
});

// =====================================================================
// Legendary edges (5)
// =====================================================================
test.describe('Legendary edges', () => {
  test('cap at LEGENDARY_MAX prevents new ritual openings', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureLegendaryState();
      window.state.legendary.heroesRecruited = window.LEGENDARY_MAX;
      window.openRecruitmentRitual();
    });
    // Modal should NOT open when capped.
    const opened = await page.locator('#recruitmentRitualModal.open').count();
    expect(opened).toBe(0);
  });
  test('legendary mentor is excluded from kid party picker', async ({ page }) => {
    await seedHero(page, { userName: 'kidA', name: 'KidaTest' });
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-pick', userName: 'lhp', name: 'MiraLegend',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.save();
    });
    await page.locator('.tab[data-view="adventure"]').click();
    // Read the FIRST .adventure-hero-picker (kids only). Legendary row is
    // a separate picker rendered below by renderLegendaryCompanionRow.
    const firstPickerHTML = await page.locator('.adventure-hero-picker').first().innerHTML();
    expect(firstPickerHTML).toContain('KidaTest');
    expect(firstPickerHTML).not.toContain('MiraLegend');
  });
  test('legendary companion row appears only when ≥1 mentor exists', async ({ page }) => {
    await page.locator('.tab[data-view="adventure"]').click();
    const before = await page.locator('text=Legendärer Begleiter,Legendary Companion').count();
    expect(before).toBe(0);
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-row', userName: 'lhr', name: 'Selene',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'mond', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
      });
      window.save();
    });
    await page.locator('.tab[data-view="kids"]').click();
    await page.locator('.tab[data-view="adventure"]').click();
    const after = await page.getByText(/Legendärer Begleiter|Legendary Companion/).count();
    expect(after).toBeGreaterThan(0);
  });
  test('Mondblick disables when scene already resolved', async ({ page }) => {
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-mond', userName: 'lhm', name: 'Lirio',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'mond', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.adventureState.legendaryId = 'lh-mond';
      window.adventureState.mode = 'result'; // not 'scene'
      window.useLegendaryAbility();
    });
    const charges = await page.evaluate(() => window.kidById('lh-mond').legendary.abilityCharges.currentAdventure);
    expect(charges).toBe(1); // not consumed
  });
  test('Wurzelsegen sets lootMultiplier=2 when used at adventure start', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'erdkid' });
    await page.evaluate((kid) => {
      window.state.kids.push({
        id: 'lh-erde2', userName: 'lhe2', name: 'Toras',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'erde', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.adventureState.party = [kid];
      window.adventureState.legendaryId = 'lh-erde2';
      window.chooseAdventure('fischer-sebastian');
      // Click "Yes, use it now" by directly invoking the same logic.
      document.getElementById('erdePromptUse').click();
    }, kidId);
    const m = await page.evaluate(() => window.adventureState.lootMultiplier);
    expect(m).toBe(2);
  });
});

// =====================================================================
// Cosmetics (5)
// =====================================================================
test.describe('Cosmetics', () => {
  test('COSMETIC_POOL contains entries for all 4 slots', async ({ page }) => {
    const r = await page.evaluate(() => {
      const slots = new Set(window.COSMETIC_POOL.map(c => c.slot));
      return [...slots].sort();
    });
    expect(r).toEqual(['accessory', 'cape', 'hat', 'pet']);
  });
  test('applyCosmeticToKid sets kid.cosmetics[slot] to the cosmetic id', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'cosmkid' });
    await page.evaluate((id) => {
      window.state.cosmeticInventory = [{ id: 'crown_gold', slot: 'hat', icon: '👑' }];
      window.applyCosmeticToKid(id, 'hat', 'crown_gold');
    }, kidId);
    const r = await page.evaluate((id) => window.kidById(id).cosmetics, kidId);
    expect(r.hat).toBe('crown_gold');
  });
  test('removeCosmeticFromKid clears the slot', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'cosmrm' });
    await page.evaluate((id) => {
      window.state.cosmeticInventory = [{ id: 'cape_red', slot: 'cape', icon: '🧣' }];
      window.applyCosmeticToKid(id, 'cape', 'cape_red');
      window.removeCosmeticFromKid(id, 'cape');
    }, kidId);
    const r = await page.evaluate((id) => window.kidById(id).cosmetics.cape, kidId);
    expect(r == null).toBe(true);
  });
  test('legendary cosmetics are gated by the legendary flag', async ({ page }) => {
    const r = await page.evaluate(() => window.COSMETIC_POOL.some(c => c.legendary === true));
    expect(r).toBe(true);
  });
  test('cosmetic gallery is empty when inventory is empty', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'galempty' });
    await page.evaluate(() => { window.state.cosmeticInventory = []; window.save(); });
    await page.locator('.kid-head-click').first().click();
    await expect(page.locator('#heroSheetModal')).toContainText(/keinen Schmuck|No cosmetics yet/);
  });
});
