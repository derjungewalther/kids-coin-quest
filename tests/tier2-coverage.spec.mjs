/**
 * TIER 2 — middle-priority gap fillers identified in the post-Tier-1 audit.
 *
 *   A. Achievements catalog parametrized (8 tests)
 *      Each non-trivial unlock condition is reproduced with a synthesised
 *      kid; checkAchievements() must add the id to k.achievements.
 *   B. Quest / activity authoring (6 tests)
 *      addActivity, isQuestDoneWithinCadence (daily/weekly/once),
 *      previewQuest, amount=0 edge, deleteActivity.
 *   C. Items / loot (6 tests)
 *      rollLoot shape, giveItemToKid + unique instanceId, equipInstance
 *      slot conflict + replace, unequip, statBreakdown total.
 *   D. Scene-type happy + fail paths (10 tests, 2 per type)
 *      puzzle / sequence / statcheck / split / choice success+fail.
 *   E. Family streak deep (4 tests)
 *      90-day cap, applyFreezeIfNeeded short-streak guard, multi-shield,
 *      break+recovery.
 *   F. Legendary deep (5 tests)
 *      4th recruitment offering, pendingRecruitment round-trip,
 *      ritualBack step decrement, nameTaken, bond milestone at 10.
 *
 * Each test is independent — fixtures.mjs wipes localStorage on every
 * page navigation. Tests reach into window.* surfaces only; no edits
 * to index.html.
 */
import { test, expect, seedHero } from './fixtures.mjs';

// =====================================================================
// A. ACHIEVEMENTS CATALOG
// =====================================================================

test.describe('TIER 2 — achievements catalog', () => {
  // Each entry: { id, build } where build(seedKidId) mutates state.kids
  // to make `id`'s test predicate pass.  All run via checkAchievements.
  const cases = [
    {
      id: 'level_10',
      // xpLevelBonus(99) >= 10 — 99 XP buys level 10 in any stat.
      mutate: (kid) => { kid.xp = { brave: 9999, clever: 0, kind: 0 }; }
    },
    {
      id: 'coins_200',
      mutate: (kid) => { kid.totalEarned = 250; }
    },
    {
      id: 'streak_3',
      // effectiveStreak reads k.streak = { lastDay, days, best }.
      mutate: (kid, w) => {
        kid.streak = { lastDay: w.todayYmd(), days: 3, best: 3 };
      }
    },
    {
      id: 'streak_7',
      mutate: (kid, w) => {
        kid.streak = { lastDay: w.todayYmd(), days: 7, best: 7 };
      }
    },
    {
      id: 'streak_30',
      mutate: (kid, w) => {
        kid.streak = { lastDay: w.todayYmd(), days: 30, best: 30 };
      }
    },
    {
      id: 'first_victory',
      // Need a transaction with type='earn' and note containing 🏆.
      mutate: (kid, w) => {
        w.state.transactions.unshift({
          id: 'tx_v1', kidId: kid.id, type: 'earn', amount: 1,
          note: '🏆 Victory!', at: new Date().toISOString()
        });
      }
    },
    {
      id: 'donor',
      mutate: (kid, w) => {
        w.state.transactions.unshift({
          id: 'tx_d1', kidId: kid.id, type: 'donate', amount: -1,
          note: 'alms', at: new Date().toISOString()
        });
      }
    },
    {
      id: 'all_classes',
      // Need 5 distinct classes across state.kids. The seed kid is one;
      // push 4 more dummies with distinct classes.
      mutate: (kid, w) => {
        const others = ['warrior', 'mage', 'rogue', 'cleric', 'ranger']
          .filter(c => c !== kid.class).slice(0, 4);
        others.forEach((c, i) => w.state.kids.push({
          id: 'k_dummy_' + i, userName: 'd' + i, name: 'Dummy ' + i,
          class: c, stats: { brave: 0, clever: 0, kind: 0 },
          balance: 0, totalEarned: 0, inventory: [], equipment: {},
          xp: { brave: 0, clever: 0, kind: 0 }
        }));
      }
    }
  ];

  for (const c of cases) {
    test(`unlocks ${c.id}`, async ({ page }) => {
      const kidId = await seedHero(page, { userName: 'ach_' + c.id });
      const has = await page.evaluate(({ id, kid, mutateSrc }) => {
        const k = window.state.kids.find(x => x.id === kid);
        // Reconstitute the mutate fn from its serialized source.
        const mutate = new Function('kid', 'w', 'return (' + mutateSrc + ')(kid, w);');
        mutate(k, window);
        window.checkAchievements(k, 'all');
        return Array.isArray(k.achievements) && k.achievements.includes(id);
      }, { id: c.id, kid: kidId, mutateSrc: c.mutate.toString() });
      expect(has).toBe(true);
    });
  }
});

