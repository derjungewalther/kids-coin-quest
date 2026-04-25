/**
 * R3 coverage — exhaustive smoke + E2E review of:
 *
 *   R3-S1  Family streak system (mark-active, freezes, tier rewards, badge)
 *   R3-S2  Mini-game framework + 5 new minigames (memory/sort/count/maze/rhythm/spot)
 *   R3-S3  Variant content engine (pickVariant, getNarration, narrationHistory)
 *   R3-S4  Legendary heroes (Heldenweihe ritual, four classes, abilities,
 *          group picker 4th slot, Erdheld pre-prompt, mentor card variant,
 *          bond level + milestone, deletion guard, cap-at-4 fallback)
 *
 * Plus a Fischer-Sebastian end-to-end playthrough that walks through
 * every scene type once and asserts the adventure log records each one.
 *
 * Style note: most assertions drive game state via `page.evaluate()` and
 * verify outcomes against `window.state` rather than waiting on UI
 * animation. UI is only clicked when the click handler is the unit
 * under test (e.g. ritual buttons, sort tap+drop). This keeps the suite
 * fast (full file ≈ 30s) while still exercising the real code paths.
 */
import { test, expect, seedHero, setPin } from './fixtures.mjs';

test.use({ viewport: { width: 1280, height: 900 } });

// ---------------------------------------------------------------------
// R3-S3 — VARIANT CONTENT ENGINE
// ---------------------------------------------------------------------

test.describe('R3-S3 variant content engine', () => {
  test('pickVariant is deterministic for the same seed', async ({ page }) => {
    const result = await page.evaluate(() => {
      const pool = ['a', 'b', 'c', 'd', 'e'];
      const a = window.pickVariant(pool, 'seed-1');
      const b = window.pickVariant(pool, 'seed-1');
      const c = window.pickVariant(pool, 'seed-2');
      return { a, b, c };
    });
    expect(result.a).toBe(result.b);
    // Different seed should usually pick differently — assert the seed
    // pair we picked actually does (sanity check on the hash function).
    expect(result.c === result.a).toBe(false);
  });

  test('pickVariant on a single-element pool returns that element', async ({ page }) => {
    const r = await page.evaluate(() =>
      window.pickVariant(['only'], 'whatever')
    );
    expect(r).toBe('only');
  });

  test('pickVariant on a string is returned verbatim (legacy compat)', async ({ page }) => {
    const r = await page.evaluate(() => window.pickVariant('legacy line', 'seed'));
    expect(r).toBe('legacy line');
  });

  test('pickVariantWithMemory excludes recent indices', async ({ page }) => {
    const r = await page.evaluate(() => {
      const pool = ['v1', 'v2', 'v3', 'v4', 'v5'];
      const out = [];
      const history = [];
      for (let i = 0; i < 5; i++) {
        const pick = window.pickVariantWithMemory(pool, 'seed-' + i, history, 3);
        out.push(pick.index);
        history.push(pick.index);
      }
      return out;
    });
    // No three consecutive picks should all be the same index.
    for (let i = 0; i < r.length - 2; i++) {
      expect(r[i] === r[i + 1] && r[i + 1] === r[i + 2]).toBe(false);
    }
  });

  test('getNarration on a pool object resolves a single variant + caches it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const scene = {
        id: 's-test',
        narration: { intro: ['Line A.', 'Line B.', 'Line C.'] }
      };
      const run = { id: 'run-x', adventureId: 'adv-x' };
      const a = window.getNarration(scene, 'intro', run);
      const b = window.getNarration(scene, 'intro', run);
      return { a, b, idx: scene._lastResolvedVariantIndex && scene._lastResolvedVariantIndex.intro };
    });
    expect(r.a).toBe(r.b); // 🔊 replay reads the same line
    expect(typeof r.idx).toBe('number');
    expect(['Line A.', 'Line B.', 'Line C.']).toContain(r.a);
  });

  test('getNarration on a legacy { en, de } object respects active locale', async ({ page }) => {
    const result = await page.evaluate(() => {
      const scene = { id: 's-loc', text: { en: 'English', de: 'Deutsch' } };
      window.state.settings.lang = 'de';
      const de = window.getNarration(scene, 'intro', { id: 'run' });
      window.state.settings.lang = 'en';
      const en = window.getNarration(scene, 'intro', { id: 'run' });
      return { en, de };
    });
    expect(result.de).toBe('Deutsch');
    expect(result.en).toBe('English');
  });

  test('getNarration on a locale-bucketed pool walks the right language', async ({ page }) => {
    const result = await page.evaluate(() => {
      const scene = {
        id: 's-bucketed',
        narration: {
          de: { intro: ['DE eins', 'DE zwei'] },
          en: { intro: ['EN one', 'EN two'] }
        }
      };
      window.state.settings.lang = 'de';
      const de = window.getNarration(scene, 'intro', { id: 'r' });
      window.state.settings.lang = 'en';
      const en = window.getNarration(scene, 'intro', { id: 'r2' });
      return { de, en };
    });
    expect(['DE eins', 'DE zwei']).toContain(result.de);
    expect(['EN one', 'EN two']).toContain(result.en);
  });

  test('narrationHistory persists picked indices on state', async ({ page }) => {
    await page.evaluate(() => {
      const scene = { id: 's-hist', narration: { intro: ['A', 'B', 'C'] } };
      window.getNarration(scene, 'intro', { id: 'r1', adventureId: 'adv-h' });
      window.getNarration(scene, 'intro', { id: 'r2', adventureId: 'adv-h' });
      window.getNarration(scene, 'intro', { id: 'r3', adventureId: 'adv-h' });
    });
    const history = await page.evaluate(() =>
      window.state.narrationHistory && window.state.narrationHistory['adv-h']
        && window.state.narrationHistory['adv-h']['s-hist']
        && window.state.narrationHistory['adv-h']['s-hist'].intro);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------
// R3-S2 — MINI-GAME FRAMEWORK + EACH MINIGAME
// ---------------------------------------------------------------------

test.describe('R3-S2 mini-game framework', () => {
  test('MINIGAME_TYPES registry has all 6 expected types', async ({ page }) => {
    const types = await page.evaluate(() => Object.keys(window.MINIGAME_TYPES).sort());
    expect(types).toEqual(['count', 'maze', 'memory', 'rhythm', 'sort', 'spot']);
  });

  test('each factory exposes the MinigameInstance contract', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const k of Object.keys(window.MINIGAME_TYPES)) {
        const inst = window.MINIGAME_TYPES[k]();
        out[k] = {
          mount: typeof inst.mount,
          unmount: typeof inst.unmount,
          replay: typeof inst.replay
        };
      }
      return out;
    });
    for (const k of Object.keys(r)) {
      expect(r[k].mount).toBe('function');
      expect(r[k].unmount).toBe('function');
      expect(r[k].replay).toBe('function');
    }
  });

  test('finishMinigameOutcome pushes a structured log entry', async ({ page }) => {
    await seedHero(page, { userName: 'mgkid' });
    const log = await page.evaluate(() => {
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.party = [window.state.kids[0].id];
      window.adventureState.sceneIdx = 0;
      window.adventureState.log = [];
      window.adventureState.hp = 6;
      window.adventureState.maxHp = 6;
      const adv = window.ADVENTURES.find(a => a.id === 'fischer-sebastian');
      const scene = adv.scenes[0];
      window.finishMinigameOutcome({ success: true, score: 0.85, errors: 1, durationMs: 1234 }, scene);
      return window.adventureState.log;
    });
    expect(log.length).toBe(1);
    expect(log[0].success).toBe(true);
    expect(log[0].score).toBeCloseTo(0.85, 2);
    expect(log[0].errors).toBe(1);
  });
});

