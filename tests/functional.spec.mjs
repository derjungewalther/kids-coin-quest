/**
 * Functional tests — exercise pure logic directly via page.evaluate().
 * These verify the internal functions that back the game mechanics.
 */
import { test, expect, seedHero } from './fixtures.mjs';
import { test as rawTest } from '@playwright/test';

// ---------- XP & LEVELS ----------

test.describe('XP and leveling', () => {
  test('xpLevelBonus floors at 0 and increments every 5 XP', async ({ page }) => {
    const results = await page.evaluate(() => [
      xpLevelBonus(0),
      xpLevelBonus(4),
      xpLevelBonus(5),
      xpLevelBonus(9),
      xpLevelBonus(10),
      xpLevelBonus(24)
    ]);
    expect(results).toEqual([0, 0, 1, 1, 2, 4]);
  });

  test('xpInLevel returns progress within current level', async ({ page }) => {
    const values = await page.evaluate(() => [
      xpInLevel(0),
      xpInLevel(4),
      xpInLevel(5),
      xpInLevel(7),
      xpInLevel(10)
    ]);
    expect(values).toEqual([0, 4, 0, 2, 0]);
  });

  test('xpProgress is a ratio 0..1', async ({ page }) => {
    const p = await page.evaluate(() => [xpProgress(0), xpProgress(2.5), xpProgress(5)]);
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(0.5, 5);
    expect(p[2]).toBe(0);
  });
});

// ---------- CLASSES & STATS ----------

test.describe('Classes and stats', () => {
  test('5 classes are defined with the right bonuses', async ({ page }) => {
    const classes = await page.evaluate(() => window.CLASSES.map(c => ({ id: c.id, bonus: c.bonus })));
    expect(classes).toHaveLength(5);
    const byId = Object.fromEntries(classes.map(c => [c.id, c.bonus]));
    expect(byId.magician).toBe('clever');
    expect(byId.warrior).toBe('brave');
    expect(byId.healer).toBe('kind');
    expect(byId.elf).toBe('brave');
    expect(byId.bard).toBe('kind');
  });

  test('makeStats gives class the +1 bonus on its stat', async ({ page }) => {
    const stats = await page.evaluate(() => makeStats('magician'));
    expect(stats).toEqual({ brave: 1, clever: 2, kind: 1 });
  });

  test('effectiveStats caps at 5 per stat', async ({ page }) => {
    const kidId = await seedHero(page, { class: 'warrior', xp: { brave: 999, clever: 0, kind: 0 } });
    const eff = await page.evaluate((id) => effectiveStats(window.kidById(id)), kidId);
    expect(eff.brave).toBe(5); // capped, even with huge XP
    expect(eff.clever).toBe(1);
    expect(eff.kind).toBe(1);
  });

  test('statBreakdown reports base + xp + gear separately', async ({ page }) => {
    const kidId = await seedHero(page, { class: 'warrior', xp: { brave: 10, clever: 0, kind: 0 } });
    const bd = await page.evaluate((id) => statBreakdown(window.kidById(id), 'brave'), kidId);
    expect(bd.base).toBe(2);    // warrior base
    expect(bd.xpBonus).toBe(2); // 10 XP = 2 levels
    expect(bd.itemBonus).toBe(0);
    expect(bd.total).toBe(4);
  });

  test('rankName uses the new thresholds', async ({ page }) => {
    const ranks = await page.evaluate(() => {
      const mk = (lvl) => ({ xp: { brave: lvl * 5, clever: 0, kind: 0 } });
      return [
        rankName(mk(0)),  // Beginner
        rankName(mk(2)),  // Beginner (< 3)
        rankName(mk(3)),  // Adventurer
        rankName(mk(6)),  // Hero
        rankName(mk(10)), // Champion
        rankName(mk(15))  // Legend
      ];
    });
    expect(ranks[0]).toMatch(/beginner/i);
    expect(ranks[1]).toMatch(/beginner/i);
    expect(ranks[2]).toMatch(/adventurer/i);
    expect(ranks[3]).toMatch(/hero/i);
    expect(ranks[4]).toMatch(/champion/i);
    expect(ranks[5]).toMatch(/legend/i);
  });
});

// ---------- TREASURE CAP ----------

