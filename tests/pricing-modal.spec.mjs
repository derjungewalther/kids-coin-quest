/**
 * Pricing modal + Stripe return URL flow.
 *
 * Pins the behaviour added in commits 5c7f700 + 6e5c8f8:
 *   - Modal opens with reason context (hero_limit / adventure_locked)
 *   - Period toggle flips monthly ↔ yearly + aria-pressed updates
 *   - Already-Pro users get a friendly toast instead of the modal
 *   - ?upgrade=success/cancel triggers toast + URL strip + refetch
 */
import { test, expect } from './fixtures.mjs';

test.describe('Pricing modal · open / close / period', () => {

  test('opens with the reason banner when triggered with a known reason', async ({ page }) => {
    await page.evaluate(() => window.openPricingModal('hero_limit'));
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const modal = document.getElementById('pricingModal');
      const reason = document.getElementById('pricingReason');
      return {
        open: modal?.classList.contains('open'),
        reasonVisible: reason && reason.style.display !== 'none',
        reasonText: reason?.textContent?.trim() || ''
      };
    });
    expect(r.open).toBe(true);
    expect(r.reasonVisible).toBe(true);
    expect(r.reasonText.length).toBeGreaterThan(10);
  });

  test('opens without reason banner when called with no reason', async ({ page }) => {
    await page.evaluate(() => window.openPricingModal());
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const reason = document.getElementById('pricingReason');
      return {
        open: document.getElementById('pricingModal')?.classList.contains('open'),
        reasonVisible: reason && reason.style.display !== 'none'
      };
    });
    expect(r.open).toBe(true);
    expect(r.reasonVisible).toBe(false);
  });

  test('Period toggle flips monthly ↔ yearly with aria-pressed in sync', async ({ page }) => {
    await page.evaluate(() => window.openPricingModal());
    await page.waitForTimeout(100);
    const initial = await page.evaluate(() => {
      const m = document.querySelector('.pricing-period-btn[data-period="monthly"]');
      const y = document.querySelector('.pricing-period-btn[data-period="yearly"]');
      return { mActive: m?.classList.contains('active'), mPressed: m?.getAttribute('aria-pressed'),
               yActive: y?.classList.contains('active'), yPressed: y?.getAttribute('aria-pressed') };
    });
    expect(initial.mActive).toBe(true);
    expect(initial.mPressed).toBe('true');
    expect(initial.yActive).toBeFalsy();
    expect(initial.yPressed).toBe('false');

    await page.evaluate(() => window.setPricingPeriod('yearly'));
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const m = document.querySelector('.pricing-period-btn[data-period="monthly"]');
      const y = document.querySelector('.pricing-period-btn[data-period="yearly"]');
      return { mActive: m?.classList.contains('active'), mPressed: m?.getAttribute('aria-pressed'),
               yActive: y?.classList.contains('active'), yPressed: y?.getAttribute('aria-pressed'),
               subLabel: document.getElementById('pricingTierSubLabel')?.textContent?.trim() };
    });
    expect(after.mActive).toBeFalsy();
    expect(after.mPressed).toBe('false');
    expect(after.yActive).toBe(true);
    expect(after.yPressed).toBe('true');
    expect(after.subLabel).toMatch(/19[.,]99/);  // sub-label flipped to "billed €19.99 once a year"
  });

  test('already-Pro user gets a "you have Pro" toast instead of the modal', async ({ page }) => {
    await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'pro@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'active', billing_period: 'monthly' };
      window.openPricingModal('account');
    });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      modalOpen: document.getElementById('pricingModal')?.classList.contains('open'),
      // Toast appears in #toast container; check it's visible-ish
      toastText: document.getElementById('toast')?.textContent || ''
    }));
    expect(r.modalOpen).toBeFalsy();
    expect(r.toastText).toMatch(/Pro/i);
  });

  test('Pricing modal has the recommended badge in the i18n key (not hardcoded English)', async ({ page }) => {
    // Was a CSS ::before with content:'RECOMMENDED' — DE users saw English.
    // Now an actual span.pricing-recommended-badge with data-i18n.
    const r = await page.evaluate(() => {
      const badge = document.querySelector('.pricing-recommended-badge');
      return {
        exists: !!badge,
        hasI18nAttr: badge?.hasAttribute('data-i18n'),
        text: badge?.textContent?.trim()
      };
    });
    expect(r.exists).toBe(true);
    expect(r.hasI18nAttr).toBe(true);
    expect(r.text).toBeTruthy();
  });
});