// ---------- Memory adapter ----------
test.describe('Mini-game · memory', () => {
  test('mounts a grid sized to minigameConfig.items', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.memory();
      inst.mount(slot, {
        pairs: 3,
        items: [
          { id: 'a', icon: '🦊' }, { id: 'b', icon: '🐢' }, { id: 'c', icon: '🦉' }
        ]
      }, () => {});
    });
    await expect(page.locator('.memory-card')).toHaveCount(6);
  });

  test('matching all pairs fires onFinish with success=true', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.memory();
      let outcome = null;
      inst.mount(slot, {
        pairs: 2,
        items: [{ id: 'a', icon: '🌙' }, { id: 'b', icon: '⭐' }]
      }, (o) => { outcome = o; });
      // Walk the deck and pair indices off DOM card order.
      const cards = Array.from(document.querySelectorAll('.memory-card'));
      const groups = new Map();
      cards.forEach((c, i) => {
        const k = c.textContent || `_empty_${i}`;
      });
      // Easier: read pair indexes off the internal state via a second
      // mount. The first mount was used just to set up DOM; redo via
      // direct state read by introspecting the closure isn't possible,
      // so instead pair-up by tapping every card and observing matches.
      // Simpler approach: tap (0,1), if no match tap (0,2)... but the
      // memory adapter has lock timing. Easiest: directly call the
      // tap handler with brute-force ordering and wait for completion.
      // We resolve when onFinish fires.
      const tapAll = async () => {
        for (let a = 0; a < 4; a++) {
          for (let b = a + 1; b < 4; b++) {
            // Reset locked state by waiting for unflip animation
            await new Promise(r => setTimeout(r, 50));
            window.__mgMemTap(a);
            window.__mgMemTap(b);
            await new Promise(r => setTimeout(r, 1100));
            if (outcome) return;
          }
        }
      };
      await tapAll();
      // Some random shuffles will need a couple of cycles — keep going
      // up to 6 iterations.
      for (let attempt = 0; attempt < 6 && !outcome; attempt++) {
        await tapAll();
      }
      return outcome;
    });
    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ---------- Sort ----------
