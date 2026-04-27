# Kids Coin Quest — Working Notes for Claude

Single-HTML-file kids' piggy-bank + RPG app. Live at **kidscoinquest.app**
(Netlify), with optional Supabase backend for cross-device sync + global
admin dashboard. Audio narration via OpenAI TTS-1-HD (Nova voice), served
from jsDelivr-over-GitHub for the heavy mp3s, same-origin for the manifest.

## Quick reference

| What | Where |
|---|---|
| Source | `index.html` (~17k lines, single file) |
| Service worker | `sw.js` (cache version `kcq-v9`) |
| Audio | `audio/<sha256-16hex>.mp3` (~700+ files) + `audio/manifest.json` |
| SQL migrations | `supabase-*.sql` in repo root |
| Tests | Playwright in `tests/` (run via `npx playwright test`) |
| Dev server | `python3 -m http.server 8765` (npm run serve) |
| Deploy | Push to `main` → Netlify auto-deploys (~1-2 min) |

## Supabase project

- **Project ref:** `dyfomoaxreoaceaakusg`
- **SQL editor link (always paste-and-run here):**
  https://supabase.com/dashboard/project/dyfomoaxreoaceaakusg/sql/new
- **Schema files (idempotent, run in order — ALL FIVE are required):**
  1. `supabase-schema.sql` (base tables + RLS + delete_my_account)
  2. `supabase-migration-2026-04-25-rpc.sql` (get_my_profile, list_my_families, admin_list_*)
  3. `supabase-migration-2026-04-26-admin-dashboard.sql` (admin_overview_stats, admin_families_detail, admin_login_activity)
  4. `supabase-migration-2026-04-26-admin-extensions.sql` (drill-down, charts, soft-delete, subscriptions table — adds 'family' tier temporarily)
  5. `supabase-migration-2026-04-26-pricing-update.sql` **(MANDATORY — drops 'family' tier, adds billing_period, finalizes 2-tier €3/€19.99 pricing)**

  Skipping #5 leaves the schema in an inconsistent 3-tier state where `admin_set_plan` still accepts `'family'` but the client expects 2 tiers — silent data drift on signup.

## Workflow when Sebastian needs to run SQL

**Always do this:**

1. Show the SQL **inline as a code block in chat**, in addition to writing it to a file. Sebastian doesn't read files in his editor — he wants to copy-paste straight from chat into Supabase.
2. Give the direct SQL-editor URL (`https://supabase.com/dashboard/project/dyfomoaxreoaceaakusg/sql/new`) so it's one click.
3. State explicitly that it's idempotent / safe to re-run.
4. After he runs it, prompt him to **hard-refresh the live site** (`Cmd+Shift+R`) so the SW pulls fresh code.

**Don't do this:**

- Don't just point at a file path and assume he'll open it.
- Don't bundle multiple "run this then that" SQL steps without making them obviously sequential and copy-paste-able.

## Workflow when committing changes

1. `git add -A && git commit -m "..."` (use HEREDOC for multi-line)
2. `git push origin main`
3. **State explicitly that Netlify will deploy in ~1-2 min** and tell Sebastian to hard-refresh.
4. If audio was generated: confirm jsDelivr typically picks up new mp3s within a few minutes too — but the manifest is same-origin so that's never the bottleneck.

## Service-worker cache busting

Bump `CACHE_VERSION` in `sw.js` (kcq-v9 → kcq-v10) when shipping changes Sebastian needs to see immediately. The activate handler purges old caches. After bumping, the test in `tests/narration-pipeline.spec.mjs` line ~138 needs to also be ≥ the new version — soft floor only, so v9 → v10 doesn't break the test.

## Audio pipeline (Nova narration)

```bash
# 1. Extract all narratable text from window.ADVENTURES → texts.json
npm run extract-audio          # = node scripts/extract-narration.mjs
                               # (needs dev server running on :8765)

# 2. Generate any missing mp3s via OpenAI TTS-1-HD (Nova voice)
node scripts/generate-audio.mjs
# Idempotent — only generates new hashes. Cost ~$0.03 per scene.
# Reads OPENAI_API_KEY from .env.

# 3. Verify 100% coverage
node -e "const m=require('./audio/manifest.json'),t=require('./audio/texts.json');let h=0;for(const x of t.texts)if(m[x.lang]&&m[x.lang][x.id])h++;console.log(h+'/'+t.texts.length)"
```

**Architecture v2 (Apr 2026):**
- `MANIFEST_BASE = ''` (same-origin) — Netlify ships `audio/manifest.json` with `Cache-Control: max-age=0`. SW handles it network-first.
- `AUDIO_BASE = 'https://cdn.jsdelivr.net/gh/derjungewalther/kids-coin-quest@main/'` in prod (mp3s are content-hashed, cache-forever).
- Audio unlock: silent `<audio>.play()` on first user gesture (iOS/Chrome-mobile autoplay).
- Pre-warm: `chooseAdventure()` prefetches intro + first 3 scene mp3s.
- Diagnostics: Settings → 🎙 Vertonung → Test button + debug log toggle.

## Adventure data shape

`ADVENTURES` array in index.html has 8 entries (as of 2026-04-26):
`grove`, `cave`, `castle`, `tower`, `volcano`, `fischer-sebastian`, `tiefer-amboss`, `aldwin-mondschein`.

Each adventure: `{id, icon, difficulty, minLevel, maxHp, title:{de,en}, summary:{de,en}, intro:{de,en}, victory:{de,en}, defeat:{de,en}, scenes: [...]}`.

Each scene either:
- **Choice (d20):** `{title:{de,en}, text:{de,en}, options:[{stat, dc, label, success, failure}]}`
- **Mini-game:** `{id, minigame:'memory|sort|rhythm|count|maze|spot', title:{de,en}, minigameConfig:{...}, text:{de,en}, success:{de,en}, failure:{de,en}}`

