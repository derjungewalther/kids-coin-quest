/**
 * End-to-end tests — exercise real user flows through the UI.
 */
import { test, expect, seedHero, setPin } from './fixtures.mjs';

// ---------- FIRST LOAD ----------

test.describe('First load', () => {
  test('shows the Heroes view with an empty-state prompt', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/Kids Coin Quest/i);
    await expect(page.locator('#view-kids')).toBeVisible();
    await expect(page.locator('#kidsGrid')).toContainText(/no heroes/i);
  });

  test('4 default activities are seeded', async ({ page }) => {
    await page.locator('.tab[data-view="activities"]').click();
    await expect(page.locator('#activitiesTable tbody tr')).toHaveCount(4);
  });
});

// ---------- RECRUIT A HERO ----------

test.describe('Recruit a hero', () => {
  test('filling the form and submitting adds a card', async ({ page }) => {
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await page.locator('#newKidName').fill('Lily Brave');
    await page.locator('#newKidUserName').fill('lilybrave');
    // Click the Warrior class card
    await page.locator('.class-card').filter({ hasText: /Warrior/i }).first().click();
    await page.locator('#addKidModal .btn-primary').click();
    await expect(page.locator('.kid-card')).toHaveCount(1);
    await expect(page.locator('.kid-card .kid-name')).toContainText(/Lily Brave/);
    await expect(page.locator('.kid-card .kid-user')).toContainText(/@lilybrave/);
  });

  test('rejects a duplicate username', async ({ page }) => {
    await seedHero(page, { userName: 'taken' });
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await page.locator('#newKidName').fill('Copycat');
    await page.locator('#newKidUserName').fill('taken');
    await page.locator('#addKidModal .btn-primary').click();
    await expect(page.locator('#toast')).toContainText(/already claimed/i);
  });

  test('rejects a too-short username', async ({ page }) => {
    await page.getByRole('button', { name: /Recruit New Hero/i }).click();
    await page.locator('#newKidName').fill('Shorty');
    await page.locator('#newKidUserName').fill('a');
    await page.locator('#addKidModal .btn-primary').click();
    await expect(page.locator('#toast')).toContainText(/2.{1,5}20/);
  });
});

// ---------- COMPLETING A QUEST ----------

test.describe('Quest completion', () => {
  test('completing a quest increases balance and XP', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'quester' });
    // The hero card's quest dropdown has all 4 seeded activities.
    const selector = `#quest-select-${kidId}`;
    const picker = page.locator(selector);
    await picker.selectOption({ index: 1 }); // the "Study scrolls" seeded quest (+2 clever)
    const [txt] = await Promise.all([
      picker.evaluate(el => el.options[el.selectedIndex].text)
    ]);
    expect(txt).toMatch(/.+/);
    const before = await page.evaluate((id) => window.kidById(id).balance, kidId);
    // Click the matching ⚔ Complete button (next to the select)
    await page.locator(`.kid-card:has(${selector}) .btn-primary`).click();
    const after = await page.evaluate((id) => ({ balance: window.kidById(id).balance, xp: window.kidById(id).xp }), kidId);
    expect(after.balance).toBeGreaterThan(before);
    // at least one of brave/clever/kind XP should have gone up
    expect(after.xp.brave + after.xp.clever + after.xp.kind).toBeGreaterThan(0);
  });

  test('level-up toast fires when crossing an XP threshold', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'aboutto', xp: { brave: 0, clever: 4.5, kind: 0 } });
    const selector = `#quest-select-${kidId}`;
    // the "Study scrolls" quest (amount 2) — adds 2 clever → crosses level threshold
    await page.locator(selector).selectOption({ index: 1 });
    await page.locator(`.kid-card:has(${selector}) .btn-primary`).click();
    await expect(page.locator('#toast')).toContainText(/leveled up/i, { timeout: 3000 });
  });
});

// ---------- PAYOUT & DONATE ----------