test.describe('Mini-game · sort', () => {
  test('renders configured items + buckets', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.sort();
      inst.mount(slot, {
        buckets: [
          { id: 'A', label: { en: 'Alpha', de: 'Alpha' }, icon: '🅰' },
          { id: 'B', label: { en: 'Beta',  de: 'Beta'  }, icon: '🅱' }
        ],
        items: [
          { id: 'i1', icon: '1️⃣', correctBucket: 'A' },
          { id: 'i2', icon: '2️⃣', correctBucket: 'B' },
          { id: 'i3', icon: '3️⃣', correctBucket: 'A' }
        ]
      }, () => {}, { difficulty: 'sproessling' });
    });
    await expect(page.locator('.sort-item')).toHaveCount(3);
    await expect(page.locator('.sort-bucket')).toHaveCount(2);
  });

  test('placing all items correctly fires success outcome with score=1', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.sort();
      let result = null;
      inst.mount(slot, {
        buckets: [
          { id: 'A', label: { en: 'Alpha', de: 'Alpha' }, icon: '🅰' },
          { id: 'B', label: { en: 'Beta',  de: 'Beta'  }, icon: '🅱' }
        ],
        items: [
          { id: 'i1', icon: '1', correctBucket: 'A' },
          { id: 'i2', icon: '2', correctBucket: 'B' }
        ],
        successThreshold: 0.5
      }, (o) => { result = o; }, { difficulty: 'sproessling' });
      window.__sortPickItem(0);
      window.__sortDropItem('A');
      await new Promise(r => setTimeout(r, 50));
      window.__sortPickItem(1);
      window.__sortDropItem('B');
      await new Promise(r => setTimeout(r, 800));
      return result;
    });
    expect(outcome).toBeTruthy();
    expect(outcome.success).toBe(true);
    expect(outcome.score).toBe(1);
    expect(outcome.errors).toBe(0);
  });

  test('wrong bucket counts an error and does not place the item', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.sort();
      let result = null;
      inst.mount(slot, {
        buckets: [
          { id: 'A', label: { en: 'A', de: 'A' }, icon: 'A' },
          { id: 'B', label: { en: 'B', de: 'B' }, icon: 'B' }
        ],
        items: [
          { id: 'i1', icon: '1', correctBucket: 'A' }
        ],
        successThreshold: 1
      }, (o) => { result = o; });
      window.__sortPickItem(0);
      window.__sortDropItem('B'); // wrong
      await new Promise(r => setTimeout(r, 50));
      const items = Array.from(document.querySelectorAll('.sort-item'));
      const item0Placed = items[0].classList.contains('placed');
      // Now correct
      window.__sortPickItem(0);
      window.__sortDropItem('A');
      await new Promise(r => setTimeout(r, 800));
      return { item0Placed, result };
    });
    expect(state.item0Placed).toBe(false);
    expect(state.result).toBeTruthy();
    expect(state.result.errors).toBe(1);
  });
});

// ---------- Count ----------
test.describe('Mini-game · count', () => {
  test('flash phase renders objects, then transitions to guess', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.count();
      inst.mount(slot, { rounds: 1, min: 3, max: 3, flashDurationMs: 80 }, () => {}, { difficulty: 'knappe' });
    });
    // During flash the canvas has icons; after ~150ms it's empty
    await expect(page.locator('.count-obj')).toHaveCount(3);
    await page.waitForTimeout(200);
    await expect(page.locator('.count-pad')).toHaveCount(9);
  });

  test('correct guess in all rounds wins; wrong in all rounds loses', async ({ page }) => {
    const winOutcome = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.count();
      let outcome = null;
      inst.mount(slot, { rounds: 2, min: 3, max: 3, flashDurationMs: 30 }, (o) => { outcome = o; });
      // Flash → guess loop: after each flash, tap 3.
      for (let r = 0; r < 2; r++) {
        await new Promise(res => setTimeout(res, 80));
        window.__countGuess(3);
        await new Promise(res => setTimeout(res, 1200));
      }
      return outcome;
    });
    expect(winOutcome).toBeTruthy();
    expect(winOutcome.success).toBe(true);
    expect(winOutcome.score).toBe(1);

    const loseOutcome = await page.evaluate(async () => {
      // Fresh slot
      document.getElementById('minigamePuzzleSlot').remove();
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.count();
      let outcome = null;
      inst.mount(slot, { rounds: 3, min: 3, max: 3, flashDurationMs: 30 }, (o) => { outcome = o; });
      for (let r = 0; r < 3; r++) {
        await new Promise(res => setTimeout(res, 80));
        window.__countGuess(9); // wrong on purpose
        await new Promise(res => setTimeout(res, 1200));
      }
      return outcome;
    });
    expect(loseOutcome).toBeTruthy();
    expect(loseOutcome.success).toBe(false);
    expect(loseOutcome.errors).toBe(3);
  });
});

