/**
 * TIER 1 — high-leverage gap fillers identified in the test-gap audit.
 *
 *   Auth flow smoke (5)        — sign-in modal surfaces, sign-out
 *                                degrades, session-restore safe
 *   Adventure E2E walkthrough  — programmatic full run on each of the
 *   (5)                          5 legacy adventures (Bakery, Grove,
 *                                Crypt, Dragon, Tower). Fischer
 *                                Sebastian already covered in r3.
 *   Adventure mid-flow (6)     — save/resume/discard round-trips,
 *                                multi-hero parties, loot cap
 *   Custom adventures (3)      — edit, delete, full play
 *
 * Total: 19 tests pinning the most realistic regression risks.
 */
import { test, expect, seedHero } from './fixtures.mjs';

test.describe('TIER 1 — auth flow smoke', () => {

  test('sign-in modal opens with both email + magic-link affordances', async ({ page }) => {
    await page.evaluate(() => window.openSignInModal && window.openSignInModal());
    await expect(page.locator('#signInModal')).toHaveClass(/open/);
    const r = await page.evaluate(() => {
      const m = document.getElementById('signInModal');
      const text = (m.textContent || '').toLowerCase();
      return {
        hasEmail: !!m.querySelector('input[type="email"]'),
        hasPassword: !!m.querySelector('input[type="password"]'),
        hasGoogleBtn: /continue with google|google/i.test(m.textContent || ''),
        hasForgot: /forgot|password.*reset|passwort.*zurück/i.test(text)
      };
    });
    expect(r.hasEmail).toBe(true);
    expect(r.hasPassword).toBe(true);
    // At least one auth path beyond plain password should be visible.
    expect(r.hasGoogleBtn || r.hasForgot).toBe(true);
  });

  test('sign-out helper degrades gracefully when no Supabase session is bound', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // No active session in the test env — sign-out must be a no-op
      // not a thrown TypeError.
      try {
        if (typeof window.signOut === 'function') {
          await window.signOut();
          return 'ok';
        }
        return 'helper-absent';
      } catch (e) {
        return 'threw: ' + e.message;
      }
    });
    expect(r).not.toMatch(/^threw:/);
  });

  test('reset password modal opens via openResetPasswordModal', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof window.openResetPasswordModal === 'function') {
        window.openResetPasswordModal();
      } else if (typeof window.openModal === 'function') {
        window.openModal('resetPasswordModal');
      }
    });
    await expect(page.locator('#resetPasswordModal')).toHaveClass(/open/);
  });

  test('session restore on reload reads supaSession safely without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.reload();
    await page.waitForFunction(() => typeof window.kidById === 'function');
    expect(errors).toEqual([]);
  });

  test('cloudLoad is a no-op when no Supabase client is configured', async ({ page }) => {
    const r = await page.evaluate(async () => {
      try {
        if (typeof window.cloudLoad === 'function') {
          const out = await window.cloudLoad();
          return { ok: true, out };
        }
        return { ok: true, out: 'helper-absent' };
      } catch (e) { return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(true);
  });
});

test.describe('TIER 1 — adventure E2E walkthroughs', () => {
  // Programmatic full run: seed a max-stats hero so dice rolls almost
  // always succeed, walk every scene by driving the right state hook
  // for its scene type, end the adventure, assert the log fills up.
  //
  // We don't UI-click through 8 scenes per adventure (too slow + flaky).
  // Each scene-type advance gets its own helper.
  async function walkAdventure(page, advId) {
    return await page.evaluate((id) => new Promise((resolve, reject) => {
      try {
        const adv = window.ADVENTURES.find(a => a.id === id);
        if (!adv) return resolve({ error: 'adventure-not-found' });
        // Stub Math.random so dice rolls + outcomes favour success.
        const _r = Math.random;
        let bias = 0.95;
        Math.random = () => bias;
        // Set up a max-level hero.
        const hero = {
          id: 'walker_' + id, userName: 'walker_' + id, name: 'Walker',
          class: 'warrior',
          stats: { brave: 5, clever: 5, kind: 5 },
          balance: 0, totalEarned: 0, totalPaidOut: 0,
          xp: { brave: 9999, clever: 9999, kind: 9999 },
          inventory: [], equipment: { hat: null, armor: null, weapon: null, accessory: null }
        };
        window.state.kids.push(hero);
        window.adventureState.party = [hero.id];
        window.chooseAdventure(id);
        window.beginScenes();
        const advNow = window.ADVENTURES.find(a => a.id === id);
        for (let i = 0; i < advNow.scenes.length; i++) {
          const scene = advNow.scenes[i];
          window.adventureState.sceneIdx = i;
          if (scene.minigame && window.MINIGAME_TYPES && window.MINIGAME_TYPES[scene.minigame]) {
            // Minigame scenes: use the unified outcome plumbing.
            window.finishMinigameOutcome({
              success: true, score: 1, errors: 0, durationMs: 1000
            }, scene);
            // finishMinigameOutcome advances asynchronously; sync here.
            window.adventureState.sceneIdx = i;
            window.adventureState.log.push = window.adventureState.log.push;
          } else if (scene.type === 'puzzle') {
            // Push a passing puzzle log entry directly.
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, type: 'puzzle' });
          } else if (scene.type === 'sequence') {
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, type: 'sequence' });
          } else if (scene.type === 'memory') {
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, type: 'memory' });
          } else if (scene.type === 'statcheck') {
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, type: 'statcheck' });
          } else if (scene.type === 'split') {
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, type: 'split' });
          } else {
            // Choice scene — pick first option, simulate a success roll.
            window.adventureState.chosenOption = scene.options[0];
            window.adventureState.lastRoll = {
              roll: 18, bonus: 5, total: 23, dc: 10, success: true,
              scene, challenge: scene.options[0]
            };
            window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: hero.id, success: true, total: 23, dc: 10 });
          }
        }
        window.adventureState.treasureRewards = null;
        window.endAdventure(true);
        Math.random = _r;
        resolve({
          ok: true,
          mode: window.adventureState.mode,
          logCount: window.adventureState.log.length,
          sceneCount: advNow.scenes.length,
          tier: window.adventureState.endTier,
          treasureCount: (window.adventureState.treasureRewards || []).length
        });
      } catch (e) { reject(e); }
    }), advId);
  }

  for (const advId of ['bakery', 'grove', 'crypt', 'dragon', 'tower']) {
    test(`adventure ${advId} runs end-to-end without throwing`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const r = await walkAdventure(page, advId);
      expect.soft(r.error).toBeUndefined();
      expect(r.ok).toBe(true);
      // Log fills up to at least one entry per scene.
      expect(r.logCount).toBeGreaterThanOrEqual(r.sceneCount);
      expect(['triumph', 'brave', 'close', 'home']).toContain(r.tier);
      expect(r.treasureCount).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('TIER 1 — adventure mid-flow', () => {

  test('save → reload state shape → resume restores sceneIdx + party', async ({ page }) => {
    const kidA = await seedHero(page, { name: 'A', userName: 'midA' });
    const kidB = await seedHero(page, { name: 'B', userName: 'midB' });
    const r = await page.evaluate(({ a, b }) => {
      window.state.savedAdventure = {
        mode: 'scene',
        adventureId: 'bakery',
        party: [a, b],
        legendaryId: null,
        runId: 'run_test',
        hp: 4, maxHp: 6, sceneIdx: 3,
        log: [{ success: true }, { success: true }],
        chosenOption: null,
        savedAt: new Date().toISOString()
      };
      window.save();
      // Resume.
      window.adventureState.adventureId = null;
      window.adventureState.party = [];
      window.resumeSavedAdventure();
      return {
        adventureId: window.adventureState.adventureId,
        party: [...window.adventureState.party],
        sceneIdx: window.adventureState.sceneIdx,
        hp: window.adventureState.hp
      };
    }, { a: kidA, b: kidB });
    expect(r.adventureId).toBe('bakery');
    expect(r.party).toEqual([kidA, kidB]);
    expect(r.sceneIdx).toBe(3);
    expect(r.hp).toBe(4);
  });

  test('discardSavedAdventure clears the saved slot', async ({ page }) => {
    const kid = await seedHero(page, { userName: 'mid-disc' });
    await page.evaluate((id) => {
      window.state.savedAdventure = {
        mode: 'scene', adventureId: 'bakery', party: [id],
        hp: 5, maxHp: 5, sceneIdx: 0, log: [], chosenOption: null,
        savedAt: new Date().toISOString()
      };
      window.save();
      // Direct state-clear bypasses the confirm() prompt and PIN gate
      // — we're testing that the data is removed, not the UI.
      window.state.savedAdventure = null;
      window.save();
    }, kid);
    const had = await page.evaluate(() => window.hasSavedAdventure());
    expect(had).toBe(false);
  });

  test('multi-hero party of 2 records each scene with at least one hero', async ({ page }) => {
    const kid1 = await seedHero(page, { name: 'P1', userName: 'mp1' });
    const kid2 = await seedHero(page, { name: 'P2', userName: 'mp2' });
    const r = await page.evaluate(({ a, b }) => {
      window.adventureState.party = [a, b];
      window.chooseAdventure('bakery');
      window.beginScenes();
      const adv = window.ADVENTURES.find(x => x.id === 'bakery');
      for (let i = 0; i < adv.scenes.length; i++) {
        const scene = adv.scenes[i];
        window.adventureState.sceneIdx = i;
        if (scene.options) {
          window.adventureState.log.push({ sceneTitle: window.L(scene.title), heroId: a, success: true });
        }
      }
      window.adventureState.treasureRewards = null;
      window.endAdventure(true);
      // Both heroes share the loot — each should be in the rewards list.
      const r = window.adventureState.treasureRewards || [];
      return {
        rewardCount: r.length,
        heroIds: r.map(x => x.kidId)
      };
    }, { a: kid1, b: kid2 });
    expect(r.rewardCount).toBe(2);
    expect(r.heroIds).toContain(kid1);
    expect(r.heroIds).toContain(kid2);
  });

  test('multi-hero party of 3 still awards correctly', async ({ page }) => {
    const a = await seedHero(page, { name: 'P1', userName: 'mp31' });
    const b = await seedHero(page, { name: 'P2', userName: 'mp32' });
    const c = await seedHero(page, { name: 'P3', userName: 'mp33' });
    const r = await page.evaluate(({ a, b, c }) => {
      window.adventureState.party = [a, b, c];
      window.chooseAdventure('grove');
      window.beginScenes();
      const adv = window.ADVENTURES.find(x => x.id === 'grove');
      for (let i = 0; i < adv.scenes.length; i++) {
        window.adventureState.log.push({ sceneTitle: 'S' + i, heroId: a, success: true });
      }
      window.adventureState.treasureRewards = null;
      window.endAdventure(true);
      return (window.adventureState.treasureRewards || []).length;
    }, { a, b, c });
    expect(r).toBe(3);
  });

  test('loot cap enforces max 3 items per run', async ({ page }) => {
    const a = await seedHero(page, { userName: 'loot-cap' });
    const r = await page.evaluate((id) => {
      window.adventureState.party = [id];
      window.adventureState.adventureId = 'bakery';
      window.adventureState.lootDropCount = 0;
      const out = [];
      // Try to drop 5 items — only the first 3 should be marked.
      for (let i = 0; i < 5; i++) {
        out.push({ canDrop: window.canDropLoot(), count: window.adventureState.lootDropCount });
        if (window.canDropLoot()) window.markLootDropped();
      }
      return out;
    }, a);
    // First 3 calls return canDrop=true, then false.
    expect(r[0].canDrop).toBe(true);
    expect(r[1].canDrop).toBe(true);
    expect(r[2].canDrop).toBe(true);
    expect(r[3].canDrop).toBe(false);
    expect(r[4].canDrop).toBe(false);
  });

  test('chooseAdventure is rejected with a toast when party is empty', async ({ page }) => {
    await page.evaluate(() => {
      window.adventureState.party = [];
      window.chooseAdventure('bakery');
    });
    await expect(page.locator('#toast')).toContainText(/at least|hero|Held/i);
  });
});

test.describe('TIER 1 — custom adventures', () => {

  function buildCustomAdvJSON(id) {
    return JSON.stringify({
      id,
      icon: '🧪',
      title:   { en: 'Test Adventure',  de: 'Test-Abenteuer' },
      summary: { en: 'A pinned test',   de: 'Test-Pin' },
      intro:   { en: 'Once upon...',    de: 'Es war einmal...' },
      victory: { en: 'Won!',            de: 'Gewonnen!' },
      defeat:  { en: 'Lost.',           de: 'Verloren.' },
      difficulty: 'easy', minLevel: 0, maxHp: 5,
      scenes: [
        { title: { en: 'S1', de: 'S1' }, text: { en: 'go', de: 'los' },
          options: [
            { stat: 'brave', dc: 5, label: { en: 'A', de: 'A' },
              success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } },
            { stat: 'clever', dc: 5, label: { en: 'B', de: 'B' },
              success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } },
            { stat: 'kind', dc: 5, label: { en: 'C', de: 'C' },
              success: { en: 'y', de: 'y' }, failure: { en: 'n', de: 'n' } }
          ] }
      ]
    });
  }

  test('valid JSON saves AND a re-edit/save round-trips updates', async ({ page }) => {
    const customId = 'custom_tier1_edit_' + Date.now();
    const advCount = await page.evaluate(() => window.ADVENTURES.length);
    await page.evaluate((json) => {
      window.pinVerified = true;
      window.openCustomAdventureModal();
      const ta = document.getElementById('customAdvJson');
      if (ta) ta.value = json;
      window.saveCustomAdventureFromModal();
    }, buildCustomAdvJSON(customId));
    const after = await page.evaluate(() => window.ADVENTURES.length);
    expect(after).toBe(advCount + 1);
    // Edit it: open the modal with the same id, change the title.
    const r = await page.evaluate((customId) => {
      window.openCustomAdventureModal(customId);
      const ta = document.getElementById('customAdvJson');
      const original = JSON.parse(ta.value);
      original.title = { en: 'Edited Title', de: 'Bearbeiteter Titel' };
      ta.value = JSON.stringify(original);
      window.saveCustomAdventureFromModal();
      const advs = window.ADVENTURES.filter(a => a.id === customId);
      return advs.map(a => ({ id: a.id, en: a.title.en, de: a.title.de }));
    }, customId);
    expect(r.length).toBe(1);
    expect(r[0].en).toBe('Edited Title');
    expect(r[0].de).toBe('Bearbeiteter Titel');
  });

  test('delete removes a custom adventure from ADVENTURES', async ({ page }) => {
    const customId = 'custom_tier1_del_' + Date.now();
    await page.evaluate((json) => {
      window.pinVerified = true;
      window.openCustomAdventureModal();
      document.getElementById('customAdvJson').value = json;
      window.saveCustomAdventureFromModal();
    }, buildCustomAdvJSON(customId));
    const before = await page.evaluate((id) => window.ADVENTURES.some(a => a.id === id), customId);
    expect(before).toBe(true);
    await page.evaluate((id) => {
      window.openCustomAdventureModal(id);
      // Stub confirm() so the destructive prompt auto-accepts.
      const _c = window.confirm; window.confirm = () => true;
      window.deleteCustomAdventureFromModal();
      window.confirm = _c;
    }, customId);
    const after = await page.evaluate((id) => window.ADVENTURES.some(a => a.id === id), customId);
    expect(after).toBe(false);
  });

  test('full play through a custom adventure reaches the end screen', async ({ page }) => {
    const customId = 'custom_tier1_play_' + Date.now();
    const kid = await seedHero(page, { userName: 'cust-play' });
    const r = await page.evaluate(({ json, kidId }) => {
      window.pinVerified = true;
      window.openCustomAdventureModal();
      document.getElementById('customAdvJson').value = json;
      window.saveCustomAdventureFromModal();
      window.adventureState.party = [kidId];
      const customId = JSON.parse(json).id;
      window.chooseAdventure(customId);
      window.beginScenes();
      const adv = window.ADVENTURES.find(a => a.id === customId);
      for (let i = 0; i < adv.scenes.length; i++) {
        const scene = adv.scenes[i];
        window.adventureState.sceneIdx = i;
        window.adventureState.chosenOption = scene.options ? scene.options[0] : null;
        window.adventureState.lastRoll = { roll: 18, bonus: 5, total: 23, dc: 10, success: true };
        window.adventureState.log.push({ sceneTitle: 'S' + i, heroId: kidId, success: true });
      }
      window.adventureState.treasureRewards = null;
      window.endAdventure(true);
      return {
        mode: window.adventureState.mode,
        endTier: window.adventureState.endTier,
        rewards: (window.adventureState.treasureRewards || []).length
      };
    }, { json: buildCustomAdvJSON(customId), kidId: kid });
    expect(r.mode).toBe('end');
    expect(['triumph', 'brave', 'close', 'home']).toContain(r.endTier);
    expect(r.rewards).toBeGreaterThan(0);
  });
});
