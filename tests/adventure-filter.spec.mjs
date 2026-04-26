/**
 * Adventure picker — sort + filter.
 *
 * Pins the new behaviour: adventures sort easy→epic, the filter bar
 * lets the user narrow by difficulty + availability, and the
 * selection persists across renders. Empty-result state has a reset
 * button.
 */
import { test, expect, seedHero } from './fixtures.mjs';

test.describe('Adventure sort + filter', () => {

  test('adventure list is sorted by difficulty rank then minLevel', async ({ page }) => {
    await seedHero(page, { userName: 'sortk', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    await page.evaluate(() => window.switchTab('adventure'));
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.adventure-option .adventure-difficulty-badge'))
        .map(el => el.classList[1].replace('difficulty-', ''))
    );
    expect(order.length).toBeGreaterThan(0);
    const rank = { easy: 0, medium: 1, hard: 2, epic: 3 };
    for (let i = 1; i < order.length; i++) {
      expect.soft(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
  });

  test('filter bar exists with two rows (difficulty + availability)', async ({ page }) => {
    await seedHero(page, { userName: 'fbar' });
    await page.evaluate(() => window.switchTab('adventure'));
    await expect(page.locator('.adventure-filter-bar')).toBeVisible();
    await expect(page.locator('.adventure-filter-bar .filter-row')).toHaveCount(2);
    // 5 difficulty chips (all + 4 levels) + 2 availability chips = 7.
    await expect(page.locator('.adventure-filter-bar .filter-chip')).toHaveCount(7);
  });

  test('clicking a difficulty chip filters the list', async ({ page }) => {
    await seedHero(page, { userName: 'fdiff', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    await page.evaluate(() => window.switchTab('adventure'));
    const beforeCount = await page.locator('.adventure-option').count();
    expect(beforeCount).toBeGreaterThan(1);
    await page.evaluate(() => window.setAdventureFilter('difficulty', 'epic'));
    const afterBadges = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.adventure-option .adventure-difficulty-badge'))
        .map(el => el.classList[1])
    );
    // Every visible adventure now has the epic class — and there's
    // strictly fewer than the unfiltered count.
    for (const c of afterBadges) expect.soft(c).toBe('difficulty-epic');
    expect(afterBadges.length).toBeLessThan(beforeCount);
  });

  test('availability filter "unlocked" hides locked adventures', async ({ page }) => {
    // Seed a level-0 hero so high-min-level adventures stay locked.
    await seedHero(page, { userName: 'favail' });
    await page.evaluate(() => {
      window.switchTab('adventure');
      window.adventureState.party = [window.state.kids[0].id];
      window.renderAdventure();
    });
    const lockedBefore = await page.locator('.adventure-option.locked').count();
    expect(lockedBefore).toBeGreaterThan(0);   // there are real locked entries
    await page.evaluate(() => window.setAdventureFilter('availability', 'unlocked'));
    const lockedAfter = await page.locator('.adventure-option.locked').count();
    expect(lockedAfter).toBe(0);
  });

  test('filter selection persists in state.adventureFilter and to localStorage', async ({ page }) => {
    await seedHero(page, { userName: 'fpers' });
    await page.evaluate(() => window.switchTab('adventure'));
    await page.evaluate(() => window.setAdventureFilter('difficulty', 'medium'));
    const stored = await page.evaluate(() => {
      const fromState = window.state.adventureFilter;
      const fromLs = JSON.parse(localStorage.getItem('piggyBankState')).adventureFilter;
      return { fromState, fromLs };
    });
    expect(stored.fromState.difficulty).toBe('medium');
    expect(stored.fromLs.difficulty).toBe('medium');
  });

  test('empty-result state shows a reset button', async ({ page }) => {
    await seedHero(page, { userName: 'fempty' });
    await page.evaluate(() => window.switchTab('adventure'));
    // Filter to a difficulty/availability combo that has nothing —
    // 'epic' + 'unlocked' on a level-0 hero is reliably empty.
    await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.setAdventureFilter('difficulty', 'epic');
      window.setAdventureFilter('availability', 'unlocked');
    });
    const list = await page.locator('.adventure-list').count();
    const empty = await page.locator('.empty .empty-icon').count();
    expect(list).toBe(0);
    expect(empty).toBeGreaterThan(0);
    // Reset button is reachable + clears the filter.
    await page.getByRole('button', { name: /Reset filters|Filter zurücksetzen/i }).click();
    const stored = await page.evaluate(() => window.state.adventureFilter);
    expect(stored.difficulty).toBe('all');
    expect(stored.availability).toBe('all');
  });

  test('active chip toggles aria-pressed=true and renders with .active class', async ({ page }) => {
    await seedHero(page, { userName: 'factive' });
    await page.evaluate(() => window.switchTab('adventure'));
    await page.evaluate(() => window.setAdventureFilter('difficulty', 'easy'));
    const r = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.adventure-filter-bar .filter-chip'));
      const easyChip = chips.find(c => c.textContent.trim().toLowerCase().includes('easy') ||
                                        c.textContent.trim().toLowerCase().includes('leicht'));
      return easyChip ? {
        active: easyChip.classList.contains('active'),
        pressed: easyChip.getAttribute('aria-pressed')
      } : null;
    });
    expect(r).not.toBeNull();
    expect(r.active).toBe(true);
    expect(r.pressed).toBe('true');
  });
});