test.describe('Treasure awarding', () => {
  test('treasure never exceeds settings.maxTreasure even with max luck', async ({ page }) => {
    await seedHero(page, { userName: 'cap1' });
    const max = 7;
    // Force full-success log and call awardTreasure repeatedly. Luck is random
    // 0.7..1.3, so without clamping ~30% of runs would go over.
    const samples = await page.evaluate((maxVal) => {
      window.state.settings.maxTreasure = maxVal;
      window.state.settings.paidAdventuresPerWeek = 9999; // bypass weekly cap
      window.state.transactions = []; // reset so the weekly counter is clean
      const runs = [];
      for (let i = 0; i < 200; i++) {
        window.adventureState = {
          party: window.state.kids.map(k => k.id),
          log: Array.from({ length: 5 }, () => ({ success: true })),
          treasureRewards: null,
          treasureMeta: null,
          adventureId: 'grove'
        };
        window.awardTreasure();
        runs.push(window.adventureState.treasureMeta.amount);
      }
      return runs;
    }, max);
    for (const amt of samples) {
      expect(amt).toBeLessThanOrEqual(max);
      expect(amt).toBeGreaterThanOrEqual(1);
    }
  });

  test('treasure scales down with success ratio', async ({ page }) => {
    await seedHero(page, { userName: 'cap2' });
    const lowSuccess = await page.evaluate(() => {
      window.state.settings.maxTreasure = 100;
      window.state.settings.paidAdventuresPerWeek = 9999;
      window.state.transactions = [];
      const amounts = [];
      for (let i = 0; i < 50; i++) {
        window.adventureState = {
          party: window.state.kids.map(k => k.id),
          log: [
            { success: true }, { success: false }, { success: false },
            { success: false }, { success: false }
          ],
          treasureRewards: null,
          treasureMeta: null,
          adventureId: 'grove'
        };
        window.awardTreasure();
        amounts.push(window.adventureState.treasureMeta.amount);
      }
      return amounts;
    });
    // 1/5 success ratio × max 100 × luck (0.7..1.3) ≈ 14..26
    const avg = lowSuccess.reduce((a, b) => a + b, 0) / lowSuccess.length;
    expect(avg).toBeLessThan(35);
    expect(avg).toBeGreaterThan(5);
  });
});

// ---------- VOICE RANKING ----------

test.describe('Voice ranking', () => {
  test('novelty voices get heavily penalized', async ({ page }) => {
    const scores = await page.evaluate(() => {
      const mk = (name, lang) => ({ name, lang });
      return {
        grandma:   scoreVoice(mk('Grandma', 'en-US'), 'en'),
        badNews:   scoreVoice(mk('Bad News', 'en-US'), 'en'),
        zarvox:    scoreVoice(mk('Zarvox', 'en-US'), 'en'),
        samantha:  scoreVoice(mk('Samantha', 'en-US'), 'en'),
        premium:   scoreVoice(mk('Samantha (Premium)', 'en-US'), 'en'),
        plainDe:   scoreVoice(mk('Anna', 'de-DE'), 'de'),
        annaPrem:  scoreVoice(mk('Anna (Premium)', 'de-DE'), 'de')
      };
    });
    expect(scores.grandma).toBeLessThanOrEqual(-10);
    expect(scores.badNews).toBeLessThanOrEqual(-10);
    expect(scores.zarvox).toBeLessThanOrEqual(-10);
    expect(scores.premium).toBeGreaterThan(scores.samantha);
    expect(scores.annaPrem).toBeGreaterThan(scores.plainDe);
  });
});

// ---------- PIN HASHING ----------

