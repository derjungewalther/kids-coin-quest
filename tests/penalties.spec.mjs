/**
 * Negative quests / penalties (commit 43a3272).
 *
 * Pins:
 *   - amount < 0 marks an activity as a penalty
 *   - applying a penalty subtracts coins, awards NO XP, NO streak bump
 *   - transaction is logged with type='penalty', event='penalty'
 *   - the form's sign toggle flips between + and − and resets after save
 *   - quest picker option labels show the negative sign
 */
import { test, expect, seedHero } from './fixtures.mjs';

test.describe('Penalty quest mechanic', () => {

  test('applying a penalty subtracts from balance, no XP, no streak', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'p1', balance: 5, totalEarned: 5 });
    const r = await page.evaluate((kid) => {
      window.state.activities.push({
        id: 'pen1', name: 'Hit sister', amount: -2, icon: '👊',
        statType: 'kind', cadence: 'once'
      });
      window.save();
      const before = window.kidById(kid).balance;
      const xpBefore = window.kidById(kid).xp.kind;
      window.earn(kid, 'pen1');
      const k = window.kidById(kid);
      const lastTx = window.state.transactions[0];
      return {
        balanceBefore: before,
        balanceAfter: k.balance,
        xpBefore,
        xpAfter: k.xp.kind,
        streakDays: (k.streak && k.streak.days) || 0,
        txType: lastTx?.type,
        txEvent: lastTx?.event,
        txAmount: lastTx?.amount
      };
    }, kidId);
    expect(r.balanceAfter).toBe(r.balanceBefore - 2);
    expect(r.xpAfter).toBe(r.xpBefore);                 // NO XP gain
    expect(r.streakDays).toBe(0);                       // NO streak bump
    expect(r.txType).toBe('penalty');
    expect(r.txEvent).toBe('penalty');
    expect(r.txAmount).toBe(-2);
  });

  test('penalty allows balance to go negative (kid "owes" coins)', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'p2', balance: 1, totalEarned: 1 });
    const r = await page.evaluate((kid) => {
      window.state.activities.push({
        id: 'pen2', name: 'Big oops', amount: -3, icon: '⚠',
        statType: 'kind', cadence: 'once'
      });
      window.save();
      window.earn(kid, 'pen2');
      return { balance: window.kidById(kid).balance };
    }, kidId);
    expect(r.balance).toBe(-2);                         // -2 = "owes 2"
  });

  test('reward quest (positive amount) is unchanged: balance + XP + streak', async ({ page }) => {
    // Regression check — penalty path must not steal the reward path.
    const kidId = await seedHero(page, { userName: 'p3', balance: 0 });
    const r = await page.evaluate((kid) => {
      window.state.activities.push({
        id: 'rwd1', name: 'Make bed', amount: 1, icon: '🛏',
        statType: 'kind', cadence: 'daily'
      });
      window.save();
      window.earn(kid, 'rwd1');
      const k = window.kidById(kid);
      const lastTx = window.state.transactions[0];
      return {
        balance: k.balance, xp: k.xp.kind,
        streakDays: (k.streak && k.streak.days) || 0,
        txType: lastTx?.type
      };
    }, kidId);
    expect(r.balance).toBe(1);
    expect(r.xp).toBe(1);                               // XP awarded
    expect(r.streakDays).toBe(1);                       // streak bumped
    expect(r.txType).toBe('earn');
  });
});

test.describe('Penalty quest form (sign toggle)', () => {

  test('sign toggle defaults to + and flips state on click', async ({ page }) => {
    await page.evaluate(() => window.switchTab('activities'));
    const initial = await page.evaluate(() => {
      const btn = document.getElementById('actSignToggle');
      return { text: btn?.textContent, pressed: btn?.getAttribute('aria-pressed') };
    });
    expect(initial.text).toBe('+');
    expect(initial.pressed).toBe('false');

    await page.evaluate(() => window.toggleQuestSign());
    const flipped = await page.evaluate(() => {
      const btn = document.getElementById('actSignToggle');
      return {
        text: btn?.textContent, pressed: btn?.getAttribute('aria-pressed'),
        hasPenaltyClass: btn?.classList.contains('is-penalty')
      };
    });
    expect(flipped.text).toBe('−');
    expect(flipped.pressed).toBe('true');
    expect(flipped.hasPenaltyClass).toBe(true);
  });

  test('addActivity with toggle on → activity has negative amount, toggle resets to +', async ({ page }) => {
    await page.evaluate(() => window.switchTab('activities'));
    const created = await page.evaluate(() => {
      window.toggleQuestSign();                          // flip to penalty
      document.getElementById('actName').value = 'Hauen';
      document.getElementById('actAmount').value = '2';
      window.addActivity();
      const a = window.state.activities[window.state.activities.length - 1];
      const btn = document.getElementById('actSignToggle');
      return {
        name: a.name, amount: a.amount,
        toggleResetText: btn?.textContent,
        toggleResetPressed: btn?.getAttribute('aria-pressed')
      };
    });
    expect(created.name).toBe('Hauen');
    expect(created.amount).toBe(-2);                    // sign came from toggle
    expect(created.toggleResetText).toBe('+');          // reset after save
    expect(created.toggleResetPressed).toBe('false');
  });

  test('addActivity with toggle off → activity has positive amount (default reward path)', async ({ page }) => {
    await page.evaluate(() => window.switchTab('activities'));
    const created = await page.evaluate(() => {
      document.getElementById('actName').value = 'Bett machen';
      document.getElementById('actAmount').value = '0.5';
      window.addActivity();
      return window.state.activities[window.state.activities.length - 1];
    });
    expect(created.name).toBe('Bett machen');
    expect(created.amount).toBe(0.5);
  });
});

test.describe('Activities table renders penalty rows distinctly', () => {

  test('penalty row gets .is-penalty class + ⚠ icon prefix', async ({ page }) => {
    await page.evaluate(() => {
      window.state.activities = [
        { id: 'r1', name: 'Reward task', amount: 1, icon: '🛏', statType: 'kind', cadence: 'once' },
        { id: 'p1', name: 'Penalty task', amount: -2, icon: '👊', statType: 'kind', cadence: 'once' }
      ];
      window.save();
      window.switchTab('activities');
      window.renderActivities();
    });
    const r = await page.evaluate(() => {
      const rows = document.querySelectorAll('#activitiesTable tbody tr');
      return Array.from(rows).map(row => ({
        hasPenaltyClass: row.classList.contains('is-penalty'),
        firstCellText: row.cells[0]?.textContent,
        hasPenaltyBadge: !!row.querySelector('.penalty-badge')
      }));
    });
    expect(r[0].hasPenaltyClass).toBe(false);
    expect(r[1].hasPenaltyClass).toBe(true);
    expect(r[1].firstCellText).toContain('⚠');
    expect(r[1].hasPenaltyBadge).toBe(true);
  });
});