## Pricing model (Apr 2026 — final)

Two-tier model. **No Family tier** (Sebastian decided single-parent
single-account is enough).

| Tier | Price | Limits |
|---|---|---|
| **Free** | €0 | 3 adventures, max 2 heroes, local-only storage |
| **Pro** | **€3/mo** OR **€19.99/yr** (44% annual discount) | All 8 adventures, unlimited heroes, cloud sync, Nova narration |

Schema: `subscriptions.plan ∈ ('free', 'pro')`, `billing_period ∈ ('monthly', 'yearly', null)`.
- MRR: monthly Pro = €3 · yearly Pro = €19.99 / 12 ≈ €1.67
- ARR: monthly Pro × 12 = €36 · yearly Pro = €19.99
- These are calculated server-side in `admin_overview_stats()`.

**Feature gating is live** in the client code (Apr 2026):
- `isPro()` helper — true iff signed in AND `plan==='pro'` AND `status` in `('active','trialing')`
- Hero recruit: max 2 for free users (gate in `addKid()`)
- Adventure picker: free can only play `grove`, `bakery`, `fischer-sebastian` (rest show ⭐ Pro lock)
- Narration: free skips premium audio path → Web Speech only

**Stripe integration is wired up** via Supabase Edge Functions:
- `supabase/functions/create-checkout-session/` — creates Stripe Checkout, redirects user
- `supabase/functions/create-portal-session/` — opens Stripe Customer Portal for self-serve cancellation/plan change
- `supabase/functions/stripe-webhook/` — receives subscription events, syncs to `public.subscriptions`

Setup is one-time and documented in `STRIPE-SETUP.md`. The user (Sebastian)
must:
1. Create the Stripe product + prices + webhook endpoint
2. Set the 5 secrets via `supabase secrets set ...`
3. Deploy the 3 functions via `supabase functions deploy ...` (webhook needs `--no-verify-jwt`)

Until that's done, the "Upgrade to Pro" button shows the
`pricing_stripe_not_configured` toast. Admin manual plan-set via the
dashboard still works as a fallback.

When debugging Stripe:
- `supabase functions logs stripe-webhook --follow`
- Check `subscriptions` table directly in Supabase Table Editor

## Admin dashboard (Settings → 🛡 Globaler Admin)

Visible only when `supaProfile.is_admin === true`. Five tabs:
- **📊 Übersicht** — KPI cards + Trends sparklines (signups, logins, last 30d)
- **👨‍👩‍👧 Familien** — sortable+searchable table; click row → drill-down modal. Archive 🗄 / unarchive ↩ buttons. "Show archived" toggle.
- **🔑 Logins** — daily sign-in bars
- **🎯 Engagement** — streak distribution, hero distribution, top-5
- **💳 Pläne** — plan distribution + MRR + per-customer plan dropdown

CSV export button + ↻ Aktualisieren button in the section header.

To grant someone admin:
```sql
update public.profiles set is_admin = true where email = 'foo@bar.com';
```

## Common gotchas

- **`column reference "X" is ambiguous`** in plpgsql functions with `returns table(... X ...)`: add `#variable_conflict use_column` directive at top of function body. The OUT parameter shadows column refs by default.
- **`42P13: cannot change return type of existing function`**: when extending a `returns table(...)` signature (adding/changing OUT params), `create or replace` is rejected. Always prepend `drop function if exists public.<name>(<arg-types>);` before the create. Idempotent migrations need explicit DROP for any function whose signature might evolve.
- **Top-level `const X = ...` not visible to `page.evaluate(() => window.X)`**: top-level `const` is lexical-only, not on window. Use `var X` or add `window.X = X` after declaration.
- **jsDelivr edge cache** holds raw GitHub files ~7 days. **Never** put manifest-style files (lookup tables that must be in sync with the deploy) on jsDelivr. Same-origin only.
- **iOS/Chrome-mobile autoplay block:** `audio.play()` rejects without prior user gesture. The `narratorUnlocked` flag in `bindNarratorUnlock()` handles this with a silent base64 mp3 primed on first tap.
- **Service-worker stale code on live site** is the most common "this doesn't work" cause. First debug step: have Sebastian unregister the SW (DevTools → Application → Service Workers → Unregister) and hard-refresh.

## Existing tests we don't want to break

- `tests/r3-coverage.spec.mjs` — adventure framework, mini-games, narration variant pools
- `tests/narration-pipeline.spec.mjs` — same-origin manifest, audio unlock, pre-warm, SW version floor
- `tests/audit-2026-04-26.spec.mjs` — BUG-01 to BUG-23 regressions (incl. streak unification)
- `tests/adventure-filter.spec.mjs` — sort+filter UI
- `tests/visual.spec.mjs` — 99 captures × chromium/firefox/webkit baselines

Smoke command before pushing:
```bash
npx playwright test r3-coverage.spec.mjs narration-pipeline.spec.mjs --reporter=line
```

## Sebastian's preferences

- **German primary**, EN secondary. Always update both translation blocks together.
- **Likes step-by-step**: link → paste this block → click Run → hard-refresh. Don't make him hunt.
- **Hates SW cache**: when something doesn't work after a push, default to bumping `CACHE_VERSION` rather than blaming his browser.
- **Visual confirmation matters**: a small UX bug like "I see heroes but it says 'Anmelden'" is real and worth a polish-pass (cf. session-expired banner from 2026-04-26).
- **Doesn't want spawning lots of Stripe complexity** without explicit ask — current schema is "Stripe-ready" but actual webhook integration is a separate task.