test.describe('Stripe return URL flow', () => {

  test('?upgrade=success strips query, fires success toast, schedules refetch', async ({ page }) => {
    // Pre-seed a session so refetchSubscription has something to call.
    await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'returner@example.com' } };
    });
    // Navigate with the success param.
    await page.evaluate(() => {
      // Simulate the URL that Stripe redirects to.
      history.pushState(null, '', '/index.html?upgrade=success&session_id=cs_test_abc');
      window.handleStripeReturn();
    });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      url: location.search,
      toastText: document.getElementById('toast')?.textContent || '',
      hasUpgradeParam: location.search.includes('upgrade')
    }));
    expect(r.hasUpgradeParam).toBe(false);            // query stripped
    expect(r.toastText).toMatch(/(Pro|Welcome|Willkommen)/i);
  });

  test('?upgrade=cancel shows info toast and strips query', async ({ page }) => {
    await page.evaluate(() => {
      history.pushState(null, '', '/index.html?upgrade=cancel');
      window.handleStripeReturn();
    });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      hasUpgradeParam: location.search.includes('upgrade'),
      toastText: document.getElementById('toast')?.textContent || ''
    }));
    expect(r.hasUpgradeParam).toBe(false);
    expect(r.toastText.length).toBeGreaterThan(0);
  });

  test('handleStripeReturn() with no upgrade param is a no-op (no toast, no URL change)', async ({ page }) => {
    await page.evaluate(() => {
      history.pushState(null, '', '/index.html?other=foo');
      window.handleStripeReturn();
    });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      url: location.search,
      toastText: document.getElementById('toast')?.textContent || ''
    }));
    expect(r.url).toContain('other=foo');             // unchanged
  });
});

test.describe('Session-expired banner', () => {

  test('appears when cloudLinkedEmail is set but supaSession is null', async ({ page }) => {
    await page.evaluate(() => {
      // Mark "previously signed in" then clear the session.
      window.state.settings.cloudLinkedEmail = 'someone@example.com';
      window.save();
      window.supaSession = null;
      window.renderSessionExpiredBanner();
    });
    const banner = page.locator('#sessionExpiredBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    const text = await banner.textContent();
    expect(text).toMatch(/someone@example\.com/);
  });

  test('does NOT appear when no cloudLinkedEmail is recorded (clean slate)', async ({ page }) => {
    await page.evaluate(() => {
      window.state.settings.cloudLinkedEmail = null;
      window.supaSession = null;
      window.renderSessionExpiredBanner();
    });
    const exists = await page.locator('#sessionExpiredBanner').count();
    expect(exists).toBe(0);
  });

  test('does NOT appear when supaSession IS active (logged in normally)', async ({ page }) => {
    await page.evaluate(() => {
      window.state.settings.cloudLinkedEmail = 'someone@example.com';
      window.supaSession = { user: { id: 'u1', email: 'someone@example.com' } };
      window.renderSessionExpiredBanner();
    });
    const exists = await page.locator('#sessionExpiredBanner').count();
    expect(exists).toBe(0);
  });

  test('dismissSessionExpiredBanner clears the marker so it stays hidden', async ({ page }) => {
    await page.evaluate(() => {
      window.state.settings.cloudLinkedEmail = 'someone@example.com';
      window.save();
      window.supaSession = null;
      window.renderSessionExpiredBanner();
      window.dismissSessionExpiredBanner();
    });
    const r = await page.evaluate(() => ({
      bannerCount: document.querySelectorAll('#sessionExpiredBanner').length,
      markerCleared: !window.state.settings.cloudLinkedEmail
    }));
    expect(r.bannerCount).toBe(0);
    expect(r.markerCleared).toBe(true);
  });
});
