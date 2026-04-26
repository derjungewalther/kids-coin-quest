// Extracts every piece of narratable text from the app's ADVENTURES data
// block and writes a stable, flat list to audio/texts.json.
//
// Each entry is:
//   { id: short hash of (lang + '|' + text), lang: 'en'|'de', text: '...' }
//
// Re-running with new/changed text only adds new hashes; existing ones stay
// unchanged, so generated audio doesn't need to be re-rendered wholesale.
//
// Usage:
//   npm run serve          # in one terminal
//   npm run extract-audio  # in another
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'audio');
const OUT_FILE = resolve(OUT_DIR, 'texts.json');

function shortHash(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function push(bucket, lang, text) {
  if (!text || typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = shortHash(lang + '|' + trimmed);
  bucket[id] = { id, lang, text: trimmed };
}

// Helper: walk an R3-S3 narration pool. Two shapes are supported,
// matching getNarration() in index.html:
//   1. Flat pools by kind:    { intro: [...], success: [...], fail: [...] }
//   2. Locale-bucketed pools:  { de: { intro: [...] }, en: { intro: [...] } }
// We also tolerate a string in place of an array (a single-variant pool).
function walkNarrationPool(bucket, narration) {
  if (!narration || typeof narration !== 'object') return;
  // Detect shape: locale-bucketed first because the keys are 'de'/'en'.
  if (narration.de || narration.en) {
    for (const lang of ['de', 'en']) {
      const b = narration[lang];
      if (!b || typeof b !== 'object') continue;
      walkPoolKinds(bucket, lang, b);
    }
    return;
  }
  // Flat pool — every kind contains an array of strings or a single string.
  // Flat pools have no language information attached, so we push the same
  // text into BOTH language buckets. The hash differs per language because
  // the id includes the lang prefix; in practice flat pools should be
  // avoided for bilingual apps.
  for (const lang of ['de', 'en']) walkPoolKinds(bucket, lang, narration);
}
function walkPoolKinds(bucket, lang, kindMap) {
  for (const kind of Object.keys(kindMap)) {
    const v = kindMap[kind];
    if (Array.isArray(v)) v.forEach(s => push(bucket, lang, s));
    else if (typeof v === 'string') push(bucket, lang, v);
  }
}

function walkAdventures(ADVENTURES) {
  const bucket = {};
  for (const adv of ADVENTURES) {
    ['en', 'de'].forEach(lang => {
      push(bucket, lang, adv.intro && adv.intro[lang]);
      push(bucket, lang, adv.victory && adv.victory[lang]);
      push(bucket, lang, adv.defeat && adv.defeat[lang]);
    });
    // R3-S3 — adventure-level adventureNarration variant pools, used by
    // some custom adventures for taglines/intros/outros.
    walkNarrationPool(bucket, adv.adventureNarration);
    for (const sc of adv.scenes || []) {
      ['en', 'de'].forEach(lang => {
        push(bucket, lang, sc.text && sc.text[lang]);
        push(bucket, lang, sc.question && sc.question[lang]); // puzzles
        // success/failure text attached to the scene itself (puzzle/mem/seq)
        push(bucket, lang, sc.success && sc.success[lang]);
        push(bucket, lang, sc.failure && sc.failure[lang]);
        // choice options
        for (const opt of sc.options || []) {
          push(bucket, lang, opt.success && opt.success[lang]);
          push(bucket, lang, opt.failure && opt.failure[lang]);
        }
        // split-scene per-task outcomes
        for (const task of sc.tasks || []) {
          push(bucket, lang, task.success && task.success[lang]);
          push(bucket, lang, task.failure && task.failure[lang]);
        }
      });
      // R3-S3 — per-scene narration variant pools (Fischer Sebastian
      // and any future pool-based adventure). Each variant string in
      // every kind (intro / callToAction / success / fail) gets its
      // own hash + mp3, so the kid hears a different recording on
      // each replay even though the underlying scene is identical.
      walkNarrationPool(bucket, sc.narration);
    }
  }
  return Object.values(bucket);
}

(async () => {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.ADVENTURES) && window.ADVENTURES.length > 0);
  const adventures = await page.evaluate(() => JSON.parse(JSON.stringify(window.ADVENTURES)));
  await browser.close();

  const texts = walkAdventures(adventures);
  texts.sort((a, b) => a.lang.localeCompare(b.lang) || a.id.localeCompare(b.id));

  const totalChars = texts.reduce((s, t) => s + t.text.length, 0);
  const perLang = texts.reduce((acc, t) => { acc[t.lang] = (acc[t.lang] || 0) + 1; return acc; }, {});

  writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), texts }, null, 2));

  console.log(`Wrote ${texts.length} entries → ${OUT_FILE}`);
  console.log(`  per language: ${JSON.stringify(perLang)}`);
  console.log(`  total characters: ${totalChars.toLocaleString()}`);
  console.log();
  console.log(`Estimated TTS cost:`);
  console.log(`  OpenAI tts-1      (standard): $${(totalChars * 15 / 1_000_000).toFixed(2)}`);
  console.log(`  OpenAI tts-1-hd   (high-q):   $${(totalChars * 30 / 1_000_000).toFixed(2)}`);
  console.log(`  OpenAI gpt-4o-mini-tts:       $${(totalChars * 12 / 1_000_000).toFixed(2)}  (preview; char pricing indicative)`);
  console.log(`  ElevenLabs (Starter ~$5/30k chars): ~$${Math.ceil(totalChars / 30000 * 5)}`);
})();