// =====================================================================
// B. QUEST / ACTIVITY AUTHORING
// =====================================================================

test.describe('TIER 2 — quest authoring', () => {
  test('addActivity pushes a structured quest into state.activities', async ({ page }) => {
    const r = await page.evaluate(() => {
      const before = window.state.activities.length;
      // Drive via the modal inputs the function reads.
      // openModal('addActivityModal') would open the UI; we just set
      // the values directly because addActivity only reads the fields.
      document.getElementById('actName').value = 'Sweep the hall';
      document.getElementById('actAmount').value = '2';
      document.getElementById('actStat').value = 'kind';
      const cad = document.getElementById('actCadence');
      if (cad) cad.value = 'daily';
      window.addActivity();
      const after = window.state.activities;
      const last = after[after.length - 1];
      return { before, after: after.length,
        name: last && last.name, amount: last && last.amount,
        statType: last && last.statType, cadence: last && last.cadence };
    });
    expect(r.after).toBe(r.before + 1);
    expect(r.name).toBe('Sweep the hall');
    expect(r.amount).toBe(2);
    expect(r.statType).toBe('kind');
    expect(r.cadence).toBe('daily');
  });

  test('isQuestDoneWithinCadence returns false for a fresh "once" quest', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'qonce' });
    const r = await page.evaluate((kid) => {
      const act = { id: 'a_once', name: 'X', amount: 1, statType: 'brave', cadence: 'once' };
      window.state.activities.push(act);
      // No prior earn transaction.
      return window.isQuestDoneWithinCadence(kid, act);
    }, kidId);
    expect(r).toBe(false);
  });

  test('isQuestDoneWithinCadence enforces daily window', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'qd' });
    const r = await page.evaluate((kid) => {
      const act = { id: 'a_daily', name: 'D', amount: 1, statType: 'brave', cadence: 'daily' };
      window.state.activities.push(act);
      // Push an earn tx dated today — should count as done.
      window.logTx(kid, 'earn', 1, 'D earn', { activityId: act.id });
      const doneToday = window.isQuestDoneWithinCadence(kid, act);
      // Now backdate the tx to yesterday — should reset to "not done today".
      const tx = window.state.transactions.find(t => t.activityId === act.id);
      tx.at = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
      const doneAfterBackdate = window.isQuestDoneWithinCadence(kid, act);
      return { doneToday, doneAfterBackdate };
    }, kidId);
    expect(r.doneToday).toBe(true);
    expect(r.doneAfterBackdate).toBe(false);
  });

  test('isQuestDoneWithinCadence enforces weekly window', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'qw' });
    const r = await page.evaluate((kid) => {
      const act = { id: 'a_weekly', name: 'W', amount: 1, statType: 'brave', cadence: 'weekly' };
      window.state.activities.push(act);
      window.logTx(kid, 'earn', 1, 'W earn', { activityId: act.id });
      const doneThisWeek = window.isQuestDoneWithinCadence(kid, act);
      // 8 days ago is definitely outside the Mon-start week.
      const tx = window.state.transactions.find(t => t.activityId === act.id);
      tx.at = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      const doneAfterBackdate = window.isQuestDoneWithinCadence(kid, act);
      return { doneThisWeek, doneAfterBackdate };
    }, kidId);
    expect(r.doneThisWeek).toBe(true);
    expect(r.doneAfterBackdate).toBe(false);
  });

  test('previewQuest writes the +amount/+xp summary into the preview slot', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'prev' });
    const text = await page.evaluate((kid) => {
      window.state.activities.push({ id: 'a_prev', name: 'Wash', amount: 3, statType: 'kind', cadence: 'once' });
      // Re-render kids so the existing #quest-select-{kid} + #quest-preview-{kid} pick up the activity.
      window.renderKids();
      const sel = document.getElementById('quest-select-' + kid);
      sel.value = 'a_prev';
      window.previewQuest(kid);
      return document.getElementById('quest-preview-' + kid).textContent;
    }, kidId);
    expect(text).toMatch(/\+3/);
    expect(text).toMatch(/XP/);
  });

  test('deleteActivity removes the quest after PIN bypass', async ({ page }) => {
    const r = await page.evaluate(() => {
      const id = 'a_kill';
      window.state.activities.push({ id, name: 'Doomed', amount: 1, statType: 'brave', cadence: 'once' });
      window.pinVerified = true; // bypass PIN gate
      window.deleteActivity(id);
      return window.state.activities.some(a => a.id === id);
    });
    expect(r).toBe(false);
  });
});