test.describe('PIN hashing', () => {
  test('hashPin is deterministic and 64 hex chars', async ({ page }) => {
    const results = await page.evaluate(async () => [
      await hashPin('1234'),
      await hashPin('1234'),
      await hashPin('0000')
    ]);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).not.toBe(results[2]);
    expect(results[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------- ITEMS ----------

test.describe('Items and loot', () => {
  test('ITEMS catalog has 12 + mystery_trinket across 4 slots', async ({ page }) => {
    const items = await page.evaluate(() => window.ITEMS);
    expect(items.length).toBe(13);
    const slots = [...new Set(items.map(i => i.slot))];
    expect(slots.sort()).toEqual(['accessory', 'armor', 'hat', 'weapon']);
    const mystery = items.find(i => i.id === 'mystery_trinket');
    expect(mystery).toBeDefined();
    expect(mystery.stat).toBeNull();
  });

  test('rollLoot returns a valid item with a stat', async ({ page }) => {
    const samples = await page.evaluate(() => {
      const seen = new Set();
      for (let i = 0; i < 50; i++) seen.add(window.rollLoot(false).id);
      return [...seen];
    });
    // at least a few different items rolled
    expect(samples.length).toBeGreaterThan(3);
    // none of them are mystery_trinket (not in loot pool)
    expect(samples.includes('mystery_trinket')).toBe(false);
  });

  test('giving an item adds it to the kid\'s inventory', async ({ page }) => {
    const kidId = await seedHero(page);
    const after = await page.evaluate((id) => {
      const k = window.kidById(id);
      const item = window.ITEMS.find(i => i.id === 'wooden_sword');
      window.giveItemToKid(id, item);
      return k.inventory.length;
    }, kidId);
    expect(after).toBe(1);
  });
});

// ---------- MIGRATIONS ----------

/**
 * Migration tests need to *pre-seed* localStorage before any app script
 * runs. The shared fixture clears storage on every navigation, so these
 * use a fresh browser context without that init script.
 */
async function loadWithLegacyState(browser, legacy) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((state) => {
    try { localStorage.setItem('piggyBankState', JSON.stringify(state)); } catch (e) {}
  }, legacy);
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.effectiveStats === 'function');
  return { ctx, page };
}

rawTest.describe('Legacy data migration', () => {
  rawTest('old 5-stat XP is collapsed into 3 stats (max-merge)', async ({ browser }) => {
    const { ctx, page } = await loadWithLegacyState(browser, {
      kids: [{
        id: 'legacy1', userName: 'oldie', name: 'Oldie', avatar: '⚔️',
        class: 'rogue',              // should remap to elf
        stats: { strength: 2, stamina: 1, intelligence: 1, charisma: 1, compassion: 1 },
        xp:    { strength: 4, stamina: 9, intelligence: 12, charisma: 6, compassion: 3 },
        balance: 0,
        equipment: { helmet: null, mainHand: null, chest: null, ring: null, amulet: null, offHand: null, pants: null, shoes: null },
        inventory: []
      }],
      activities: [], transactions: [], settings: {}
    });
    const migrated = await page.evaluate(() => window.state.kids[0]);
    expect(migrated.class).toBe('elf');
    expect(migrated.xp).toEqual({ brave: 9, clever: 12, kind: 6 });
    expect(Object.keys(migrated.equipment).sort()).toEqual(['accessory', 'armor', 'hat', 'weapon']);
    await ctx.close();
  });

  rawTest('old activity statType (e.g. stamina) is remapped to brave', async ({ browser }) => {
    const { ctx, page } = await loadWithLegacyState(browser, {
      kids: [],
      activities: [{ id: 'a1', name: 'Old', amount: 1, icon: '📜', statType: 'stamina' }],
      transactions: [], settings: {}
    });
    const st = await page.evaluate(() => window.state.activities[0].statType);
    expect(st).toBe('brave');
    await ctx.close();
  });

  rawTest('unknown old item IDs become mystery_trinket', async ({ browser }) => {
    const { ctx, page } = await loadWithLegacyState(browser, {
      kids: [{
        id: 'legacy2', userName: 'collector', name: 'Collector',
        class: 'warrior',
        stats: { strength: 2, stamina: 1, intelligence: 1, charisma: 1, compassion: 1 },
        xp: {},
        balance: 0,
        equipment: { helmet: null, mainHand: null, chest: null, ring: null, amulet: null, offHand: null, pants: null, shoes: null },
        inventory: [
          { instanceId: 'inst1', itemId: 'longbow' },
          { instanceId: 'inst2', itemId: 'healing_potion' },
          { instanceId: 'inst3', itemId: 'totally_made_up_item' }
        ]
      }],
      activities: [], transactions: [], settings: {}
    });
    const ids = await page.evaluate(() => window.state.kids[0].inventory.map(i => i.itemId));
    expect(ids).toContain('mystery_trinket');
    for (const id of ids) {
      const hit = await page.evaluate((x) => !!window.ITEMS.find(i => i.id === x), id);
      expect(hit).toBe(true);
    }
    await ctx.close();
  });
});

// ---------- ADVENTURE HELPERS ----------

test.describe('Adventure gating', () => {
  test('adventureLocked returns true when party is below minLevel', async ({ page }) => {
    await seedHero(page, { class: 'warrior', xp: { brave: 0, clever: 0, kind: 0 } });
    const locked = await page.evaluate(() => {
      const dragon = window.ADVENTURES.find(a => a.id === 'dragon');
      window.adventureState.party = [window.state.kids[0].id];
      return window.adventureLocked(dragon);
    });
    expect(locked).toBe(true);
  });

  test('adventureLocked returns false once party meets min level', async ({ page }) => {
    // hero level = sum of stat XP levels. Need dragon.minLevel (5)
    await seedHero(page, { class: 'warrior', xp: { brave: 25, clever: 0, kind: 0 } });
    const locked = await page.evaluate(() => {
      const dragon = window.ADVENTURES.find(a => a.id === 'dragon');
      window.adventureState.party = [window.state.kids[0].id];
      return window.adventureLocked(dragon);
    });
    expect(locked).toBe(false);
  });
});

// ---------- WEEK START ----------

test('weekStartMonday returns a Monday at 00:00', async ({ page }) => {
  const d = await page.evaluate(() => {
    const m = window.weekStartMonday();
    return { dow: m.getDay(), h: m.getHours(), mi: m.getMinutes(), s: m.getSeconds() };
  });
  expect(d.dow).toBe(1);       // Monday
  expect(d.h).toBe(0);
  expect(d.mi).toBe(0);
  expect(d.s).toBe(0);
});
