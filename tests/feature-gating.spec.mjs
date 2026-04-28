/**
 * Feature gating: Free vs Pro enforcement.
 *
 * Pins the behaviour added in commit 5c7f700:
 *   - Free max 2 heroes (FREE_TIER_HERO_LIMIT)
 *   - Free can play only 3 adventures (FREE_TIER_ADVENTURE_IDS)
 *   - Free skips premium narration (Web Speech only)
 *   - isPro() / getMyPlan() honour subscription.status
 *
 * The gates exist on the client for UX — the server is the source of
 * truth. These tests pin the client behaviour so a refactor doesn't
 * silently regress and let free users skate past the gates.
 */
import { test, expect, seedHero } from './fixtures.mjs';

test.describe('Feature gating · isPro / getMyPlan', () => {

  test('anonymous user (no session) reports plan=free, isPro=false', async ({ page }) => {
    const r = await page.evaluate(() => ({
      plan: window.getMyPlan(),
      pro: window.isPro()
    }));
    expect(r.plan).toBe('free');
    expect(r.pro).toBe(false);
  });

  test('signed-in free user reports plan=free, isPro=false', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'free@example.com' } };
      window.supaSubscription = { plan: 'free', status: 'active', billing_period: null };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('free');
    expect(r.pro).toBe(false);
  });

  test('active pro subscription unlocks isPro()', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'pro@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'active', billing_period: 'monthly' };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('pro');
    expect(r.pro).toBe(true);
  });

  test('canceled pro subscription DOWNGRADES to free in both helpers', async ({ page }) => {
    // Critical: was a real bug in earlier commits. getMyPlan returned
    // 'pro' for canceled subs while isPro() returned false, so the
    // Account-panel pill said "⭐ Pro" but feature gates locked. UX
    // disagreed with itself.
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'lapsed@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'canceled', billing_period: 'monthly' };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('free');
    expect(r.pro).toBe(false);
  });

  test('trialing status counts as Pro', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'trial@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'trialing', billing_period: 'monthly' };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('pro');
    expect(r.pro).toBe(true);
  });

  test('past_due status does NOT count as Pro', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'pastdue@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'past_due', billing_period: 'monthly' };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('free');
    expect(r.pro).toBe(false);
  });

  test('admin always counts as Pro, even with plan=free subscription', async ({ page }) => {
    // Admins shouldn't be feature-gated — they need full access for
    // testing, support, dogfooding. Without this exemption, the team
    // running the app silently gets Web Speech instead of Nova etc.
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'admin1', email: 'admin@example.com' } };
      window.supaProfile = { user_id: 'admin1', email: 'admin@example.com', is_admin: true };
      window.supaSubscription = { plan: 'free', status: 'active', billing_period: null };
      return { plan: window.getMyPlan(), pro: window.isPro() };
    });
    expect(r.plan).toBe('pro');
    expect(r.pro).toBe(true);
  });
});

test.describe('Feature gating · hero limit', () => {

  test('free user can recruit up to FREE_TIER_HERO_LIMIT heroes', async ({ page }) => {
    const limit = await page.evaluate(() => window.FREE_TIER_HERO_LIMIT);
    expect(limit).toBe(2);
    await seedHero(page, { userName: 'a', name: 'Anna' });
    await seedHero(page, { userName: 'b', name: 'Bea' });
    const count = await page.evaluate(() => window.state.kids.length);
    expect(count).toBe(2);
  });

  test('addKid() blocks the 3rd hero for free user and opens pricing modal', async ({ page }) => {
    // Seed 2 heroes (at the limit) — direct state push to bypass the gate.
    await seedHero(page, { userName: 'a', name: 'Anna' });
    await seedHero(page, { userName: 'b', name: 'Bea' });
    // Now try to add a third via the actual addKid() flow.
    const result = await page.evaluate(() => {
      // Open the recruit modal so the form fields exist.
      window.openAddKidModal();
      // Fill the form with a 3rd hero.
      document.getElementById('newKidName').value = 'Carla';
      document.getElementById('newKidUserName').value = 'carla';
      // Pick a class so addKid() doesn't refuse on missing class.
      window.selectedClass = 'magician';
      // Track whether the pricing modal is opened.
      const before = document.getElementById('pricingModal')?.classList.contains('open');
      window.addKid();
      return {
        kidsAfter: window.state.kids.length,
        pricingOpenBefore: before,
        pricingOpenAfter: document.getElementById('pricingModal')?.classList.contains('open')
      };
    });
    expect(result.kidsAfter).toBe(2);                  // 3rd was blocked
    expect(result.pricingOpenBefore).toBeFalsy();
    expect(result.pricingOpenAfter).toBe(true);        // pricing modal triggered
  });

  test('Pro user can recruit beyond the free limit', async ({ page }) => {
    // Promote to Pro first.
    await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1', email: 'pro@example.com' } };
      window.supaSubscription = { plan: 'pro', status: 'active', billing_period: 'monthly' };
    });
    await seedHero(page, { userName: 'a' });
    await seedHero(page, { userName: 'b' });
    // Now add a 3rd via the form.
    const result = await page.evaluate(() => {
      window.openAddKidModal();
      document.getElementById('newKidName').value = 'Carla';
      document.getElementById('newKidUserName').value = 'carla';
      window.selectedClass = 'magician';
      window.addKid();
      return { kidsAfter: window.state.kids.length };
    });
    expect(result.kidsAfter).toBe(3);
  });
});