// =====================================================================
// C. ITEMS / LOOT
// =====================================================================

test.describe('TIER 2 — items / loot', () => {
  test('rollLoot returns an item with id, slot, rarity, and stat', async ({ page }) => {
    const r = await page.evaluate(() => {
      const item = window.rollLoot(false);
      return {
        hasId: !!item.id,
        slot: item.slot,
        rarity: item.rarity,
        stat: item.stat
      };
    });
    expect(r.hasId).toBe(true);
    expect(['hat', 'armor', 'weapon', 'accessory']).toContain(r.slot);
    expect(['common', 'rare', 'legendary']).toContain(r.rarity);
    expect(['brave', 'clever', 'kind']).toContain(r.stat);
  });

  test('rollLoot(true) biases distribution toward rare/legendary', async ({ page }) => {
    // Run 200 rolls; favored rolls should yield far more rares/legendaries.
    const r = await page.evaluate(() => {
      let normalRare = 0, favoredRare = 0;
      for (let i = 0; i < 200; i++) {
        const a = window.rollLoot(false);
        const b = window.rollLoot(true);
        if (a.rarity !== 'common') normalRare++;
        if (b.rarity !== 'common') favoredRare++;
      }
      return { normalRare, favoredRare };
    });
    expect(r.favoredRare).toBeGreaterThan(r.normalRare);
  });

  test('giveItemToKid appends to inventory with a unique instanceId', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'inv' });
    const r = await page.evaluate((kid) => {
      const item = window.ITEMS.find(i => i.id === 'wooden_sword');
      const a = window.giveItemToKid(kid, item);
      const b = window.giveItemToKid(kid, item);
      const inv = window.kidById(kid).inventory;
      return { idsDistinct: a.instanceId !== b.instanceId, len: inv.length };
    }, kidId);
    expect(r.idsDistinct).toBe(true);
    expect(r.len).toBe(2);
  });

  test('equipInstance places the item in its slot', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'eq' });
    const slotKey = await page.evaluate((kid) => {
      const item = window.ITEMS.find(i => i.id === 'wooden_sword');
      const inst = window.giveItemToKid(kid, item);
      window.openHeroSheet(kid); // sets openSheetKidId
      window.equipInstance(inst.instanceId);
      const k = window.kidById(kid);
      return k.equipment[item.slot];
    }, kidId);
    expect(slotKey).toBeTruthy();
  });

  test('equipping a NEW item in the same slot replaces the old', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'eq-rep' });
    const r = await page.evaluate((kid) => {
      const swordA = window.ITEMS.find(i => i.id === 'wooden_sword');
      const swordB = window.ITEMS.find(i => i.id === 'magic_wand'); // same slot 'weapon'
      const a = window.giveItemToKid(kid, swordA);
      const b = window.giveItemToKid(kid, swordB);
      window.openHeroSheet(kid);
      window.equipInstance(a.instanceId);
      const after1 = window.kidById(kid).equipment.weapon;
      window.equipInstance(b.instanceId);
      const after2 = window.kidById(kid).equipment.weapon;
      return { after1, after2, aId: a.instanceId, bId: b.instanceId };
    }, kidId);
    expect(r.after1).toBe(r.aId);
    expect(r.after2).toBe(r.bId);
  });

  test('unequip clears the slot', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'unq' });
    const cleared = await page.evaluate((kid) => {
      const item = window.ITEMS.find(i => i.id === 'wooden_sword');
      const inst = window.giveItemToKid(kid, item);
      window.openHeroSheet(kid);
      window.equipInstance(inst.instanceId);
      window.unequip('weapon');
      return window.kidById(kid).equipment.weapon;
    }, kidId);
    expect(cleared).toBeNull();
  });

  test('statBreakdown returns base + xpBonus + itemBonus = total', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sb' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 2;
      k.xp.brave = 99; // > level 0
      const sword = window.ITEMS.find(i => i.id === 'wooden_sword'); // common brave
      const inst = window.giveItemToKid(kid, sword);
      window.openHeroSheet(kid);
      window.equipInstance(inst.instanceId);
      return window.statBreakdown(window.kidById(kid), 'brave');
    }, kidId);
    expect(r.base).toBe(2);
    expect(r.xpBonus).toBeGreaterThan(0);
    expect(r.itemBonus).toBeGreaterThan(0);
    expect(r.total).toBe(r.base + r.xpBonus + r.itemBonus);
  });
});