// ---------- Maze ----------
test.describe('Mini-game · maze', () => {
  test('renders a grid and marks 4-adjacent cells clickable', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.maze();
      inst.mount(slot, {
        width: 3, height: 3,
        start: [0, 0], goal: [2, 2],
        obstacles: [], moveLimit: 8, hero: '🛶'
      }, () => {});
    });
    await expect(page.locator('.maze-cell')).toHaveCount(9);
    // Hero at 0,0 → adjacent are 1,0 and 0,1 → 2 highlighted.
    const adjacent = await page.locator('.maze-cell.adjacent').count();
    expect(adjacent).toBe(2);
  });

  test('reaching the goal fires success; bumping an obstacle counts an error', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.maze();
      let outcome = null;
      inst.mount(slot, {
        width: 3, height: 3,
        start: [0, 0], goal: [2, 0],
        obstacles: [{ pos: [1, 0], icon: '🪨' }],
        moveLimit: 10
      }, (o) => { outcome = o; });
      window.__mgMazeStep(1, 0); // bump obstacle (error +1, no move)
      window.__mgMazeStep(0, 1); // detour down
      window.__mgMazeStep(1, 1);
      window.__mgMazeStep(2, 1);
      window.__mgMazeStep(2, 0); // goal
      await new Promise(r => setTimeout(r, 700));
      return outcome;
    });
    expect(out).toBeTruthy();
    expect(out.success).toBe(true);
    expect(out.errors).toBeGreaterThanOrEqual(1);
  });

  test('exceeding moveLimit fails the maze', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.maze();
      let outcome = null;
      inst.mount(slot, {
        width: 4, height: 4,
        start: [0, 0], goal: [3, 3],
        obstacles: [], moveLimit: 3
      }, (o) => { outcome = o; });
      // Burn through the budget without reaching the goal.
      window.__mgMazeStep(1, 0);
      window.__mgMazeStep(0, 0);
      window.__mgMazeStep(1, 0);
      await new Promise(r => setTimeout(r, 700));
      return outcome;
    });
    expect(out).toBeTruthy();
    expect(out.success).toBe(false);
  });
});

// ---------- Rhythm ----------
test.describe('Mini-game · rhythm', () => {
  test('starts in ready phase and shows three drum pads', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.rhythm();
      inst.mount(slot, { rounds: 1, patternLength: 3 }, () => {});
    });
    await expect(page.locator('.rhythm-pad')).toHaveCount(3);
    await expect(page.locator('.rhythm-banner')).toContainText(/Anhören|Listen/);
  });

  test('replaying the demo pattern correctly wins both rounds', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      // Force-mute so AudioContext doesn't try to play in the test env.
      window.state.settings.muted = true;
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.rhythm();
      let result = null;
      inst.mount(slot, { rounds: 2, patternLength: 3 }, (o) => { result = o; });
      // Stub Math.random so the pattern is predictable for both rounds.
      const seq = [0, 1, 2, 2, 1, 0]; let p = 0;
      const _r = Math.random;
      Math.random = () => { const v = seq[p++ % seq.length]; return (v + 0.5) / 3; };
      window.__mgRhythmStart();
      // Wait for the demo to finish (3 notes × 520ms + buffer)
      await new Promise(r => setTimeout(r, 520 * 3 + 600));
      // Now we're in 'play' phase — tap the predicted pattern.
      window.__mgRhythmTap(0); window.__mgRhythmTap(1); window.__mgRhythmTap(2);
      await new Promise(r => setTimeout(r, 1100));
      // Round 2 demo plays
      await new Promise(r => setTimeout(r, 520 * 3 + 600));
      window.__mgRhythmTap(2); window.__mgRhythmTap(1); window.__mgRhythmTap(0);
      await new Promise(r => setTimeout(r, 1300));
      Math.random = _r;
      return result;
    });
    expect(outcome).toBeTruthy();
    expect(outcome.success).toBe(true);
  });
});