test.describe('Money flows', () => {
  test('payout decreases balance and records a negative transaction', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'spender', balance: 10, totalEarned: 10 });
    await page.locator('.kid-card').first().getByRole('button', { name: /Withdraw/i }).click();
    await page.locator('#payoutAmount').fill('3');
    await page.locator('#payoutNote').fill('Toy shop');
    await page.locator('#payoutModal').getByRole('button', { name: /Confirm/i }).click();
    // Wait for confirmPayout to finish (modal closes on success)
    await expect(page.locator('#payoutModal')).not.toHaveClass(/open/);
    const after = await page.evaluate((id) => window.kidById(id).balance, kidId);
    expect(after).toBeCloseTo(7, 2);
    const txs = await page.evaluate(
      (id) => window.state.transactions.filter(t => t.kidId === id && t.type === 'payout'),
      kidId
    );
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBeCloseTo(-3, 2);
  });

  test('payout blocked when insufficient balance', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'broke', balance: 2 });
    await page.locator('.kid-card').first().getByRole('button', { name: /Withdraw/i }).click();
    await page.locator('#payoutAmount').fill('50');
    await page.locator('#payoutModal').getByRole('button', { name: /Confirm/i }).click();
    await expect(page.locator('#toast')).toContainText(/insufficient/i);
    const after = await page.evaluate((id) => window.kidById(id).balance, kidId);
    expect(after).toBeCloseTo(2, 2);
  });

  test('donation decreases balance and records a donate transaction', async ({ page }) => {
    const kidId = await seedHero(page, { userName: 'giver', balance: 5, totalEarned: 5 });
    await page.locator('.kid-card').first().getByRole('button', { name: /Alms/i }).click();
    await page.locator('#donateAmount').fill('2');
    await page.locator('#donateTo').fill('Orphanage');
    await page.locator('#donateModal').getByRole('button', { name: /Grant/i }).click();
    const after = await page.evaluate((id) => {
      const tx = window.state.transactions.find(t => t.kidId === id && t.type === 'donate');
      return { balance: window.kidById(id).balance, note: tx?.note || '' };
    }, kidId);
    expect(after.balance).toBeCloseTo(3, 2);
    expect(after.note).toMatch(/Orphanage/);
  });
});

// ---------- LANGUAGE TOGGLE ----------

test('language toggle switches the header button label', async ({ page }) => {
  // Button label shows the OTHER language as the target
  await expect(page.locator('#langBtn')).toContainText(/DE/);
  await page.locator('#langBtn').click();
  await expect(page.locator('#langBtn')).toContainText(/EN/);
  // Tabs should now show German names
  const tabText = await page.locator('.tab[data-view="kids"]').textContent();
  expect(tabText).toMatch(/Helden/i);
});

// ---------- HERO SHEET + RENAME ----------

test.describe('Hero sheet', () => {
  test('clicking a card opens the sheet with the hero name', async ({ page }) => {
    await seedHero(page, { name: 'Sheeter', userName: 'sheeter' });
    await page.locator('.kid-head-click').first().click();
    await expect(page.locator('#heroSheetModal')).toHaveClass(/open/);
    await expect(page.locator('#heroSheetContent h3')).toContainText(/Sheeter/);
  });

  test('renaming a hero persists and re-renders', async ({ page }) => {
    await seedHero(page, { name: 'OldName', userName: 'old' });
    await page.locator('.kid-head-click').first().click();
    await page.locator('#heroSheetContent button[onclick^="openRenameHero"]').click();
    await expect(page.locator('#renameHeroModal')).toHaveClass(/open/);
    await page.locator('#renameHeroName').fill('NewName');
    await page.locator('#renameHeroUsername').fill('newname');
    await page.locator('#renameHeroModal .btn-primary').click();
    await expect(page.locator('.kid-name').first()).toContainText(/NewName/);
    await expect(page.locator('.kid-user').first()).toContainText(/@newname/);
  });
});