test.describe('Feature gating · adventure tier lock', () => {

  test('FREE_TIER_ADVENTURE_IDS is exactly the documented 3', async ({ page }) => {
    const ids = await page.evaluate(() => window.FREE_TIER_ADVENTURE_IDS);
    expect(ids).toEqual(['grove', 'bakery', 'fischer-sebastian']);
  });

  test('adventureLockReason returns "tier" for non-free adventures (free user)', async ({ page }) => {
    await seedHero(page, { userName: 'h', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    const r = await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      const adv = window.ADVENTURES.find(a => a.id === 'crypt');
      return window.adventureLockReason(adv);
    });
    expect(r).toBe('tier');
  });

  test('adventureLockReason returns null for free-tier adventures (free user)', async ({ page }) => {
    await seedHero(page, { userName: 'h', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    const reasons = await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      return ['grove', 'bakery', 'fischer-sebastian'].map(id =>
        window.adventureLockReason(window.ADVENTURES.find(a => a.id === id))
      );
    });
    expect(reasons).toEqual([null, null, null]);
  });

  test('chooseAdventure on a tier-locked adventure opens pricing modal (no party traversal)', async ({ page }) => {
    await seedHero(page, { userName: 'h', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    const r = await page.evaluate(() => {
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('crypt');
      return {
        modalOpen: document.getElementById('pricingModal')?.classList.contains('open'),
        adventureMode: window.adventureState.mode  // 'select' = blocked, 'intro' = bypassed
      };
    });
    expect(r.modalOpen).toBe(true);
    expect(r.adventureMode).toBe('select');  // never advanced past picker
  });

  test('Pro user bypasses the tier lock and can start any adventure', async ({ page }) => {
    await seedHero(page, { userName: 'h', xp: { brave: 9999, clever: 9999, kind: 9999 } });
    const r = await page.evaluate(() => {
      window.supaSession = { user: { id: 'u1' } };
      window.supaSubscription = { plan: 'pro', status: 'active', billing_period: 'monthly' };
      window.adventureState.party = [window.state.kids[0].id];
      window.chooseAdventure('crypt');
      return {
        modalOpen: document.getElementById('pricingModal')?.classList.contains('open'),
        adventureId: window.adventureState.adventureId,
        adventureMode: window.adventureState.mode
      };
    });
    expect(r.modalOpen).toBeFalsy();
    expect(r.adventureId).toBe('crypt');
    expect(r.adventureMode).toBe('intro');
  });
});

test.describe('Narrator · Nova for everyone (free + pro)', () => {

  // Nova narration is NOT a paywall feature — it's part of the
  // experience for all users. Apr 2026: a brief gating attempt was
  // reversed because users (incl. Sebastian) lost the premium voice
  // for adventures they'd been hearing it on.

  test('free user → narrate() takes the premium path (calls loadNarratorManifest)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // Anonymous / free — no session, no subscription.
      window.state.settings.narratorOn = true;
      let manifestCalls = 0;
      const orig = window.loadNarratorManifest;
      window.loadNarratorManifest = (...a) => { manifestCalls++; return orig(...a); };
      window.playPrerenderedAudio = async () => true;
      window.narrate('A unique phrase 12345');
      await new Promise(r => setTimeout(r, 200));
      window.loadNarratorManifest = orig;
      return { manifestCalls };
    });
    expect(r.manifestCalls).toBeGreaterThanOrEqual(1);
  });

  test('pro user → narrate() also takes the premium path', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.supaSession = { user: { id: 'u1' } };
      window.supaSubscription = { plan: 'pro', status: 'active', billing_period: 'monthly' };
      window.state.settings.narratorOn = true;
      let manifestCalls = 0;
      const orig = window.loadNarratorManifest;
      window.loadNarratorManifest = (...a) => { manifestCalls++; return orig(...a); };
      window.playPrerenderedAudio = async () => true;
      window.narrate('Another unique phrase 67890');
      await new Promise(r => setTimeout(r, 200));
      window.loadNarratorManifest = orig;
      return { manifestCalls };
    });
    expect(r.manifestCalls).toBeGreaterThanOrEqual(1);
  });

  test('narrator off → no speak, no fetch (regardless of plan)', async ({ page }) => {
    const audioFetches = [];
    page.on('request', r => {
      if (/\/audio\/[a-f0-9]{16}\.mp3$/i.test(r.url())) audioFetches.push(r.url());
    });
    const r = await page.evaluate(() => {
      window.state.settings.narratorOn = false;
      let speakCalls = 0;
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = () => { speakCalls++; };
      window.narrate('Should be silent.');
      window.speechSynthesis.speak = orig;
      return { speakCalls };
    });
    await page.waitForTimeout(300);
    expect(r.speakCalls).toBe(0);
    expect(audioFetches.length).toBe(0);
  });
});