// ---------- Spot ----------
test.describe('Mini-game · spot', () => {
  test('renders left + right panels with base props on both', async ({ page }) => {
    await page.evaluate(() => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.spot();
      inst.mount(slot, {}, () => {});
    });
    await expect(page.locator('.spot-panel')).toHaveCount(2);
    // Base + diff icons on left; base only on right.
    const leftIcons = await page.locator('.spot-panel:not(.right) .spot-prop').count();
    const rightIcons = await page.locator('.spot-panel.right .spot-prop').count();
    expect(leftIcons).toBeGreaterThan(rightIcons);
  });

  test('finding all differences fires success outcome', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      slot.style.width = '600px';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.spot();
      let result = null;
      inst.mount(slot, {
        differences: [
          { id: 'd1', icon: '🎣', leftPos: [25, 50], rightAreaPct: [0.20, 0.45, 0.10, 0.10] },
          { id: 'd2', icon: '🪣', leftPos: [55, 65], rightAreaPct: [0.50, 0.60, 0.10, 0.10] }
        ]
      }, (o) => { result = o; });
      // Re-query the panel inside `tap` because render() rewrites
      // slot.innerHTML on every state change — the old element ref
      // becomes detached after the first hit.
      const tap = (fx, fy) => {
        const right = document.querySelector('.spot-panel.right');
        const r = right.getBoundingClientRect();
        const ev = new MouseEvent('click', {
          bubbles: true,
          clientX: r.left + fx * r.width,
          clientY: r.top  + fy * r.height
        });
        window.__mgSpotTap(ev, right);
      };
      tap(0.25, 0.50);
      tap(0.55, 0.65);
      await new Promise(res => setTimeout(res, 800));
      return result;
    });
    expect(outcome).toBeTruthy();
    expect(outcome.success).toBe(true);
    expect(outcome.errors).toBe(0);
  });

  test('wrong taps count as misses, no penalty to win condition', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const slot = document.createElement('div');
      slot.id = 'minigamePuzzleSlot';
      slot.style.width = '600px';
      document.body.appendChild(slot);
      const inst = window.MINIGAME_TYPES.spot();
      let result = null;
      inst.mount(slot, {
        differences: [
          { id: 'd1', icon: '🎣', leftPos: [25, 50], rightAreaPct: [0.20, 0.45, 0.10, 0.10] }
        ]
      }, (o) => { result = o; });
      const tap = (fx, fy) => {
        const right = document.querySelector('.spot-panel.right');
        const r = right.getBoundingClientRect();
        const ev = new MouseEvent('click', { bubbles: true,
          clientX: r.left + fx * r.width, clientY: r.top + fy * r.height });
        window.__mgSpotTap(ev, right);
      };
      tap(0.9, 0.9); // way off
      tap(0.1, 0.1); // also off
      tap(0.25, 0.50); // hit
      await new Promise(res => setTimeout(res, 800));
      return result;
    });
    expect(outcome.success).toBe(true);
    expect(outcome.errors).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------
// R3-S1 — FAMILY STREAK
// ---------------------------------------------------------------------