// ---------- PIN FLOW ----------

test.describe('Parent PIN', () => {
  test('first-time Council click triggers setup modal', async ({ page }) => {
    await page.locator('.tab[data-view="settings"]').click();
    await expect(page.locator('#pinSetupModal')).toHaveClass(/open/);
  });

  test('full setup then unlocks Council', async ({ page }) => {
    await page.locator('.tab[data-view="settings"]').click();
    await page.locator('#pinSetupFirst').fill('1234');
    await page.locator('#pinSetupConfirm').fill('1234');
    await page.locator('#pinSetupModal .btn-primary').click();
    await expect(page.locator('#view-settings')).toBeVisible();
  });

  test('PIN setup rejects mismatched confirmation', async ({ page }) => {
    await page.locator('.tab[data-view="settings"]').click();
    await page.locator('#pinSetupFirst').fill('1234');
    await page.locator('#pinSetupConfirm').fill('9999');
    await page.locator('#pinSetupModal .btn-primary').click();
    await expect(page.locator('#toast')).toContainText(/do not match/i);
  });

  test('with a PIN already set, entry modal appears before Council opens', async ({ page }) => {
    await setPin(page, '5678');
    // NOTE: no reload — the fixture's init-script would wipe localStorage again.
    // setPin already sets pinVerified=false so requirePin triggers the entry modal.
    await page.locator('.tab[data-view="settings"]').click();
    await expect(page.locator('#pinEntryModal')).toHaveClass(/open/);
    for (const d of '5678') await page.locator(`.pin-btn:has-text("${d}")`).click();
    await expect(page.locator('#pinEntryModal')).not.toHaveClass(/open/, { timeout: 2000 });
    await expect(page.locator('#view-settings')).toBeVisible();
  });

  test('wrong PIN three times triggers lockout countdown', async ({ page }) => {
    await setPin(page, '5555');
    await page.locator('.tab[data-view="settings"]').click();
    await expect(page.locator('#pinEntryModal')).toHaveClass(/open/);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const d of '0000') await page.locator(`.pin-btn:has-text("${d}")`).click();
      await page.waitForTimeout(300);
    }
    await expect(page.locator('#pinLockoutTimer')).toBeVisible();
    await expect(page.locator('#pinLockoutTimer')).toContainText(/\d+s/);
  });
});

// ---------- CHRONICLE & REVOKE ----------

test.describe('Chronicle', () => {
  test('revoke restores coin, XP, and removes transaction', async ({ page }) => {
    // No PIN set → revoke is un-gated for this test
    const kidId = await seedHero(page, { userName: 'revoker' });
    // Complete a quest to generate a transaction
    const selector = `#quest-select-${kidId}`;
    await page.locator(selector).selectOption({ index: 1 });
    await page.locator(`.kid-card:has(${selector}) .btn-primary`).click();
    const beforeRevoke = await page.evaluate((id) => ({
      balance: window.kidById(id).balance,
      xp: window.kidById(id).xp,
      txCount: window.state.transactions.filter(t => t.kidId === id).length
    }), kidId);
    expect(beforeRevoke.txCount).toBe(1);

    // Open Chronicle and click revoke (auto-accept the browser confirm dialog)
    page.once('dialog', d => d.accept());
    await page.locator('.tab[data-view="history"]').click();
    await page.locator('.tx-revoke').first().click();

    const after = await page.evaluate((id) => ({
      balance: window.kidById(id).balance,
      xp: window.kidById(id).xp,
      txCount: window.state.transactions.filter(t => t.kidId === id).length
    }), kidId);
    expect(after.balance).toBeCloseTo(0, 2);
    expect(after.txCount).toBe(0);
    // XP should be reversed to 0 on the stat that got it
    expect(after.xp.brave + after.xp.clever + after.xp.kind).toBeCloseTo(0, 2);
  });
});

// ---------- ADVENTURE END-TO-END ----------

