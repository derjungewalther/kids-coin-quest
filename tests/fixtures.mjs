/**
 * Shared test fixtures and helpers.
 * All tests load the app, then reach into `window` to call internal
 * functions via `page.evaluate()`. localStorage is reset before each test
 * so every run starts with the same clean seed state.
 */
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Start from a clean localStorage before the app code runs.
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch (e) {}
    });
    await page.goto('/index.html');
    // Wait for the app to finish wiring up (indicator: the Heroes tab is active)
    await page.waitForFunction(() => typeof window.effectiveStats === 'function');
    await use(page);
  }
});

export { expect };

/** Seed one hero via direct state manipulation (faster than clicking). */
export async function seedHero(page, opts = {}) {
  return await page.evaluate((o) => {
    const cls = o.class || 'warrior';
    const kid = {
      id: 'k_test_' + Math.random().toString(36).slice(2, 8),
      userName: o.userName || 'tester',
      name: o.name || 'Tester',
      avatar: '⚔️',
      class: cls,
      stats: window.makeStats(cls),
      balance: o.balance || 0,
      totalEarned: o.totalEarned || 0,
      totalPaidOut: 0,
      portrait: null,
      inventory: [],
      equipment: { hat: null, armor: null, weapon: null, accessory: null },
      features: window.generateFeatures ? window.generateFeatures('seed') : null,
      xp: o.xp || { brave: 0, clever: 0, kind: 0 }
    };
    window.state.kids.push(kid);
    window.save();
    if (window.renderKids) window.renderKids();
    return kid.id;
  }, opts);
}

/** Set a parent PIN directly in state (bypasses the setup modal). */
export async function setPin(page, pin) {
  return await page.evaluate(async (p) => {
    const enc = new TextEncoder().encode('coinquest-pin:' + p);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    window.state.settings.parentPinHash = hex;
    window.save();
    // Flag in-session verification so we don't need to re-enter for tests
    window.pinVerified = false;
  }, pin);
}