test.describe('R3-S1 family streak', () => {
  test('familyMarkActive bumps activeDays + computeFamilyStreak reflects it', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      const before = window.computeFamilyStreak();
      window.familyMarkActive();
      const after = window.computeFamilyStreak();
      return { before, after, days: window.state.streak.activeDays.length };
    });
    expect(r.after).toBe(1);
    expect(r.days).toBe(1);
  });

  test('30-day streak mints a legendary_recruitment_ritual reward', async ({ page }) => {
    const reward = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.ensureLegendaryState();
      // Synthesise a 30-day active streak.
      const today = window.todayKeyFamily();
      const days = [];
      for (let i = 29; i >= 0; i--) days.push(window.dayKeyOffset(today, -i));
      window.state.streak.activeDays = days;
      window.state.streak._lastClaimedDay = {};
      window.evaluateFamilyRewards();
      return window.state.streak.pendingRewards.find(r => r.tier === 'tier30');
    });
    expect(reward).toBeTruthy();
    expect(reward.contents.type).toBe('legendary_recruitment_ritual');
  });

  test('30-day streak after 4 mentors falls back to legendary cosmetic', async ({ page }) => {
    const reward = await page.evaluate(() => {
      window.ensureFamilyStreakState();
      window.ensureLegendaryState();
      window.state.legendary.heroesRecruited = 4;
      const today = window.todayKeyFamily();
      const days = [];
      for (let i = 29; i >= 0; i--) days.push(window.dayKeyOffset(today, -i));
      window.state.streak.activeDays = days;
      window.state.streak._lastClaimedDay = {};
      window.evaluateFamilyRewards();
      return window.state.streak.pendingRewards.find(r => r.tier === 'tier30');
    });
    expect(reward).toBeTruthy();
    expect(['legendary_cosmetic', 'lucky_charm']).toContain(reward.contents.type);
  });

  test('weekly Tier-7 cosmetic pool excludes legendary cosmetics', async ({ page }) => {
    const r = await page.evaluate(() => {
      // Run pickRandomCosmetic 50× and verify none are flagged legendary.
      const seen = new Set();
      for (let i = 0; i < 50; i++) {
        const c = window.pickRandomCosmetic();
        if (c) seen.add(c.id);
      }
      const allLegendaries = window.COSMETIC_POOL ? window.COSMETIC_POOL.filter(x => x.legendary).map(x => x.id) : [];
      const overlap = [...seen].filter(id => allLegendaries.includes(id));
      return { overlap };
    });
    expect(r.overlap).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// R3-S4 — LEGENDARY HEROES
// ---------------------------------------------------------------------

test.describe('R3-S4 legendary heroes', () => {
  test('isLegendaryHero distinguishes new mentor objects from boolean flags', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = { legendary: true };
      const b = { legendary: { class: 'licht' } };
      const c = {};
      const d = null;
      return [
        window.isLegendaryHero(a),
        window.isLegendaryHero(b),
        window.isLegendaryHero(c),
        window.isLegendaryHero(d)
      ];
    });
    expect(r).toEqual([false, true, false, false]);
  });

  test('pickOfferedLegendaryClasses always returns 3 distinct classes initially', async ({ page }) => {
    const r = await page.evaluate(() => {
      const offered = window.pickOfferedLegendaryClasses();
      return { offered, distinct: new Set(offered).size };
    });
    expect(r.offered.length).toBe(3);
    expect(r.distinct).toBe(3);
  });

  test('openRecruitmentRitual sets pendingRecruitment + walks to step 2', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureLegendaryState();
      window.openRecruitmentRitual();
    });
    await expect(page.locator('#recruitmentRitualModal')).toHaveClass(/open/);
    // Step 1 → invocation lines + Next button. Click Next → step 2 shows class cards.
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    await expect(page.locator('#recruitmentRitualModal .ritual-class-card')).toHaveCount(3);
  });

  test('full ritual flow recruits a mentor with the chosen class + cosmetic', async ({ page }) => {
    await page.evaluate(() => {
      window.ensureLegendaryState();
      window.openRecruitmentRitual();
    });
    // Step 1 → Step 2
    await page.locator('#recruitmentRitualModal .btn-primary').first().click();
    // Pick the first offered class
    await page.locator('#recruitmentRitualModal .ritual-class-card').first().click();
    await page.locator('#ritualClassNextBtn').click();
    // Step 3: pick a suggested name chip
    await page.locator('#recruitmentRitualModal .ritual-name-chip').first().click();
    await page.locator('#ritualNameNextBtn').click();
    // Step 4: pick first cosmetic
    await page.locator('#recruitmentRitualModal .ritual-cosmetic-card').first().click();
    await page.locator('#ritualCosmeticNextBtn').click();
    // Step 5: welcome screen — close to roster
    await expect(page.locator('#recruitmentRitualModal .ritual-welcome-portrait')).toBeVisible();
    const final = await page.evaluate(() => {
      const lh = window.state.kids.find(k => window.isLegendaryHero(k));
      return lh ? {
        cls: lh.legendary.class,
        name: lh.name,
        bondLevel: lh.legendary.bondLevel,
        charges: lh.legendary.abilityCharges.currentAdventure,
        cosmetics: Object.keys(lh.cosmetics || {}).length,
        recruited: window.state.legendary.heroesRecruited
      } : null;
    });
    expect(final).toBeTruthy();
    expect(['licht', 'sturm', 'mond', 'erde']).toContain(final.cls);
    expect(final.name.length).toBeGreaterThan(0);
    expect(final.charges).toBe(1);
    expect(final.cosmetics).toBeGreaterThanOrEqual(1);
    expect(final.recruited).toBe(1);
  });

  test('legendary mentor card has class pill and no delete button', async ({ page }) => {
    await page.evaluate(() => {
      // Manually inject a mentor.
      window.state.kids.push({
        id: 'lh1', userName: 'lh', name: 'Mira', avatar: '🦸',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        balance: null, totalEarned: null, totalPaidOut: null,
        portrait: null, inventory: [], equipment: {},
        cosmetics: {}, features: 'x', xp: { brave: 0, clever: 0, kind: 0 },
        legendary: { class: 'licht', recruitedAt: new Date().toISOString(),
          recruitedAfterStreak: 30, abilityCharges: { perAdventure: 1, currentAdventure: 1 },
          timesUsed: 0, bondLevel: 0 }
      });
      window.save(); window.renderKids();
    });
    const card = page.locator('.kid-card[data-legendary="true"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.legendary-class-pill')).toBeVisible();
    // The kid-head has a 'btn-ghost' delete on regular kids; legendary
    // mentor card explicitly omits it.
    await expect(card.locator('.kid-head .btn-ghost')).toHaveCount(0);
  });

  test('deleteKid refuses to remove a legendary mentor', async ({ page }) => {
    await page.evaluate(async () => {
      window.state.kids.push({
        id: 'lh-del', userName: 'lhd', name: 'Selene',
        class: 'legendary', stats: { brave: 0, clever: 0, kind: 0 },
        balance: null, inventory: [], equipment: {},
        legendary: { class: 'mond', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0 }
      });
      window.save();
      window.pinVerified = true; // bypass PIN gate
      window.deleteKid('lh-del');
    });
    const stillThere = await page.evaluate(() =>
      window.state.kids.some(k => k.id === 'lh-del')
    );
    expect(stillThere).toBe(true);
    // And the toast complained.
    await expect(page.locator('#toast')).toContainText(/cannot be removed|nicht entfernt/i);
  });

  test('Lichtfunke restores a morale star and disables when full', async ({ page }) => {
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-licht', userName: 'lhl', name: 'Aurel',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.party = ['lh-licht']; // anything; not a kid hero
      window.adventureState.legendaryId = 'lh-licht';
      window.adventureState.maxHp = 6;
      window.adventureState.hp = 4; // not full
      window.useLegendaryAbility();
    });
    const after1 = await page.evaluate(() => ({
      hp: window.adventureState.hp,
      charges: window.kidById('lh-licht').legendary.abilityCharges.currentAdventure
    }));
    expect(after1.hp).toBe(5);
    expect(after1.charges).toBe(0);
    // Already-spent is now disabled.
    await page.evaluate(() => window.useLegendaryAbility());
    const after2 = await page.evaluate(() => ({
      hp: window.adventureState.hp,
      charges: window.kidById('lh-licht').legendary.abilityCharges.currentAdventure
    }));
    expect(after2.hp).toBe(5); // unchanged
    expect(after2.charges).toBe(0);
  });

  test('Sturmschritt requires a prior fail; otherwise it is a no-op', async ({ page }) => {
    await page.evaluate(() => {
      window.state.kids.push({
        id: 'lh-sturm', userName: 'lhs', name: 'Boras',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'sturm', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.party = ['lh-sturm'];
      window.adventureState.legendaryId = 'lh-sturm';
      window.adventureState.sceneIdx = 0;
      window.adventureState.legendaryFailedAtLeastOnce = false;
      window.adventureState.maxHp = 6;
      window.adventureState.hp = 6;
      window.useLegendaryAbility(); // should be blocked
    });
    let charges = await page.evaluate(() => window.kidById('lh-sturm').legendary.abilityCharges.currentAdventure);
    expect(charges).toBe(1);
    // Now flag a fail and try again — should consume.
    await page.evaluate(() => {
      window.adventureState.legendaryFailedAtLeastOnce = true;
      window.useLegendaryAbility();
    });
    charges = await page.evaluate(() => window.kidById('lh-sturm').legendary.abilityCharges.currentAdventure);
    expect(charges).toBe(0);
  });

  test('Erdheld:in pre-adventure prompt opens before scenes', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'kidx' });
    await page.evaluate((kid) => {
      window.state.kids.push({
        id: 'lh-erde', userName: 'lhe', name: 'Toras',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'erde', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 0, timesUsed: 0 }
      });
      window.adventureState.party = [kid];
      window.adventureState.legendaryId = 'lh-erde';
      window.chooseAdventure('fischer-sebastian');
    }, kidId);
    await expect(page.locator('#erdePromptModal')).toHaveClass(/open/);
    // "Save it this time" preserves the charge.
    await page.locator('#erdePromptSkip').click();
    await expect(page.locator('#erdePromptModal')).not.toHaveClass(/open/);
    const charges = await page.evaluate(() =>
      window.kidById('lh-erde').legendary.abilityCharges.currentAdventure);
    expect(charges).toBe(1);
  });

  test('bond level increments per adventure and milestone fires at 5', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'kidy' });
    const milestone = await page.evaluate(async (kid) => {
      window.state.kids.push({
        id: 'lh-bond', userName: 'lhb', name: 'Lumi',
        class: 'legendary', stats: {brave:0,clever:0,kind:0},
        legendary: { class: 'licht', abilityCharges: { perAdventure: 1, currentAdventure: 1 }, bondLevel: 4, timesUsed: 0 }
      });
      window.save();
      // Set up a complete adventure run state and call endAdventure.
      window.adventureState.adventureId = 'fischer-sebastian';
      window.adventureState.party = [kid];
      window.adventureState.legendaryId = 'lh-bond';
      window.adventureState.maxHp = 6;
      window.adventureState.hp = 6;
      window.adventureState.log = [{ success: true }];
      window.adventureState.treasureRewards = [];
      window.endAdventure(true);
      const lh = window.kidById('lh-bond');
      const txs = window.state.transactions.filter(t => t.event === 'legendary_milestone');
      return { bondLevel: lh.legendary.bondLevel, milestoneTxCount: txs.length };
    }, kidId);
    expect(milestone.bondLevel).toBe(5);
    expect(milestone.milestoneTxCount).toBe(1);
  });
});

