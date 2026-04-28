/**
 * Admin dashboard tabs — keyboard navigation + ARIA tablist semantics.
 *
 * Pins the a11y fix from commit 0013c04 (ultrareview cleanup batch 1):
 *   - role="tablist" / role="tab" / role="tabpanel"
 *   - aria-selected on the active tab + aria-controls
 *   - tabindex=0 on active, -1 on the rest (roving tabindex)
 *   - Arrow-Left / Arrow-Right / Home / End cycle through tabs
 */
import { test, expect } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
  // Force the admin section visible regardless of supaProfile.is_admin
  // — this is a UI-shape test, not a privilege test.
  await page.evaluate(() => {
    const sec = document.getElementById('adminSection');
    if (sec) sec.style.display = '';
  });
});

test.describe('Admin tabs · ARIA semantics', () => {

  test('tablist + 5 tabs with proper roles', async ({ page }) => {
    const r = await page.evaluate(() => {
      const list = document.querySelector('.admin-tabs');
      const tabs = Array.from(document.querySelectorAll('.admin-tab'));
      return {
        listRole: list?.getAttribute('role'),
        listLabel: list?.getAttribute('aria-label'),
        tabCount: tabs.length,
        roles: tabs.map(b => b.getAttribute('role'))
      };
    });
    expect(r.listRole).toBe('tablist');
    expect(r.listLabel).toBeTruthy();
    expect(r.tabCount).toBe(5);
    expect(r.roles).toEqual(['tab', 'tab', 'tab', 'tab', 'tab']);
  });

  test('tab panel has role + is labelled by the active tab', async ({ page }) => {
    const r = await page.evaluate(() => {
      const panel = document.getElementById('adminTabBody');
      return {
        role: panel?.getAttribute('role'),
        labelledBy: panel?.getAttribute('aria-labelledby')
      };
    });
    expect(r.role).toBe('tabpanel');
    expect(r.labelledBy).toBe('adminTabBtn-overview');  // default
  });

  test('aria-selected + tabindex stay in sync as you switch tabs', async ({ page }) => {
    await page.evaluate(() => window.switchAdminTab('plans'));
    const r = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.admin-tab'));
      return tabs.map(b => ({
        id: b.dataset.adminTab,
        sel: b.getAttribute('aria-selected'),
        tabidx: b.getAttribute('tabindex')
      }));
    });
    const plansTab = r.find(t => t.id === 'plans');
    expect(plansTab.sel).toBe('true');
    expect(plansTab.tabidx).toBe('0');
    // All other tabs are deselected + non-tabbable.
    const others = r.filter(t => t.id !== 'plans');
    for (const t of others) {
      expect(t.sel).toBe('false');
      expect(t.tabidx).toBe('-1');
    }
  });

  test('aria-labelledby on the panel updates when the tab changes', async ({ page }) => {
    await page.evaluate(() => window.switchAdminTab('engagement'));
    const labelledBy = await page.locator('#adminTabBody').getAttribute('aria-labelledby');
    expect(labelledBy).toBe('adminTabBtn-engagement');
  });
});

test.describe('Admin tabs · keyboard navigation', () => {

  // Direct function call rather than synthetic KeyboardEvent: the inline
  // onkeydown="onAdminTabKeydown(event)" attribute does fire on real
  // user keys, but synthetic events through Playwright can be flaky
  // because of focus + bubbling oddities. The handler logic is what we
  // care about — that's what's tested here.
  test('ArrowRight cycles to the next tab (handler logic)', async ({ page }) => {
    await page.evaluate(() => window.switchAdminTab('overview'));
    const expected = ['families', 'logins', 'engagement', 'plans', 'overview'];
    for (const expectedTab of expected) {
      await page.evaluate(() => window.onAdminTabKeydown({
        key: 'ArrowRight', preventDefault() {}
      }));
      const cur = await page.evaluate(() => window.adminDashboard.tab);
      expect(cur).toBe(expectedTab);
    }
  });

  test('ArrowLeft cycles to the previous tab', async ({ page }) => {
    await page.evaluate(() => window.switchAdminTab('overview'));
    await page.evaluate(() => window.onAdminTabKeydown({
      key: 'ArrowLeft', preventDefault() {}
    }));
    const cur = await page.evaluate(() => window.adminDashboard.tab);
    expect(cur).toBe('plans');                          // wraps around
  });

  test('Home jumps to first, End to last', async ({ page }) => {
    await page.evaluate(() => window.switchAdminTab('engagement'));
    await page.evaluate(() => window.onAdminTabKeydown({ key: 'Home', preventDefault() {} }));
    expect(await page.evaluate(() => window.adminDashboard.tab)).toBe('overview');
    await page.evaluate(() => window.onAdminTabKeydown({ key: 'End', preventDefault() {} }));
    expect(await page.evaluate(() => window.adminDashboard.tab)).toBe('plans');
  });
});