test.describe('Adventure full flow', () => {
  test('start → pick approach → roll dice → see result → advance', async ({ page }) => {
    await seedHero(page, { userName: 'advr' });
    await page.locator('.tab[data-view="adventure"]').click();
    // Select the hero
    await page.locator('.adventure-hero-card').first().click();
    // Click the Grove (Easy) adventure
    await page.locator('.adventure-option:not(.locked)').first().click();
    // Intro screen → Begin (scoped to the adventure scene to avoid the
    // "Begin Quest" button in the Recruit modal)
    await page.locator('.adventure-scene').getByRole('button', { name: /Begin/i }).click();
    // Scene 1: pick first option
    await page.locator('.choice-option').first().click();
    // Roll Dice
    await page.getByRole('button', { name: /Roll/i }).click();
    // Result screen should appear with a dice number
    await expect(page.locator('.dice-display')).toBeVisible({ timeout: 3000 });
    // The result has either a success or failure label
    await expect(page.locator('.dice-result')).toBeVisible();
  });

  test('treasure on victory never exceeds maxTreasure', async ({ page }) => {
    // Set a small cap and drive the adventure to victory via direct state
    await seedHero(page, { userName: 'winner' });
    await page.evaluate(() => {
      window.state.settings.maxTreasure = 5;
      window.state.settings.paidAdventuresPerWeek = 9999;
      window.state.transactions = [];
      window.state.kids.forEach(k => k.balance = 0);
      window.save();
    });
    // Run many treasure awards to catch any luck-multiplier cap breach
    const amounts = await page.evaluate(() => {
      const results = [];
      for (let i = 0; i < 300; i++) {
        window.adventureState = {
          party: [window.state.kids[0].id],
          log: Array.from({ length: 5 }, () => ({ success: true })),
          treasureRewards: null, treasureMeta: null,
          adventureId: 'grove'
        };
        window.awardTreasure();
        results.push(window.adventureState.treasureMeta.amount);
      }
      return results;
    });
    for (const a of amounts) {
      expect(a).toBeLessThanOrEqual(5);
      expect(a).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------- PARENT DASHBOARD ----------

test.describe('Parent dashboard', () => {
  test('opens after PIN and shows weekly summary for each kid', async ({ page }) => {
    await seedHero(page, { userName: 'dash1', balance: 10, totalEarned: 10 });
    // Add a recent earn transaction so the weekly summary has something to show
    await page.evaluate(() => {
      window.logTx(window.state.kids[0].id, 'earn', 3, '📜 Test quest', { activityId: 'seed' });
      window.save();
    });
    await setPin(page, '0000');
    await page.locator('.tab[data-view="parents"]').click();
    await expect(page.locator('#pinEntryModal')).toHaveClass(/open/);
    for (const d of '0000') await page.locator(`.pin-btn:has-text("${d}")`).click();
    await expect(page.locator('#view-parents')).toBeVisible();
    await expect(page.locator('#view-parents')).toContainText(/Weekly Summary/i);
    await expect(page.locator('.parent-kid-card')).toHaveCount(1);
  });
});

// ---------- ACTIVITY MANAGEMENT ----------

test('adding a new activity makes it appear in the hero card picker', async ({ page }) => {
  const kidId = await seedHero(page, { userName: 'a1' });
  await page.locator('.tab[data-view="activities"]').click();
  await page.locator('#actName').fill('Take out trash');
  await page.locator('#actAmount').fill('1.5');
  await page.locator('#actStat').selectOption('brave');
  await page.locator('button.btn-primary:has-text("Proclaim")').click();
  await expect(page.locator('#activitiesTable tbody tr')).toHaveCount(5);
  // Back to Heroes view and check the dropdown has the new activity
  await page.locator('.tab[data-view="kids"]').click();
  const options = await page.locator(`#quest-select-${kidId} option`).allTextContents();
  expect(options.some(o => /Take out trash/i.test(o))).toBe(true);
});