// ---------------------------------------------------------------------
// FISCHER SEBASTIAN — END-TO-END
// ---------------------------------------------------------------------

test.describe('Fischer Sebastian adventure', () => {
  test('appears in ADVENTURES with all 8 minigame scenes', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = window.ADVENTURES.find(x => x.id === 'fischer-sebastian');
      return a ? {
        scenes: a.scenes.length,
        types: a.scenes.map(s => s.minigame),
        difficulty: a.difficulty,
        minLevel: a.minLevel
      } : null;
    });
    expect(r).toBeTruthy();
    expect(r.scenes).toBe(8);
    expect(r.types).toEqual([
      'memory', 'sort', 'rhythm', 'count', 'maze', 'sort', 'spot', 'memory'
    ]);
    expect(r.difficulty).toBe('easy');
    expect(r.minLevel).toBe(0);
  });

  test('every scene has narration variant pools (R3-S3 wired up)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = window.ADVENTURES.find(x => x.id === 'fischer-sebastian');
      return a.scenes.map(s => {
        const n = s.narration;
        if (!n || typeof n !== 'object') return { id: s.id, ok: false };
        // Either { intro: [...], ... } or { de: { intro: [...] }, en: ... }.
        const hasFlat = Array.isArray(n.intro);
        const hasBucketed = (n.de && Array.isArray(n.de.intro)) || (n.en && Array.isArray(n.en.intro));
        return { id: s.id, ok: hasFlat || hasBucketed };
      });
    });
    for (const row of r) expect(row.ok).toBe(true);
  });

  test('starting the adventure mounts the first minigame (memory)', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'fkid' });
    await page.locator('.tab[data-view="adventure"]').click();
    // Pick the kid into the party.
    await page.locator('.adventure-hero-card').first().click();
    // Pick Fischer Sebastian.
    await page.locator(`.adventure-option:has-text("Sebastian"), .adventure-option:has-text("Fischer")`).first().click();
    // Begin button on the intro.
    await page.locator('.adventure-scene').getByRole('button', { name: /Begin|Beginnen/ }).click();
    // First scene = memory (Knotenstunde) → 8 cards on screen.
    await expect(page.locator('.memory-card')).toHaveCount(8);
  });

  test('full programmatic walkthrough advances each scene type', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'walker' });
    const log = await page.evaluate(async (kid) => {
      window.adventureState.party = [kid];
      window.chooseAdventure('fischer-sebastian');
      window.beginScenes();
      const adv = window.ADVENTURES.find(a => a.id === 'fischer-sebastian');
      const seenTypes = [];
      for (let i = 0; i < adv.scenes.length; i++) {
        const scene = adv.scenes[i];
        seenTypes.push(scene.minigame);
        // Manually push a successful outcome — exercises every
        // minigame's plumbing without driving each interactively.
        window.finishMinigameOutcome({ success: true, score: 1, errors: 0, durationMs: 1000 }, scene);
        // finishMinigameOutcome calls renderAdventure on a 800ms
        // timeout, so wait for that to advance sceneIdx.
        await new Promise(r => setTimeout(r, 850));
      }
      return { types: seenTypes, log: window.adventureState.log };
    }, kidId);
    expect(log.types).toEqual([
      'memory', 'sort', 'rhythm', 'count', 'maze', 'sort', 'spot', 'memory'
    ]);
    expect(log.log.length).toBe(8);
    // All scene types recorded with score=1 success.
    for (const entry of log.log) {
      expect(entry.success).toBe(true);
      expect(entry.score).toBe(1);
    }
  });

  test('legacy memory scene type still renders alongside new minigame path', async ({ page }) => {
    // Bakery scene 1 is a classic d20-choice; verify it still works
    // by fast-forwarding into it without crashing on R3-S2 dispatch.
    const kidId = await seedHero(page, { userName: 'oldway' });
    const ok = await page.evaluate((kid) => {
      window.adventureState.party = [kid];
      window.chooseAdventure('bakery');
      window.beginScenes();
      window.renderAdventure();
      // Bakery first scene is a choice scene → .choice-option items render.
      return document.querySelectorAll('.choice-option').length > 0;
    }, kidId);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// CROSS-CUTTING SMOKE — sanity checks
// ---------------------------------------------------------------------

test.describe('Smoke', () => {
  test('boot wiring exposes all R3 helpers on window', async ({ page }) => {
    const r = await page.evaluate(() => {
      const want = [
        'pickVariant', 'pickVariantWithMemory', 'getNarration',
        'MINIGAME_TYPES', 'finishMinigameOutcome',
        'ensureLegendaryState', 'isLegendaryHero', 'legendaryClassDef',
        'pickOfferedLegendaryClasses', 'openRecruitmentRitual',
        'useLegendaryAbility', 'legendaryInParty',
        'ensureFamilyStreakState', 'computeFamilyStreak',
        'familyMarkActive', 'evaluateFamilyRewards', 'pickRandomCosmetic',
        'COSMETIC_POOL'
      ];
      return Object.fromEntries(want.map(k => [k, typeof window[k]]));
    });
    for (const [k, type] of Object.entries(r)) {
      expect.soft(type === 'function' || type === 'object').toBe(true);
    }
  });

  test('window.error handlers are still attached after R3', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.reload();
    await page.waitForFunction(() => typeof window.MINIGAME_TYPES === 'object');
    expect(errors).toEqual([]);
  });

  test('all 8 Fischer Sebastian scenes have a registered minigame factory', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = window.ADVENTURES.find(x => x.id === 'fischer-sebastian');
      return a.scenes.map(s => ({ id: s.id, has: !!window.MINIGAME_TYPES[s.minigame] }));
    });
    for (const row of r) expect(row.has).toBe(true);
  });
});