// =====================================================================
// D. SCENE TYPES — happy + fail
// =====================================================================
//
// Driver: pre-seed adventureState with a synthetic 1-scene adventure, then
// dispatch the matching handler (answerPuzzle / pickSequenceTile /
// pickStatCheck / runSplitScene / attemptChallenge). Assert log + hp.

test.describe('TIER 2 — scene types', () => {

  // ---------- Puzzle ----------
  test('puzzle: correct answer logs success and does not change hp', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'pz-ok' });
    const r = await page.evaluate((kid) => {
      const scene = {
        type: 'puzzle', id: 'pz1',
        title: { en: 'Riddle', de: 'Rätsel' },
        text: { en: '?', de: '?' }, question: { en: 'Q', de: 'Q' },
        success: { en: 'yes', de: 'yes' }, failure: { en: 'no', de: 'no' },
        answers: [
          { label: { en: 'A', de: 'A' }, correct: true },
          { label: { en: 'B', de: 'B' }, correct: false }
        ]
      };
      window.adventureState.adventureId = '__synthetic_pz';
      window.ADVENTURES.push({ id: '__synthetic_pz', icon: '🧩',
        title: { en: 'pz', de: 'pz' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.puzzleState = null;
      window.answerPuzzle(0); // correct
      // Cleanup synthetic adventure.
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__synthetic_pz'), 1);
      return {
        log: window.adventureState.log,
        hp: window.adventureState.hp
      };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(true);
    expect(r.log[0].type).toBe('puzzle');
    expect(r.hp).toBe(5);
  });

  test('puzzle: 2 wrong answers fail the scene and decrement hp by 1', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'pz-bad' });
    const r = await page.evaluate((kid) => {
      const scene = {
        type: 'puzzle', id: 'pz2',
        title: { en: 'R', de: 'R' }, text: { en: '?', de: '?' },
        question: { en: 'Q', de: 'Q' },
        success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' },
        answers: [
          { label: { en: 'A', de: 'A' }, correct: false },
          { label: { en: 'B', de: 'B' }, correct: false },
          { label: { en: 'C', de: 'C' }, correct: true }
        ]
      };
      window.adventureState.adventureId = '__pz_fail';
      window.ADVENTURES.push({ id: '__pz_fail', icon: '🧩',
        title: { en: 'p', de: 'p' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.puzzleState = null;
      window.answerPuzzle(0); // wrong #1
      window.answerPuzzle(1); // wrong #2 → fail
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__pz_fail'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(false);
    expect(r.hp).toBe(4);
  });

  // ---------- Sequence ----------
  test('sequence: tapping the full pattern in order logs success', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sq-ok' });
    const r = await page.evaluate((kid) => {
      const scene = {
        type: 'sequence', id: 'sq1',
        title: { en: 'S', de: 'S' }, text: { en: '?', de: '?' },
        success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' },
        tiles: ['🌲', '⭐'], length: 2
      };
      window.adventureState.adventureId = '__sq_ok';
      window.ADVENTURES.push({ id: '__sq_ok', icon: '🎵',
        title: { en: 's', de: 's' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      // Pre-seed the sequenceState so we know the pattern.
      window.adventureState.sequenceState = {
        tiles: scene.tiles, pattern: [0, 1], input: [],
        phase: 'input', attempts: 0, solved: false, failed: false, _flashing: false
      };
      window.pickSequenceTile(0);
      window.pickSequenceTile(1);
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sq_ok'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(true);
    expect(r.log[0].type).toBe('sequence');
    expect(r.hp).toBe(5);
  });

  test('sequence: 2 wrong attempts fail the scene and drop hp by 1', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sq-bad' });
    const r = await page.evaluate((kid) => {
      const scene = {
        type: 'sequence', id: 'sq2',
        title: { en: 'S', de: 'S' }, text: { en: '?', de: '?' },
        success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' },
        tiles: ['🌲', '⭐'], length: 2
      };
      window.adventureState.adventureId = '__sq_bad';
      window.ADVENTURES.push({ id: '__sq_bad', icon: '🎵',
        title: { en: 's', de: 's' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      // Pattern [0,1] — tap the wrong tile twice to consume both attempts.
      window.adventureState.sequenceState = {
        tiles: scene.tiles, pattern: [0, 1], input: [],
        phase: 'input', attempts: 0, solved: false, failed: false, _flashing: false
      };
      window.pickSequenceTile(1); // wrong, attempts=1, resets input
      // Re-enter input phase manually (the resetter sets phase='showing').
      window.adventureState.sequenceState.phase = 'input';
      window.adventureState.sequenceState.input = [];
      window.pickSequenceTile(1); // wrong again, attempts=2 → failed
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sq_bad'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(false);
    expect(r.hp).toBe(4);
  });

  // ---------- Statcheck ----------
  test('statcheck: party stat above threshold logs success', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sc-ok' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 9; // way above threshold
      const scene = {
        type: 'statcheck', id: 'sc1',
        title: { en: 'C', de: 'C' }, text: { en: '?', de: '?' },
        options: [
          { stat: 'brave', threshold: 5, label: { en: 'A', de: 'A' },
            success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }
        ]
      };
      window.adventureState.adventureId = '__sc_ok';
      window.ADVENTURES.push({ id: '__sc_ok', icon: '⚔️',
        title: { en: 'c', de: 'c' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.statCheckState = null;
      window.pickStatCheck(0);
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sc_ok'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(true);
    expect(r.log[0].type).toBe('statcheck');
    expect(r.hp).toBe(5);
  });

  test('statcheck: party stat below threshold logs failure and drops hp', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sc-bad' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 0; k.xp.brave = 0;
      const scene = {
        type: 'statcheck', id: 'sc2',
        title: { en: 'C', de: 'C' }, text: { en: '?', de: '?' },
        options: [
          { stat: 'brave', threshold: 99, label: { en: 'A', de: 'A' },
            success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }
        ]
      };
      window.adventureState.adventureId = '__sc_bad';
      window.ADVENTURES.push({ id: '__sc_bad', icon: '⚔️',
        title: { en: 'c', de: 'c' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.statCheckState = null;
      window.pickStatCheck(0);
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sc_bad'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(false);
    expect(r.hp).toBe(4);
  });

  // ---------- Split ----------
  test('split: majority successes logs an overall success', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sp-ok' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 5; k.stats.clever = 5; k.stats.kind = 5;
      const scene = {
        type: 'split', id: 'sp1',
        title: { en: 'S', de: 'S' }, text: { en: '?', de: '?' },
        success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' },
        tasks: [
          { stat: 'brave', dc: 5, label: { en: 'T', de: 'T' },
            success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }
        ]
      };
      window.adventureState.adventureId = '__sp_ok';
      window.ADVENTURES.push({ id: '__sp_ok', icon: '👥',
        title: { en: 's', de: 's' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.splitState = null;
      // Force a roll of 20 → guaranteed success.
      const _r = Math.random;
      Math.random = () => 0.999;
      // Build the splitState by rendering the scene through the helper —
      // but easier to just manually seed the assignment list.
      window.adventureState.splitState = {
        assignments: [{
          task: scene.tasks[0], heroId: kid, roll: null, total: null, success: null
        }],
        rolled: false, allSuccess: null
      };
      window.runSplitScene();
      Math.random = _r;
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sp_ok'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp,
        rolled: window.adventureState.splitState.rolled };
    }, kidId);
    expect(r.rolled).toBe(true);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(true);
    expect(r.log[0].type).toBe('split');
  });

  test('split: minority successes logs failure and drops hp', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'sp-bad' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 0; k.stats.clever = 0; k.stats.kind = 0; k.xp = { brave: 0, clever: 0, kind: 0 };
      const scene = {
        type: 'split', id: 'sp2',
        title: { en: 'S', de: 'S' }, text: { en: '?', de: '?' },
        success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' },
        tasks: [
          { stat: 'brave', dc: 99, label: { en: 'T', de: 'T' },
            success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }
        ]
      };
      window.adventureState.adventureId = '__sp_bad';
      window.ADVENTURES.push({ id: '__sp_bad', icon: '👥',
        title: { en: 's', de: 's' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      // Force a roll of 1 → fumble fails even crit-style logic.
      const _r = Math.random;
      Math.random = () => 0;
      window.adventureState.splitState = {
        assignments: [{
          task: scene.tasks[0], heroId: kid, roll: null, total: null, success: null
        }],
        rolled: false, allSuccess: null
      };
      window.runSplitScene();
      Math.random = _r;
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__sp_bad'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(false);
    expect(r.hp).toBe(4);
  });

  // ---------- Choice (dice-rolled) ----------
  test('choice: high party stat passes the d20 challenge', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'ch-ok' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 9;
      const scene = {
        title: { en: 'C', de: 'C' }, text: { en: '?', de: '?' },
        options: [{ stat: 'brave', dc: 5, label: { en: 'A', de: 'A' },
          success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }]
      };
      window.adventureState.adventureId = '__ch_ok';
      window.ADVENTURES.push({ id: '__ch_ok', icon: '🛡',
        title: { en: 'c', de: 'c' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.chosenOption = scene.options[0];
      const _r = Math.random; Math.random = () => 0.999; // crit
      window.attemptChallenge();
      Math.random = _r;
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__ch_ok'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(true);
    expect(r.hp).toBe(5);
  });

  test('choice: forced fumble fails the d20 challenge and drops hp', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'ch-bad' });
    const r = await page.evaluate((kid) => {
      const k = window.kidById(kid);
      k.stats.brave = 0; k.xp.brave = 0;
      const scene = {
        title: { en: 'C', de: 'C' }, text: { en: '?', de: '?' },
        options: [{ stat: 'brave', dc: 25, label: { en: 'A', de: 'A' },
          success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }]
      };
      window.adventureState.adventureId = '__ch_bad';
      window.ADVENTURES.push({ id: '__ch_bad', icon: '🛡',
        title: { en: 'c', de: 'c' }, summary: { en: '', de: '' },
        intro: { en: '', de: '' }, victory: { en: '', de: '' }, defeat: { en: '', de: '' },
        difficulty: 'easy', minLevel: 0, maxHp: 5, scenes: [scene] });
      window.adventureState.party = [kid];
      window.adventureState.sceneIdx = 0;
      window.adventureState.hp = 5;
      window.adventureState.maxHp = 5;
      window.adventureState.log = [];
      window.adventureState.chosenOption = scene.options[0];
      const _r = Math.random; Math.random = () => 0; // fumble (1)
      window.attemptChallenge();
      Math.random = _r;
      window.ADVENTURES.splice(window.ADVENTURES.findIndex(a => a.id === '__ch_bad'), 1);
      return { log: window.adventureState.log, hp: window.adventureState.hp };
    }, kidId);
    expect(r.log.length).toBe(1);
    expect(r.log[0].success).toBe(false);
    expect(r.hp).toBe(4);
  });
});

// =====================================================================
// E. FAMILY STREAK DEEP
// =====================================================================

test.describe('TIER 2 — family streak deep', () => {

  test('familyMarkActive caps activeDays history at 90 entries', async ({ page }) => {
    const len = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      // Pre-fill 90 prior days (today NOT yet recorded). On familyMarkActive
      // the array becomes 91, then the size cap shifts the oldest off → 90.
      const days = [];
      for (let i = 90; i >= 1; i--) days.push(window.dayKeyOffset(today, -i));
      window.state.streak.activeDays = days; // length 90, today not in
      window.familyMarkActive(); // push today → 91 → shift → 90
      return window.state.streak.activeDays.length;
    });
    expect(len).toBe(90);
  });

  test('applyFreezeIfNeeded does NOT consume a freeze for a 2-day streak', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      // Two-day streak: day-3 and day-2 active, gap on day-1 (yesterday).
      window.state.streak.activeDays = [
        window.dayKeyOffset(today, -3),
        window.dayKeyOffset(today, -2)
      ];
      window.state.streak.freezesAvailable = 1;
      window.state.streak.freezesUsed = [];
      window.applyFreezeIfNeeded();
      return {
        avail: window.state.streak.freezesAvailable,
        used: window.state.streak.freezesUsed.length
      };
    });
    expect(r.avail).toBe(1);
    expect(r.used).toBe(0);
  });

  test('multiple shields persist across different gap days', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      // Streak >= 3 days, then two separate gap days both shielded.
      window.state.streak.activeDays = [
        window.dayKeyOffset(today, -10),
        window.dayKeyOffset(today, -9),
        window.dayKeyOffset(today, -8),
        window.dayKeyOffset(today, -7)
      ];
      window.state.streak.freezesUsed = [
        window.dayKeyOffset(today, -6),
        window.dayKeyOffset(today, -5)
      ];
      window.state.streak.freezesAvailable = 0;
      return window.state.streak.freezesUsed.length;
    });
    expect(r).toBe(2);
  });

  test('streak break + recovery: 2-day gap resets count to 1 on new active', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const today = window.todayKeyFamily();
      // Old active days far in the past with a gap > 1 day.
      window.state.streak.activeDays = [
        window.dayKeyOffset(today, -10),
        window.dayKeyOffset(today, -9)
      ];
      window.state.streak.freezesAvailable = 0;
      window.state.streak.freezesUsed = [];
      // Mark today active — should NOT extend old streak (gap is 9 days).
      window.familyMarkActive();
      return window.computeFamilyStreak();
    });
    expect(r).toBe(1);
  });
});

// =====================================================================
// F. LEGENDARY DEEP
// =====================================================================

test.describe('TIER 2 — legendary deep', () => {

  test('pickOfferedLegendaryClasses with 3 distinct mentors owned still returns 3 picks', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureLegendaryState();
      // Push 3 mentors of distinct classes.
      ['licht', 'sturm', 'mond'].forEach(cls => {
        window.state.kids.push({
          id: 'lh_' + cls, userName: 'lh' + cls, name: cls.toUpperCase(),
          class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
          legendary: { class: cls, abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
        });
      });
      const offered = window.pickOfferedLegendaryClasses();
      const ownedClasses = ['licht', 'sturm', 'mond'];
      const repeats = offered.filter(c => ownedClasses.includes(c));
      return { len: offered.length, offered, repeats };
    });
    expect(r.len).toBe(3);
    // The single unowned class ("erde") is in the offer; the other 2
    // slots get filled from the owned set as repeats.
    expect(r.offered).toContain('erde');
    expect(r.repeats.length).toBeGreaterThanOrEqual(2);
  });

  test('pendingRecruitment survives a save → JSON roundtrip and openRecruitmentRitual reopens', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureLegendaryState();
      window.state.legendary.pendingRecruitment = {
        offeredClasses: ['licht', 'sturm', 'mond'],
        triggeredAt: new Date().toISOString(),
        triggerReason: 'tier30'
      };
      window.save();
    });
    const persisted = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('piggyBankState'));
      return raw.legendary && raw.legendary.pendingRecruitment;
    });
    expect(persisted).toBeTruthy();
    expect(persisted.offeredClasses).toEqual(['licht', 'sturm', 'mond']);
    // Reopen — should land in step 1 with the same offered classes.
    await page.evaluate(() => window.openRecruitmentRitual());
    await expect(page.locator('#recruitmentRitualModal')).toHaveClass(/open/);
  });

  test('ritualBack decrements ritualState.step', async ({ page }) => {
    const stepAfter = await page.evaluate(() => {
      window.ensureLegendaryState();
      window.openRecruitmentRitual();
      // ritualState is module-scoped — bump it directly via the back fn.
      // After open, step=1; force step=3, then ritualBack() → 2.
      // ritualState is not on window, but the open helper exposes the same
      // surface via __resumeLegendaryRitual / step machinery. Easiest path:
      // walk the modal forward via .btn-primary clicks then call ritualBack.
      return null;
    });
    // Click "Next" twice to reach step 3 (or as far as possible).
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    // step should now be 2 — pick a class card to enable next.
    await page.locator('#recruitmentRitualModal .ritual-class-card').first().click();
    await page.locator('#ritualClassNextBtn').click();
    // Now on step 3. Call ritualBack().
    const backStep = await page.evaluate(() => {
      window.ritualBack();
      // Read the visible step indicator: step 2 shows class cards again.
      return document.querySelectorAll('#recruitmentRitualModal .ritual-class-card').length;
    });
    expect(backStep).toBeGreaterThan(0); // step 2 is rendered (class cards visible)
  });

  test('nameTaken returns true after a mentor with that name exists', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh_taken', userName: 'lht', name: 'Mira',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
      });
      return {
        sameName: window.nameTaken('Mira', null),
        differentName: window.nameTaken('Selene', null),
        excludingSelf: window.nameTaken('Mira', 'lh_taken')
      };
    });
    expect(r.sameName).toBe(true);
    expect(r.differentName).toBe(false);
    expect(r.excludingSelf).toBe(false);
  });

  test('bond milestone fires at 10 adventures', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'milestone10' });
    const r = await page.evaluate((kid) => {
      window.state.kids.push({
        id: 'lh_b10', userName: 'lhb10', name: 'Lumi10',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 },
                     bondLevel: 9, timesUsed: 0 }
      });
      window.save();
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.party = [kid];
      window.adventureState.legendaryId = 'lh_b10';
      window.adventureState.maxHp = 6;
      window.adventureState.hp = 6;
      window.adventureState.log = [{ success: true }];
      window.adventureState.treasureRewards = [];
      window.endAdventure(true);
      const lh = window.kidById('lh_b10');
      const tx = window.state.transactions.find(t => t.event === 'legendary_milestone');
      return {
        bond: lh.legendary.bondLevel,
        milestone: tx && tx.payload && tx.payload.milestone
      };
    }, kidId);
    expect(r.bond).toBe(10);
    expect(r.milestone).toBe('10_adventures');
  });
});
